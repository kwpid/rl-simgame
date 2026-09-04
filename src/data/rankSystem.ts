// Rank visual system, mirrors real RL's Sept 2020 free-to-play relaunch, which changed rank art AND
// tier structure (added Grand Champion I/II/III + Supersonic Legend on top of the old flat Grand Champion cap).
// This is a presentation-layer concept, separate from the mechanic meta-timeline in docs/DATA_MODEL.md,
// but the same "in-universe date gates what's possible" idea applies here to ranks/rank art.

export type RankEra = "legacy" | "modern";

export const ERA_CUTOVER = { year: 2020, month: 9 }; // saves at/after this date use "modern"

export function eraForDate(date: { year: number; month: number }): RankEra {
  if (date.year > ERA_CUTOVER.year) return "modern";
  if (date.year === ERA_CUTOVER.year && date.month >= ERA_CUTOVER.month) return "modern";
  return "legacy";
}

export type BaseTier = "bronze" | "silver" | "gold" | "platinum" | "diamond" | "champion";
export type RankTierId = BaseTier | "grand_champion" | "ssl" | "unranked";

export const BASE_TIERS: BaseTier[] = ["bronze", "silver", "gold", "platinum", "diamond", "champion"];

const TIER_ORDER: RankTierId[] = [
  "unranked",
  "bronze",
  "silver",
  "gold",
  "platinum",
  "diamond",
  "champion",
  "grand_champion",
  "ssl",
];

/** Ordinal position for comparing tiers ("is this a higher rank than that"), used for season peak
 *  tracking and reward tiers. Higher number = higher rank. */
export function tierRank(tier: RankTierId): number {
  return TIER_ORDER.indexOf(tier);
}

export const TIER_LABELS: Record<RankTierId, string> = {
  unranked: "Unranked",
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  platinum: "Platinum",
  diamond: "Diamond",
  champion: "Champion",
  grand_champion: "Grand Champion",
  ssl: "Supersonic Legend",
};

export const TIER_COLORS: Record<RankTierId, string> = {
  unranked: "#5c5f66",
  bronze: "#a5673f",
  silver: "#9fa3ab",
  gold: "#d9b357",
  platinum: "#7fb3c9",
  diamond: "#5b8def",
  champion: "#b56bd9",
  grand_champion: "#d9645b", // modern-era Grand Champion (reddish/pink, matches real RL's post-2020 GC)
  ssl: "#f04ba0", // real RL's Supersonic Legend is a bright pink/magenta, not gold
};

/** Legacy-era Grand Champion was a distinct purple, close to Champion's but more saturated/deeper so the
 *  two stay visually distinguishable. Use `tierColor()` instead of `TIER_COLORS` directly wherever era is known. */
const LEGACY_GRAND_CHAMPION_COLOR = "#8a4fd1";

export function tierColor(tier: RankTierId, era: RankEra): string {
  if (tier === "grand_champion" && era === "legacy") return LEGACY_GRAND_CHAMPION_COLOR;
  return TIER_COLORS[tier];
}

const ROMAN = ["I", "II", "III", "IV"];

/** Division count for a tier in a given era. 0 = no division split (single flat rank). */
export function divisionCount(tier: RankTierId, era: RankEra): number {
  if (tier === "unranked" || tier === "ssl") return 0;
  if (tier === "grand_champion") return era === "modern" ? 3 : 0; // modern GC splits into GC1/GC2/GC3, matches real RL
  return 3; // bronze..champion split into divisions I-III, matches real RL (no division IV, that was a bug)
}

export function divisionLabel(tier: RankTierId, division: number | undefined, era: RankEra): string {
  const label = TIER_LABELS[tier];
  const count = divisionCount(tier, era);
  if (count === 0 || !division) return label;
  const roman = ROMAN[division - 1] ?? String(division);
  return `${label} ${roman}`;
}

/** Roman numeral only, empty string for tiers with no division split (SSL, legacy Grand Champion, unranked). */
export function divisionRoman(tier: RankTierId, division: number | undefined, era: RankEra): string {
  const count = divisionCount(tier, era);
  if (count === 0 || !division) return "";
  return ROMAN[division - 1] ?? String(division);
}

/**
 * Resolves the image path for a rank badge. Drop your PNGs into:
 *   public/ranks/legacy/{tier}-{division}.png   (e.g. bronze-1.png, champion-3.png)
 *   public/ranks/legacy/grand-champion.png       (no division, legacy GC is a flat single rank)
 *   public/ranks/modern/{tier}-{division}.png    (same pattern, includes grand-champion-1/2/3.png)
 *   public/ranks/modern/supersonic-legend.png
 *   public/ranks/{era}/unranked.png
 * Missing files fall back to a generated color badge, see RankBadge.tsx, so the UI never breaks
 * waiting on art.
 */
