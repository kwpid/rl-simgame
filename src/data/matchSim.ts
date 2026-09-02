// Stat-weighted match simulation engine. Every possession is a short chain of stat-checked steps
// (not a single randomized flavor line), and every check pulls real stats from both the acting player
// and whoever is contesting them, so a defense-heavy opponent actually punishes a high-offense attacker,
// a low-aerial-control player actually whiffs aerials more, and so on.

import { MECHANICS, type FoundationCategory } from "./mechanics";
import { deriveRankFromMmr, tierMinMmr, type RankEra, type RankQueue, type RankTierId } from "./rankSystem";
import { pickAiTitle, type TitleEntry } from "./seasons";
import { PRO_PLAYERS, isGenerationalTalent, experienceGrowth, hashString } from "./proPlayers";
import type { PlaystyleProfile } from "./mockSave";
import { ORG_NAMES, orgTagForOrgName } from "./tournaments";

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
}

const ALL_ORG_NAMES = Object.values(ORG_NAMES).flat();

/** Whether a given AI opponent is currently signed to an org, and which one, deterministic per name so the
 *  same opponent always reads as tagged (or not) and with the same org match to match, rather than a fresh
 *  coinflip every game. Gated by rank tier since only GC/SSL-caliber play is realistically org-scouted (see
 *  data/orgs.ts's own MMR gate for the player's identical career track), and a real named pro is far more
 *  likely to already be signed than a generic filler regular at the same rank. */
