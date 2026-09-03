// Live, persistent per-queue state for every pro player, separate from any one save (the pro ladder is
// shared world state, not tied to a single career). Rather than a smooth time-based ramp toward a fixed
// peak, each pro's MMR/Game Sense/Mechanical Consistency comes from actually simulating their background
// games one at a time (Elo-style deltas, placement matches at the start of a season, gradual stat growth
// per game) whenever their entry is read and time has passed since it was last caught up — so a pro reads
// as a consistent, improving person across matches instead of a fresh random roll every time, and their
// current MMR and their current skill level always describe the SAME point in their season, not a maxed-
// out skill paired with a still-depressed early-season rating.

import { create } from "zustand";
import type { RankEra } from "@/data/rankSystem";
import { PRO_PLAYERS, seedProMmr, hashString } from "@/data/proPlayers";
import { proQueueStatCeiling, eloExpectedScore, eloKFactor } from "@/data/matchSim";
import { rlcsTitleMmrBonus } from "@/data/tournaments";
import { findRealRlcsTitlesForPlayer } from "@/store/useTournamentStore";
import type { QueueMode } from "@/data/mockSave";
import { daysBetween, type SimDate } from "@/data/dateUtils";
import { softResetMmr, seasonActivityMultiplier } from "@/data/seasons";

const STORAGE_KEY = "rl-sim:pro-leaderboard-mmr-v3";

// How much of a pro's rating/skill survives a season reset, same spirit as the player's own softResetMmr,
// pros lose real ground each season and have to climb back, they just start closer to the top than a
// regular player since they never truly left it.
const RESET_COMPRESSION = 0.45;
// Skill (Game Sense/Mechanical Consistency) also takes a "rust" hit at season start rather than snapping
// straight back to full strength, climbing back through simulated games the same way MMR does — this is
// what stops a fresh-season pro from showing max stats while still sitting at a depressed early rating.
const STAT_RUST_FLOOR_FRACTION = 0.35;

const GAMES_PER_DAY_MIN = 1.2;
const GAMES_PER_DAY_SPREAD = 2.0;
const PLACEMENT_GAMES = 10;
const ELO_K_PLACEMENT = 60; // placement matches swing much harder, same idea as the player's own placements
const STAT_CLOSE_RATE = 0.03; // fraction of the remaining gap to target skill closed per simulated game
const MAX_GAMES_PER_CATCHUP = 300; // safety cap so a huge date jump doesn't loop thousands of times

interface ProMmrEntry {
  mmr: number;
  gameSense: number;
  mechanicalConsistency: number;
  gamesPlayedThisSeason: number;
  targetMmr: number;
  targetGameSense: number;
  targetMechanicalConsistency: number;
  seasonStartKey: string;
  /** Highest MMR this pro/queue has ever actually reached, carried forward across every season reset
   *  (unlike `mmr` itself, which compresses back down each season) — same "all-time best" concept as the
   *  player's own RankedProfile.peakMmr, shown on the AI profile view. */
  peakMmr: number;
}

type ProMmrTable = Record<string, Partial<Record<QueueMode, ProMmrEntry>>>;

function seasonKey(seasonStartDate: SimDate): string {
  return `${seasonStartDate.year}-${seasonStartDate.month}-${seasonStartDate.day}`;
}

/** This pro ladder's own reseed/catch-up cadence anchors to the RLCS calendar (one season = one calendar
 *  year, see data/tournaments.ts's `rlcsSeasonForDate`), NOT the player's ranked-ladder season (which
 *  resets every 84 days) — a ranked season rollover must never touch a pro's tracked MMR/stats, only the
 *  player's own rank does that. Every caller in this file still threads a `seasonStartDate` parameter
 *  through (kept so every existing call site across the codebase doesn't need touching), but it's
 *  intentionally ignored below in favor of this. Duplicated here (rather than importing
 *  `rlcsSeasonForDate`) to avoid a circular import — data/tournaments.ts itself imports this store. */
