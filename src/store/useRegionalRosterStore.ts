// Persistent, per-region, per-save live state for the "ranked grinder" identity pool (see
// regionalGrinders.ts). Same simulated-background-games model as useLeaderboardFillerStore/
// useProLeaderboardStore (Elo-style deltas, placement games, gradual stat growth per game), but keyed by
// region AND scoped per save (mirrors useTournamentStore.ts's loadForSave/per-save-id storage key pattern)
// rather than the older two stores' single-shared-key approach — the entire point of this store is "you've
// met this AI before", so it must not bleed between unrelated save profiles the way the older stores do.

import { create } from "zustand";
import { tierMinMmr, mmrEraInflation, realisticOneVOneMmr, type RankEra } from "@/data/rankSystem";
import { hashString } from "@/data/proPlayers";
import { estimateGameSenseForMmr, eloExpectedScore, eloKFactor } from "@/data/matchSim";
import type { QueueMode } from "@/data/mockSave";
import type { ProRegion } from "@/data/proPlayers";
import { regionalGrinderRoster, type RosterBand } from "@/data/regionalGrinders";
import { daysBetween, type SimDate } from "@/data/dateUtils";
import { softResetMmr, seasonActivityMultiplier, AI_PLACEMENT_GAMES_REQUIRED, PLACEMENT_MMR_AMPLIFIER } from "@/data/seasons";

const STORAGE_KEY_PREFIX = "rl-sim:regional-roster-v1";

let activeSaveId: string | null = null;

function storageKeyFor(saveId: string | null): string {
  return `${STORAGE_KEY_PREFIX}:${saveId ?? "unsaved"}`;
}

/** Raw (already-JSON-string) regional-grinder progress for one save, read verbatim — see
 *  useTournamentStore.ts's `exportTournamentDataForSave` for why this exists: this store's per-save blob
 *  lives outside the SaveData object entirely, so a plain save export/import would otherwise silently
 *  leave every grinder identity's tracked progress behind. */
export function exportRegionalRosterDataForSave(saveId: string): string | null {
  return localStorage.getItem(storageKeyFor(saveId));
}

/** Writes a previously-exported blob into storage under a NEW save id — a plain localStorage write, the
 *  normal `loadForSave` call that happens whenever a save is actually opened picks it up from here. */
export function importRegionalRosterDataForSave(saveId: string, data: string | null | undefined): void {
  try {
    if (data) localStorage.setItem(storageKeyFor(saveId), data);
  } catch {
    // Storage full/unavailable, the imported roster progress just won't carry over this session.
  }
}

const GAMES_PER_DAY_MIN = 1.0;
const GAMES_PER_DAY_SPREAD = 1.6;
const PLACEMENT_GAMES = AI_PLACEMENT_GAMES_REQUIRED;
const ELO_K_PLACEMENT = 60;
const STAT_CLOSE_RATE = 0.03;
const MAX_GAMES_PER_CATCHUP = 300;

// How far above (or, for Low, below) the bare top-tier floor a band's target MMR reaches, and how wide its
// own spread is within that — Super High reaches well past the floor, Low sits solidly BELOW it (real
// Champion/GC-tier ranked-ladder regulars, "not remotely pro-caliber", the exact phrase
// `eligibleRealPlayersForRegion` already uses to exclude this band from real RLCS rosters). Mirrors the
// shape (not the exact numbers) of useLeaderboardFillerStore's flat "floor + 100 + hash%450". Low used to
// sit AT the floor (fraction 0), which meant a randomly-generated grinder nobody's ever heard of could
// always clear the Top 100 leaderboard's own floor threshold just by existing — since Low is also,
// deliberately, the single most common band (65% of all grinders, see LOW_BAND_SHARE), that's what was
// crowding real pros' recognizable names off the top of the leaderboard.
const BAND_FLOOR_FRACTION: Record<RosterBand, number> = { low: -0.35, mid: 0.2, high: 0.45, super_high: 0.75 };
const BAND_SPREAD: Record<RosterBand, number> = { low: 250, mid: 350, high: 500, super_high: 700 };
const BAND_CEILING_SPAN = 900;

