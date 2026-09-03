// Persistent, per-region, per-save live state for the "ranked grinder" identity pool (see
// regionalGrinders.ts). Same simulated-background-games model as useLeaderboardFillerStore/
// useProLeaderboardStore (Elo-style deltas, placement games, gradual stat growth per game), but keyed by
// region AND scoped per save (mirrors useTournamentStore.ts's loadForSave/per-save-id storage key pattern)
// rather than the older two stores' single-shared-key approach — the entire point of this store is "you've
// met this AI before", so it must not bleed between unrelated save profiles the way the older stores do.

import { create } from "zustand";
import { tierMinMmr, mmrEraInflation, type RankEra } from "@/data/rankSystem";
import { hashString } from "@/data/proPlayers";
import { estimateGameSenseForMmr, eloExpectedScore, eloKFactor } from "@/data/matchSim";
import type { QueueMode } from "@/data/mockSave";
import type { ProRegion } from "@/data/proPlayers";
import { regionalGrinderRoster, type RosterBand } from "@/data/regionalGrinders";
import { daysBetween, type SimDate } from "@/data/dateUtils";
import { softResetMmr, seasonActivityMultiplier } from "@/data/seasons";

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

const RESET_COMPRESSION = 0.45;
const STAT_RUST_FLOOR_FRACTION = 0.35;

const GAMES_PER_DAY_MIN = 1.0;
const GAMES_PER_DAY_SPREAD = 1.6;
const PLACEMENT_GAMES = 10;
const ELO_K_PLACEMENT = 60;
const STAT_CLOSE_RATE = 0.03;
const MAX_GAMES_PER_CATCHUP = 300;

// How far above the bare top-tier floor a band's target MMR reaches, and how wide its own spread is within
// that — Low barely clears the floor, Super High reaches well past it. Mirrors the shape (not the exact
// numbers) of useLeaderboardFillerStore's flat "floor + 100 + hash%450".
const BAND_FLOOR_FRACTION: Record<RosterBand, number> = { low: 0, mid: 0.2, high: 0.45, super_high: 0.75 };
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
  const spread = hashString(`${name}${region}${queue}`) % BAND_SPREAD[band];
  // "low" band deliberately sits out the era creep below — those are just regular ranked-ladder regulars,
  // not remotely leaderboard/RLCS caliber, and shouldn't drift toward SSL+ just because the years pass.
  // Every other band tracks the same rising ceiling real pros get (see proPlayers.ts's seedProMmr), which
  // is what actually makes the Top 50 board's floor climb season over season rather than just the real
  // pros individually pulling away from an otherwise-static grinder pool.
  const inflation = band === "low" ? 0 : mmrEraInflation(currentYear, era);
  const targetMmr = floor + BAND_FLOOR_FRACTION[band] * BAND_CEILING_SPAN + spread + inflation;
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

  const statFloor = targetGameSense * STAT_RUST_FLOOR_FRACTION;
  const mechFloor = targetMechanicalConsistency * STAT_RUST_FLOOR_FRACTION;
  const priorGameSense = previous ? previous.gameSense : targetGameSense;
  const priorMech = previous ? previous.mechanicalConsistency : targetMechanicalConsistency;
  const gameSense = Math.max(statFloor, Math.round(statFloor + (priorGameSense - statFloor) * RESET_COMPRESSION));
  const mechanicalConsistency = Math.max(mechFloor, Math.round(mechFloor + (priorMech - mechFloor) * RESET_COMPRESSION));

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
    const oppRating = mmr + (Math.random() - 0.5) * 2 * 350;
    const expected = eloExpectedScore(mmr, oppRating);
    const skillPull = (entry.targetMmr - mmr) / 1600;
    const winProb = Math.max(0.05, Math.min(0.95, expected + skillPull));
    const won = Math.random() < winProb;
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
  return simulateForward(safeBase, name, region, currentDate, seasonStartDate);
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
    const nextMmr = Math.max(0, entry.mmr + mmrDelta);
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
