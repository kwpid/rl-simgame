// Stat-weighted match simulation engine. Every possession is a short chain of stat-checked steps
// (not a single randomized flavor line), and every check pulls real stats from both the acting player
// and whoever is contesting them, so a defense-heavy opponent actually punishes a high-offense attacker,
// a low-aerial-control player actually whiffs aerials more, and so on.

import { MECHANICS, type FoundationCategory } from "./mechanics";
import { deriveRankFromMmr, tierMinMmr, type RankEra, type RankQueue, type RankTierId } from "./rankSystem";
import { pickAiTitle, type TitleEntry } from "./seasons";
import { PRO_PLAYERS, isGenerationalTalent, experienceGrowth, hashString, type ProRegion } from "./proPlayers";
import type { PlaystyleProfile } from "./mockSave";
import { ORG_NAMES, orgTagForOrgName } from "./orgNames";
import type { SimDate } from "./dateUtils";

/** The human player's real per-mechanic/per-concept training and playstyle tendency, only ever present
 *  for `isSelf` — an AI opponent has no individual trained-mechanic breakdown, the 1v1 duel engine falls
 *  back to a believable proxy derived from their overall stats instead (see matchSim.ts's pickWeightedMove). */
export interface DuelMastery {
  mechanicMastery: Record<string, number>;
  queueConceptMastery: Record<string, number>;
  playstyle: PlaystyleProfile;
}

/** mechanicProgress/queueConceptProgress on the save are `{ currentValue }` wrapper records, this strips
 *  that down to a flat id->value map for `DuelMastery`. */
export function flattenProgress(progress: Record<string, { currentValue: number }>): Record<string, number> {
  return Object.fromEntries(Object.entries(progress).map(([id, p]) => [id, p.currentValue]));
}

export interface MatchParticipantStats {
  name: string;
  team: "blue" | "orange";
  isSelf: boolean;
  gameSense: number;
  mechanicalConsistency: number;
  foundationStats: Record<FoundationCategory, number>;
  title: TitleEntry | null;
  /** This player's notional MMR in the queue being played, a real pro's actual live MMR, or a small
   *  jitter around the human player's own MMR for a generic AI (matchmaking pairs you near your rank). */
  mmr: number;
  duelMastery?: DuelMastery;
  /** 2-4 character org tag shown as [TAG] before this player's name (see OrgTag.tsx), or undefined if
   *  they're not signed to anything. For the human player this comes from their own orgContract; for an AI
   *  opponent see orgTagForOpponent below. */
  orgTag?: string;
  /** This player's real region (their own save region for the human, or a real pro's/regional grinder's
   *  tracked region for an AI opponent) — undefined for an untracked generic filler name. Purely cosmetic,
   *  drives the live ping readout (see data/pingModel.ts), no gameplay effect. */
  region?: ProRegion;
  /** 0-100, how well this player's REAL TEAM (an org roster or a generated RLCS team, see OrgContract.chemistry
   *  and data/tournaments.ts) plays together — shared by every player on that team. Undefined for ordinary
   *  ranked matches (no team concept there), which keeps regular ranked play byte-for-byte unaffected: see
   *  simulateTeamPossession's neutral fallback. Only ever set for 3v3 org-scrim/tournament matches. */
  teamChemistry?: number;
}

const ALL_ORG_NAMES = Object.values(ORG_NAMES).flat();

/** Whether a given AI opponent is currently signed to an org, and which one, deterministic per name so the
 *  same opponent always reads as tagged (or not) and with the same org match to match, rather than a fresh
 *  coinflip every game. Gated by rank tier since only GC/SSL-caliber play is realistically org-scouted (see
 *  data/orgs.ts's own MMR gate for the player's identical career track), and a real named pro is far more
 *  likely to already be signed than a generic filler regular at the same rank. Barely cracking GC isn't
 *  signed-pro territory yet though, so this also scales down hard for anyone still shallow in the tier (a
 *  fresh GC lobby full of org tags reads wrong), and the pre-2020 pro scene was much smaller/less saturated,
 *  so a legacy-era opponent is tagged far less often than an otherwise-identical modern one. */
function orgTagForOpponent(name: string, effectiveTier: RankTierId, isPro: boolean, era: RankEra, mmr: number, queue: RankQueue): string | undefined {
  const eligible = effectiveTier === "grand_champion" || effectiveTier === "ssl";
  if (!eligible) return undefined;
  const tierFloor = tierMinMmr(effectiveTier, era, queue);
  const depth = Math.max(0, Math.min(1, (mmr - tierFloor) / 300));
  const eraFactor = era === "modern" ? 1 : 0.5;
  const seed = hashString(name + "#org");
  const baseChance = isPro ? 0.4 : 0.05;
  const chance = baseChance * (0.15 + 0.85 * depth) * eraFactor;
  if (((seed >>> 0) % 1000) / 1000 >= chance) return undefined;
  const orgName = ALL_ORG_NAMES[Math.abs(seed >> 3) % ALL_ORG_NAMES.length];
  return orgTagForOrgName(orgName);
}

/** The real trained profile when present (the human player, via duelMastery), else a believable proxy
 *  derived deterministically from the actor's own stats and name — same "no authored per-opponent data,
 *  so infer a consistent personality from what we do know" pattern moveMasteryValue/conceptMasteryValue
 *  already use below for AI mechanic mastery. Same name always proxies to the same tendencies match to
 *  match, it just isn't a REAL trained profile the way the player's own is. */
export function effectivePlaystyle(actor: MatchParticipantStats): PlaystyleProfile {
  if (actor.duelMastery) return actor.duelMastery.playstyle;
  const seed = hashString(actor.name + "#style");
  const jitter = (shift: number, spread = 20) => ((seed >> shift) % (spread + 1)) - spread / 2;
  const offenseLean = actor.foundationStats.offense - actor.foundationStats.defense;
  const clamp = (v: number) => Math.max(5, Math.min(95, Math.round(v)));
  return {
    aggression: clamp(50 + offenseLean / 40 + jitter(0)),
    rotationDiscipline: clamp(40 + actor.foundationStats.defense / 200 + jitter(4)),
    mechanicalFlair: clamp(40 + actor.mechanicalConsistency / 2000 + jitter(8)),
    consistency: clamp(50 + jitter(12)),
  };
}

// Game Sense and Mechanical Consistency dominate real skill separation at the high end (an SSL's raw
// foundation stats are close together, decision-making/execution is what actually separates them), so they
// carry more of the blend than any single foundation stat, but a well-rounded foundation still matters.
const OVERALL_RATING_GAME_SENSE_WEIGHT = 0.35;
const OVERALL_RATING_CONSISTENCY_WEIGHT = 0.25;
const OVERALL_RATING_FOUNDATION_WEIGHT = 0.4;

/** A single number blending Game Sense, Mechanical Consistency, and the average of all six foundation
 *  stats, so two players (or the same player across sessions) can be compared at a glance instead of
 *  reading six-plus separate numbers. Same rough scale as Game Sense alone (uncapped, elite pros run well
 *  past 80k), since that's the dominant term. */
export function computeOverallRating(gameSense: number, mechanicalConsistency: number, foundationStats: Record<FoundationCategory, number>): number {
  const values = Object.values(foundationStats);
  const avgFoundation = values.reduce((sum, v) => sum + v, 0) / values.length;
  return Math.round(
    gameSense * OVERALL_RATING_GAME_SENSE_WEIGHT +
      mechanicalConsistency * OVERALL_RATING_CONSISTENCY_WEIGHT +
      avgFoundation * OVERALL_RATING_FOUNDATION_WEIGHT
  );
}

// Rough skill magnitude per rank tier, used to generate believable AI stats. Real players' stats live
// on their save, AI opponents/teammates are generated fresh each match around their queue's rank tier.
const RANK_STAT_BASELINE: Record<RankTierId, number> = {
  unranked: 80,
  bronze: 150,
  silver: 280,
  gold: 450,
  platinum: 1200,
  diamond: 1800,
  champion: 2600,
  grand_champion: 3800,
  ssl: 5500,
};

function jitter(base: number, spread = 0.3): number {
  return Math.round(base * (1 - spread + Math.random() * spread * 2));
}

// Real Rocket League's meta has genuinely gotten harder every year since launch, the same rank has
// demanded more actual execution/game sense each season as the whole population's ceiling (and average)
// climbs. Modeled as flat compounding growth from the sim's earliest playable year, uncapped like every
// other stat here, so "the highest rank obtainable" in an early save reads as a believable mid-tier rank
// once the same save reaches a much later year, same as it would in real RL.
const GAME_LAUNCH_YEAR = 2015; // matches SaveCreateScreen's earliest selectable starting year
const ANNUAL_SKILL_GROWTH_RATE = 0.04; // ~4%/year, compounds to a real difference over a decade+ save

export function yearSkillGrowthFactor(currentYear: number): number {
  const years = Math.max(0, currentYear - GAME_LAUNCH_YEAR);
  return Math.pow(1 + ANNUAL_SKILL_GROWTH_RATE, years);
}

