// Persistent, live state for the "regular" (non-pro) names that round out the Top 50 leaderboard alongside
// real pros. Same simulated-background-games model as useProLeaderboardStore: MMR/Game Sense/Mechanical
// Consistency all come from actually simulating games one at a time (Elo-style deltas, placement matches
// at the start of a season, gradual stat growth per game) rather than a smooth time-based ramp or a fresh
// random roll per match, so a name on the board reads as the same improving person match to match, and a
// match opponent sharing that name gets the exact stats the board is showing.

import { create } from "zustand";
import { tierMinMmr, realisticOneVOneMmr, type RankEra } from "@/data/rankSystem";
import { hashString } from "@/data/proPlayers";
import { estimateGameSenseForMmr, eloExpectedScore, eloKFactor } from "@/data/matchSim";
import { LB_NAMES, type QueueMode } from "@/data/mockSave";
import { withNameFlourish } from "@/data/nameFlourish";
import { daysBetween, type SimDate } from "@/data/dateUtils";
import { softResetMmr, seasonActivityMultiplier, AI_PLACEMENT_GAMES_REQUIRED, PLACEMENT_MMR_AMPLIFIER } from "@/data/seasons";

const STORAGE_KEY = "rl-sim:leaderboard-filler-mmr-v2";

// A bit more than the visible Top 50 so real pros occupying some of those spots (which varies by queue/
// era) still leaves enough filler names to fill the board out.
export const LEADERBOARD_FILLER_COUNT = 70;

const GAMES_PER_DAY_MIN = 1.0;
const GAMES_PER_DAY_SPREAD = 1.6;
const PLACEMENT_GAMES = AI_PLACEMENT_GAMES_REQUIRED;
const ELO_K_PLACEMENT = 60;
const STAT_CLOSE_RATE = 0.03;
const MAX_GAMES_PER_CATCHUP = 300;

interface FillerMmrEntry {
  mmr: number;
  gameSense: number;
  mechanicalConsistency: number;
  gamesPlayedThisSeason: number;
  targetMmr: number;
  targetGameSense: number;
  targetMechanicalConsistency: number;
  seasonStartKey: string;
  /** Highest MMR this name/queue has ever actually reached, carried forward across every season reset —
   *  same "all-time best" concept as the player's own RankedProfile.peakMmr. */
  peakMmr: number;
}

type FillerMmrTable = Record<string, Partial<Record<QueueMode, FillerMmrEntry>>>;

/** The fixed pool of filler leaderboard names, same order every time so a name (and its persisted history)
 *  always refers to the same "person" across sessions. */
export function fillerLeaderboardNames(): string[] {
  return Array.from({ length: LEADERBOARD_FILLER_COUNT }, (_, i) => {
    const base = `${LB_NAMES[i % LB_NAMES.length]}${i >= LB_NAMES.length ? i : ""}`;
    return withNameFlourish(base, `fillerlb#${i}`);
  });
}

function seasonKey(seasonStartDate: SimDate): string {
  return `${seasonStartDate.year}-${seasonStartDate.month}-${seasonStartDate.day}`;
}

function gamesPerDay(name: string): number {
  return GAMES_PER_DAY_MIN + ((hashString(name + "#pace")) % 100) / 100 * GAMES_PER_DAY_SPREAD;
}

/** A filler's target MMR is a stable, name-seeded spot within the top bracket rather than a fresh random
 *  roll, the exact same name always lands in roughly the same ceiling season to season. Their target
 *  skill is read straight off the same MMR->Game Sense curve real ranked opponents use, so a filler regular
 *  reads as exactly as skilled as their MMR would suggest, no separate/inflated formula. */