function rlcsSeasonAnchor(year: number): SimDate {
  return { year, month: 1, day: 1 };
}

function loadStored(): ProMmrTable {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Raw (already-JSON-string) pro leaderboard state, read verbatim — this is genuinely global/shared-world
 *  state (see this file's own top-of-file doc comment), not scoped to any one save, but a save export/
 *  import still bundles it so switching devices doesn't quietly reset every pro's tracked progress back to
 *  a fresh reseed. Exported for saveManager.ts. */
export function exportProLeaderboardData(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

/** Overwrites the global pro leaderboard blob — a plain localStorage write, picked up on next load since
 *  this store only ever reads it once at module init. */
export function importProLeaderboardData(data: string | null | undefined): void {
  try {
    if (data) localStorage.setItem(STORAGE_KEY, data);
  } catch {
    // Storage full/unavailable, the imported leaderboard just won't carry over this session.
  }
}

function persist(table: ProMmrTable) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(table));
  } catch {
    // Storage full/unavailable, the ladder just won't persist across reloads this session.
  }
}

function gamesPerDay(name: string): number {
  return GAMES_PER_DAY_MIN + ((hashString(name + "#pace")) % 100) / 100 * GAMES_PER_DAY_SPREAD;
}

/** Reseeds one pro/queue entry for a new season: their target MMR/skill ceiling is recomputed from
 *  career/experience, and their live MMR and skill both compress back toward a "rusty" starting point
 *  from wherever they ended last season (or start right at the floor if this is the first look-up ever). */
function reseedEntry(
  proName: string,
  queue: QueueMode,
  era: RankEra,
  currentYear: number,
  seasonStartDate: SimDate,
  previous: ProMmrEntry | undefined
): ProMmrEntry {
  const pro = PRO_PLAYERS.find((p) => p.name === proName)!;
  // 3v3 is the one queue this pro's target MMR should actually reflect real RLCS results in — it's their
  // literal competitive queue, unlike the 1v1/2v2 ranked grind the rest of `seedProMmr` models. Without
  // this, a genuine Worlds/Major champion (real completed history this save produced, or a plausible
  // fictional past career for a veteran on a save that started mid-timeline — see
  // `findRealRlcsTitlesForPlayer`) could still show a perfectly ordinary 3v3 MMR with zero connection to
  // having actually won anything, which is exactly backwards for the one format that's supposed to prove it.
  const rlcsTitleBonus = queue === "3v3" ? rlcsTitleMmrBonus(findRealRlcsTitlesForPlayer(proName, currentYear)) : 0;
  const targetMmr = seedProMmr(pro, era, currentYear)[queue] + rlcsTitleBonus;
  const targetGameSense = proQueueStatCeiling(pro, currentYear, targetMmr, era, queue);
  const targetMechanicalConsistency = targetGameSense * 0.95;

  // A real season reset hits everyone's actual rank the same way, pro or not — the same soft reset
  // (toward baseline 600, keeping 70% of the prior gap) the player's own MMR gets, not a separate, much
  // milder compression toward a permanently-elite floor. Resetting from `previous.mmr` directly would let a
  // pro who happened to be caught mid-climb (an entry only reseeds/simulates when actually queried, so it
  // can be snapshotted anywhere between a past reset and its real target) get soft-reset from that partial,
  // already-low number — compounding downward every season a pro isn't looked at often enough to fully
  // catch up first, the "one pro sitting at 995 MMR" bug. Resetting from their best-demonstrated level
  // instead (their all-time peak, or their current target if that's even higher after a career-growth
  // re-seed) keeps every reset anchored to how good they actually are, not to catch-up timing luck.
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
    peakMmr: Math.max(previous?.peakMmr ?? 0, priorMmr, mmr, targetMmr),
  };
}

