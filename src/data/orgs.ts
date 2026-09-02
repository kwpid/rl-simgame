// Org/pro-scene eligibility and tier math. Purely stateless — the actual tryout/contract state lives on
// the save (see mockSave.ts's OrgInvite/OrgTryout/OrgContract), this file only answers "is this player
// good enough to be scouted at all, and by what caliber of org" from their live 2v2 ranked numbers.
//
// The org track only ever cares about 2v2: it's the queue real pros treat as their main competitive
// practice (see proPlayers.ts's seedProMmr), and it's the queue eligibility/teammate-matching both key off.

import { tierMinMmr, type RankEra } from "./rankSystem";
import { eliteGameSenseCeiling, eliteFoundationCeiling } from "./matchSim";
import type { FoundationCategory } from "./mechanics";
import type { RlcsSeasonPhase } from "./tournaments";

export type OrgTier = "bubble" | "mid" | "top";

export const ORG_TIER_LABELS: Record<OrgTier, string> = {
  bubble: "Bubble Org",
  mid: "Mid-Tier Org",
  top: "Top-Tier Org",
};

/** The 2v2 MMR floor to even be considered for scouting: mid-SSL in the modern era, or any Grand Champion
 *  in the legacy era (no SSL to be "mid" of yet). "Mid-SSL" is the midpoint between the SSL floor and the
 *  same uncapped-top-tier spread `matchSim.ts`'s gameSenseAnchors uses elsewhere, so it scales with 2v2's
 *  own MMR scale rather than a hardcoded number that'd drift out of sync with the rest of the rank curve. */
export function orgRankFloorMmr(era: RankEra): number {
  const champMin = tierMinMmr("champion", era, "2v2");
  const gcMin = tierMinMmr("grand_champion", era, "2v2");
  if (era !== "modern") return gcMin;
  const sslMin = tierMinMmr("ssl", era, "2v2");
  const topSpread = Math.max(100, sslMin - gcMin);
  return sslMin + topSpread * 0.5;
}

/** Rank is a simple hard gate, nothing more nuanced: the player's 2v2 MMR either clears the floor or it
 *  doesn't. Matches how real recruiting actually works — the rank requirement gets you a look, everything
 *  past that point is judged on the actual stats below, not the rank number itself. */
export function meetsOrgRankRequirement(era: RankEra, mmr2v2: number): boolean {
  return mmr2v2 >= orgRankFloorMmr(era);
}

// Game Sense is the most "coachable" of the three — a real org can teach decision-making and rotations
// far more easily than it can instill raw mechanical execution or the underlying physical foundation
// (car control, aerial control, etc.), so those two carry noticeably more weight in how impressive a
// prospect actually looks, Game Sense matters but isn't the differentiator.
const ORG_STAT_WEIGHT_FOUNDATION = 0.45;
const ORG_STAT_WEIGHT_MECHANICAL_CONSISTENCY = 0.35;
const ORG_STAT_WEIGHT_GAME_SENSE = 0.2;

export interface OrgTalentDetail {
  foundationRatio: number;
  mechanicalConsistencyRatio: number;
  gameSenseRatio: number;
  /** Weighted blend of the three ratios above, ~1.0 reads as genuine "top player" caliber (can run higher
   *  for someone who's already exceeding that benchmark). Drives both the scouting chance and which tier
   *  of org does the scouting. */
  overallScore: number;
}

/** Compares a player's actual stats against a "top player" benchmark (see matchSim.ts's
 *  eliteGameSenseCeiling/eliteFoundationCeiling) rather than just checking rank — someone whose MMR looks
 *  the part off a lucky/placement-amplified run but whose real stats lag well behind top-player level
 *  reads as a much weaker prospect here, exactly as a real org's own eye test would catch. */
export function orgTalentDetail(
  era: RankEra,
  currentYear: number,
  foundationStats: Record<FoundationCategory, number>,
  mechanicalConsistency2v2: number,
  gameSense2v2: number
): OrgTalentDetail {
  const foundationValues = Object.values(foundationStats);
  const avgFoundation = foundationValues.reduce((sum, v) => sum + v, 0) / foundationValues.length;
  const foundationCeiling = eliteFoundationCeiling(currentYear);
  const gameSenseCeiling = eliteGameSenseCeiling(era, "2v2", currentYear);
  const mechanicalConsistencyCeiling = gameSenseCeiling * 0.95;

  const foundationRatio = foundationCeiling > 0 ? avgFoundation / foundationCeiling : 0;
  const mechanicalConsistencyRatio = mechanicalConsistencyCeiling > 0 ? mechanicalConsistency2v2 / mechanicalConsistencyCeiling : 0;
  const gameSenseRatio = gameSenseCeiling > 0 ? gameSense2v2 / gameSenseCeiling : 0;

  const overallScore =
    foundationRatio * ORG_STAT_WEIGHT_FOUNDATION +
    mechanicalConsistencyRatio * ORG_STAT_WEIGHT_MECHANICAL_CONSISTENCY +
    gameSenseRatio * ORG_STAT_WEIGHT_GAME_SENSE;

  return { foundationRatio, mechanicalConsistencyRatio, gameSenseRatio, overallScore };
}

const TOP_ORG_TALENT_SCORE = 0.6;
const MID_ORG_TALENT_SCORE = 0.3;