function reseedEntry(
  name: string,
  queue: QueueMode,
  era: RankEra,
  currentYear: number,
  seasonStartDate: SimDate,
  previous: FillerMmrEntry | undefined
): FillerMmrEntry {
  const floor = tierMinMmr(era === "modern" ? "ssl" : "grand_champion", era, queue);
  const spread = hashString(name + queue) % 450;
  const rawTargetMmr = floor + 100 + spread;
  const targetMmr = queue === "1v1" ? realisticOneVOneMmr(rawTargetMmr) : rawTargetMmr;
  const targetGameSense = estimateGameSenseForMmr(targetMmr, era, queue, currentYear);
  const targetMechanicalConsistency = targetGameSense * 0.9;

  // A real season reset hits everyone's actual rank the same way regardless of AI type — the same soft
  // reset (toward baseline 600, keeping 70% of the prior gap) the player's own MMR gets, not a separate,
  // much milder compression toward a permanently-elite floor. Resetting from `previous.mmr` directly would
  // let a name who happened to be caught mid-climb (an entry only reseeds/simulates when actually queried,
  // so it can be snapshotted anywhere between a past reset and its real target) get soft-reset from that
  // partial, already-low number — compounding downward every season they aren't looked at often enough to
  // fully catch up first. Resetting from their best-demonstrated level instead (all-time peak, or their
  // current target if that's even higher) keeps every reset anchored to how good they actually are.
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
    peakMmr: Math.max(previous?.peakMmr ?? 0, priorMmr, mmr, targetMmr),
  };
}

function simulateForward(entry: FillerMmrEntry, name: string, currentDate: SimDate, seasonStartDate: SimDate): FillerMmrEntry {
  const daysIn = Math.max(0, daysBetween(seasonStartDate, currentDate));
  // Real leaderboard names no-life ranked right after a reset to reclaim their rank, and again near
  // season's end grinding for rewards — see seasonActivityMultiplier's doc comment.
  const expectedGames = Math.floor(daysIn * gamesPerDay(name) * seasonActivityMultiplier(daysIn));
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
  existing: FillerMmrEntry | undefined,
  name: string,
  queue: QueueMode,
  era: RankEra,
  currentYear: number,
  currentDate: SimDate,
  seasonStartDate: SimDate
): FillerMmrEntry {
  const key = seasonKey(seasonStartDate);
  const base = existing && existing.seasonStartKey === key ? existing : reseedEntry(name, queue, era, currentYear, seasonStartDate, existing);
  const result = simulateForward(base, name, currentDate, seasonStartDate);
  // simulateForward's own game-by-game ELO walk pulls toward targetMmr (already realistically clamped, see
  // reseedEntry) but doesn't hard-bound the walk itself - a long enough win streak can still random-walk
  // past it, so 1v1 needs a final clamp here too.
  if (queue !== "1v1") return result;
  return { ...result, mmr: Math.round(realisticOneVOneMmr(result.mmr)), peakMmr: Math.round(realisticOneVOneMmr(result.peakMmr)) };
}

function loadStored(): FillerMmrTable {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Raw (already-JSON-string) filler leaderboard state, read verbatim — genuinely global/shared-world state,
 *  not scoped to any one save, but a save export/import still bundles it so switching devices doesn't
 *  quietly reset every filler regular's tracked progress. Exported for saveManager.ts. */
export function exportFillerLeaderboardData(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

/** Overwrites the global filler leaderboard blob — a plain localStorage write, picked up on next load since
 *  this store only ever reads it once at module init. */
export function importFillerLeaderboardData(data: string | null | undefined): void {
  try {
    if (data) localStorage.setItem(STORAGE_KEY, data);
  } catch {
    // Storage full/unavailable, the imported leaderboard just won't carry over this session.
  }
}

function persist(table: FillerMmrTable) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(table));
  } catch {
    // Storage full/unavailable, the filler ladder just won't persist across reloads this session.
  }
}

interface LeaderboardFillerState {
  mmr: FillerMmrTable;
  /** Current MMR for a filler name in a queue, caught up (reseeded for a new season and/or simulated
   *  forward through background games) to `currentDate` first. Safe to call one at a time from match
   *  generation; for a render-time loop over the whole board, call `ensureSeeded` in an effect first and
   *  then just read `mmr` directly. */
  getMmr: (name: string, queue: QueueMode, era: RankEra, currentYear: number, currentDate: SimDate, seasonStartDate: SimDate) => number;
  /** Same as `getMmr` but returns the persistent Game Sense/Mechanical Consistency this entry has
   *  simulated its way to, so a filler regular's in-match stats are the SAME person the board shows. */
  getStats: (name: string, queue: QueueMode, era: RankEra, currentYear: number, currentDate: SimDate, seasonStartDate: SimDate) => { gameSense: number; mechanicalConsistency: number; peakMmr: number };
  /** Batches catch-up for every name in the list, in one `set` call. Call this from a `useEffect`, never
   *  from inside a render body. */
  ensureSeeded: (names: string[], queue: QueueMode, era: RankEra, currentYear: number, currentDate: SimDate, seasonStartDate: SimDate) => void;
  /** Applies a real match result the same Elo-style way a real ranked match would move a player's MMR, on
   *  top of whatever this filler's simulated background games already have them at. */
  applyResult: (name: string, queue: QueueMode, mmrDelta: number, era: RankEra, currentYear: number, seasonStartDate: SimDate) => void;
  /** Immediately re-seeds every filler regular's MMR/skill in every queue from scratch (using whatever the
   *  current seeding formula/tuning is), rather than just clearing the table and hoping a later screen
   *  visit fills it back in. For a save that picked up stale/pre-tuning entries. Dev-tools only. */
  resetAll: (era: RankEra, currentYear: number, seasonStartDate: SimDate) => void;
}

