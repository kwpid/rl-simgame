// Org/pro-scene eligibility and tier math. Purely stateless — the actual tryout/contract state lives on
// the save (see mockSave.ts's OrgInvite/OrgTryout/OrgContract), this file only answers "is this player
// good enough to be scouted at all, and by what caliber of org" from their live 2v2 ranked numbers.
//
// The org track only ever cares about 2v2: it's the queue real pros treat as their main competitive
// practice (see proPlayers.ts's seedProMmr), and it's the queue eligibility/teammate-matching both key off.

import { tierMinMmr, type RankEra } from "./rankSystem";
import { estimateGameSenseForMmr } from "./matchSim";

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

/** Whether this player's 2v2 numbers clear the org scouting bar at all: BOTH the rank floor above AND
 *  their actual trained stats have to hold up, someone whose MMR looks the part off a lucky/placement-
 *  amplified run but whose real Game Sense lags well behind what that MMR should imply isn't someone a
 *  real org would sign — the numbers have to be real, not just a rank number. */
export function meetsOrgEligibility(era: RankEra, currentYear: number, mmr2v2: number, gameSense2v2: number): boolean {
  if (mmr2v2 < orgRankFloorMmr(era)) return false;
  const expectedGameSense = estimateGameSenseForMmr(mmr2v2, era, "2v2", currentYear);
  return gameSense2v2 >= expectedGameSense * 0.8;
}

/** How far above the bare minimum this player actually is, 0 at the floor, 1 at a full "second floor" of
 *  overshoot — blends rank and Game Sense evenly since either one alone can be misleading (see
 *  `meetsOrgEligibility`). Determines both the odds of getting scouted at all and which tier of org does
 *  the scouting: a bubble/feeder org takes anyone clearing the floor at all, a top org only wants players
 *  who are clearly, comfortably above it already. */
export function orgOvershoot(era: RankEra, currentYear: number, mmr2v2: number, gameSense2v2: number): number {
  const floor = orgRankFloorMmr(era);
  const mmrOvershoot = Math.max(0, (mmr2v2 - floor) / floor);
  const expectedGameSense = estimateGameSenseForMmr(floor, era, "2v2", currentYear);
  const statOvershoot = Math.max(0, (gameSense2v2 - expectedGameSense) / Math.max(1, expectedGameSense));
  return (mmrOvershoot + statOvershoot) / 2;
}

const TOP_ORG_OVERSHOOT = 0.5;
const MID_ORG_OVERSHOOT = 0.15;

export function orgTierForOvershoot(overshoot: number): OrgTier {
  if (overshoot >= TOP_ORG_OVERSHOOT) return "top";
  if (overshoot >= MID_ORG_OVERSHOOT) return "mid";
  return "bubble";
}

/** Real orgs (especially anything above bubble tier) don't scout every single eligible player the moment
 *  they clear the floor, most eligible players never get picked up at all — this is the daily chance an
 *  eligible, unsigned/untried player gets a fresh scouting invite. Scales up a little with how far above
 *  the floor they are, a player who's clearly overshooting gets noticed faster than one barely qualifying. */
export function orgScoutingChance(overshoot: number): number {
  return Math.min(0.12, 0.02 + overshoot * 0.06);
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