export interface RosterMmrEntry {
  mmr: number;
  gameSense: number;
  mechanicalConsistency: number;
  gamesPlayedThisSeason: number;
  targetMmr: number;
  targetGameSense: number;
  targetMechanicalConsistency: number;
  seasonStartKey: string;
  band: RosterBand;
  /** Highest MMR this grinder/queue has ever actually reached, carried forward across every season reset —
   *  same "all-time best" concept as the player's own RankedProfile.peakMmr, shown on the AI profile view. */
  peakMmr: number;
}

type RegionMmrTable = Record<string, Partial<Record<QueueMode, RosterMmrEntry>>>;
type RosterMmrTable = Partial<Record<ProRegion, RegionMmrTable>>;

/** Deterministic stand-in for Math.random() in the catch-up walk below - same seed always produces the
 *  same [0,1) roll. The catch-up walk gets re-run from the same starting point more often than a purely
 *  in-memory simulation would (any read while off-season/mid-catch-up recomputes it), so using REAL
 *  Math.random() there meant re-visiting a leaderboard could reroll the same batch of "already happened"
 *  games and land on a genuinely different final MMR each time - the exact "everyone's numbers keep
 *  changing" bug this fixes. Keying by the game's own absolute index makes the whole walk a pure function
 *  of the starting entry, so replaying it is idempotent no matter how many times it's re-triggered. */
function seededRoll(seed: string): number {
  return (hashString(seed) % 1_000_000) / 1_000_000;
}

function seasonKey(seasonStartDate: SimDate): string {
  return `${seasonStartDate.year}-${seasonStartDate.month}-${seasonStartDate.day}`;
}

function gamesPerDay(name: string, region: ProRegion): number {
  return GAMES_PER_DAY_MIN + (hashString(name + region + "#pace") % 100) / 100 * GAMES_PER_DAY_SPREAD;
}

/** A grinder's target MMR is a stable, band+name-seeded spot within the top bracket, never a fresh random
 *  roll — the same identity always lands in roughly the same ceiling season to season, scaled by which
 *  density band they were generated into. Target skill reads straight off the same MMR->Game Sense curve
 *  every other opponent in the sim uses. */
function reseedEntry(
  name: string,
  region: ProRegion,
  band: RosterBand,
  queue: QueueMode,
  era: RankEra,
  currentYear: number,
  seasonStartDate: SimDate,
  previous: RosterMmrEntry | undefined
): RosterMmrEntry {
  const floor = tierMinMmr(era === "modern" ? "ssl" : "grand_champion", era, queue);
  // 1v1's own post-compression realisticOneVOneMmr squashes the top of the ladder toward the real-world
  // record - feeding it a wider raw spread than 2v2/3v3 get is what actually keeps that squash from reading
  // as "everyone near the top converges on the same 2-3 numbers" (a narrow raw cluster compresses to an
  // even narrower one, no matter how the compression curve itself is tuned - the fix has to happen before
  // that step, giving the population genuine variety to begin with).
  const spreadRange = queue === "1v1" ? BAND_SPREAD[band] * 2.5 : BAND_SPREAD[band];
  const ceilingSpan = queue === "1v1" ? BAND_CEILING_SPAN * 1.4 : BAND_CEILING_SPAN;
  const spread = hashString(`${name}${region}${queue}`) % spreadRange;
  // "low" band deliberately sits out the era creep below — those are just regular ranked-ladder regulars,
  // not remotely leaderboard/RLCS caliber, and shouldn't drift toward SSL+ just because the years pass.
  // Every other band tracks the same rising ceiling real pros get (see proPlayers.ts's seedProMmr), which
  // is what actually makes the Top 50 board's floor climb season over season rather than just the real
  // pros individually pulling away from an otherwise-static grinder pool.
  const inflation = band === "low" ? 0 : mmrEraInflation(currentYear, era);
  const rawTargetMmr = floor + BAND_FLOOR_FRACTION[band] * ceilingSpan + spread + inflation;
  const targetMmr = queue === "1v1" ? realisticOneVOneMmr(rawTargetMmr) : rawTargetMmr;
  const targetGameSense = estimateGameSenseForMmr(targetMmr, era, queue, currentYear);
  const targetMechanicalConsistency = targetGameSense * 0.9;

  // A real season reset hits everyone's actual rank the same way regardless of AI type — the same soft
  // reset (toward baseline 600, keeping 70% of the prior gap) the player's own MMR gets, not a separate,
  // much milder compression toward a permanently-elite floor. Resetting from `previous.mmr` directly would
  // let a grinder who happened to be caught mid-climb (an entry only reseeds/simulates when actually
  // queried, so it can be snapshotted anywhere between a past reset and its real target) get soft-reset
  // from that partial, already-low number — compounding downward every season they aren't looked at often
  // enough to fully catch up first. Resetting from their best-demonstrated level instead (all-time peak, or
  // their current target if that's even higher) keeps every reset anchored to how good they actually are.
  const priorMmr = previous ? Math.max(previous.mmr, previous.peakMmr ?? previous.mmr, targetMmr) : targetMmr;
  const mmr = previous ? softResetMmr(priorMmr) : targetMmr;

  // Only MMR gets soft-reset each ranked season (the same global, everyone-at-once 84-day cadence the
  // player's own rank resets on) — Game Sense/Mechanical Consistency are real persistent skill, not a
  // per-season ladder number, so a season boundary never touches them, they just carry forward untouched.
  const gameSense = previous ? previous.gameSense : targetGameSense;
  const mechanicalConsistency = previous ? previous.mechanicalConsistency : targetMechanicalConsistency;

  return {
    mmr,
    gameSense,
    mechanicalConsistency,
    gamesPlayedThisSeason: 0,
    targetMmr,
    targetGameSense,
    targetMechanicalConsistency,
    seasonStartKey: seasonKey(seasonStartDate),
    band,
    peakMmr: Math.max(previous?.peakMmr ?? 0, priorMmr, mmr, targetMmr),
  };
}

