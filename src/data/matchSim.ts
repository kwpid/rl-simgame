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

/** Setup touch + finish, kind-specific whiff curve and flavor line, then delegates to `resolveFinish` for
 *  the actual shot-vs-save. This is the "kind" flavor the old single-step 2v2/3v3 engines had, now just the
 *  LAST beat of the richer chain in `simulateTeamChain` below instead of the whole possession. */
function attemptFinish(
  attacker: MatchParticipantStats,
  defendingTeam: MatchParticipantStats[],
  lines: PossessionLogLine[],
  pointsAwarded: { name: string; amount: number }[],
  kind: ChainKind,
  keeperMultiplier: number
): PossessionResult {
  if (kind === "aerial") {
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
  const stallWeight = teammateAvailable ? Math.max(0, 0.15 + (50 - style.aggression) / 300) : 0;
  const shadowWeight = Math.max(0.05, 0.3 + (style.rotationDiscipline - 50) / 300);
  const fakeWeight = Math.max(0.05, 0.2 + (defender.gameSense - 1000) / 8000);
  const hardWeight = Math.max(0.15, 0.35 + (style.aggression - 50) / 300);
  const total = stallWeight + shadowWeight + fakeWeight + hardWeight;
  let roll = Math.random() * total;
  if ((roll -= stallWeight) <= 0) return "stall";
  if ((roll -= shadowWeight) <= 0) return "shadow";
  if ((roll -= fakeWeight) <= 0) return "fake";
  return "hard";
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

/** Decides who gets first touch off a kickoff — occasional strats beyond the standard approach, gated a
 *  little by mechanical consistency (a speedflip is only worth attempting reliably once you can land it),
 *  "somewhat rare but not super uncommon" per the design brief. A botched speedflip is a real risk, not
 *  just flavor: it actually costs that side effective power for the challenge. */
function simulateKickoffBeat(blueTeam: MatchParticipantStats[], orangeTeam: MatchParticipantStats[]): { lines: PossessionLogLine[]; winnerSide: "blue" | "orange" } {
  const blueTaker = pickAttacker(blueTeam);
  const orangeTaker = pickAttacker(orangeTeam);

  function pickStrat(taker: MatchParticipantStats): KickoffStrat {
    const exoticChance = Math.min(0.3, 0.12 + taker.mechanicalConsistency / 12000);
    const roll = Math.random();
    if (roll < exoticChance * 0.3) return "cheat";
    if (roll < exoticChance * 0.6) return "fake";
    if (roll < exoticChance) return "speed";
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
  const winnerSide: "blue" | "orange" = Math.random() < statProbability(blueEff, orangeEff, 500) ? "blue" : "orange";
  const winnerTaker = winnerSide === "blue" ? blueTaker : orangeTaker;
  lines.push({ text: `${winnerTaker.name} gets there first and takes control off the kickoff.` });
  return { lines, winnerSide };
}

/** Resolves one full possession as a variable-length chain of beats for 2v2/3v3, carrying signed pressure
 *  in and back out. `isKickoff` runs a real kickoff beat first (deciding who even gets the ball) instead of
 *  a blind coin flip — pass true after every goal and the instant overtime starts, see useMatchStore.ts's
 *  `needsKickoff`. */
export function simulateTeamChain(
  blueTeam: MatchParticipantStats[],
  orangeTeam: MatchParticipantStats[],
  currentPressure: number,
  isKickoff: boolean
): TeamChainResult {
  const lines: PossessionLogLine[] = [];
  const pointsAwarded: { name: string; amount: number }[] = [];
  function award(name: string, amount: number) {
    pointsAwarded.push({ name, amount });
  }

  let attackingSide: "blue" | "orange";
  if (isKickoff) {
    const kickoff = simulateKickoffBeat(blueTeam, orangeTeam);
    lines.push(...kickoff.lines);
    attackingSide = kickoff.winnerSide;
  } else {
    // Pressure biases who's more likely to have/keep the ball this possession, but never removes the
    // coinflip entirely — a team under siege can still snatch it back, this just makes it less likely.
    const blueChance = Math.max(0.12, Math.min(0.88, 0.5 + currentPressure / 400));
    attackingSide = Math.random() < blueChance ? "blue" : "orange";
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

  let attacker = pickAttacker(attackingTeam);

  for (let beat = 0; beat < MAX_ADVANCE_BEATS; beat++) {
    const roles = defenderRoles(defendingTeam);
    const teammateAvailable = roles.cover.length > 0;

    // Attacker can demo the stepping-up challenger before the challenge even happens, leaving the net
    // effectively open (whoever's left covers alone, same worse-odds shape as a 2v2 last-man situation).
    const attackerDemo = attemptDemo(attacker, roles.challenger, "lines up and demos");
    if (attackerDemo.demoed) {
      lines.push(...attackerDemo.lines);
      pressureForAttacker = Math.min(PRESSURE_CAP, pressureForAttacker + 25);
      return pack(attemptFinish(attacker, defendingTeam, lines, pointsAwarded, pickChainKind(attacker), teammateAvailable ? 0.75 : 0.55));
    }

    const challengeType = pickChallengeType(roles.challenger, teammateAvailable);

    if (challengeType === "stall") {
      lines.push({ text: `${roles.challenger.name} holds off, backing toward goal and waiting for ${roles.cover[0]?.name ?? "support"} to rotate in.` });
      pressureForAttacker = Math.min(PRESSURE_CAP, pressureForAttacker + 14);
      // A stall buys the attacker a free look but doesn't hand them the ball outright — decide fast
      // whether they cash in now or the chain keeps going (another beat, possibly a different attacker).
      if (Math.random() < 0.4) return pack(attemptFinish(attacker, defendingTeam, lines, pointsAwarded, pickChainKind(attacker), 1));
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
      const contest = statProbability(
        attacker.foundationStats.carControl + attacker.gameSense * 0.2,
        roles.challenger.foundationStats.defense + roles.challenger.gameSense * 0.15
      );
      if (Math.random() > contest) {
        lines.push({ text: `${roles.challenger.name} stays patient and forces a bad touch, clearing it away.` });
        award(roles.challenger.name, 25);
        return pack({ lines, outcome: "clear", pointsAwarded });
      }
      lines.push({ text: `${attacker.name} works around the shadow and keeps possession.` });
      pressureForAttacker = Math.min(PRESSURE_CAP, pressureForAttacker + 12);
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
    const defBoost = roles.cover.reduce((sum, c) => sum + c.foundationStats.defense * 0.05, 0);
    const contest = statProbability(
      attacker.foundationStats.carControl + attacker.gameSense * 0.15,
      roles.challenger.foundationStats.defense + roles.challenger.gameSense * 0.1 + defBoost
    );
    if (Math.random() > contest) {
      lines.push({ text: `${roles.challenger.name} wins the challenge and clears it out.` });
      award(roles.challenger.name, 30);
      return pack({ lines, outcome: "clear", pointsAwarded });
    }
    lines.push({ text: `${attacker.name} wins the challenge and drives on.` });
    pressureForAttacker = Math.min(PRESSURE_CAP, pressureForAttacker + 22);
    // A won hard challenge is the most decisive beat — good odds this converts straight into a shot.
    if (Math.random() < 0.3 + beat * 0.15) return pack(attemptFinish(attacker, defendingTeam, lines, pointsAwarded, pickChainKind(attacker), teammateAvailable ? 1.05 : 1));
  }

  // Ran out of advance beats without a clean look or a turnover — the attacker cashes in whatever they've
  // built up rather than looping forever, a supported keeper (still contested, no demo/breakaway bonus).
  return pack(attemptFinish(attacker, defendingTeam, lines, pointsAwarded, pickChainKind(attacker), 1));
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