export function rankImagePath(tier: RankTierId, division: number | undefined, era: RankEra): string {
  if (tier === "unranked") return `/ranks/${era}/unranked.png`;
  if (tier === "ssl") return `/ranks/${era}/supersonic-legend.png`;
  const count = divisionCount(tier, era);
  const fileTier = tier.replace(/_/g, "-");
  if (count === 0) return `/ranks/${era}/${fileTier}.png`;
  return `/ranks/${era}/${fileTier}-${division ?? 1}.png`;
}

interface RankBracket {
  tier: RankTierId;
  min: number;
  max: number; // Infinity for the top bracket
}

export type RankQueue = "1v1" | "2v2" | "3v3";

/** MMR-to-rank scale is playlist-specific in real RL, 2s is the highest-population/highest-ceiling
 *  playlist (SSL starts far higher there than in 1s), 1s has the lowest ceiling, 3s sits in between.
 *  These brackets are loosely tuned to real RL's actual MMR distribution per playlist, not a flat
 *  shared 0-2600 scale, so a given MMR number lands on a believable rank per queue (e.g. ~1850+ in 2s
 *  is SSL territory, the same number in 1s would already be well past SSL). */
function rankBrackets(era: RankEra, queue: RankQueue): RankBracket[] {
  const byQueue: Record<RankQueue, Omit<RankBracket, "max">[]> = {
    "1v1": [
      { tier: "bronze", min: 0 },
      { tier: "silver", min: 290 },
      { tier: "gold", min: 480 },
      { tier: "platinum", min: 670 },
      { tier: "diamond", min: 860 },
      { tier: "champion", min: 1060 },
      { tier: "grand_champion", min: 1300 },
      { tier: "ssl", min: 1600 },
    ],
    "2v2": [
      { tier: "bronze", min: 0 },
      { tier: "silver", min: 350 },
      { tier: "gold", min: 550 },
      { tier: "platinum", min: 750 },
      { tier: "diamond", min: 950 },
      { tier: "champion", min: 1150 },
      { tier: "grand_champion", min: 1500 },
      { tier: "ssl", min: 1850 },
    ],
    "3v3": [
      { tier: "bronze", min: 0 },
      { tier: "silver", min: 330 },
      { tier: "gold", min: 530 },
      { tier: "platinum", min: 730 },
      { tier: "diamond", min: 930 },
      { tier: "champion", min: 1130 },
      { tier: "grand_champion", min: 1450 },
      { tier: "ssl", min: 1750 },
    ],
  };

  const mins = byQueue[queue];
  const brackets: RankBracket[] = mins.map((b, i) => ({
    ...b,
    max: i + 1 < mins.length ? mins[i + 1].min - 1 : Infinity,
  }));

  if (era === "legacy") {
    // Legacy has no SSL, Grand Champion is the flat uncapped top bracket instead.
    const gc = brackets.find((b) => b.tier === "grand_champion")!;
    gc.max = Infinity;
    return brackets.filter((b) => b.tier !== "ssl");
  }
  return brackets;
}

/** The MMR floor for a tier in a given queue/era, e.g. "what's the minimum MMR to be SSL in 2s". Used
 *  to seed believable pro-player MMR per queue without duplicating the bracket table elsewhere. */
export function tierMinMmr(tier: RankTierId, era: RankEra, queue: RankQueue): number {
  const brackets = rankBrackets(era, queue);
  return brackets.find((b) => b.tier === tier)?.min ?? 0;
}

/** Diminishing-return growth from years of something (experience, era creep, etc), same shape as every
 *  other uncapped stat in this sim: fast early gains, slower later, but never a hard ceiling. */
export function experienceGrowth(years: number, perYear: number, diminishingScale: number): number {
  let value = 0;
  for (let y = 0; y < years; y++) {
    value += perYear * (diminishingScale / (diminishingScale + value));
  }
  return value;
}

/** Real Rocket League's actual highest-ever recorded 1v1 MMR is 1814 - 1s's playerbase is far smaller than
 *  2s/3s, so unlike those two queues (whose ceiling keeps climbing indefinitely via mmrEraInflation/
 *  experienceGrowth with no practical limit), 1v1 realistically self-limits well below that. Every 1v1 MMR
 *  value the sim ever produces - the player's own ranked climb (useSaveStore.ts's recordMatchResult), every
 *  AI pro/filler/grinder's seeded and live MMR (proPlayers.ts's seedProMmr, useLeaderboardFillerStore.ts and
 *  useRegionalRosterStore.ts's reseedEntry) - passes through this. Values under the soft floor are
 *  untouched (a realistic climb up to genuinely elite feels earned, not artificially held down); anything
 *  higher compresses asymptotically toward the real record, never reaching it - same diminishing-returns
 *  shape experienceGrowth already uses elsewhere, just approaching a ceiling instead of an unbounded
 *  asymptote, so only the most extreme rolls ever land anywhere close to it ("very very rarely" exceed
 *  ~1800, matching the design chat). */