function simulateForward(entry: RosterMmrEntry, name: string, region: ProRegion, currentDate: SimDate, seasonStartDate: SimDate): RosterMmrEntry {
  const daysIn = Math.max(0, daysBetween(seasonStartDate, currentDate));
  // Real grinders no-life ranked right after a reset to reclaim their rank, and again near season's end
  // grinding for rewards — see seasonActivityMultiplier's doc comment.
  const expectedGames = Math.floor(daysIn * gamesPerDay(name, region) * seasonActivityMultiplier(daysIn));
  const gamesBehind = expectedGames - entry.gamesPlayedThisSeason;
  if (gamesBehind <= 0) return entry;

  if (gamesBehind > MAX_GAMES_PER_CATCHUP) {
    return {
      ...entry,
      mmr: Math.round(entry.targetMmr),
      gameSense: Math.round(entry.targetGameSense),
      mechanicalConsistency: Math.round(entry.targetMechanicalConsistency),
      gamesPlayedThisSeason: expectedGames,
      peakMmr: Math.max(entry.peakMmr, entry.targetMmr),
    };
  }

  let { mmr, gameSense, mechanicalConsistency, gamesPlayedThisSeason, peakMmr } = entry;
  for (let i = 0; i < gamesBehind; i++) {
    const isPlacement = gamesPlayedThisSeason < PLACEMENT_GAMES;
    const gameSeed = `${name}${region}#catchup#${gamesPlayedThisSeason}`;
    const oppRating = mmr + (seededRoll(gameSeed + "#opp") - 0.5) * 2 * 350;
    const expected = eloExpectedScore(mmr, oppRating);
    const skillPull = (entry.targetMmr - mmr) / 1600;
    const winProb = Math.max(0.05, Math.min(0.95, expected + skillPull));
    const won = seededRoll(gameSeed + "#win") < winProb;
    const k = isPlacement ? ELO_K_PLACEMENT : eloKFactor(mmr);
    mmr = Math.max(0, mmr + k * ((won ? 1 : 0) - expected));
    gameSense += (entry.targetGameSense - gameSense) * STAT_CLOSE_RATE;
    mechanicalConsistency += (entry.targetMechanicalConsistency - mechanicalConsistency) * STAT_CLOSE_RATE;
    gamesPlayedThisSeason++;
    peakMmr = Math.max(peakMmr, mmr);
  }

  return {
    ...entry,
    mmr: Math.round(mmr),
    gameSense: Math.round(gameSense),
    mechanicalConsistency: Math.round(mechanicalConsistency),
    gamesPlayedThisSeason,
    peakMmr: Math.round(peakMmr),
  };
}