/** Simulates however many background games this pro "should" have played by now (based on a per-name
 *  games-per-day pace) since they were last caught up, each one an Elo-style result against a plausible
 *  opponent near their own current rating, nudging MMR and letting skill close the gap toward their
 *  season target a little at a time — this is what makes the ladder feel like real people grinding rather
 *  than a smooth formula or a fresh random roll. */
function simulateForward(entry: ProMmrEntry, proName: string, currentDate: SimDate): ProMmrEntry {
  const daysIn = Math.max(0, daysBetween(rlcsSeasonAnchor(currentDate.year), currentDate));
  // Real pros no-life ranked right after a reset to reclaim their rank, and again near season's end
  // grinding for rewards — see seasonActivityMultiplier's doc comment.
  const expectedGames = Math.floor(daysIn * gamesPerDay(proName) * seasonActivityMultiplier(daysIn));
  const gamesBehind = expectedGames - entry.gamesPlayedThisSeason;
  if (gamesBehind <= 0) return entry;

  if (gamesBehind > MAX_GAMES_PER_CATCHUP) {
    // A huge time skip, fast-forward straight to target rather than looping thousands of simulated games.
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
    // A slight pull toward their real target skill so they trend the right direction over a season
    // instead of a pure random walk, without ever guaranteeing a given game's result.
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

/** Reseeds-if-needed then simulates-forward one entry, the shared step behind every read/ensure below. */
function catchUp(
  existing: ProMmrEntry | undefined,
  proName: string,
  queue: QueueMode,
  era: RankEra,
  currentYear: number,
  currentDate: SimDate,
  _seasonStartDate: SimDate
): ProMmrEntry {
  const anchor = rlcsSeasonAnchor(currentDate.year);
  const key = seasonKey(anchor);
  const base = existing && existing.seasonStartKey === key ? existing : reseedEntry(proName, queue, era, currentYear, anchor, existing);
  // Guards against a pre-existing localStorage entry saved before `peakMmr` was tracked at all.
  const safeBase = typeof base.peakMmr === "number" ? base : { ...base, peakMmr: base.mmr };
  return simulateForward(safeBase, proName, currentDate);
}

interface ProLeaderboardState {
  mmr: ProMmrTable;
  /** Current MMR for a pro in a queue, caught up (reseeded for a new season and/or simulated forward
   *  through background games) to `currentDate` first. Returns 0 for a name that isn't a known pro. Safe
   *  to call one at a time from match generation; for a render-time loop over many pros, call
   *  `ensureSeeded` in an effect first and then just read `mmr` directly. */
  getMmr: (proName: string, queue: QueueMode, era: RankEra, currentYear: number, currentDate: SimDate, seasonStartDate: SimDate) => number;
  /** Same as `getMmr` but returns the persistent Game Sense/Mechanical Consistency this same pro/queue
   *  entry has simulated its way to, so their in-match stats are the SAME person as the leaderboard shows,
   *  not a fresh jittered roll. */
  getStats: (proName: string, queue: QueueMode, era: RankEra, currentYear: number, currentDate: SimDate, seasonStartDate: SimDate) => { gameSense: number; mechanicalConsistency: number; peakMmr: number };
  /** Batches catch-up (reseed + simulate-forward) for every name in the list, in one `set` call. Call
   *  this from a `useEffect`, never from inside a render body — after it runs, render can read `mmr`
   *  directly without needing `getMmr`/`getStats` again. */
  ensureSeeded: (proNames: string[], queue: QueueMode, era: RankEra, currentYear: number, currentDate: SimDate, seasonStartDate: SimDate) => void;
  /** Applies a real match result: `mmrDelta` nudges the pro's queue MMR the same Elo-style way a real
   *  ranked match would move a player's, on top of whatever their simulated background games already
   *  have them at. Doesn't count toward their simulated game count. */
  applyResult: (proName: string, queue: QueueMode, mmrDelta: number, era: RankEra, currentYear: number, seasonStartDate: SimDate) => void;
  /** Immediately re-seeds every active pro's MMR/skill in every queue from scratch (using whatever the
   *  current seeding formula/tuning is), rather than just clearing the table and hoping a later screen
   *  visit fills it back in. For a save that picked up stale/pre-tuning entries. Dev-tools only. */
  resetAll: (era: RankEra, currentYear: number, seasonStartDate: SimDate) => void;
}

export const useProLeaderboardStore = create<ProLeaderboardState>((set, get) => ({
  mmr: loadStored(),

  getMmr: (proName, queue, era, currentYear, currentDate, seasonStartDate) => {
    if (!PRO_PLAYERS.some((p) => p.name === proName)) return 0;
    const state = get();
    const entry = catchUp(state.mmr[proName]?.[queue], proName, queue, era, currentYear, currentDate, seasonStartDate);
    const nextTable = { ...state.mmr, [proName]: { ...state.mmr[proName], [queue]: entry } };
    set({ mmr: nextTable });
    persist(nextTable);
    return entry.mmr;
  },

  getStats: (proName, queue, era, currentYear, currentDate, seasonStartDate) => {
    if (!PRO_PLAYERS.some((p) => p.name === proName)) return { gameSense: 0, mechanicalConsistency: 0, peakMmr: 0 };
    const state = get();
    const entry = catchUp(state.mmr[proName]?.[queue], proName, queue, era, currentYear, currentDate, seasonStartDate);
    const nextTable = { ...state.mmr, [proName]: { ...state.mmr[proName], [queue]: entry } };
    set({ mmr: nextTable });
    persist(nextTable);
    return { gameSense: entry.gameSense, mechanicalConsistency: entry.mechanicalConsistency, peakMmr: entry.peakMmr };
  },

  ensureSeeded: (proNames, queue, era, currentYear, currentDate, seasonStartDate) => {
    const state = get();
    const nextTable = { ...state.mmr };
    let changed = false;
    for (const name of proNames) {
      if (!PRO_PLAYERS.some((p) => p.name === name)) continue;
      const entry = catchUp(nextTable[name]?.[queue], name, queue, era, currentYear, currentDate, seasonStartDate);
      nextTable[name] = { ...nextTable[name], [queue]: entry };
      changed = true;
    }
    if (!changed) return;
    set({ mmr: nextTable });
    persist(nextTable);
  },

  applyResult: (proName, queue, mmrDelta, era, currentYear, _seasonStartDate) => {
    const state = get();
    const anchor = rlcsSeasonAnchor(currentYear);
    const key = seasonKey(anchor);
    const existing = state.mmr[proName]?.[queue];
    const rawEntry = existing && existing.seasonStartKey === key ? existing : reseedEntry(proName, queue, era, currentYear, anchor, existing);
    const entry = typeof rawEntry.peakMmr === "number" ? rawEntry : { ...rawEntry, peakMmr: rawEntry.mmr };
    const nextMmr = Math.max(0, entry.mmr + mmrDelta);
    const nextEntry: ProMmrEntry = { ...entry, mmr: nextMmr, peakMmr: Math.max(entry.peakMmr, nextMmr) };
    const nextTable = { ...state.mmr, [proName]: { ...state.mmr[proName], [queue]: nextEntry } };
    set({ mmr: nextTable });
    persist(nextTable);
  },

  resetAll: (era, currentYear, _seasonStartDate) => {
    const anchor = rlcsSeasonAnchor(currentYear);
    const nextTable: ProMmrTable = {};
    for (const pro of PRO_PLAYERS) {
      if (pro.debutYear > currentYear) continue;
      const perQueue: Partial<Record<QueueMode, ProMmrEntry>> = {};
      (["1v1", "2v2", "3v3"] as QueueMode[]).forEach((queue) => {
        perQueue[queue] = reseedEntry(pro.name, queue, era, currentYear, anchor, undefined);
      });
      nextTable[pro.name] = perQueue;
    }
    set({ mmr: nextTable });
    persist(nextTable);
  },
}));

export type { ProMmrEntry };