// Game Sense/Mechanical Consistency scale far more steeply than a flat per-tier baseline: 3k-6k is only
// Diamond-Champion territory, low-mid GC sits around 10k, and SSL alone spans an enormous range (15k
// fresh-SSL up to 50k-80k at the very top of the non-pro population), reflecting how much further real
// skill separates the best non-pros from an average SSL, before pros (80k+) even enter the picture. Modeled
// as a piecewise-linear curve over MMR, anchored relative to each queue's own Champion/GC/SSL thresholds
// (era-aware, legacy has no SSL so its GC bracket carries the same "uncapped top tier" spread instead).
function gameSenseAnchors(era: RankEra, queue: RankQueue, currentYear: number): { mmr: number; value: number }[] {
  const champMin = tierMinMmr("champion", era, queue);
  const gcMin = tierMinMmr("grand_champion", era, queue);
  const topMin = era === "modern" ? tierMinMmr("ssl", era, queue) : gcMin + (gcMin - champMin);
  const topSpread = Math.max(100, topMin - gcMin);
  const growth = yearSkillGrowthFactor(currentYear);

  return [
    // A fresh, just-started player (near 0 MMR) reads as genuinely raw, not "a little below average" —
    // real Bronze-Gold play (roughly up to 600 MMR in most queues) stays deliberately low and only starts
    // climbing meaningfully once Platinum/Diamond starts separating out real decision-making, rather than
    // a single straight line all the way to Champion that made even mid-Gold read as an already-decent
    // ~1000+ overall rating. Every value below scales with `growth`, the same MMR requires more actual
    // execution in a later year than an earlier one, the population as a whole keeps getting better.
    { mmr: 0, value: 60 * growth },
    { mmr: champMin * 0.35, value: 500 * growth },
    { mmr: champMin * 0.7, value: 1400 * growth },
    { mmr: champMin, value: 3000 * growth },
    { mmr: gcMin, value: 6000 * growth },
    { mmr: gcMin + topSpread * 0.4, value: 9000 * growth },
    // The run-up right before SSL is deliberately steeper than the rest of the curve: the last stretch
    // below the floor, and the floor itself, both jumped harder than a plain linear approach would, so
    // maintaining a matchmaking edge gets tangibly tougher the closer a player gets to actually ranking in.
    { mmr: gcMin + topSpread * 0.75, value: 14000 * growth },
    { mmr: topMin, value: 20000 * growth },
    { mmr: topMin + topSpread * 0.3, value: 38000 * growth },
    { mmr: topMin + topSpread * 0.6, value: 60000 * growth },
    { mmr: topMin + topSpread * 1.0, value: 80000 * growth },
  ];
}

export function estimateGameSenseForMmr(mmr: number, era: RankEra, queue: RankQueue, currentYear: number): number {
  const anchors = gameSenseAnchors(era, queue, currentYear);
  if (mmr <= anchors[0].mmr) return anchors[0].value;
  for (let i = 1; i < anchors.length; i++) {
    if (mmr <= anchors[i].mmr) {
      const a = anchors[i - 1];
      const b = anchors[i];
      const t = (mmr - a.mmr) / (b.mmr - a.mmr);
      return a.value + t * (b.value - a.value);
    }
  }
  // Beyond the last anchor, hold flat rather than keep extrapolating the final slope: 1v1 in particular
  // has a small topSpread (its real population sits close to its own SSL floor), so extrapolating further
  // used to blow straight past this same curve's own pro floor for anyone deep into SSL — a merely very
  // good non-pro shouldn't read as more skilled than an actual pro.
  return anchors[anchors.length - 1].value;
}

/** The curve's own topped-out ceiling for this era/queue/year — "as good as it plausibly gets short of
 *  real pro territory" — used as the "top player" benchmark data/orgs.ts compares a player's Game Sense/
 *  Mechanical Consistency against, rather than an absolute number that'd drift out of sync with the rest
 *  of the year-scaled rank curve. */
export function eliteGameSenseCeiling(era: RankEra, queue: RankQueue, currentYear: number): number {
  const anchors = gameSenseAnchors(era, queue, currentYear);
  return anchors[anchors.length - 1].value;
}

/** Same idea as `eliteGameSenseCeiling` but for foundation stats (car control, aerial control, etc.) —
 *  the SSL tier baseline is the highest rung the rank-tier curve itself defines, year-scaled the same way. */
export function eliteFoundationCeiling(currentYear: number): number {
  return RANK_STAT_BASELINE.ssl * yearSkillGrowthFactor(currentYear);
}

// Real pros run circles around even a Grand Champion/SSL rando: years of grinding accumulate way past
// what the tier-baseline curve alone would produce. There's no hard ceiling (a decade-deep veteran keeps
// climbing), but diminishing returns per year mean most pros cluster in the same rough band rather than
// spreading out endlessly, a rare "generational talent" (see proPlayers.ts) climbs well past the pack.
// A fresh pro floors around 80k, a long-tenured talented one reaches well past 120k.
const PRO_STAT_FLOOR = 80000;
const PRO_STAT_PER_YEAR = 5500;
const PRO_STAT_DIMINISHING_SCALE = 45000;

export function generateOpponentStats(
  name: string,
  team: "blue" | "orange",
  rankTier: RankTierId,
  era: RankEra,
  seasonNumber: number,
  currentYear: number,
  /** The human player's own current MMR in this queue, used as the notional MMR for a generic (non-pro)
   *  opponent, matchmaking pairs you near your own rank, so a bot without a real MMR of its own should
   *  read as roughly your rank, not some arbitrary number. */
  playerMmr: number,
  /** Which queue this match is in, needed to anchor the Game Sense/Mechanical Consistency curve to the
   *  right MMR thresholds (1v1/2v2/3v3 brackets sit at different MMR scales). */
  queue: RankQueue,
  /** When this opponent is a pro playing THIS specific queue, their live per-queue MMR (from the pro
   *  leaderboard) determines their effective rank tier here, instead of the player's own rank tier, a
   *  2v2-main pro dropped into a 1v1 match should play like their (weaker) 1v1 self, not their 2v2 self. */
  proQueueOverride?: { mmr: number; queue: RankQueue },
  /** Tournament fields (RLCS opens, majors, etc.) are still a notch above regular ranked play even for
   *  the generic/amateur entrants who aren't a named real pro, real "open bracket" competitors are
   *  seriously skilled, not just typical ranked players. Only affects non-pro opponents, a real pro's
   *  stats already come from the dedicated pro floor regardless of context. */
  isTournamentMatch = false,
  /** The FINAL title choice for a tracked identity (pro, regional grinder, leaderboard filler), already
   *  resolved by the caller via useAiTitleStore.ts's getEquippedTitle (real/fictional RLCS history +
   *  fictional season-title inventory, persisted so the same name keeps wearing the same title match to
   *  match). `null` means tracked but genuinely has no titles at all. `undefined` (an untracked, one-off
   *  generic opponent) falls back to the old per-match `pickAiTitle` flavor roll below. */
  resolvedTitle?: TitleEntry | null,
  /** A pro or leaderboard filler regular's own persistent, gradually-simulated Game Sense/Mechanical
   *  Consistency (see store/useProLeaderboardStore.ts / useLeaderboardFillerStore.ts), used verbatim
   *  instead of rolling a fresh jittered value every match — the whole point being that a name tracked on
   *  the leaderboard reads as the SAME person match to match (improving over time), not a random reroll. */
  persistentStats?: { gameSense: number; mechanicalConsistency: number },
  /** 0 (first bracket stage) to 1 (final stage) — only matters for a non-pro tournament entrant, later
   *  rounds of a real qualifier are tougher even among the amateurs who make it that far, not a flat
   *  difficulty the whole way through. */
  tournamentStageProgress = 0
): MatchParticipantStats {
  const effectiveTier = proQueueOverride ? deriveRankFromMmr(proQueueOverride.mmr, era, proQueueOverride.queue).tier : rankTier;
  const mmr = proQueueOverride ? proQueueOverride.mmr : Math.round(playerMmr * (0.94 + Math.random() * 0.12));
  const baseline = (RANK_STAT_BASELINE[effectiveTier] ?? 800) * yearSkillGrowthFactor(currentYear);
  const foundationCategories: FoundationCategory[] = [
    "carControl",
    "aerialControl",
    "boostManagement",
    "offense",
    "defense",
    "passing",
  ];
  const foundationStats = Object.fromEntries(
    foundationCategories.map((cat) => [cat, jitter(baseline)])
  ) as Record<FoundationCategory, number>;

  const pro = PRO_PLAYERS.find((p) => p.name === name && p.debutYear <= currentYear);
  const experienceYears = pro ? Math.max(0, currentYear - pro.debutYear) : 0;
  const talentBonus = pro && isGenerationalTalent(pro.name) ? 15000 + Math.random() * 20000 : 0;
  const proFloor = pro
    ? PRO_STAT_FLOOR + experienceGrowth(experienceYears, PRO_STAT_PER_YEAR, PRO_STAT_DIMINISHING_SCALE) + talentBonus
    : 0;

  // A generic tournament entrant (amateur bracket, not a named pro) still reads as seriously competitive,
  // well above a typical ranked SSL player, and gets notably tougher deeper into the bracket — surviving
  // to a regional's playoffs round means actually beating real orgs along the way, not staying a pushover.
  const amateurTournamentFloor = 25000 + Math.max(0, Math.min(1, tournamentStageProgress)) * 45000 + Math.random() * 15000;
  const rankedEstimate = estimateGameSenseForMmr(mmr, era, proQueueOverride?.queue ?? queue, currentYear);

  const title = resolvedTitle !== undefined ? resolvedTitle : pickAiTitle(era, seasonNumber, effectiveTier);

  return {
    name,
    team,
    isSelf: false,
    gameSense: persistentStats
      ? persistentStats.gameSense
      : pro
        ? jitter(proFloor, 0.12)
        : isTournamentMatch
          ? jitter(amateurTournamentFloor, 0.2)
          : jitter(rankedEstimate, 0.2),
    mechanicalConsistency: persistentStats
      ? persistentStats.mechanicalConsistency
      : pro
        ? jitter(proFloor * 0.95, 0.12)
        : isTournamentMatch
          ? jitter(amateurTournamentFloor * 0.9, 0.2)
          : jitter(rankedEstimate * 0.9, 0.2),
    foundationStats,
    title,
    mmr,
    orgTag: orgTagForOpponent(name, effectiveTier, !!pro, era, mmr, proQueueOverride?.queue ?? queue),
    region: pro?.region,
  };
}

/** A pro's Game Sense/Mechanical Consistency ceiling for a season: years of grinding accumulate way past
 *  what the tier-baseline curve alone would produce, with diminishing returns per year and a rare
 *  "generational talent" (see proPlayers.ts) climbing well past the pack. Exported so the pro leaderboard
 *  store can use the exact same target this file's own per-match generation used to compute inline. */
export function proStatCeiling(pro: { name: string; debutYear: number }, currentYear: number): number {
  const experienceYears = Math.max(0, currentYear - pro.debutYear);
  const talentBonus = isGenerationalTalent(pro.name) ? 15000 + Math.random() * 20000 : 0;
  return PRO_STAT_FLOOR + experienceGrowth(experienceYears, PRO_STAT_PER_YEAR, PRO_STAT_DIMINISHING_SCALE) + talentBonus;
}