function orgTagForOpponent(name: string, effectiveTier: RankTierId, isPro: boolean): string | undefined {
  const eligible = effectiveTier === "grand_champion" || effectiveTier === "ssl";
  if (!eligible) return undefined;
  const seed = hashString(name + "#org");
  const chance = isPro ? 0.75 : 0.18;
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
  /** Real RLCS titles this specific name has actually earned in completed tournament history (see
   *  store/useTournamentStore.ts's findRealRlcsTitlesForPlayer), takes priority over the fictional
   *  past-season titles below when present, since it's chronologically real rather than a plausible guess. */
  realRlcsTitles?: TitleEntry[],
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

  // Real, earned RLCS history takes priority over the fictional season-title guesswork below, someone
  // who's actually won a Regional should show that far more often than a made-up past-season title.
  const bestRealTitle = realRlcsTitles && realRlcsTitles.length > 0 ? realRlcsTitles[realRlcsTitles.length - 1] : null;
  const title = bestRealTitle && Math.random() < 0.7 ? bestRealTitle : pickAiTitle(era, seasonNumber, effectiveTier);

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
    orgTag: orgTagForOpponent(name, effectiveTier, !!pro),
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

/** Computes one team's signed MMR delta for a match via a standard Elo formula (K * (actual - expected)),
 *  so upsets swing hard and expected results barely move anyone, same as a real competitive rating system.
 *  K itself compresses as `myAvgMmr` climbs into GC/SSL territory (see `eloKFactor`), the top of the ladder
 *  moves slower per game than the middle does. */
export function computeMmrDelta(myAvgMmr: number, oppAvgMmr: number, won: boolean): number {
  const expected = eloExpectedScore(myAvgMmr, oppAvgMmr);
  const actual = won ? 1 : 0;
  return Math.round(eloKFactor(myAvgMmr) * (actual - expected));
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

// 3v3-only now: 2v2 moved to the team-chain engine (simulateTeamPossession) below, 1v1 has its own duel
// engine further down. 3v3 stays on this single stat-checked step per possession for now, a third
// teammate's rotation makes the "who's out of position" question different enough not to reuse the 2v2
// last-man model as-is.
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

export function simulatePossession(
  attackingTeam: MatchParticipantStats[],
  defendingTeam: MatchParticipantStats[]
): PossessionResult {
  const attacker = pickAttacker(attackingTeam);
  const primaryDefender = pickDefender(defendingTeam);
  const kind = pickChainKind(attacker);
  const lines: PossessionLogLine[] = [];
  const pointsAwarded: { name: string; amount: number }[] = [];

  function award(name: string, amount: number) {
    pointsAwarded.push({ name, amount });
  }

  if (kind === "aerial") {
    lines.push({ text: `${attacker.name} goes up for an aerial.` });
    const whiff = whiffChance(attacker, attacker.foundationStats.aerialControl, 0.4);
    if (Math.random() < whiff) {
      lines.push({ text: `${attacker.name} mistimes it and whiffs completely.` });
      return { lines, outcome: "whiff", pointsAwarded };
    }
    lines.push({ text: `${primaryDefender.name} rotates back to challenge in the air.` });
    const attackerAerialPower = attacker.foundationStats.aerialControl + attacker.foundationStats.offense * 0.3;
    const defenderAerialPower = primaryDefender.foundationStats.defense + primaryDefender.foundationStats.aerialControl * 0.3;
    if (Math.random() > statProbability(attackerAerialPower, defenderAerialPower)) {
      lines.push({ text: `${primaryDefender.name} beats them to it and clears the ball.` });
      award(primaryDefender.name, 30);
      return { lines, outcome: "clear", pointsAwarded };
    }
    lines.push({ text: `${attacker.name} wins the aerial duel and redirects it on frame.` });
    return resolveFinish(attacker, defendingTeam, lines, pointsAwarded, 0.32);
  }

  if (kind === "wall_read") {
    lines.push({ text: `${attacker.name} reads a ball rolling up the wall.` });
    const whiff = whiffChance(attacker, attacker.foundationStats.carControl, 0.22);
    if (Math.random() < whiff) {
      lines.push({ text: `${attacker.name} mistimes the wall read and misses it entirely.` });
      return { lines, outcome: "whiff", pointsAwarded };
    }
    const contest = statProbability(
      attacker.foundationStats.carControl + attacker.gameSense * 0.2,
      primaryDefender.foundationStats.defense
    );
    if (Math.random() > contest) {
      lines.push({ text: `${primaryDefender.name} challenges first and knocks it away.` });
      award(primaryDefender.name, 25);
      return { lines, outcome: "clear", pointsAwarded };
    }
    lines.push({ text: `${attacker.name} controls it off the wall and drives toward goal.` });
    return resolveFinish(attacker, defendingTeam, lines, pointsAwarded, 0.22);
  }

  if (kind === "ground_flick") {
    lines.push({ text: `${attacker.name} sets up a flick off the ground.` });
    const whiff = whiffChance(attacker, attacker.foundationStats.carControl, 0.28);
    if (Math.random() < whiff) {
      lines.push({ text: `${attacker.name} fumbles the touch and loses the ball.` });
      return { lines, outcome: "whiff", pointsAwarded };
    }
    lines.push({ text: `${attacker.name} pops it up and dodges into the flick.` });
    return resolveFinish(attacker, defendingTeam, lines, pointsAwarded, 0.28);
  }

  // fifty_fifty: a neutral ball both teams challenge, pure car control + a sliver of game sense.
  lines.push({ text: `${attacker.name} and ${primaryDefender.name} challenge the 50/50.` });
  const p1 = attacker.foundationStats.carControl + attacker.gameSense * 0.15;
  const p2 = primaryDefender.foundationStats.carControl + primaryDefender.gameSense * 0.15;
  if (Math.random() > statProbability(p1, p2)) {
    lines.push({ text: `${primaryDefender.name} wins the challenge and sends it back the other way.` });
    award(primaryDefender.name, 15);
  } else {
    lines.push({ text: `${attacker.name} wins the challenge and pushes forward.` });
    award(attacker.name, 15);
  }
  return { lines, outcome: "clear", pointsAwarded };
}

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
  lines.push({ text: `${keeper.name} scrambles back to defend the net.` });

  if (Math.random() > statProbability(shotPower, savePower)) {
    lines.push({ text: `SAVE! ${keeper.name} gets enough on it to keep it out.` });
    award(keeper.name, 50);
    return { lines, outcome: "save", actorName: keeper.name, pointsAwarded };
  }

  lines.push({ text: `GOAL! ${attacker.name} finishes it past ${keeper.name}.` });
  award(attacker.name, 100);
  return { lines, outcome: "goal", scoringTeam: attacker.team, actorName: attacker.name, pointsAwarded };
}

// ============================================================================================
// 2v2 team-chain engine: 2v2 is the main/most-played gamemode, so its possessions get the same short-chain
// treatment as the 1v1 duel engine below (not the single stat-checked step simulatePossession above still
// uses for 3v3), plus a team-specific beat that duel and 3v3 alike don't have: a SECOND teammate whose own
// positioning matters. If they bite on a fake or get caught upfield, the primary defender is left as the
// "last man" with no help, materially worse odds on the finish than defending with support behind them.
// How often that actually happens scales off the teammate's own defense/game sense, not a flat chance, a
// Platinum lobby's rotations are noticeably shakier than an SSL's.
// ============================================================================================

const TEAM_ROTATION_MISTAKE_BASE = 0.4;
const TEAM_ROTATION_MISTAKE_MIN = 0.06;
const TEAM_ROTATION_MISTAKE_MAX = 0.5;
const TEAM_ROTATION_MISTAKE_SCALE = 11000;
const LAST_MAN_DEFENSE_PENALTY = 0.72;
const LAST_MAN_KEEPER_MULTIPLIER = 0.8;
const SUPPORTED_KEEPER_MULTIPLIER = 1.05;

export function simulateTeamPossession(
  attackingTeam: MatchParticipantStats[],
  defendingTeam: MatchParticipantStats[]
): PossessionResult {
  const attacker = pickAttacker(attackingTeam);
  const primaryDefender = pickDefender(defendingTeam);
  const teammates = defendingTeam.filter((p) => p.name !== primaryDefender.name);
  const teammate = teammates.length > 0 ? teammates[Math.floor(Math.random() * teammates.length)] : null;
  const kind = pickChainKind(attacker);
  const lines: PossessionLogLine[] = [];
  const pointsAwarded: { name: string; amount: number }[] = [];
  function award(name: string, amount: number) {
    pointsAwarded.push({ name, amount });
  }

  let isLastMan = false;
  let supportBonus = 0;
  if (teammate) {
    const rotationPower = teammate.foundationStats.defense * 0.5 + teammate.gameSense * 0.5;
    // A disciplined rotator earns real relief here on top of raw stats — Rotation Discipline is exactly
    // the trained tendency that keeps someone from ball-chasing into a bad spot in the first place.
    const disciplineRelief = (effectivePlaystyle(teammate).rotationDiscipline - 50) / 300;
    const mistakeChance = Math.max(
      TEAM_ROTATION_MISTAKE_MIN,
      Math.min(TEAM_ROTATION_MISTAKE_MAX, TEAM_ROTATION_MISTAKE_BASE - rotationPower / TEAM_ROTATION_MISTAKE_SCALE - disciplineRelief)
    );
    isLastMan = Math.random() < mistakeChance;
    if (isLastMan) {
      lines.push({ text: `${teammate.name} bites on the fake and gets caught out of position, ${primaryDefender.name} is last man back.` });
    } else {
      lines.push({ text: `${teammate.name} rotates back to support ${primaryDefender.name}.` });
      supportBonus = Math.min(600, 150 + rotationPower * 0.1);
    }
  }
  const defBoost = (stat: number) => (isLastMan ? stat * LAST_MAN_DEFENSE_PENALTY : stat + supportBonus);
  const keeperMultiplier = isLastMan ? LAST_MAN_KEEPER_MULTIPLIER : teammate ? SUPPORTED_KEEPER_MULTIPLIER : 1;

  if (kind === "aerial") {
    lines.push({ text: `${attacker.name} goes up for an aerial.` });
    const whiff = whiffChance(attacker, attacker.foundationStats.aerialControl, 0.4);
    if (Math.random() < whiff) {
      lines.push({ text: `${attacker.name} mistimes it and whiffs completely.` });
      return { lines, outcome: "whiff", pointsAwarded };
    }
    lines.push({ text: `${primaryDefender.name} rotates back to challenge in the air.` });
    const attackerAerialPower = attacker.foundationStats.aerialControl + attacker.foundationStats.offense * 0.3;
    const defenderAerialPower = defBoost(primaryDefender.foundationStats.defense + primaryDefender.foundationStats.aerialControl * 0.3);
    if (Math.random() > statProbability(attackerAerialPower, defenderAerialPower)) {
      lines.push({ text: `${primaryDefender.name} beats them to it and clears the ball.` });
      award(primaryDefender.name, 30);
      return { lines, outcome: "clear", pointsAwarded };
    }
    lines.push({ text: `${attacker.name} wins the aerial duel and redirects it on frame.` });
    return resolveFinish(attacker, defendingTeam, lines, pointsAwarded, 0.32, keeperMultiplier);
  }

  if (kind === "wall_read") {
    lines.push({ text: `${attacker.name} reads a ball rolling up the wall.` });
    const whiff = whiffChance(attacker, attacker.foundationStats.carControl, 0.22);
    if (Math.random() < whiff) {
      lines.push({ text: `${attacker.name} mistimes the wall read and misses it entirely.` });
      return { lines, outcome: "whiff", pointsAwarded };
    }
    const contest = statProbability(
      attacker.foundationStats.carControl + attacker.gameSense * 0.2,
      defBoost(primaryDefender.foundationStats.defense)
    );
    if (Math.random() > contest) {
      lines.push({ text: `${primaryDefender.name} challenges first and knocks it away.` });
      award(primaryDefender.name, 25);
      return { lines, outcome: "clear", pointsAwarded };
    }
    lines.push({ text: `${attacker.name} controls it off the wall and drives toward goal.` });
    return resolveFinish(attacker, defendingTeam, lines, pointsAwarded, 0.22, keeperMultiplier);
  }

  if (kind === "ground_flick") {
    lines.push({ text: `${attacker.name} sets up a flick off the ground.` });
    const whiff = whiffChance(attacker, attacker.foundationStats.carControl, 0.28);
    if (Math.random() < whiff) {
      lines.push({ text: `${attacker.name} fumbles the touch and loses the ball.` });
      return { lines, outcome: "whiff", pointsAwarded };
    }
    lines.push({ text: `${attacker.name} pops it up and dodges into the flick.` });
    return resolveFinish(attacker, defendingTeam, lines, pointsAwarded, 0.28, keeperMultiplier);
  }

  // fifty_fifty: a neutral ball both teams challenge, pure car control + a sliver of game sense.
  lines.push({ text: `${attacker.name} and ${primaryDefender.name} challenge the 50/50.` });
  const p1 = attacker.foundationStats.carControl + attacker.gameSense * 0.15;
  const p2 = defBoost(primaryDefender.foundationStats.carControl + primaryDefender.gameSense * 0.15);
  if (Math.random() > statProbability(p1, p2)) {
    lines.push({ text: `${primaryDefender.name} wins the challenge and sends it back the other way.` });
    award(primaryDefender.name, 15);
  } else {
    lines.push({ text: `${attacker.name} wins the challenge and pushes forward.` });
    award(attacker.name, 15);
  }
  return { lines, outcome: "clear", pointsAwarded };
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