export const ONE_V_ONE_MMR_RECORD = 1814;
const ONE_V_ONE_MMR_SOFT_FLOOR = 1650;
export function realisticOneVOneMmr(raw: number): number {
  if (raw <= ONE_V_ONE_MMR_SOFT_FLOOR) return raw;
  const excess = raw - ONE_V_ONE_MMR_SOFT_FLOOR;
  const span = ONE_V_ONE_MMR_RECORD - ONE_V_ONE_MMR_SOFT_FLOOR;
  return ONE_V_ONE_MMR_SOFT_FLOOR + span * (excess / (excess + 250));
}

/** How much the competitive MMR ceiling has crept up since the Sept 2020 relaunch, independent of any one
 *  player's/pro's own experience curve — real RL's actual top-end MMR climbed noticeably every year as the
 *  playerbase grew and the mechanical ceiling rose with it (2v2 top-50 went from just clearing SSL right
 *  after relaunch to routinely 2400-2500+ a few years in). Modeled with the same diminishing-returns shape
 *  as everything else here: real growth, but not linear forever. Legacy era predates the relaunch, no
 *  creep applies (there's no SSL yet to have crept above). Applied on top of the fixed SSL/GC floor by
 *  every AI MMR source that should track the top of the ladder rising over time (pro seeding, and the
 *  upper ranked-grinder bands) — see proPlayers.ts's seedProMmr and useRegionalRosterStore.ts's reseedEntry. */
export function mmrEraInflation(currentYear: number, era: RankEra): number {
  if (era !== "modern") return 0;
  const yearsSinceRelaunch = Math.max(0, currentYear - ERA_CUTOVER.year);
  return experienceGrowth(yearsSinceRelaunch, 100, 6000);
}

// Roughly matches real RL's actual published rank distribution shape (a hump centered on Platinum/Diamond,
// thinning out fast above Champion), same percentages regardless of queue or era — only the MMR floor a
// percentage lands on shifts (via rankBrackets/tierMinMmr above), the SHAPE of "how many people are Bronze
// vs Diamond vs SSL" doesn't. Legacy has no SSL, its sliver folds into the (still uncapped) Grand Champion
// bucket instead, so the two eras' numbers still sum to 100 either way.
// Grand Champion+ is genuinely rare in real RL (community-tracked distributions put GC+SSL combined well
// under 2% of the ranked population), so the top end here is deliberately thin — Diamond/Champion is
// already "good", GC is a real minority, and SSL is a sliver of that minority.
const MODERN_RANK_DISTRIBUTION_PCT: Record<BaseTier | "grand_champion" | "ssl", number> = {
  bronze: 4,
  silver: 12,
  gold: 24,
  platinum: 28,
  diamond: 21,
  champion: 9.5,
  grand_champion: 1.3,
  ssl: 0.2,
};
const LEGACY_RANK_DISTRIBUTION_PCT: Record<BaseTier | "grand_champion", number> = {
  bronze: 4,
  silver: 12,
  gold: 24,
  platinum: 28,
  diamond: 21,
  champion: 9.5,
  grand_champion: 1.5,
};

/** The MMR floor for a SPECIFIC division within a tier (not just the tier as a whole), same even split
 *  `deriveRankFromMmr` uses to go the other direction (MMR -> division). `division <= 1` (or a tier with
 *  no divisions at all, SSL/legacy GC) just returns the tier's own floor. */
export function divisionMinMmr(tier: RankTierId, division: number, era: RankEra, queue: RankQueue): number {
  const match = rankBrackets(era, queue).find((b) => b.tier === tier);
  if (!match) return 0;
  const count = divisionCount(tier, era);
  if (count === 0 || division <= 1) return match.min;
  const span = match.max === Infinity ? 400 : match.max - match.min + 1;
  return Math.round(match.min + ((division - 1) / count) * span);
}

export interface RankDistributionRow {
  tier: RankTierId;
  division: number; // 0 for a tier with no divisions (SSL, legacy Grand Champion)
  minMmr: number;
  populationPct: number;
}

// Within one tier's own share of the population, a lower division (just promoted in) holds noticeably
// more people than a higher one (about to promote out of the tier entirely) — division I gets the
// biggest slice, III the smallest, roughly doubling each step, same shape real tracker sites show.
const DIVISION_WEIGHTS = [4, 2, 1]; // index 0 = division I