/** `proStatCeiling` alone is flat and queue-independent, a pro's full career-wide potential regardless of
 *  which queue is being asked about. That used to get applied even to a queue that isn't remotely their
 *  main: a pro whose live MMR in an off-queue only reaches low Grand Champion would still show 80k+ stats
 *  there, a wild mismatch against an actual low-GC opponent (a real GC player has no business facing down
 *  someone reading as a top-of-the-world pro). This blends the flat career ceiling with what the queue's
 *  own MMR->Game Sense curve implies for THIS queue's target MMR, so a pro playing well below their main
 *  queue's level reads as a genuinely strong player at that level (better than the curve baseline, they're
 *  still a real pro) rather than their full potential, which only actually shows up once their target MMR
 *  in this queue is itself near the top bracket. */
export function proQueueStatCeiling(
  pro: { name: string; debutYear: number },
  currentYear: number,
  targetMmr: number,
  era: RankEra,
  queue: RankQueue
): number {
  const ceiling = proStatCeiling(pro, currentYear);
  const rankedEstimate = estimateGameSenseForMmr(targetMmr, era, queue, currentYear);
  const gcFloor = tierMinMmr("grand_champion", era, queue);
  const champFloor = tierMinMmr("champion", era, queue);
  const topFloor = era === "modern" ? tierMinMmr("ssl", era, queue) : gcFloor + Math.max(100, gcFloor - champFloor);
  if (targetMmr >= topFloor) return Math.max(ceiling, rankedEstimate);
  const t = Math.max(0, targetMmr / topFloor);
  return rankedEstimate + (ceiling - rankedEstimate) * t * t;
}

// A real Elo expected-score formula: beating a much stronger opponent pays out close to the full K, an
// expected win against a much weaker one pays out close to nothing, and an even match sits near K/2 —
// unlike a flat narrow band, the size of the swing now genuinely depends on the actual skill gap.
export const ELO_K_FACTOR = 24;
const ELO_RATING_SCALE = 400; // standard Elo divisor: a 400-point gap is a 10x-favorite expected score

// Real ranked systems settle down near the top: full-size swings through the mid-ranks, but a rating
// that's already deep into GC/SSL territory should move noticeably slower per game than one still in
// Diamond, real skill differences there are much narrower on average. Anchored on flat MMR numbers rather
// than per-queue tier thresholds (queue floors only differ by a couple hundred MMR, this is deliberately
// a broad, universal compression rather than something that needs era/queue context to compute).
const K_FACTOR_MAX = 24;
const K_FACTOR_MIN = 10;
const K_COMPRESSION_START_MMR = 1300; // roughly Champion/low-GC across all three queues
const K_COMPRESSION_END_MMR = 2000; // solidly deep-SSL across all three queues

/** The Elo K-factor for a rating this high: flat `K_FACTOR_MAX` below the compression band, tapering
 *  linearly down to `K_FACTOR_MIN` by the top of it, so the closer a player gets to (and through) SSL,
 *  the more games it takes to move the same amount — climbing the last stretch is a real grind, not just
 *  the same per-game swing repeated. */
export function eloKFactor(mmr: number): number {
  if (mmr <= K_COMPRESSION_START_MMR) return K_FACTOR_MAX;
  if (mmr >= K_COMPRESSION_END_MMR) return K_FACTOR_MIN;
  const t = (mmr - K_COMPRESSION_START_MMR) / (K_COMPRESSION_END_MMR - K_COMPRESSION_START_MMR);
  return K_FACTOR_MAX - t * (K_FACTOR_MAX - K_FACTOR_MIN);
}

export function eloExpectedScore(myMmr: number, oppMmr: number): number {
  return 1 / (1 + Math.pow(10, (oppMmr - myMmr) / ELO_RATING_SCALE));
}

/** A completely expected result at the very top of the ladder (see `eloKFactor`'s compression) can round
 *  down to a near-nothing swing — every match should still feel like it moved the needle at least a
 *  little, win or lose. */
const MIN_MMR_DELTA_MAGNITUDE = 7;

/** Computes one team's signed MMR delta for a match via a standard Elo formula (K * (actual - expected)),
 *  so upsets swing hard and expected results barely move anyone, same as a real competitive rating system.
 *  K itself compresses as `myAvgMmr` climbs into GC/SSL territory (see `eloKFactor`), the top of the ladder
 *  moves slower per game than the middle does. Floored at `MIN_MMR_DELTA_MAGNITUDE` either direction — a
 *  win never gains less than that, a loss never costs less than that. */
export function computeMmrDelta(myAvgMmr: number, oppAvgMmr: number, won: boolean): number {
  const expected = eloExpectedScore(myAvgMmr, oppAvgMmr);
  const actual = won ? 1 : 0;
  const raw = Math.round(eloKFactor(myAvgMmr) * (actual - expected));
  return won ? Math.max(MIN_MMR_DELTA_MAGNITUDE, raw) : Math.min(-MIN_MMR_DELTA_MAGNITUDE, raw);
}

/** Logistic comparison: converts an arbitrary-scale stat gap into a win probability for the attacker.
 *  spread controls how decisive a gap is, a bigger spread means even large stat gaps stay competitive. */
function statProbability(attackerStat: number, defenderStat: number, spread = 700): number {
  const diff = attackerStat - defenderStat;
  return 1 / (1 + Math.exp(-diff / spread));
}

/** How often a player botches an attempt regardless of opposition, driven by consistency and by their
 *  own skill in the relevant stat (a low-aerial-control player whiffs aerials more, independent of who's
 *  defending). baseWhiff is the floor difficulty of the move itself (aerials are harder than ground shots). */
function whiffChance(actor: MatchParticipantStats, relevantStat: number, baseWhiff: number): number {
  const consistencyRelief = Math.min(0.55, actor.mechanicalConsistency / 7000);
  const skillRelief = Math.min(0.3, relevantStat / 8000);
  return Math.max(0.04, baseWhiff - consistencyRelief - skillRelief);
}

export interface PossessionLogLine {
  text: string;
}

export interface PossessionResult {
  lines: PossessionLogLine[];
  outcome: "goal" | "save" | "clear" | "whiff";
  scoringTeam?: "blue" | "orange";
  /** Name of the scorer (outcome "goal") or the keeper who made the stop (outcome "save"), so callers
   *  can track "did *I* score/save that" without guessing from point amounts. */
  actorName?: string;
  pointsAwarded: { name: string; amount: number }[];
}

function pickDefender(defenders: MatchParticipantStats[]): MatchParticipantStats {
  return defenders[Math.floor(Math.random() * defenders.length)];
}

function pickAttacker(attackers: MatchParticipantStats[]): MatchParticipantStats {
  // Weight toward players with higher combined offense + gameSense, better players get the ball more —
  // plus a real playstyle lean: a more aggressive player pushes up for the ball more often, a passive one
  // hangs back and lets it come to them.
  const weights = attackers.map((a) => a.foundationStats.offense + a.gameSense * 0.4 + 200 + (effectivePlaystyle(a).aggression - 50) * 2);
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < attackers.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return attackers[i];
  }
  return attackers[attackers.length - 1];
}

// Shot "kind" for the finishing beat of a team chain (see simulateTeamChain below) — purely flavor/whiff-
// profile at this point (aerial vs ground vs flick each have their own setup line and whiff curve), the
// actual chain-of-events realism (kickoffs, roles, challenges, demos, pressure) lives in the chain engine.
type ChainKind = "aerial" | "ground_flick" | "wall_read" | "fifty_fifty";

function pickChainKind(attacker: MatchParticipantStats): ChainKind {
  const roll = Math.random();
  // Better aerial control makes an aerial play more likely to be attempted at all, a more aggressive
  // playstyle pushes that further still (going for the flashier, higher-risk read more often).
  const aerialWeight = 0.2 + Math.min(0.35, attacker.foundationStats.aerialControl / 9000) + (effectivePlaystyle(attacker).aggression - 50) / 400;
  if (roll < aerialWeight) return "aerial";
  if (roll < aerialWeight + 0.25) return "wall_read";
  if (roll < aerialWeight + 0.45) return "ground_flick";
  return "fifty_fifty";
}

/** The finishing beat of a team chain: a setup touch (kind-specific whiff/flavor) followed by the actual
 *  shot-vs-save resolution. Split out from `simulateTeamChain` so the chain engine can reach this from
 *  several different points (an early breakaway, a demo leaving the net empty, running out of advance
 *  beats) without duplicating the setup-then-shoot shape each time. */
function resolveFinish(
  attacker: MatchParticipantStats,
  defendingTeam: MatchParticipantStats[],
  lines: PossessionLogLine[],
  pointsAwarded: { name: string; amount: number }[],
  finishWhiffBase: number,
  /** Scales the keeper's effective save power for this finish only: below 1 when the defense is
   *  stretched thin (a 2v2 last-man situation), above 1 when a teammate's rotated back in support. */
  keeperPowerMultiplier = 1
): PossessionResult {
  function award(name: string, amount: number) {
    pointsAwarded.push({ name, amount });
  }

  const finishWhiff = whiffChance(attacker, attacker.foundationStats.offense, finishWhiffBase);
  if (Math.random() < finishWhiff) {
    lines.push({ text: `${attacker.name} skies the finish over the bar.` });
    return { lines, outcome: "whiff", pointsAwarded };
  }

  const keeper = pickDefender(defendingTeam);
  const shotPower = attacker.foundationStats.offense + attacker.mechanicalConsistency * 0.15;
  const savePower = (keeper.foundationStats.defense + keeper.mechanicalConsistency * 0.15) * keeperPowerMultiplier;
  // A composed, well-positioned recovery reads differently than a panicked scramble — a stronger keeper
  // (relative to this finish's own difficulty) gets the calmer lines, "scrambles back" stops being the
  // only recovery this engine ever describes.
  // Softer than a near-even bar — a merely somewhat-outmatched keeper still reads as composed sometimes
  // instead of every real mismatch defaulting to the panicked-language pool every single time.
  const composed = savePower > shotPower * 0.75;
  // A wider pool than just 3 lines each — this fires on basically every finish attempt in a match, a small
  // pool repeats within a single short stretch often enough to read as templated.
  const recoveryLines = composed
    ? [
        `${keeper.name} is already set and shape stays clean.`,
        `${keeper.name} recovers with plenty of time to spare.`,
        `${keeper.name} reads it early and gets goalside in good shape.`,
        `${keeper.name} times the rotation perfectly and is waiting.`,
        `${keeper.name} never loses shape and slots back in calmly.`,
        `${keeper.name} anticipates it and is already back in position.`,
      ]
    : [
        `${keeper.name} scrambles back to defend the net.`,
        `${keeper.name} recovers late, still getting across in time.`,
        `${keeper.name} hustles back to cover the net.`,
        `${keeper.name} is caught out but just manages to get back.`,
        `${keeper.name} rotates back in a hurry.`,
        `${keeper.name} barely makes it back in time.`,
      ];
  lines.push({ text: recoveryLines[Math.floor(Math.random() * recoveryLines.length)] });

  if (Math.random() > statProbability(shotPower, savePower)) {
    lines.push({ text: `SAVE! ${keeper.name} gets enough on it to keep it out.` });
    award(keeper.name, 50);
    return { lines, outcome: "save", actorName: keeper.name, pointsAwarded };
  }

  lines.push({ text: `GOAL! ${attacker.name} finishes it past ${keeper.name}.` });
  award(attacker.name, 100);
  return { lines, outcome: "goal", scoringTeam: attacker.team, actorName: attacker.name, pointsAwarded };
}