export const useLeaderboardFillerStore = create<LeaderboardFillerState>((set, get) => ({
  mmr: loadStored(),

  getMmr: (name, queue, era, currentYear, currentDate, seasonStartDate) => {
    const state = get();
    const entry = catchUp(state.mmr[name]?.[queue], name, queue, era, currentYear, currentDate, seasonStartDate);
    const nextTable = { ...state.mmr, [name]: { ...state.mmr[name], [queue]: entry } };
    set({ mmr: nextTable });
    persist(nextTable);
    return entry.mmr;
  },

  getStats: (name, queue, era, currentYear, currentDate, seasonStartDate) => {
    const state = get();
    const entry = catchUp(state.mmr[name]?.[queue], name, queue, era, currentYear, currentDate, seasonStartDate);
    const nextTable = { ...state.mmr, [name]: { ...state.mmr[name], [queue]: entry } };
    set({ mmr: nextTable });
    persist(nextTable);
    return { gameSense: entry.gameSense, mechanicalConsistency: entry.mechanicalConsistency, peakMmr: entry.peakMmr };
  },

  ensureSeeded: (names, queue, era, currentYear, currentDate, seasonStartDate) => {
    const state = get();
    const nextTable = { ...state.mmr };
    let changed = false;
    for (const name of names) {
      const entry = catchUp(nextTable[name]?.[queue], name, queue, era, currentYear, currentDate, seasonStartDate);
      nextTable[name] = { ...nextTable[name], [queue]: entry };
      changed = true;
    }
    if (!changed) return;
    set({ mmr: nextTable });
    persist(nextTable);
  },

  applyResult: (name, queue, mmrDelta, era, currentYear, seasonStartDate) => {
    const state = get();
    const key = seasonKey(seasonStartDate);
    const existing = state.mmr[name]?.[queue];
    const entry = existing && existing.seasonStartKey === key ? existing : reseedEntry(name, queue, era, currentYear, seasonStartDate, existing);
    // Still mid-placement this season — a real match played directly against this name should swing them
    // the same amplified way a real placement result would, not the flat few-point delta an ordinary
    // ranked result gets.
    const effectiveDelta = entry.gamesPlayedThisSeason < PLACEMENT_GAMES ? Math.round(mmrDelta * PLACEMENT_MMR_AMPLIFIER) : mmrDelta;
    const rawMmr = Math.max(0, entry.mmr + effectiveDelta);
    const nextEntry: FillerMmrEntry = { ...entry, mmr: queue === "1v1" ? realisticOneVOneMmr(rawMmr) : rawMmr };
    const nextTable = { ...state.mmr, [name]: { ...state.mmr[name], [queue]: nextEntry } };
    set({ mmr: nextTable });
    persist(nextTable);
  },

  resetAll: (era, currentYear, seasonStartDate) => {
    const nextTable: FillerMmrTable = {};
    for (const name of fillerLeaderboardNames()) {
      const perQueue: Partial<Record<QueueMode, FillerMmrEntry>> = {};
      (["1v1", "2v2", "3v3"] as QueueMode[]).forEach((queue) => {
        perQueue[queue] = reseedEntry(name, queue, era, currentYear, seasonStartDate, undefined);
      });
      nextTable[name] = perQueue;
    }
    set({ mmr: nextTable });
    persist(nextTable);
  },
}));

export type { FillerMmrEntry };
