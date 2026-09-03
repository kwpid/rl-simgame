// Ranked seasons: every SEASON_LENGTH_DAYS, every queue's rank does a soft MMR reset and re-enters
// placements. Season numbering resets to 1 the first time a season ends inside the modern (SSL) era,
// matching real RL's post-free-to-play season renumbering. Only Grand Champion (and, once introduced,
// Supersonic Legend) earn a season title, one dedup'd title per season regardless of how many queues
// reached it in.
//
// Season reward levels are a separate mechanic from titles, this is real RL's actual system (confirmed
// via web search): reward level unlocks sequentially, Bronze through SSL, each tier requiring 10 WINS
// while ranked at-or-above that tier. Losses never count. A tier stays unlocked for the season even if
// you derank afterward, and the final unlocked tier is what gets paid out at season's end.

import { eraForDate, ERA_CUTOVER, type RankEra, type RankTierId } from "./rankSystem";
import type { SimDate } from "./dateUtils";
import { addDays, daysBetween } from "./dateUtils";

export const SEASON_LENGTH_DAYS = 84; // 12 weeks, "a few months" per the original design chat

export function seasonEndDate(seasonStartDate: SimDate): SimDate {
  return addDays(seasonStartDate, SEASON_LENGTH_DAYS);
}

/** Where a brand-new save's season clock should actually start: a save created well into the modern
 *  (SSL) era shouldn't pretend it's still "Season 1" the way a save starting right at the 2020 relaunch
 *  would — real season numbering is anchored to that relaunch date, so this figures out how many 84-day
 *  seasons have realistically elapsed since then and starts the save already mid-season, matching wherever
 *  the calendar would really be. Legacy-era saves (before the relaunch) have no such real anchor to count
 *  from, they just start at Season 1 on their own character's start date, same as before. */
export function initialSeasonForDate(startDate: SimDate): { seasonNumber: number; seasonStartDate: SimDate; seasonNumberingReset: boolean } {
  if (eraForDate(startDate) === "legacy") {
    return { seasonNumber: 1, seasonStartDate: startDate, seasonNumberingReset: false };
  }
  const cutoverDate: SimDate = { year: ERA_CUTOVER.year, month: ERA_CUTOVER.month, day: 1 };
  const daysSinceCutover = Math.max(0, daysBetween(cutoverDate, startDate));
  const seasonNumber = Math.floor(daysSinceCutover / SEASON_LENGTH_DAYS) + 1;
  const seasonStartDate = addDays(cutoverDate, (seasonNumber - 1) * SEASON_LENGTH_DAYS);
  return { seasonNumber, seasonStartDate, seasonNumberingReset: true };
}

// "aqua" is reserved for real competitive-tournament titles (RLCS regionals/majors/worlds), keeping them
// visually distinct from season-reward titles (gold/red/white), which come from ranked peak rank instead.
export type TitleGlow = "none" | "gold" | "red" | "white" | "aqua";

const GLOW_COLORS: Record<TitleGlow, string> = {
  none: "var(--text-secondary)",
  gold: "#f0d68a",
  red: "#ff6b5e",
  white: "#ffffff",
  aqua: "#5ee6d8",
};

export function glowColor(glow: TitleGlow): string {
  return GLOW_COLORS[glow];
}

export interface TitleEntry {
  id: string;
  label: string;
  glow: TitleGlow;
}

/** Only Grand Champion and Supersonic Legend grant a season title, everything below gets nothing,
 *  same as real RL. Returns null if the peak tier this season didn't qualify. */
export function seasonTitleFor(seasonNumber: number, era: RankEra, peakTier: RankTierId): TitleEntry | null {
  if (era === "legacy") {
    if (peakTier === "grand_champion") {
      return { id: `season_legacy_${seasonNumber}_gc`, label: `SEASON ${seasonNumber} GRAND CHAMPION`, glow: "gold" };
    }
    return null;
  }
  if (peakTier === "ssl") {
    return { id: `season_modern_${seasonNumber}_ssl`, label: `S${seasonNumber} SUPERSONIC LEGEND`, glow: "white" };
  }
  if (peakTier === "grand_champion") {
    return { id: `season_modern_${seasonNumber}_gc`, label: `S${seasonNumber} GRAND CHAMPION`, glow: "red" };
  }
  return null;
}

/** A soft reset compresses MMR toward the starting baseline rather than wiping it, a Champion doesn't
 *  fall all the way back to Bronze. compressionFactor is how much of the distance above baseline survives. */
export function softResetMmr(mmr: number, baseline = 600, compressionFactor = 0.7): number {
  return Math.max(0, Math.round(baseline + (mmr - baseline) * compressionFactor));
}

/** How much faster than usual AI (pros, regional grinders, leaderboard names — see the simulateForward in
 *  each of those stores) plays right now, as a multiplier on their normal games-per-day pace. Real ranked
 *  activity is U-shaped across a season: a rush right after the reset to reclaim rank (real top players
 *  no-life ranked for days to climb back to SSL), a calmer middle stretch, then another rush near the end
 *  grinding for season rewards before they lock in. Without this, a season reset (see `softResetMmr`) drops
 *  everyone — pro or not — well below the Top 50 leaderboard's rank floor, and the ordinary catch-up pace
 *  alone leaves the board looking sparse/broken for weeks until they gradually climb back. */