/** Setup touch + finish, kind-specific whiff curve and flavor line, then delegates to `resolveFinish` for
 *  the actual shot-vs-save. This is the "kind" flavor the old single-step 2v2/3v3 engines had, now just the
 *  LAST beat of the richer chain in `simulateTeamChain` below instead of the whole possession. */
function attemptFinish(
  attacker: MatchParticipantStats,
  defendingTeam: MatchParticipantStats[],
  lines: PossessionLogLine[],
  pointsAwarded: { name: string; amount: number }[],
  kind: ChainKind,
  keeperMultiplier: number,
  currentDate: SimDate
): PossessionResult {
  if (kind === "aerial") {
    // A named mechanic only ever comes up here — never forced into every aerial look. It needs the
    // situation to actually support it (this beat already earned an aerial chance), the move to actually
    // exist yet (era-filtered), and the attacker to clear a shot-selection/confidence bar that scales with
    // how mechanically dense the era is — 2021+ play leans on this far more than earlier years, and a
    // player/AI whose own playstyle skews toward flair clears that bar more easily regardless of era.
    const eraPool = AERIAL_ATTACK_MOVE_IDS.filter((id) => mechanicUnlockedByDate(id, currentDate));
    const style = effectivePlaystyle(attacker);
    if (eraPool.length > 0) {
      const move = pickWeightedMove(eraPool, attacker);
      const mastery = moveMasteryValue(move.id, attacker);
      // Mastery/consistency values live on a wildly different absolute scale depending on era/rank (a
      // gameSense-adjacent stat can be single digits early on or tens of thousands at elite level) — the
      // gate has to be RELATIVE to the attacker's own general ceiling, never a flat number, or it either
      // never fires early on or fires on basically every attempt once stats get large (the exact scale-
      // mismatch bug pickChallengeType's fakeWeight had). relativeMastery near 1 means this specific move
      // is basically as sharp as their overall consistency — a real signature they reach for often.
      const relativeMastery = mastery / Math.max(1, attacker.mechanicalConsistency);
      const mechanicalEra = Math.max(0, Math.min(1, (currentDate.year - 2019) / 3)); // ~0 pre-2019, 1 by 2022+
      const flairRelief = (style.mechanicalFlair - 50) / 200;
      const attemptBar = Math.max(0.12, 0.6 - mechanicalEra * 0.25 - flairRelief);
      if (relativeMastery > attemptBar) {
        lines.push({ text: `${attacker.name} sees the chance and goes for a ${move.label}.` });
        const whiffFloor = relativeMastery > attemptBar * 1.8 ? 0.1 : 0.24;
        const whiff = whiffChance(attacker, mastery, whiffFloor);
        if (Math.random() < whiff) {
          lines.push({ text: `${attacker.name} can't quite pull it off, mistimed and wasted.` });
          return { lines, outcome: "whiff", pointsAwarded };
        }
        if (relativeMastery < attemptBar * 1.4) {
          lines.push({ text: `The execution is a bit loose, still on frame but nowhere near clean.` });
          return resolveFinish(attacker, defendingTeam, lines, pointsAwarded, 0.22, keeperMultiplier * 0.9);
        }
        lines.push({ text: `${attacker.name} gets a clean, dangerous look on goal.` });
        return resolveFinish(attacker, defendingTeam, lines, pointsAwarded, 0.16, keeperMultiplier * 1.1);
      }
    }
    lines.push({ text: `${attacker.name} goes up for an aerial finish.` });
    const whiff = whiffChance(attacker, attacker.foundationStats.aerialControl, 0.32);
    if (Math.random() < whiff) {
      lines.push({ text: `${attacker.name} mistimes it and whiffs completely.` });
      return { lines, outcome: "whiff", pointsAwarded };
    }
    return resolveFinish(attacker, defendingTeam, lines, pointsAwarded, 0.3, keeperMultiplier);
  }
  if (kind === "wall_read") {
    lines.push({ text: `${attacker.name} reads it off the wall and drives toward goal.` });
    const whiff = whiffChance(attacker, attacker.foundationStats.carControl, 0.18);
    if (Math.random() < whiff) {
      lines.push({ text: `${attacker.name} mistimes the wall read and it skips away.` });
      return { lines, outcome: "whiff", pointsAwarded };
    }
    return resolveFinish(attacker, defendingTeam, lines, pointsAwarded, 0.2, keeperMultiplier);
  }
  if (kind === "ground_flick") {
    lines.push({ text: `${attacker.name} pops it up for a flick.` });
    const whiff = whiffChance(attacker, attacker.foundationStats.carControl, 0.24);
    if (Math.random() < whiff) {
      lines.push({ text: `${attacker.name} fumbles the touch and loses the ball.` });
      return { lines, outcome: "whiff", pointsAwarded };
    }
    return resolveFinish(attacker, defendingTeam, lines, pointsAwarded, 0.24, keeperMultiplier);
  }
  lines.push({ text: `${attacker.name} takes the shot straight on.` });
  return resolveFinish(attacker, defendingTeam, lines, pointsAwarded, 0.18, keeperMultiplier);
}

// ============================================================================================
// Team-chain engine: 2v2 and 3v3 both run through this now (1v1 keeps its own separate duel engine below,
// a 1-on-1 has no rotation/role concept to model). A possession is a variable-length chain of beats —
// roles (2v2: pressure+safety pair, 3v3: first/second/third man), a challenge-type decision (shadow/fake/
// hard/stall) each beat, an occasional demo roll, and sustained PRESSURE that carries across possessions
// (see useMatchStore.ts's `pressure`/`needsKickoff`) and feeds back into the odds — a prolonged siege
// nudges the defense toward mistakes and the attack toward confidence, not just the narration. Nothing
// forces a minimum or fixed length: a quick hard/fake challenge can end a chain in one beat, a team that
// keeps beating challenges can string several together before the finish, capped only by
// MAX_ADVANCE_BEATS as a safety valve. Kickoffs (after every goal and at the start of overtime) are their
// own first beat that decides who actually gets the ball, replacing a blind coin flip.
// ============================================================================================

export interface TeamChainResult extends PossessionResult {
  /** Updated signed pressure, -100..100, positive = blue applying it — feed this back in as
   *  `currentPressure` on the next call. Resets toward 0 on a goal/kickoff, decays gradually otherwise. */
  pressure: number;
}

const PRESSURE_CAP = 100;
const MAX_ADVANCE_BEATS = 4;

type ChallengeType = "shadow" | "fake" | "hard" | "stall";

interface DefenderRoles {
  /** Whoever's stepping up to contest this beat — "first man" in 3v3, the primary defender in 2v2. */
  challenger: MatchParticipantStats;
  /** Remaining teammates in rotation order — "second man"/"third man" in 3v3, the lone covering
   *  teammate in 2v2. Empty only if this ever ran with a single defender (never happens in 2v2/3v3). */
  cover: MatchParticipantStats[];
}

/** Whoever's best-positioned steps up to challenge — weighted toward defense/game sense, same spirit as
 *  `pickAttacker`'s weighting on the other side of the ball. */
function defenderRoles(defendingTeam: MatchParticipantStats[]): DefenderRoles {
  const weights = defendingTeam.map((d) => d.foundationStats.defense + d.gameSense * 0.3 + 150);
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = Math.random() * total;
  let idx = defendingTeam.length - 1;
  for (let i = 0; i < defendingTeam.length; i++) {
    roll -= weights[i];
    if (roll <= 0) {
      idx = i;
      break;
    }
  }
  const challenger = defendingTeam[idx];
  return { challenger, cover: defendingTeam.filter((_, i) => i !== idx) };
}

/** Which kind of challenge the stepping-up defender goes for this beat — a real decision, not just "who's
 *  closer": a disciplined rotator shadows more, an aggressive one goes hard more often, and stalling for a
 *  teammate to arrive only makes sense when there IS a teammate still rotating in. */
function pickChallengeType(defender: MatchParticipantStats, teammateAvailable: boolean): ChallengeType {
  const style = effectivePlaystyle(defender);
  // Every weight here is built ONLY off effectivePlaystyle's already-bounded 5-95 scale, never raw
  // gameSense/mechanicalConsistency directly — those legitimately reach into the tens of thousands at high
  // MMR (SSL alone spans roughly 20k-80k, see gameSenseAnchors), so scaling a weight linearly off the raw
  // number let "fake" run away into practically the ONLY challenge thrown at high rank once gameSense got
  // huge, while shadow/hard stayed flat. Real high-level play uses a soft fake as an occasional tool, not
  // the default read — fakeWeight is capped well below the other three so it can never dominate the mix,
  // a sharper (higher mechanicalFlair) defender leans on it only modestly more than a duller one.
  const stallWeight = teammateAvailable ? Math.max(0.04, 0.16 + (50 - style.aggression) / 400) : 0;
  const shadowWeight = Math.max(0.15, 0.32 + (style.rotationDiscipline - 50) / 300);
  const fakeWeight = Math.max(0.06, Math.min(0.2, 0.12 + (style.mechanicalFlair - 50) / 600));
  const hardWeight = Math.max(0.2, 0.38 + (style.aggression - 50) / 300);
  const total = stallWeight + shadowWeight + fakeWeight + hardWeight;
  let roll = Math.random() * total;
  if ((roll -= stallWeight) <= 0) return "stall";
  if ((roll -= shadowWeight) <= 0) return "shadow";
  if ((roll -= fakeWeight) <= 0) return "fake";
  return "hard";
}