/** Every real resting rank for this era (unranked excluded, nobody "rests" in placements), broken all the
 *  way down to each individual division (Bronze I/II/III, not just "Bronze"), with its MMR floor and share
 *  of the active population, in ascending rank order. Used for the Stats screen's Skill Distribution
 *  chart — "what MMR do I need for THIS exact rank, and how many people are actually there". */
export function rankDistribution(era: RankEra, queue: RankQueue): RankDistributionRow[] {
  const pctTable: Record<string, number> = era === "modern" ? MODERN_RANK_DISTRIBUTION_PCT : LEGACY_RANK_DISTRIBUTION_PCT;
  const tiers: RankTierId[] = era === "modern" ? [...BASE_TIERS, "grand_champion", "ssl"] : [...BASE_TIERS, "grand_champion"];
  const rows: RankDistributionRow[] = [];
  for (const tier of tiers) {
    const tierPct = pctTable[tier];
    const count = divisionCount(tier, era);
    if (count === 0) {
      rows.push({ tier, division: 0, minMmr: tierMinMmr(tier, era, queue), populationPct: tierPct });
      continue;
    }
    const weights = DIVISION_WEIGHTS.slice(0, count);
    const weightSum = weights.reduce((a, b) => a + b, 0);
    for (let division = 1; division <= count; division++) {
      rows.push({
        tier,
        division,
        minMmr: divisionMinMmr(tier, division, era, queue),
        populationPct: Math.round(tierPct * (weights[division - 1] / weightSum) * 100) / 100,
      });
    }
  }
  return rows;
}

// Real RL's own playlist popularity ordering: 2v2 is the biggest, most-played ladder, 3v3 next, 1v1 the
// smallest — matches the population-implied queue-pop-speed multipliers already used for matchmaking
// (see useMatchStore.ts's QUEUE_POPULATION_MULTIPLIER), just expressed here as an actual headcount so the
// Skill Distribution table can show a believable "# of players" alongside the percentage.
export const RANKED_POPULATION_BY_QUEUE: Record<RankQueue, number> = {
  "1v1": 341_884,
  "2v2": 968_247,
  "3v3": 552_610,
};

/** Used once, when a queue's placement matches finish, to assign the first real rank from final MMR.
 *  Ongoing rank changes after that are handled by division-pip adjustments per match, not re-derived
 *  from this every time, real RL doesn't recompute your whole rank from MMR after every single game either. */
export function deriveRankFromMmr(mmr: number, era: RankEra, queue: RankQueue): { tier: RankTierId; division: number } {
  const brackets = rankBrackets(era, queue);
  let match = brackets[0];
  for (const b of brackets) {
    if (mmr >= b.min) match = b;
  }
  const count = divisionCount(match.tier, era);
  if (count === 0) return { tier: match.tier, division: 0 };
  const span = match.max === Infinity ? 400 : match.max - match.min + 1;
  const progress = Math.min(0.999, Math.max(0, (mmr - match.min) / span));
  const division = Math.min(count, Math.floor(progress * count) + 1);
  return { tier: match.tier, division };
}

export const PIPS_PER_DIVISION = 5;

/** Where within the CURRENT division's own MMR span this exact MMR sits, as a 0-4 pip count. Tier/division
 *  themselves come straight from `deriveRankFromMmr` on every match now (see recordMatchResult in
 *  useSaveStore.ts) instead of an independently win/loss-incremented pip counter — that used to be able to
 *  drift arbitrarily far from what the player's actual MMR said (a long win streak against weak
 *  opponents could pip-promote someone through Champion/GC while their real Elo-based MMR barely moved,
 *  or the reverse), which is exactly why the same MMR could show Grand Champion one time and Champion III
 *  another. Deriving both tier AND pip progress from MMR every time makes them agree by construction,
 *  matching the Stats screen's own MMR-floor numbers exactly. */
export function divisionProgressFromMmr(mmr: number, era: RankEra, queue: RankQueue): number {
  const brackets = rankBrackets(era, queue);
  let match = brackets[0];
  for (const b of brackets) if (mmr >= b.min) match = b;
  const count = divisionCount(match.tier, era);
  if (count === 0) return 0;
  const span = match.max === Infinity ? 400 : match.max - match.min + 1;
  const progress = Math.min(0.999, Math.max(0, (mmr - match.min) / span));
  const withinDivision = (progress * count) % 1;
  return Math.min(PIPS_PER_DIVISION - 1, Math.floor(withinDivision * PIPS_PER_DIVISION));
}
