// Grey, no-glow titles unlocked by player LEVEL alone (see mockSave.ts's TitleEntry/TitleGlow) - distinct
// from the gold/red/white/aqua titles seasons.ts hands out for ranked peak rank or RLCS results. These are
// meant to read like real Rocket League's own level-milestone titles: nothing to do with skill, just
// how long someone's actually been playing. Exact level thresholds here are a plausible curve for this
// project's own XP pacing (see useSaveStore.ts's XP_CURVE_GROWTH), not data-mined from the live game.

import type { RankTierId } from "./rankSystem";
import type { TitleEntry } from "./seasons";

export interface LevelTitleDefinition {
  level: number;
  id: string;
  label: string;
}

// Ascending by level - every helper below relies on that ordering.
export const LEVEL_TITLES: LevelTitleDefinition[] = [
  { level: 10, id: "level_rookie", label: "Rookie" },
  { level: 20, id: "level_semi_pro", label: "Semi-Pro" },
  { level: 35, id: "level_pro", label: "Pro" },
  { level: 50, id: "level_veteran", label: "Veteran" },
  { level: 70, id: "level_expert", label: "Expert" },
  { level: 90, id: "level_allstar", label: "All-Star" },
  { level: 110, id: "level_elite", label: "Elite" },
  { level: 135, id: "level_master", label: "Master" },
  { level: 165, id: "level_superstar", label: "Superstar" },
  { level: 200, id: "level_legend", label: "Legend" },
  { level: 250, id: "level_icon", label: "Icon" },
  { level: 300, id: "level_rocketeer", label: "Rocketeer" },
];

function toTitleEntry(def: LevelTitleDefinition): TitleEntry {
  return { id: def.id, label: def.label, glow: "none" };
}

/** Every level title a player at `level` would have unlocked, ascending. */
export function levelTitlesEarnedAt(level: number): TitleEntry[] {
  return LEVEL_TITLES.filter((def) => def.level <= level).map(toTitleEntry);
}

/** Folds in any level title newly unlocked at `level` that isn't already owned, same dedupe-by-id/append
 *  pattern useSaveStore.ts's processSeasonRollover uses for season titles. Idempotent - safe to call on
 *  every level-up, or to backfill every title a dev-set level should already have earned. */
export function grantLevelTitles(existing: TitleEntry[], level: number): TitleEntry[] {
  const owned = new Set(existing.map((t) => t.id));
  const missing = levelTitlesEarnedAt(level).filter((t) => !owned.has(t.id));
  return missing.length > 0 ? [...existing, ...missing] : existing;
}

// AI has no real "level" stat (see matchSim.ts's MatchParticipantStats) - rank tier is the only thing
// standing in for "how long has this person actually been playing", same proxy seasons.ts's pickAiTitle
// already leans on for season-title flavor. A loose floor + spread keeps a bronze player plausibly a
// long-time-but-not-very-good grinder, not locked out of ever having a level title just for being low rank.
const TIER_LEVEL_FLOOR: Record<RankTierId, number> = {
  unranked: 3,
  bronze: 8,
  silver: 15,
  gold: 25,
  platinum: 40,
  diamond: 60,
  champion: 90,
  grand_champion: 130,
  ssl: 180,
};

/** Rolls a level title for a generic (untracked) AI opponent, same "one title, chosen once per match, or
 *  none at all" shape as pickAiTitle. Meant as its fallback: called when the season/RLCS title roll came
 *  up empty, so lower-tier opponents (who'd otherwise NEVER show a title, pickAiTitle only ever fires for
 *  champion+) get a real chance at the same grey titles the player earns from just playing. Plenty of
 *  players genuinely never bother equipping anything, so this stays well short of guaranteed. */
export function pickAiLevelTitle(rankTier: RankTierId): TitleEntry | null {
  if (Math.random() < 0.45) return null;
  const impliedLevel = TIER_LEVEL_FLOOR[rankTier] + Math.floor(Math.random() * 40);
  const eligible = levelTitlesEarnedAt(impliedLevel);
  if (eligible.length === 0) return null;
  // Usually shows off the highest one they'd plausibly have, occasionally an earlier one for variety.
  return Math.random() < 0.7 ? eligible[eligible.length - 1] : eligible[Math.floor(Math.random() * eligible.length)];
}