/** Weighted random pick shared by every "who actually wins the loose ball" contest in this engine (a
 *  contested kickoff 50, a contested hard-challenge 50 mid-chain) — same shape each time: a handful of
 *  candidates, each with a plain positive weight. */
function weightedPick<T extends { weight: number }>(candidates: T[]): T {
  const total = candidates.reduce((sum, c) => sum + c.weight, 0);
  let roll = Math.random() * total;
  for (const c of candidates) {
    roll -= c.weight;
    if (roll <= 0) return c;
  }
  return candidates[candidates.length - 1];
}

/** After winning a challenge/stall, the attacker doesn't always keep dribbling solo — real 2v2/3v3 at this
 *  level constantly looks for the pass to set a teammate up, exactly the "second man finishes what the
 *  first man started" pattern real high-level play lives on. Returns the new ball-carrier (unchanged if no
 *  pass happens, or no teammate exists) plus whatever flavor line goes with it. A defender gets one shot at
 *  reading/demoing the pass right as it arrives — if they land it, the receiver still comes away with the
 *  ball (a real turnover here would be a bit much) but visibly worse for it, same "awkward touch" softening
 *  a defended finish already gets elsewhere in this engine. */
function maybePassToTeammate(
  attacker: MatchParticipantStats,
  attackingTeam: MatchParticipantStats[],
  defender: MatchParticipantStats,
  passChance: number
): { attacker: MatchParticipantStats; lines: PossessionLogLine[]; awkward: boolean } {
  const teammates = attackingTeam.filter((p) => p !== attacker);
  if (teammates.length === 0) return { attacker, lines: [], awkward: false };
  // A team that's actually built real chemistry together (an org roster, or a friend "queue buddy" — see
  // FriendRecord.chemistry/OrgContract.chemistry, this is the same shared mechanic both feed) reads each
  // other's positioning better, a genuinely higher pass success rate, not just flavor text.
  const chemistryBoost = attacker.teamChemistry !== undefined ? (attacker.teamChemistry - 70) / 400 : 0;
  if (Math.random() > passChance + chemistryBoost) return { attacker, lines: [], awkward: false };
  const receiver = teammates[Math.floor(Math.random() * teammates.length)];
  const lines: PossessionLogLine[] = [{ text: `${attacker.name} finds ${receiver.name} with a pass.` }];
  const demoOnReceive = attemptDemo(defender, receiver, "reads the pass and demos");
  if (demoOnReceive.demoed) {
    lines.push(...demoOnReceive.lines);
    lines.push({ text: `${receiver.name} still gets a touch, but it's an awkward one.` });
    return { attacker: receiver, lines, awkward: true };
  }
  return { attacker: receiver, lines, awkward: false };
}

const DEMO_BASE_CHANCE = 0.05;

/** A demo is "somewhat rare, not super uncommon" per the design brief — driven by aggression (a bolder
 *  player goes for the hit) and mechanical consistency (actually landing it clean), never a trainable
 *  mechanic of its own. Whichever side lands one gets to skip straight past that beat's actual challenge. */
function attemptDemo(actor: MatchParticipantStats, target: MatchParticipantStats, verb: string): { demoed: boolean; lines: PossessionLogLine[] } {
  const style = effectivePlaystyle(actor);
  const chance = Math.max(0.01, Math.min(0.12, DEMO_BASE_CHANCE + (style.aggression - 50) / 900 + actor.mechanicalConsistency / 40000));
  if (Math.random() < chance) {
    return { demoed: true, lines: [{ text: `${actor.name} ${verb} ${target.name} right as the play develops.` }] };
  }
  return { demoed: false, lines: [] };
}

type KickoffStrat = "standard" | "speed" | "cheat" | "fake";
const KICKOFF_STRAT_LABEL: Record<KickoffStrat, string> = {
  standard: "a standard approach",
  speed: "a speedflip",
  cheat: "a cheat, hanging back to bait the challenge",
  fake: "a delayed fake",
};

/** Decides who gets first touch off a kickoff AND, just as importantly, who actually ends up WITH THE
 *  BALL afterward — the two aren't the same player as often as you'd think. Each side sends one taker up
 *  the middle; the OTHER teammate(s) "cheat" — hang back reading the bounce rather than committing to the
 *  initial 50 — exactly like real GC/SSL 2v2/3v3 kickoff play. A lopsided challenge (one taker clearly
 *  wins it) is a clean read, that taker just keeps the ball themselves. A genuinely close 50 is a real
 *  bounce: it's decided by who wins THAT second contact, and a cheating teammate reading it is just as
 *  live a candidate as either front-line taker, on either side.
 *
 *  Kickoff strat: speedflipping is close to universal once a player's mechanically sharp enough to land it
 *  reliably — not a rotating coinflip with "standard" — cheat/fake are the real situational reads at that
 *  level, standard is mostly a fallback for someone who can't reliably pull the flip off yet. A botched
 *  speedflip is a real risk, not just flavor: it actually costs that side effective power for the
 *  challenge. */
function simulateKickoffBeat(
  blueTeam: MatchParticipantStats[],
  orangeTeam: MatchParticipantStats[]
): { lines: PossessionLogLine[]; winnerSide: "blue" | "orange"; winner: MatchParticipantStats; scrappy: boolean } {
  const blueTaker = pickAttacker(blueTeam);
  const orangeTaker = pickAttacker(orangeTeam);
  const blueCheaters = blueTeam.filter((p) => p !== blueTaker);
  const orangeCheaters = orangeTeam.filter((p) => p !== orangeTaker);

  function pickStrat(taker: MatchParticipantStats): KickoffStrat {
    const skilled = taker.mechanicalConsistency > 6000;
    const speedWeight = skilled ? 0.82 : Math.max(0.08, taker.mechanicalConsistency / 20000);
    const cheatWeight = 0.07;
    const fakeWeight = 0.05;
    const standardWeight = Math.max(0.03, 1 - speedWeight - cheatWeight - fakeWeight);
    const total = speedWeight + cheatWeight + fakeWeight + standardWeight;
    let roll = Math.random() * total;
    if ((roll -= cheatWeight) <= 0) return "cheat";
    if ((roll -= fakeWeight) <= 0) return "fake";
    if ((roll -= speedWeight) <= 0) return "speed";
    return "standard";
  }

  const blueStrat = pickStrat(blueTaker);
  const orangeStrat = pickStrat(orangeTaker);
  const lines: PossessionLogLine[] = [
    { text: `Kickoff: ${blueTaker.name} goes with ${KICKOFF_STRAT_LABEL[blueStrat]}, ${orangeTaker.name} goes with ${KICKOFF_STRAT_LABEL[orangeStrat]}.` },
  ];

  function power(taker: MatchParticipantStats, strat: KickoffStrat): number {
    const base = taker.mechanicalConsistency * 0.5 + taker.foundationStats.carControl * 0.5;
    if (strat === "speed") {
      if (Math.random() < whiffChance(taker, taker.foundationStats.carControl, 0.16)) {
        lines.push({ text: `${taker.name} fumbles the speedflip.` });
        return base * 0.5;
      }
      return base * 1.1;
    }
    if (strat === "cheat") return base * 0.85; // hangs back by design, slower to first touch
    if (strat === "fake") return base * 0.95;
    return base;
  }

  const blueEff = power(blueTaker, blueStrat);
  const orangeEff = power(orangeTaker, orangeStrat);
  const p = statProbability(blueEff, orangeEff, 500);
  const decisive = Math.abs(p - 0.5) > 0.2;
  const firstTouchSide: "blue" | "orange" = Math.random() < p ? "blue" : "orange";
  const firstTouchPlayer = firstTouchSide === "blue" ? blueTaker : orangeTaker;
  const otherTaker = firstTouchSide === "blue" ? orangeTaker : blueTaker;
  const otherTakerSide: "blue" | "orange" = firstTouchSide === "blue" ? "orange" : "blue";
  lines.push({
    text: decisive
      ? `${firstTouchPlayer.name} gets there first and wins the initial 50 cleanly.`
      : `${blueTaker.name} and ${orangeTaker.name} challenge it 50/50, the ball squirts loose.`,
  });

  // Winning the initial 50 doesn't automatically mean keeping the ball — the ENTIRE point of a teammate
  // cheating instead of committing to that challenge is that they're already reading the bounce, live for
  // the second touch. A decisive first-touch winner is heavily favored to just keep it, but a cheater on
  // EITHER side is still a real threat, not just a contested-50 side effect — weighted toward whoever
  // reads/reacts best (rotationDiscipline, effectivePlaystyle's bounded 5-95 scale, never raw gameSense —
  // see pickChallengeType's own doc comment on why that scale mismatch is a real bug elsewhere here).
  const candidates: { player: MatchParticipantStats; side: "blue" | "orange"; weight: number }[] = [
    { player: firstTouchPlayer, side: firstTouchSide, weight: decisive ? 2.2 : 1.3 },
    { player: otherTaker, side: otherTakerSide, weight: decisive ? 0.15 : 0.5 },
    ...blueCheaters.map((c) => ({ player: c, side: "blue" as const, weight: 0.85 + (effectivePlaystyle(c).rotationDiscipline - 50) / 100 })),
    ...orangeCheaters.map((c) => ({ player: c, side: "orange" as const, weight: 0.85 + (effectivePlaystyle(c).rotationDiscipline - 50) / 100 })),
  ];
  const picked = weightedPick(candidates);
  const isCheater = picked.player !== blueTaker && picked.player !== orangeTaker;
  lines.push({
    text:
      picked.player === firstTouchPlayer
        ? `${picked.player.name} keeps control off the first touch.`
        : isCheater
          ? `${picked.player.name}'s cheat reads the bounce perfectly and comes away with it.`
          : `${picked.player.name} recovers it after all.`,
  });
  // "Scrappy" — anything short of the clean-favorite winning the initial challenge AND keeping it
  // themselves — is what should stop the very next beat from immediately reading as a polished, settled
  // possession (see simulateTeamChain's use of this). A cheat winning the bounce, or any genuinely
  // contested 50 in the first place, means the ball only JUST came under control, not a clean setup.
  const scrappy = !decisive || picked.player !== firstTouchPlayer;
  return { lines, winnerSide: picked.side, winner: picked.player, scrappy };
}