function catchUp(
  existing: RosterMmrEntry | undefined,
  name: string,
  region: ProRegion,
  band: RosterBand,
  queue: QueueMode,
  era: RankEra,
  currentYear: number,
  currentDate: SimDate,
  seasonStartDate: SimDate
): RosterMmrEntry {
  const key = seasonKey(seasonStartDate);
  const base = existing && existing.seasonStartKey === key ? existing : reseedEntry(name, region, band, queue, era, currentYear, seasonStartDate, existing);
  // Guards against a pre-existing localStorage entry saved before `peakMmr` was tracked at all.
  const safeBase = typeof base.peakMmr === "number" ? base : { ...base, peakMmr: base.mmr };
  const result = simulateForward(safeBase, name, region, currentDate, seasonStartDate);
  // simulateForward's own game-by-game ELO walk pulls toward targetMmr (already realistically clamped, see
  // reseedEntry) but doesn't hard-bound the walk itself - a long enough win streak can still random-walk
  // past it, so 1v1 needs a final clamp here too.
  if (queue !== "1v1") return result;
  return { ...result, mmr: Math.round(realisticOneVOneMmr(result.mmr)), peakMmr: Math.round(realisticOneVOneMmr(result.peakMmr)) };
}

function loadStored(): RosterMmrTable {
  try {
    const raw = localStorage.getItem(storageKeyFor(activeSaveId));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function persist(table: RosterMmrTable) {
  try {
    localStorage.setItem(storageKeyFor(activeSaveId), JSON.stringify(table));
  } catch {
    // Storage full/unavailable, the regional roster just won't persist across reloads this session.
  }
}

/** Looks up a grinder identity's fixed band from the deterministic roster (never stored — it's cheap and
 *  pure to regenerate). Returns undefined if `name` isn't a grinder in `region` at all (e.g. it's a real
 *  pro, or belongs to a different region). */
function findGrinder(name: string, region: ProRegion, currentYear: number) {
  return regionalGrinderRoster(region, currentYear).find((g) => g.name === name);
}

/** Where a REAL PRO's own live MMR (not a grinder's, which already has a fixed band) sits on the same
 *  band scale grinders use — lets pickName weight pros and grinders on one consistent scale rather than
 *  treating "is this a pro" as its own separate axis. Exported for matchmakingPool.ts. */
export function bandForMmr(mmr: number, era: RankEra, queue: QueueMode): RosterBand {
  const floor = tierMinMmr(era === "modern" ? "ssl" : "grand_champion", era, queue);
  const fraction = Math.max(0, (mmr - floor) / BAND_CEILING_SPAN);
  if (fraction >= BAND_FLOOR_FRACTION.super_high) return "super_high";
  if (fraction >= BAND_FLOOR_FRACTION.high) return "high";
  if (fraction >= BAND_FLOOR_FRACTION.mid) return "mid";
  return "low";
}

interface RegionalRosterState {
  mmr: RosterMmrTable;
  getMmr: (name: string, region: ProRegion, queue: QueueMode, era: RankEra, currentYear: number, currentDate: SimDate, seasonStartDate: SimDate) => number;
  getStats: (name: string, region: ProRegion, queue: QueueMode, era: RankEra, currentYear: number, currentDate: SimDate, seasonStartDate: SimDate) => { gameSense: number; mechanicalConsistency: number; peakMmr: number };
  /** Batches catch-up for every grinder identity in a region, in one `set` call. Call from a `useEffect`. */
  ensureSeeded: (region: ProRegion, queue: QueueMode, era: RankEra, currentYear: number, currentDate: SimDate, seasonStartDate: SimDate) => void;
  applyResult: (name: string, region: ProRegion, queue: QueueMode, mmrDelta: number, era: RankEra, currentYear: number, seasonStartDate: SimDate) => void;
  /** Dev-tools only: re-seeds every region's grinder roster from scratch. */
  resetAll: (era: RankEra, currentYear: number, seasonStartDate: SimDate) => void;
  /** Switches this store over to a different save's roster history, mirrors useTournamentStore.ts. */
  loadForSave: (saveId: string) => void;
}

export const useRegionalRosterStore = create<RegionalRosterState>((set, get) => ({
  mmr: loadStored(),

  getMmr: (name, region, queue, era, currentYear, currentDate, seasonStartDate) => {
    const grinder = findGrinder(name, region, currentYear);
    if (!grinder) return 0;
    const state = get();
    const entry = catchUp(state.mmr[region]?.[name]?.[queue], name, region, grinder.band, queue, era, currentYear, currentDate, seasonStartDate);
    const nextTable: RosterMmrTable = { ...state.mmr, [region]: { ...state.mmr[region], [name]: { ...state.mmr[region]?.[name], [queue]: entry } } };
    set({ mmr: nextTable });
    persist(nextTable);
    return entry.mmr;
  },

  getStats: (name, region, queue, era, currentYear, currentDate, seasonStartDate) => {
    const grinder = findGrinder(name, region, currentYear);
    if (!grinder) return { gameSense: 0, mechanicalConsistency: 0, peakMmr: 0 };
    const state = get();
    const entry = catchUp(state.mmr[region]?.[name]?.[queue], name, region, grinder.band, queue, era, currentYear, currentDate, seasonStartDate);
    const nextTable: RosterMmrTable = { ...state.mmr, [region]: { ...state.mmr[region], [name]: { ...state.mmr[region]?.[name], [queue]: entry } } };
    set({ mmr: nextTable });
    persist(nextTable);
    return { gameSense: entry.gameSense, mechanicalConsistency: entry.mechanicalConsistency, peakMmr: entry.peakMmr };
  },

  ensureSeeded: (region, queue, era, currentYear, currentDate, seasonStartDate) => {
    const state = get();
    const nextRegionTable = { ...state.mmr[region] };
    let changed = false;
    for (const grinder of regionalGrinderRoster(region, currentYear)) {
      const entry = catchUp(nextRegionTable[grinder.name]?.[queue], grinder.name, region, grinder.band, queue, era, currentYear, currentDate, seasonStartDate);
      nextRegionTable[grinder.name] = { ...nextRegionTable[grinder.name], [queue]: entry };
      changed = true;
    }
    if (!changed) return;
    const nextTable = { ...state.mmr, [region]: nextRegionTable };
    set({ mmr: nextTable });
    persist(nextTable);
  },

  applyResult: (name, region, queue, mmrDelta, era, currentYear, seasonStartDate) => {
    const grinder = findGrinder(name, region, currentYear);
    if (!grinder) return;
    const state = get();
    const key = seasonKey(seasonStartDate);
    const existing = state.mmr[region]?.[name]?.[queue];
    const rawEntry = existing && existing.seasonStartKey === key ? existing : reseedEntry(name, region, grinder.band, queue, era, currentYear, seasonStartDate, existing);
    const entry = typeof rawEntry.peakMmr === "number" ? rawEntry : { ...rawEntry, peakMmr: rawEntry.mmr };
    // Still mid-placement this season — a real match played directly against this grinder should swing them
    // the same amplified way a real placement result would, not the flat few-point delta an ordinary ranked
    // result gets.
    const effectiveDelta = entry.gamesPlayedThisSeason < PLACEMENT_GAMES ? Math.round(mmrDelta * PLACEMENT_MMR_AMPLIFIER) : mmrDelta;
    const rawMmr = Math.max(0, entry.mmr + effectiveDelta);
    const nextMmr = queue === "1v1" ? realisticOneVOneMmr(rawMmr) : rawMmr;
    const nextEntry: RosterMmrEntry = { ...entry, mmr: nextMmr, peakMmr: Math.max(entry.peakMmr, nextMmr) };
    const nextTable: RosterMmrTable = { ...state.mmr, [region]: { ...state.mmr[region], [name]: { ...state.mmr[region]?.[name], [queue]: nextEntry } } };
    set({ mmr: nextTable });
    persist(nextTable);
  },

  resetAll: (era, currentYear, seasonStartDate) => {
    const nextTable: RosterMmrTable = {};
    const regions: ProRegion[] = ["NA", "EU", "OCE", "SAM", "MENA", "APAC", "SSA"];
    for (const region of regions) {
      const regionTable: RegionMmrTable = {};
      for (const grinder of regionalGrinderRoster(region, currentYear)) {
        const perQueue: Partial<Record<QueueMode, RosterMmrEntry>> = {};
        (["1v1", "2v2", "3v3"] as QueueMode[]).forEach((queue) => {
          perQueue[queue] = reseedEntry(grinder.name, region, grinder.band, queue, era, currentYear, seasonStartDate, undefined);
        });
        regionTable[grinder.name] = perQueue;
      }
      nextTable[region] = regionTable;
    }
    set({ mmr: nextTable });
    persist(nextTable);
  },

  loadForSave: (saveId) => {
    activeSaveId = saveId;
    set({ mmr: loadStored() });
  },
}));