export function seasonActivityMultiplier(daysIntoSeason: number, seasonLengthDays: number = SEASON_LENGTH_DAYS): number {
  const fraction = Math.max(0, Math.min(1, daysIntoSeason / seasonLengthDays));
  const distanceFromMidpoint = Math.abs(fraction - 0.5) * 2; // 0 at the midpoint, 1 at either end
  return 1 + distanceFromMidpoint * 3; // 1x at the calm midpoint, up to 4x right at the start/end
}

const REWARD_WINS_REQUIRED = 10;

/** Reward tiers, Bronze through Champion always available, Grand Champion always available, SSL only
 *  once the modern era has introduced it. Every tier tracks its OWN win count in parallel (see
 *  `applyRewardProgress`), not one sequential counter, an SSL-ranked player's win counts toward Bronze
 *  through SSL all at once since being SSL clears every lower tier's "ranked at or above" gate simultaneously. */
export function rewardTierSequence(era: RankEra): RankTierId[] {
  const base: RankTierId[] = ["bronze", "silver", "gold", "platinum", "diamond", "champion", "grand_champion"];
  return era === "modern" ? [...base, "ssl"] : base;
}

export interface RewardProgressResult {
  rewardTierUnlocked: RankTierId;
  /** Win count per tier (0-10), only ever set for a tier once a win has counted toward it. A tier's count
   *  only advances once its threshold is actually reached, but once it hits 10 it stays there for the
   *  rest of the season even if the player later deranks below it. */
  rewardProgressByTier: Partial<Record<RankTierId, number>>;
}

/** Call after every ranked win (never on a loss, losses don't count toward reward level in real RL).
 *  Every tier at-or-below the player's CURRENT live rank gets its win count bumped in the same call, this
 *  is what makes an already-SSL-ranked player's very first win of the season count toward Bronze through
 *  SSL simultaneously, rather than needing to grind through each lower tier's 10 wins one at a time first. */
export function applyRewardProgress(
  era: RankEra,
  liveRankTier: RankTierId,
  liveRankOrdinal: (tier: RankTierId) => number,
  current: RewardProgressResult
): RewardProgressResult {
  const sequence = rewardTierSequence(era);
  const nextProgress = { ...current.rewardProgressByTier };
  for (const tier of sequence) {
    if (liveRankOrdinal(liveRankTier) < liveRankOrdinal(tier)) continue; // not ranked high enough for this tier
    const existing = nextProgress[tier] ?? 0;
    if (existing >= REWARD_WINS_REQUIRED) continue; // already maxed, nothing more to track
    nextProgress[tier] = existing + 1;
  }

  let unlocked: RankTierId = "unranked";
  for (const tier of sequence) {
    if ((nextProgress[tier] ?? 0) >= REWARD_WINS_REQUIRED) unlocked = tier;
  }

  return { rewardTierUnlocked: unlocked, rewardProgressByTier: nextProgress };
}

/** Picks a plausible title for an AI opponent/teammate to display in-match, or null for no title.
 *  Only Champion+ is ever eligible (a Champion could plausibly have peaked Grand Champion in an earlier
 *  season and still show that title even after slipping back down, same as real RL), nothing below
 *  Champion ever qualifies, and only from a season strictly before the current one (never "SEASON 13" in
 *  season 2). Higher current rank raises both the odds of showing a title at all and how likely that
 *  title is to be the flashier SSL banner rather than "merely" Grand Champion. */
export function pickAiTitle(era: RankEra, currentSeasonNumber: number, currentRankTier: RankTierId): TitleEntry | null {
  const pastSeasonsAvailable = currentSeasonNumber - 1;
  if (pastSeasonsAvailable < 1) return null;
  if (currentRankTier !== "champion" && currentRankTier !== "grand_champion" && currentRankTier !== "ssl") return null;

  const showChance = currentRankTier === "ssl" ? 0.75 : currentRankTier === "grand_champion" ? 0.5 : 0.15;
  if (Math.random() > showChance) return null;

  const pastSeason = 1 + Math.floor(Math.random() * pastSeasonsAvailable);
  const sslChance = era === "modern" ? (currentRankTier === "ssl" ? 0.7 : currentRankTier === "grand_champion" ? 0.1 : 0) : 0;
  const peakTier: RankTierId = Math.random() < sslChance ? "ssl" : "grand_champion";
  return seasonTitleFor(pastSeason, era, peakTier);
}

/** Popup shown once per season rollover: what season it is now, whether this is the first modern-era
 *  season (SSL just became obtainable), and what reward tier got locked in from the season that just
 *  ended. Cleared by `dismissSeasonAnnouncement` once the player has seen it. */
export interface SeasonAnnouncement {
  seasonNumber: number;
  sslIntroduced: boolean;
  rewardTierAchieved: RankTierId;
}

export { REWARD_WINS_REQUIRED };