/** Resolves one full possession as a variable-length chain of beats for 2v2/3v3, carrying signed pressure
 *  in and back out. `isKickoff` runs a real kickoff beat first (deciding who even gets the ball) instead of
 *  a blind coin flip — pass true after every goal and the instant overtime starts, see useMatchStore.ts's
 *  `needsKickoff`. */
export function simulateTeamChain(
  blueTeam: MatchParticipantStats[],
  orangeTeam: MatchParticipantStats[],
  currentPressure: number,
  isKickoff: boolean,
  currentDate: SimDate
): TeamChainResult {
  const lines: PossessionLogLine[] = [];
  const pointsAwarded: { name: string; amount: number }[] = [];
  function award(name: string, amount: number) {
    pointsAwarded.push({ name, amount });
  }

  let attackingSide: "blue" | "orange";
  let kickoffWinner: MatchParticipantStats | null = null;
  // A scrappy kickoff pickup (a cheat winning the bounce, or any genuinely contested 50) means the ball
  // only JUST came under control — the very next beat shouldn't be allowed to immediately read as a
  // polished, settled possession with a clean shot at goal, that undersells how scrappy the pickup was.
  let scrappyKickoffFirstBeat = false;
  if (isKickoff) {
    const kickoff = simulateKickoffBeat(blueTeam, orangeTeam);
    lines.push(...kickoff.lines);
    attackingSide = kickoff.winnerSide;
    kickoffWinner = kickoff.winner;
    scrappyKickoffFirstBeat = kickoff.scrappy;
  } else {
    // Pressure biases who's more likely to have/keep the ball this possession, but never removes the
    // coinflip entirely — a team under siege can still snatch it back, this just makes it less likely.
    const blueChance = Math.max(0.12, Math.min(0.88, 0.5 + currentPressure / 400));
    attackingSide = Math.random() < blueChance ? "blue" : "orange";
    // Neither side's actually been under any real pressure recently — a calm, neutral moment, real play
    // at this point is mostly rotation/boost management, not a live challenge. Pure flavor, doesn't change
    // who ends up attacking or any of the odds below.
    if (Math.abs(currentPressure) < 12 && Math.random() < 0.2) {
      lines.push({ text: "Both teams rotate and collect boost." });
    }
  }

  const attackingTeam = attackingSide === "blue" ? blueTeam : orangeTeam;
  const defendingTeam = attackingSide === "blue" ? orangeTeam : blueTeam;
  // Pressure re-expressed relative to whoever's actually attacking THIS possession — a kickoff always
  // starts genuinely neutral regardless of what pressure carried over from before the last goal.
  let pressureForAttacker = isKickoff ? 0 : attackingSide === "blue" ? currentPressure : -currentPressure;
  function pack(result: PossessionResult): TeamChainResult {
    const signed = attackingSide === "blue" ? pressureForAttacker : -pressureForAttacker;
    return { ...result, pressure: Math.max(-PRESSURE_CAP, Math.min(PRESSURE_CAP, signed)) };
  }

  // Whoever actually won the kickoff (taker OR the cheating teammate who read the bounce) carries the ball
  // into the rest of the chain — re-rolling a fresh pickAttacker here would silently throw away exactly
  // the "the cheater can end up with it" outcome simulateKickoffBeat just decided.
  let attacker = kickoffWinner ?? pickAttacker(attackingTeam);

  for (let beat = 0; beat < MAX_ADVANCE_BEATS; beat++) {
    const roles = defenderRoles(defendingTeam);
    const teammateAvailable = roles.cover.length > 0;

    // Attacker can demo the stepping-up challenger before the challenge even happens, leaving the net
    // effectively open (whoever's left covers alone, same worse-odds shape as a 2v2 last-man situation).
    // Only rolled on the very first beat of a possession — checking it fresh every beat compounded into a
    // demo showing up in something like 40% of whole possessions, which is what made "demo into a goal"
    // read as a template. Never right off a scrappy kickoff pickup either (see scrappyKickoffFirstBeat) —
    // a ball that JUST barely came under control hasn't given anyone time to line up a demo yet.
    const attackerDemo = beat === 0 && !(scrappyKickoffFirstBeat) ? attemptDemo(attacker, roles.challenger, "lines up and demos") : { demoed: false, lines: [] };
    if (attackerDemo.demoed) {
      lines.push(...attackerDemo.lines);
      pressureForAttacker = Math.min(PRESSURE_CAP, pressureForAttacker + 25);
      // A demo opens things up, it shouldn't make the finish nearly automatic — still a real advantage
      // (whoever's left covers alone), just not a guaranteed goal every time it happens.
      return pack(attemptFinish(attacker, defendingTeam, lines, pointsAwarded, pickChainKind(attacker), teammateAvailable ? 0.95 : 0.85, currentDate));
    }

    const challengeType = pickChallengeType(roles.challenger, teammateAvailable);

    if (challengeType === "stall") {
      // Pure flavor half the time — a covering teammate on either side using the lull to actually go
      // collect a pad reads as real background texture (this is what a stall's slower pace is FOR), never
      // changes the odds below. A wider pool than one fixed sentence each — this fires often enough in a
      // defensive stretch that a single line repeats within a few beats of itself otherwise.
      const attackingCover = attackingTeam.find((p) => p !== attacker);
      const padLines = attackingCover
        ? [
            `${attackingCover.name} peels wide to collect pads while ${roles.challenger.name} shadows.`,
            `${attackingCover.name} rotates back for boost while ${roles.challenger.name} holds the shadow.`,
            `${attackingCover.name} grabs the corner pad, staying patient.`,
            `${attackingCover.name} tops off boost on the far side.`,
          ]
        : [];
      const holdLines = [
        `${roles.challenger.name} holds off, backing toward goal and waiting for ${roles.cover[0]?.name ?? "support"} to rotate in.`,
        `${roles.challenger.name} stays goalside, in no hurry to commit.`,
        `${roles.challenger.name} shadows patiently, content to wait this one out.`,
      ];
      const pool = attackingCover && Math.random() < 0.5 ? padLines : holdLines;
      lines.push({ text: pool[Math.floor(Math.random() * pool.length)] });
      pressureForAttacker = Math.min(PRESSURE_CAP, pressureForAttacker + 14);
      // A stall buys the attacker a free look but doesn't hand them the ball outright — decide fast
      // whether they cash in now or the chain keeps going (another beat, possibly a different attacker).
      // Never on the very first beat after a scrappy kickoff pickup — that ball only just came under
      // control, it hasn't earned a clean look at goal yet.
      if (!(beat === 0 && scrappyKickoffFirstBeat) && Math.random() < 0.4) {
        return pack(attemptFinish(attacker, defendingTeam, lines, pointsAwarded, pickChainKind(attacker), 1, currentDate));
      }
      if (teammateAvailable && Math.random() < 0.5) attacker = pickAttacker(attackingTeam);
      continue;
    }

    if (challengeType === "fake") {
      // The exact "opponent throws a quick challenge and messes up possession" case: a real chance this
      // ends the chain immediately, a smaller chance the attacker reads through it clean for a big look.
      lines.push({ text: `${roles.challenger.name} throws a soft fake challenge at ${attacker.name}.` });
      const readThrough = statProbability(
        attacker.gameSense + attacker.foundationStats.carControl * 0.2,
        roles.challenger.gameSense + roles.challenger.foundationStats.defense * 0.15,
        500
      );
      if (Math.random() > readThrough) {
        lines.push({ text: `${attacker.name} bites on it and gives the ball away.` });
        award(roles.challenger.name, 25);
        return pack({ lines, outcome: "clear", pointsAwarded });
      }
      lines.push({ text: `${attacker.name} sees through the fake and pushes on.` });
      pressureForAttacker = Math.min(PRESSURE_CAP, pressureForAttacker + 20);
      continue;
    }

    if (challengeType === "shadow") {
      lines.push({ text: `${roles.challenger.name} shadows, backing toward net instead of committing.` });
      // A good shadow is genuinely hard to beat cleanly — weighted a little toward the defender relative
      // to the other challenge types, matching real high-level defense being the harder read to crack.
      const contest = statProbability(
        attacker.foundationStats.carControl + attacker.gameSense * 0.2,
        roles.challenger.foundationStats.defense + roles.challenger.gameSense * 0.2
      );
      if (Math.random() > contest) {
        // A shadow win isn't always the same dead end — real defense forces different KINDS of bad
        // situations, and a couple of them keep the ball live instead of ending the possession outright
        // (exactly what late-game defensive stretches need to not read as identical clear-and-reset loops).
        const outcomeRoll = Math.random();
        const attackingCover = attackingTeam.find((p) => p !== attacker);
        if (outcomeRoll < 0.35) {
          lines.push({ text: `${roles.challenger.name} stays patient and forces a bad touch, clearing it away.` });
          award(roles.challenger.name, 25);
          return pack({ lines, outcome: "clear", pointsAwarded });
        }
        if (outcomeRoll < 0.55) {
          lines.push({ text: `${roles.challenger.name} reads it and forces the play out to the corner.` });
          award(roles.challenger.name, 25);
          return pack({ lines, outcome: "clear", pointsAwarded });
        }
        if (outcomeRoll < 0.7) {
          lines.push({ text: `${roles.challenger.name} cuts off the angle and forces a weak flick that sails harmlessly through.` });
          award(roles.challenger.name, 20);
          return pack({ lines, outcome: "clear", pointsAwarded });
        }
        if (outcomeRoll < 0.85 && attackingCover) {
          lines.push({ text: `${roles.challenger.name} forces a rushed pass back to ${attackingCover.name}.` });
          pressureForAttacker = Math.max(-PRESSURE_CAP, pressureForAttacker - 6);
          attacker = attackingCover;
          continue;
        }
        lines.push({ text: `${roles.challenger.name} forces a weak touch — the ball pops up into a scrappy 50.` });
        const loose = weightedPick([
          { player: attacker, forAttacker: true, weight: 0.8 },
          { player: roles.challenger, forAttacker: false, weight: 1.2 },
          ...attackingTeam.filter((p) => p !== attacker).map((p) => ({ player: p, forAttacker: true, weight: 0.5 + (effectivePlaystyle(p).rotationDiscipline - 50) / 150 })),
          ...roles.cover.map((p) => ({ player: p, forAttacker: false, weight: 0.5 + (effectivePlaystyle(p).rotationDiscipline - 50) / 150 })),
        ]);
        if (loose.forAttacker) {
          lines.push({ text: `${loose.player.name} wins the scrappy 50 and keeps it alive.` });
          attacker = loose.player;
          pressureForAttacker = Math.min(PRESSURE_CAP, pressureForAttacker + 10);
          continue;
        }
        lines.push({ text: `${loose.player.name} wins the scrappy 50 and clears it away.` });
        award(loose.player.name, 25);
        return pack({ lines, outcome: "clear", pointsAwarded });
      }
      // Even surviving the shadow isn't a clean break most of the time — beating a proper shadow SHOULD
      // cost the attacker something (a weaker touch, worse shape for what comes next), a fully clean break
      // is the exception, not the coinflip it used to be.
      if (Math.random() < 0.25) {
        lines.push({ text: `${attacker.name} works around the shadow and keeps possession.` });
        pressureForAttacker = Math.min(PRESSURE_CAP, pressureForAttacker + 12);
      } else {
        lines.push({ text: `${attacker.name} forces a touch through, but ${roles.challenger.name} stays right there in the play.` });
        pressureForAttacker = Math.min(PRESSURE_CAP, pressureForAttacker + 4);
      }
      const passed = maybePassToTeammate(attacker, attackingTeam, roles.challenger, 0.3);
      lines.push(...passed.lines);
      attacker = passed.attacker;
      continue;
    }

    // hard challenge: a full contest, can end the chain outright either way. A small chance the defender
    // (not the attacker this time) lands the demo instead, an outright turnover.
    const defenderDemo = attemptDemo(roles.challenger, attacker, "reads the challenge and demos");
    if (defenderDemo.demoed) {
      lines.push(...defenderDemo.lines);
      award(roles.challenger.name, 30);
      pressureForAttacker = Math.max(-PRESSURE_CAP, pressureForAttacker - 20);
      return pack({ lines, outcome: "clear", pointsAwarded });
    }
    lines.push({ text: `${roles.challenger.name} steps up and challenges ${attacker.name} hard.` });
    // A synced-up defense (real chemistry, org or friend "queue buddy" alike) covers/rotates a bit
    // cleaner behind the challenger — same shared mechanic maybePassToTeammate's boost feeds.
    const chemistryDefBoost = roles.challenger.teamChemistry !== undefined ? Math.max(0, (roles.challenger.teamChemistry - 70) * 2) : 0;
    const defBoost = roles.cover.reduce((sum, c) => sum + c.foundationStats.defense * 0.05, 0) + chemistryDefBoost;
    const contest = statProbability(
      attacker.foundationStats.carControl + attacker.gameSense * 0.15,
      roles.challenger.foundationStats.defense + roles.challenger.gameSense * 0.1 + defBoost
    );
    // A genuinely close 50 doesn't just get handed to one side outright — the ball pops up loose and
    // ANYONE nearby (either side's covering teammate included) gets a real crack at it, same shape as a
    // contested kickoff (see simulateKickoffBeat). A clean, lopsided result skips straight to the plain
    // win/lose below, matching how decisive a real mismatch actually reads. Widened band (vs a clean
    // mismatch) — most challenges at this level are closer to a real 50 than a total blowout, a narrow
    // band made "wins it and drives on" repeat far too often with no real contest to it.
    if (Math.abs(contest - 0.5) < 0.22) {
      lines.push({ text: `Contested 50 — the ball pops up loose.` });
      const loose = weightedPick([
        { player: attacker, forAttacker: true, weight: 1 },
        { player: roles.challenger, forAttacker: false, weight: 1 },
        ...attackingTeam.filter((p) => p !== attacker).map((p) => ({ player: p, forAttacker: true, weight: 0.55 + (effectivePlaystyle(p).rotationDiscipline - 50) / 150 })),
        ...roles.cover.map((p) => ({ player: p, forAttacker: false, weight: 0.55 + (effectivePlaystyle(p).rotationDiscipline - 50) / 150 })),
      ]);
      if (loose.forAttacker) {
        lines.push({ text: `${loose.player.name} wins the loose ball and keeps it alive.` });
        attacker = loose.player;
        pressureForAttacker = Math.min(PRESSURE_CAP, pressureForAttacker + 15);
        continue;
      }
      lines.push({ text: `${loose.player.name} wins the loose ball and clears it away.` });
      award(loose.player.name, 25);
      return pack({ lines, outcome: "clear", pointsAwarded });
    }
    if (Math.random() > contest) {
      lines.push({ text: `${roles.challenger.name} wins the challenge and clears it out.` });
      award(roles.challenger.name, 30);
      return pack({ lines, outcome: "clear", pointsAwarded });
    }
    // Second-man intervention: winning the initial challenge doesn't mean the danger's over — a covering
    // defender can still step in immediately, a real chance to end the possession right there instead of
    // every won challenge automatically converting into "drives on".
    if (roles.cover.length > 0 && Math.random() < 0.25) {
      const second = roles.cover[Math.floor(Math.random() * roles.cover.length)];
      lines.push({ text: `${second.name} steps in immediately as second man.` });
      const secondContest = statProbability(
        attacker.foundationStats.carControl + attacker.gameSense * 0.1,
        second.foundationStats.defense + second.gameSense * 0.15
      );
      if (Math.random() > secondContest) {
        lines.push({ text: `${second.name} recovers it and clears the danger.` });
        award(second.name, 25);
        return pack({ lines, outcome: "clear", pointsAwarded });
      }
      lines.push({ text: `${attacker.name} shakes off the second-man pressure and keeps driving.` });
    }
    const driveLines = [
      `${attacker.name} wins the challenge and drives on.`,
      `${attacker.name} forces a weak touch through and keeps the ball alive.`,
      `${attacker.name} edges the 50 and keeps possession.`,
    ];
    lines.push({ text: driveLines[Math.floor(Math.random() * driveLines.length)] });
    pressureForAttacker = Math.min(PRESSURE_CAP, pressureForAttacker + 22);
    const passed = maybePassToTeammate(attacker, attackingTeam, roles.challenger, 0.35);
    lines.push(...passed.lines);
    attacker = passed.attacker;
    // A won hard challenge is the most decisive beat — good odds this converts straight into a shot.
    // Never on the very first beat after a scrappy kickoff pickup, same reasoning as the stall branch.
    if (!(beat === 0 && scrappyKickoffFirstBeat) && Math.random() < 0.3 + beat * 0.15) {
      return pack(attemptFinish(attacker, defendingTeam, lines, pointsAwarded, pickChainKind(attacker), teammateAvailable ? 1.05 : 1, currentDate));
    }
  }

  // Ran out of advance beats without a clean look or a turnover — the attacker cashes in whatever they've
  // built up rather than looping forever, a supported keeper (still contested, no demo/breakaway bonus).
  return pack(attemptFinish(attacker, defendingTeam, lines, pointsAwarded, pickChainKind(attacker), 1, currentDate));
}