export function orgTierForTalent(overallScore: number): OrgTier {
  if (overallScore >= TOP_ORG_TALENT_SCORE) return "top";
  if (overallScore >= MID_ORG_TALENT_SCORE) return "mid";
  return "bubble";
}

// Real rosters overwhelmingly move in the off-season, an org going shopping mid-split (an injury/burnout
// replacement, a struggling roster panic-swap) happens, but it's the exception, not the norm.
const OFF_SEASON_SCOUTING_MULTIPLIER = 1;
const IN_SEASON_SCOUTING_MULTIPLIER = 0.2;

/** Real orgs (especially anything above bubble tier) don't scout every single rank-eligible player the
 *  moment they clear the floor, most never get picked up at all — this is the chance a rank-eligible,
 *  unsigned/untried player gets a fresh scouting invite on any given check, scaled by how their actual
 *  stats compare to top-player caliber rather than by rank alone, and by whether it's currently the RLCS
 *  off-season (see tournaments.ts's rlcsSeasonPhase) — that's when rosters typically actually shuffle. */
export function orgScoutingChance(overallScore: number, phase: RlcsSeasonPhase): number {
  const base = Math.min(0.12, 0.02 + overallScore * 0.1);
  return base * (phase === "off_season" ? OFF_SEASON_SCOUTING_MULTIPLIER : IN_SEASON_SCOUTING_MULTIPLIER);
}

/** A tryout's scrim record decides the outcome once all planned scrims are played: a strong record earns
 *  a full starter spot, a mediocre one keeps the player on as a practice-squad sub (still real experience,
 *  just not a guaranteed roster spot), a losing record means getting cut, back to free agency. */
export type TryoutOutcome = "starter" | "sub" | "cut";

export function resolveTryoutOutcome(wins: number, losses: number): TryoutOutcome {
  const total = wins + losses;
  if (total === 0) return "cut";
  const winRate = wins / total;
  if (winRate >= 0.6) return "starter";
  if (winRate >= 0.35) return "sub";
  return "cut";
}

/** Real contracts run a season or two before renewal/release comes up again, weighted toward the shorter
 *  end, longer deals are the exception for someone who really impressed in tryouts. */
export function rollContractLengthSeasons(): number {
  return Math.random() < 0.7 ? 1 : 2;
}

// --- Ongoing scrims + contract renewal, once actually signed ---

/** How often the org lines up another scrim while the player's under contract, a top org scrims more
 *  (heavier practice regimen, more scouting/tape on upcoming opponents) than a bubble one. */
export function scrimIntervalDaysForTier(tier: OrgTier): number {
  if (tier === "top") return 3;
  if (tier === "mid") return 4;
  return 6;
}

/** Coaching sessions are a routine perk of being signed (not tied to scrim scheduling): a top org can
 *  afford to bring in a coach far more often than a bubble one just scraping by. */
export function coachingIntervalDaysForTier(tier: OrgTier): number {
  if (tier === "top") return 5;
  if (tier === "mid") return 7;
  return 10;
}

/** A bootcamp is a much bigger, rarer commitment than routine coaching or a single scrim: a real team
 *  retreat the org only runs a handful of times a season, scaled the same way by tier. */
export function bootcampIntervalDaysForTier(tier: OrgTier): number {
  if (tier === "top") return 14;
  if (tier === "mid") return 18;
  return 24;
}

/** How many scrims a single bootcamp packs in — "a ton of scrims" in one intensive block, rather than the
 *  usual one-at-a-time scrim cadence. */
export const BOOTCAMP_SCRIM_COUNT = 6;

/** Bootcamp scrims are against comparable org-caliber opposition, roughly competitive either way, but a
 *  stronger prospect (see orgTalentDetail's overallScore) still tilts the record in their favor, same as a
 *  real scrim would. */
export function bootcampScrimWinChance(overallScore: number): number {
  return Math.max(0.25, Math.min(0.75, 0.35 + overallScore * 0.35));
}

export type ContractRenewalOutcome = "renew" | "promote" | "release";

/** Same win-rate bands as a fresh tryout decide whether a contract gets renewed at all: a strong season of
 *  scrims can even earn a promotion to a better-tier org (poached away, real esports rosters shuffle
 *  constantly), a mediocre one just renews in place, and a losing record means release back to free
 *  agency — same real consequence a bad tryout carries, being signed once doesn't make the roster spot
 *  permanent. */
export function resolveContractRenewal(wins: number, losses: number, currentTier: OrgTier): ContractRenewalOutcome {
  const total = wins + losses;
  if (total === 0) return "renew"; // no scrims happened somehow, don't punish for it
  const winRate = wins / total;
  if (winRate < 0.35) return "release";
  if (winRate >= 0.65 && currentTier !== "top" && Math.random() < 0.3) return "promote";
  return "renew";
}

export function promotedTier(tier: OrgTier): OrgTier {
  return tier === "bubble" ? "mid" : "top";
}

/** Whether ONE of the two teammates gets swapped out for a fresh face on renewal — real rosters aren't
 *  static, a teammate can get poached by a bigger org, retire, or just get replaced between seasons. Only
 *  rolled on an actual renewal (not a release, there's no roster left to churn at that point). */
export function rollsTeammateChurn(): boolean {
  return Math.random() < 0.25;
}