// ============================================================================================
// 1v1 duel engine: unlike simulatePossession above (one stat-checked step per possession, used for
// 2v2/3v3 for now), a duel is a short CHAIN of named beats, each one a specific mechanic or queue concept
// pulled from the player's own trained mastery when they're the actor, so what happens in a match
// actually reflects what's been trained rather than a generic "aerial"/"ground_flick" label. An AI
// opponent has no per-mechanic breakdown to draw on, so it gets a believable proxy spread off its overall
// stats instead, keeping the same chain shape without requiring a full trained-mechanic profile for every
// generated name in the sim.
// ============================================================================================

const MECHANIC_BY_ID = new Map(MECHANICS.map((m) => [m.id, m]));

/** Whether a mechanic had actually been discovered/was realistic to attempt by this point in the
 *  timeline — every mechanic carries a real `eraStart` (see mechanics.ts), a save/match set in an earlier
 *  year should never show a move nobody had figured out yet. */
function mechanicUnlockedByDate(id: string, currentDate: SimDate): boolean {
  const mech = MECHANIC_BY_ID.get(id);
  if (!mech) return false;
  return currentDate.year > mech.eraStart.year || (currentDate.year === mech.eraStart.year && currentDate.month >= mech.eraStart.month);
}

// A curated subset of the ~80 mechanics that make sense as a named "signature setup move" in a duel,
// split by whether it's realistic to attempt on low boost. The full mechanic list (movement/kickoff/passing
// mostly) still matters for AI's overall stat proxy and the flourish pool below, just not as literal named
// setup moves here.
const GROUND_ATTACK_MOVE_IDS = [
  "dribbling", "powershot", "hook_shot", "cut", "powerslide_cut",
  "front_flick", "back_flick", "flick_45", "flick_90", "flick_180", "flick_360", "ground_pinch",
];
const AERIAL_ATTACK_MOVE_IDS = [
  "air_dribble", "double_tap", "triple_tap", "flip_reset", "double_reset", "redirected_aerial",
  "air_roll_shot", "dar_aerial", "ceiling_shot", "reset_flick", "reset_musty", "backboard_pinch",
  "ceiling_pinch", "musty_pinch", "kuxir_pinch", "musty_flick", "breezi_flick", "classy_flick",
  "tornado_flick", "mawkzy_flick", "jzr_flick", "slingshot_flick", "delayed_flick", "reverse_flick",
];
const DEFENSE_MOVE_IDS = [
  "shadow_defense", "fake_challenge", "instant_challenge", "backboard_defense", "prejump_save",
  "high_aerial_save", "double_jump_save", "wall_save", "corner_clear", "redirect_save",
  "recovery_save", "panic_clear", "buzzer_save", "air_dribble_bump", "air_dribble_demo", "last_man_positioning",
];
// A small movement-mechanic flourish that can dress up a finish ("sees the gap and wavedash shots it"),
// only shows up when the attacker's actually trained it well.
const FINISH_FLOURISH_MOVE_IDS = ["wavedash", "zap_dash", "chain_dash", "curved_dash", "hel_jump"];

function moveLabel(id: string): string {
  return MECHANIC_BY_ID.get(id)?.label ?? id;
}

/** How "ready" a specific mechanic is for this actor: the player's own real trained mastery when present,
 *  else a proxy spread deterministically around their overall mechanical stats (so the same AI name
 *  doesn't always favor the exact same move, but stays consistent match to match). */
function moveMasteryValue(id: string, actor: MatchParticipantStats): number {
  if (actor.duelMastery) return actor.duelMastery.mechanicMastery[id] ?? 0;
  const spread = hashString(actor.name + id) % 600;
  return actor.foundationStats.aerialControl * 0.25 + actor.mechanicalConsistency * 0.2 + spread;
}

function conceptMasteryValue(id: string, actor: MatchParticipantStats, proxyStat: number): number {
  if (actor.duelMastery) return actor.duelMastery.queueConceptMastery[id] ?? 0;
  const spread = hashString(actor.name + id) % 500;
  return proxyStat * 0.3 + spread;
}

/** Picks one move from a pool, weighted by mastery, not just the single best one, real players try
 *  mechanics they're somewhat good at too, not only their absolute favorite. */
function pickWeightedMove(ids: string[], actor: MatchParticipantStats): { id: string; label: string } {
  const weights = ids.map((id) => 300 + moveMasteryValue(id, actor));
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < ids.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return { id: ids[i], label: moveLabel(ids[i]) };
  }
  const id = ids[ids.length - 1];
  return { id, label: moveLabel(id) };
}

const FIELD_SIDES = ["left", "center", "right"] as const;

export interface DuelPossessionResult extends PossessionResult {
  /** Final ball position after this possession, 0-100 on both axes. X: 0 = left wall, 100 = right wall.
   *  Y: 0 sits at blue's own goal line, 100 at orange's, so blue attacks toward higher Y. */
  fieldX: number;
  fieldY: number;
}

/** Resolves one full 1v1 possession as a short chain of named beats (possession -> optional defensive
 *  read -> signature setup move -> defended finish) instead of a single generic stat check, so training
 *  a specific mechanic/queue concept visibly shows up in what actually happens. `isCounterAttack` skips
 *  the defensive-read beat and narrates a fast transition instead, used when the attacker just won the
 *  ball back defensively and (playstyle- or stat-wise) leans toward countering rather than resetting. */
export function simulateDuelPossession(
  attacker: MatchParticipantStats,
  defender: MatchParticipantStats,
  currentFieldY: number,
  isCounterAttack: boolean
): DuelPossessionResult {
  const lines: PossessionLogLine[] = [];
  const pointsAwarded: { name: string; amount: number }[] = [];
  function award(name: string, amount: number) {
    pointsAwarded.push({ name, amount });
  }

  const attackDirection = attacker.team === "blue" ? 1 : -1;
  const retreatY = () => (attackDirection > 0 ? Math.max(0, currentFieldY - 15) : Math.min(100, currentFieldY + 15));
  const attackerStyle = effectivePlaystyle(attacker);

  // Beat 1: possession and situation (side of the field, boost level).
  const lowBoost = Math.random() < (isCounterAttack ? 0.15 : 0.28);
  const side = FIELD_SIDES[Math.floor(Math.random() * FIELD_SIDES.length)];
  const fieldX = side === "left" ? 15 + Math.random() * 15 : side === "right" ? 70 + Math.random() * 15 : 40 + Math.random() * 20;
  lines.push({
    text: isCounterAttack
      ? `${attacker.name} wins it back and pushes forward immediately on the counter.`
      : `${attacker.name} takes possession on the ${side} side of the field${lowBoost ? ", low on boost" : ""}.`,
  });

  // Beat 2: defensive read, skipped on a fast counter so it actually reads as a quick transition.
  let defenseBoost = 0;
  if (!isCounterAttack && Math.random() < 0.55) {
    const defRead = pickWeightedMove(DEFENSE_MOVE_IDS, defender);
    const readMastery = moveMasteryValue(defRead.id, defender);
    lines.push({ text: `${defender.name} rotates for boost and shadows.` });
    defenseBoost = Math.min(900, 200 + readMastery * 0.15);
    // A very well-trained read can jump the passing lane before the attacker even sets up.
    const jumpChance = Math.max(0, Math.min(0.15, (readMastery - 3000) / 20000));
    if (Math.random() < jumpChance) {
      lines.push({ text: `${defender.name} reads it early and clears the danger before it develops.` });
      award(defender.name, 25);
      return { lines, outcome: "clear", pointsAwarded, fieldX, fieldY: retreatY() };
    }
  }

  // Beat 3: signature setup move, low boost restricts the pool to what's realistic without a full tank.
  // A more aggressive/flairy player reaches for the aerial (flashier, higher-risk) pool more often.
  const aerialPoolChance = 0.6 + (attackerStyle.aggression + attackerStyle.mechanicalFlair - 100) / 300;
  const pool = lowBoost ? GROUND_ATTACK_MOVE_IDS : Math.random() < aerialPoolChance ? AERIAL_ATTACK_MOVE_IDS : GROUND_ATTACK_MOVE_IDS;
  const setupMove = pickWeightedMove(pool, attacker);
  const setupMastery = moveMasteryValue(setupMove.id, attacker);
  const isAerialSetup = AERIAL_ATTACK_MOVE_IDS.includes(setupMove.id);
  const fieldY = attackDirection > 0 ? Math.min(92, currentFieldY + 25) : Math.max(8, currentFieldY - 25);

  const lowBoostOffenseMastery = lowBoost ? conceptMasteryValue("1v1_low_boost_offense", attacker, attacker.foundationStats.offense) : 0;
  const setupWhiffBase = isAerialSetup ? 0.34 : 0.2;
  const setupWhiff = whiffChance(attacker, setupMastery + attacker.foundationStats.carControl * 0.3 + lowBoostOffenseMastery * 0.3, setupWhiffBase);
  lines.push({ text: `${attacker.name} goes for a ${setupMove.label}${lowBoost ? " despite the low boost" : ""}.` });
  if (Math.random() < setupWhiff) {
    lines.push({ text: `${attacker.name} can't quite pull it off and loses the touch.` });
    return { lines, outcome: "whiff", pointsAwarded, fieldX, fieldY };
  }
  lines.push({ text: `${attacker.name} pulls off the ${setupMove.label} cleanly.` });

  // Beat 4: defensive positioning, then the defended finish.
  const post = Math.random() < 0.5 ? "left" : "right";
  const defMove = pickWeightedMove(DEFENSE_MOVE_IDS, defender);
  const defMastery = moveMasteryValue(defMove.id, defender) + defenseBoost;
  lines.push({ text: `${defender.name} defends from the ${post} post.` });

  const flourish = pickWeightedMove(FINISH_FLOURISH_MOVE_IDS, attacker);
  const flourishMastery = moveMasteryValue(flourish.id, attacker);
  // Mechanical Flair is exactly the trained tendency to show off with a mastered mechanic instead of
  // taking the plain shot, Aggression pushes the same way (a bolder player takes the riskier look).
  const useFlourish = flourishMastery > 1200 && Math.random() < 0.35 + (attackerStyle.mechanicalFlair + attackerStyle.aggression - 100) / 300;

  const shotSelectionMastery = conceptMasteryValue("1v1_shot_selection", attacker, attacker.gameSense);
  const finishWhiffBase = isAerialSetup ? 0.3 : 0.2;
  const finishWhiff = whiffChance(attacker, attacker.foundationStats.offense + shotSelectionMastery * 0.2, finishWhiffBase);
  if (Math.random() < finishWhiff) {
    lines.push({ text: `${attacker.name} skies the finish over the bar.` });
    return { lines, outcome: "whiff", pointsAwarded, fieldX, fieldY };
  }

  const shotPower = attacker.foundationStats.offense + attacker.mechanicalConsistency * 0.15 + setupMastery * 0.1 + (useFlourish ? flourishMastery * 0.1 : 0);
  const savePower = defender.foundationStats.defense + defender.mechanicalConsistency * 0.15 + defMastery * 0.12;
  lines.push({
    text: useFlourish
      ? `${attacker.name} sees the gap and hits a ${flourish.label} shot behind ${defender.name}.`
      : `${attacker.name} takes the shot on goal.`,
  });

  if (Math.random() > statProbability(shotPower, savePower)) {
    lines.push({ text: `SAVE! ${defender.name} gets enough on it to keep it out.` });
    award(defender.name, 50);
    return { lines, outcome: "save", actorName: defender.name, pointsAwarded, fieldX, fieldY };
  }

  lines.push({ text: `GOAL! ${attacker.name} finishes it past ${defender.name}.` });
  award(attacker.name, 100);
  return { lines, outcome: "goal", scoringTeam: attacker.team, actorName: attacker.name, pointsAwarded, fieldX, fieldY };
}

/** Whether the side that just won the ball defensively should counter-attack immediately (skip the
 *  buildup) rather than reset to a neutral possession: a defensive-leaning player/team's real tendency,
 *  same idea as `playstyleProfiles` elsewhere, an AI opponent without one gets a stat-based proxy. */
export function prefersCounterAttack(defender: MatchParticipantStats): boolean {
  const isDefensiveLeaning = defender.duelMastery
    ? defender.duelMastery.playstyle.aggression < 45
    : defender.foundationStats.defense > defender.foundationStats.offense;
  return Math.random() < (isDefensiveLeaning ? 0.7 : 0.4);
}
