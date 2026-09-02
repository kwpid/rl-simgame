import { create } from "zustand";
import type { QueueMode } from "@/data/mockSave";
import { tierMinMmr, eraForDate, deriveRankFromMmr, type RankEra, type RankTierId } from "@/data/rankSystem";
import type { FoundationCategory } from "@/data/mechanics";
import type { TitleEntry } from "@/data/seasons";
import type { SimDate } from "@/data/dateUtils";
import { LB_NAMES } from "@/data/mockSave";
import { PRO_PLAYERS, type ProRegion } from "@/data/proPlayers";
import { rlcsSeasonForDate, orgTagForOrgName, saveRegionToProRegion } from "@/data/tournaments";
import { useProLeaderboardStore } from "@/store/useProLeaderboardStore";
import { useLeaderboardFillerStore, fillerLeaderboardNames } from "@/store/useLeaderboardFillerStore";
import { useRegionalRosterStore } from "@/store/useRegionalRosterStore";
import { regionalGrinderRoster, type RosterBand } from "@/data/regionalGrinders";
import { gatherEligibleOpponents, type EligibleCandidate } from "@/data/matchmakingPool";
import { isOnlineNow, REGION_HOUR_OFFSET } from "@/data/aiActivity";
import { findRealRlcsTitlesForPlayer } from "@/store/useTournamentStore";
import { useSaveStore } from "@/store/useSaveStore";
import {
  generateOpponentStats,
  simulatePossession,
  simulateTeamPossession,
  simulateDuelPossession,
  prefersCounterAttack,
  flattenProgress,
  effectivePlaystyle,
  type MatchParticipantStats,
  type DuelMastery,
  type PossessionResult,
} from "@/data/matchSim";

export type MatchPhase = "idle" | "searching" | "found" | "in_match" | "post_match";

export interface MatchPlayer extends MatchParticipantStats {
  points: number;
  /** Shared id when this opponent queued in with a teammate rather than solo, so the UI can flag them as
   *  a party (a duo icon next to their names). Cosmetic only, no gameplay effect. */
  partyId?: string;
}

export interface MatchLogLine {
  id: number;
  clockLabel: string;
  text: string;
  emphasis?: boolean;
}

export interface SelfStats {
  name: string;
  gameSense: number;
  mechanicalConsistency: number;
  foundationStats: Record<FoundationCategory, number>;
  title: TitleEntry | null;
  /** The player's real trained mechanic/queue-concept mastery and per-queue playstyle, used by the 1v1
   *  duel engine so a named mechanic in the log is actually one they've trained, not a generic stand-in.
   *  Omitted entirely for non-1v1 matches (that engine doesn't use it yet). */
  duelMastery?: DuelMastery;
  /** [TAG] shown before the player's own name, derived from their live orgContract (see mockSave.ts), or
   *  undefined when between orgs/never signed. */
  orgTag?: string;
}

/** One queue to search as part of a (possibly multi-queue) search — each queue needs its own rank tier/
 *  MMR/self-stats since those vary per playlist. */
export interface QueueSearchRequest {
  queue: QueueMode;
  rankTier: RankTierId;
  self: SelfStats;
  playerMmr: number;
  /** Only meaningful at GC+/SSL — which regions to draw real named opponents from (see
   *  data/matchmakingPool.ts). Ignored below that tier, where matchmaking never region-filters. */
  regions?: ProRegion[];
}

/** A "plain" friend's own persisted per-queue MMR/stats (see useSaveStore.ts's FriendRecord), used to
 *  build that queue's actual `friendOverride` for `buildOpponent` once the popped queue is known. */
export interface PartyFriendStats {
  mmr: Record<QueueMode, number>;
  gameSense: Record<QueueMode, number>;
  mechanicalConsistency: Record<QueueMode, number>;
}

export const GAME_DURATION_SECONDS = 300; // 5:00, a standard RL regulation match
const TICK_MS = 1000; // real ms per tick
const GAME_SECONDS_PER_TICK = 6; // compress 5:00 of game time into ~50 real seconds
const POSSESSION_CHANCE_PER_TICK = 0.3;

// A team down by enough goals with too little regulation time left to realistically come back votes to
// forfeit rather than play it out, same as real RL lobbies. Never triggers in overtime (one goal always
// still wins it there) or against the player's own team (forfeiting would yank control away from them).
const FORFEIT_GOAL_DIFF = 4;
const FORFEIT_TIME_THRESHOLD_SECONDS = 90;
const FORFEIT_CHANCE_PER_TICK = 0.12;

// Rough population model: lower ranks have far more players in queue, so matches pop faster.
const RANK_QUEUE_BASE_SECONDS: Partial<Record<RankTierId, number>> = {
  unranked: 4,
  bronze: 4,
  silver: 4,
  gold: 5,
  platinum: 5,
  diamond: 6,
  champion: 9,
  grand_champion: 15,
  ssl: 22,
};

const QUEUE_POPULATION_MULTIPLIER: Record<QueueMode, number> = {
  "1v1": 1.8,
  "2v2": 1.0,
  "3v3": 1.3,
};

// Fewer players online overnight, doesn't stop a match from popping, just takes longer, and it hits
// higher ranks harder since their pool of active players is already small, at 4 AM the handful of GC/SSL
// players online skews even smaller, while Bronze always has a crowd regardless of the hour.
function timeOfDayMultiplier(hour: number): number {
  if (hour >= 3 && hour < 8) return 2.4; // dead of night
  if (hour >= 0 && hour < 3) return 1.6; // late night
  if (hour >= 8 && hour < 17) return 1.05; // daytime, decent but not peak
  return 0.8; // 17:00-24:00, evening peak
}

// Below GC+/SSL, queue time stays exactly the old formula — this constant marks the boundary the scarcity
// model below never touches, keeping every rank below it provably unaffected by this whole system.
const EXPECTED_POOL_SIZE = 12;

function computeQueueDurationMs(
  queue: QueueMode,
  rankTier: RankTierId,
  hourOfDay: number,
  era: RankEra,
  regions: ProRegion[],
  playerMmr: number,
  currentYear: number,
  currentDate: SimDate,
  seasonStartDate: SimDate
): number {
  const base = RANK_QUEUE_BASE_SECONDS[rankTier] ?? 8;
  const rankSensitivity = base / 8; // low ranks barely notice the hour, SSL notices a lot
  const rawTimeMult = timeOfDayMultiplier(hourOfDay);
  const timeMult = rawTimeMult >= 1 ? 1 + (rawTimeMult - 1) * rankSensitivity : rawTimeMult;

  const isEligible = rankTier === "grand_champion" || rankTier === "ssl";
  if (!isEligible || regions.length === 0) {
    const seconds = base * QUEUE_POPULATION_MULTIPLIER[queue] * timeMult * (0.7 + Math.random() * 0.6);
    return Math.round(seconds * 1000);
  }

  // GC+/SSL: how many real, currently-online candidates are actually out there right now, across every
  // selected region — the fewer there are, the worse the multiplier on top of the plain time-of-day effect,
  // and selecting more regions directly counteracts it (mirrors the "cross-region queue" tradeoff the spec
  // describes: faster pop, less regionally-flavored opponent variety).
  const availableCount = gatherEligibleOpponents(regions, queue, playerMmr, era, currentYear, currentDate, seasonStartDate, hourOfDay, new Set()).length;
  const scarcity = Math.max(0, Math.min(1, 1 - availableCount / EXPECTED_POOL_SIZE));
  const scarcityMult = 1 + scarcity * 2.2 * rankSensitivity;
  const regionCountDiscount = 1 / (1 + 0.35 * (regions.length - 1));
  const seconds = base * QUEUE_POPULATION_MULTIPLIER[queue] * timeMult * scarcityMult * regionCountDiscount * (0.7 + Math.random() * 0.6);
  return Math.round(seconds * 1000);
}

// Only Grand Champion/SSL matches pull from the real leaderboard (pros + persistent filler regulars), and
// even then, how OFTEN scales with how deep into that bracket the player actually is: someone freshly
// promoted into low GC is nowhere near the same crowd as a deep-GC/SSL grinder, being "the highest rank
// you've reached" doesn't mean you're anywhere close to the top of the whole ladder yet.
const LEADERBOARD_NAME_CHANCE_MIN = 0.12;
const LEADERBOARD_NAME_CHANCE_MAX = 0.85;
// Even once a leaderboard name is going to show up at all, a real named PRO specifically should be rarer
// than a filler leaderboard regular at the bottom of the bracket — barely-GC/barely-SSL should almost
// never run into an actual pro, only deep into GC/SSL does a pro genuinely become the more likely pick.
const PRO_SHARE_MIN = 0.02;
const PRO_SHARE_MAX = 0.75;
// Only the single highest tier reachable in the current era (legacy Grand Champion, modern SSL) gets the
// 4-band pro-density split — modern GC (below SSL) still gets the real regional roster/online system, just
// without band weighting, same "not every top-of-ladder rank is the SAME crowd" idea the old bracketDepth
// math already captured, just now resolved into actual named identities instead of a flat MMR-band filter.
function isTopmostTierForEra(rankTier: RankTierId, era: RankEra): boolean {
  return (era === "modern" && rankTier === "ssl") || (era === "legacy" && rankTier === "grand_champion");
}

// Lerp'd by bracketDepth (0 = just cracked the topmost tier, 1 = at/past the top of its uncapped range):
// shallow depth reads mostly Low/Mid grinders, deep depth reads mostly High/Super High pros, with enough
// overlap that "sometimes a high lobby pulls in a pro" (or vice versa) is a real, if rarer, possibility.
const BAND_WEIGHTS_BY_DEPTH: Record<RosterBand, [number, number]> = {
  low: [0.55, 0.05],
  mid: [0.3, 0.2],
  high: [0.13, 0.4],
  super_high: [0.02, 0.35],
};

function weightForBand(band: RosterBand, bracketDepth: number): number {
  const [atZero, atOne] = BAND_WEIGHTS_BY_DEPTH[band];
  return atZero + (atOne - atZero) * bracketDepth;
}

function pickWeightedCandidate(pool: EligibleCandidate[], bracketDepth: number): EligibleCandidate {
  const weights = pool.map((c) => weightForBand(c.band, bracketDepth));
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return pool[Math.floor(Math.random() * pool.length)];
  let roll = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

/** Picks a name for one roster slot, plus the real leaderboard MMR to force the opponent to use when one
 *  was picked, so who you face — and the number shown for them in-match — is always exactly the person
 *  and value the Top 50 board itself would show, never an unrelated independently-rolled number. Below
 *  GC/SSL, or when no board name fits the band, falls back to a purely generic (non-leaderboard) name. */
function pickName(
  used: Set<string>,
  rankTier: RankTierId,
  currentYear: number,
  queue: QueueMode,
  playerMmr: number,
  era: RankEra,
  currentDate: SimDate,
  seasonStartDate: SimDate,
  regions: ProRegion[],
  hourOfDay: number
): { name: string; leaderboardMmr?: number; region?: ProRegion; band?: RosterBand } {
  const eligibleForLeaderboard = rankTier === "grand_champion" || rankTier === "ssl";
  // How deep into GC/SSL the player's own MMR sits, 0 at the very bottom of GC, 1 at (or past) the very
  // top of the ladder's uncapped range, scales the chance of running into a real leaderboard/pro opponent
  // at all: barely-GC and deep-SSL are both "eligible" but nowhere near the same crowd.
  const gcFloor = tierMinMmr("grand_champion", era, queue);
  const champFloor = tierMinMmr("champion", era, queue);
  const topFloor = era === "modern" ? tierMinMmr("ssl", era, queue) : gcFloor + Math.max(100, gcFloor - champFloor);
  const bracketDepth = Math.max(0, Math.min(1, (playerMmr - gcFloor) / Math.max(100, topFloor - gcFloor)));
  const leaderboardChance = LEADERBOARD_NAME_CHANCE_MIN + bracketDepth * (LEADERBOARD_NAME_CHANCE_MAX - LEADERBOARD_NAME_CHANCE_MIN);
  if (eligibleForLeaderboard && regions.length > 0 && Math.random() < leaderboardChance) {
    const pool = gatherEligibleOpponents(regions, queue, playerMmr, era, currentYear, currentDate, seasonStartDate, hourOfDay, used);

    if (pool.length > 0) {
      let chosen: EligibleCandidate;
      if (isTopmostTierForEra(rankTier, era)) {
        chosen = pickWeightedCandidate(pool, bracketDepth);
      } else {
        // Modern GC (below SSL): no band weighting, just the old plain pro-vs-grinder share by bracket depth.
        const proShare = PRO_SHARE_MIN + bracketDepth * (PRO_SHARE_MAX - PRO_SHARE_MIN);
        const preferPro = Math.random() < proShare;
        const proCandidates = pool.filter((c) => c.isPro);
        const grinderCandidates = pool.filter((c) => !c.isPro);
        let sharePool = preferPro ? proCandidates : grinderCandidates;
        if (sharePool.length === 0) sharePool = preferPro ? grinderCandidates : proCandidates;
        chosen = sharePool[Math.floor(Math.random() * sharePool.length)];
      }
      used.add(chosen.name);
      return { name: chosen.name, leaderboardMmr: chosen.mmr, region: chosen.region, band: chosen.band };
    }
  }

  let name = LB_NAMES[Math.floor(Math.random() * LB_NAMES.length)];
  let guard = 0;
  while (used.has(name) && guard < 20) {
    name = LB_NAMES[Math.floor(Math.random() * LB_NAMES.length)];
    guard++;
  }
  used.add(name);
  return { name };
}

function buildOpponent(
  name: string,
  team: "blue" | "orange",
  queue: QueueMode,
  rankTier: RankTierId,
  era: RankEra,
  seasonNumber: number,
  currentYear: number,
  playerMmr: number,
  currentDate: SimDate,
  seasonStartDate: SimDate,
  leaderboardMmr?: number,
  /** A "plain" friend's own persisted stats (see useSaveStore.ts's FriendRecord), used verbatim instead
   *  of the pro/filler leaderboard lookups above — takes priority when present, since a friend nobody
   *  else in the sim separately tracks would otherwise fall through to a fresh jittered roll every match. */
  friendOverride?: { mmr: number; gameSense: number; mechanicalConsistency: number },
  /** Which region this name's grinder identity belongs to (see pickName's return), needed to look its
   *  persistent stats up in useRegionalRosterStore. Irrelevant for a real pro (region is looked up straight
   *  off PRO_PLAYERS) or a plain filler/friend name. */
  grinderRegion?: ProRegion
): MatchPlayer {
  const effectiveMmr = friendOverride?.mmr ?? leaderboardMmr;
  const proQueueOverride = effectiveMmr !== undefined ? { mmr: effectiveMmr, queue } : undefined;
  const realRlcsTitles = findRealRlcsTitlesForPlayer(name, rlcsSeasonForDate(currentDate).seasonNumber);
  // A tracked leaderboard name (pro, regional grinder, or filler regular), or a plain friend, carries its
  // own persistent, gradually-simulated Game Sense/Mechanical Consistency, the same person shows up match
  // to match instead of a fresh jittered roll every time.
  const pro = PRO_PLAYERS.find((p) => p.name === name);
  const persistentStats = friendOverride
    ? { gameSense: friendOverride.gameSense, mechanicalConsistency: friendOverride.mechanicalConsistency }
    : leaderboardMmr === undefined
      ? undefined
      : pro
        ? useProLeaderboardStore.getState().getStats(pro.name, queue, era, currentYear, currentDate, seasonStartDate)
        : grinderRegion
          ? useRegionalRosterStore.getState().getStats(name, grinderRegion, queue, era, currentYear, currentDate, seasonStartDate)
          : useLeaderboardFillerStore.getState().getStats(name, queue, era, currentYear, currentDate, seasonStartDate);
  return {
    ...generateOpponentStats(name, team, rankTier, era, seasonNumber, currentYear, playerMmr, queue, proQueueOverride, false, realRlcsTitles, persistentStats),
    points: 0,
  };
}

function generateRoster(
  queue: QueueMode,
  self: SelfStats,
  rankTier: RankTierId,
  era: RankEra,
  seasonNumber: number,
  currentYear: number,
  playerMmr: number,
  currentDate: SimDate,
  seasonStartDate: SimDate,
  partyMemberNames: string[] = [],
  /** A party member's own persisted stats (see useSaveStore.ts's FriendRecord) for whichever queue is
   *  being played right now, keyed by name — only ever consulted for a party member who isn't a real pro
   *  or filler-leaderboard regular (those already carry their own persistence). */
  friendStatsForQueue: Record<string, { mmr: number; gameSense: number; mechanicalConsistency: number }> = {},
  /** GC+/SSL only: which regions the player selected to search, and the region-local hour to check each
   *  candidate's online/offline schedule against. Ignored (empty) below GC — pickName's own tier gate keeps
   *  those matches on the plain generic-filler path regardless. */
  regions: ProRegion[] = [],
  hourOfDay = 0
): MatchPlayer[] {
  const perTeam = queue === "1v1" ? 1 : queue === "2v2" ? 2 : 3;
  const used = new Set<string>([self.name]);
  // 1v1 has no teammate slot to bring a party into, and a party bigger than the queue's team size can't
  // fit at all (RankedScreen already keeps players from reaching this state, this is just the backstop).
  const bringParty = partyMemberNames.length > 0 && perTeam > 1 && partyMemberNames.length < perTeam;
  const partyNames = bringParty ? partyMemberNames : [];
  const selfPartyId = bringParty ? `self+${partyNames.join("+")}` : undefined;

  const players: MatchPlayer[] = [
    {
      name: self.name,
      team: "blue",
      isSelf: true,
      gameSense: self.gameSense,
      mechanicalConsistency: self.mechanicalConsistency,
      foundationStats: self.foundationStats,
      title: self.title,
      mmr: playerMmr,
      points: 0,
      partyId: selfPartyId,
      duelMastery: self.duelMastery,
      orgTag: self.orgTag,
    },
  ];

  let blueSlotsRemaining = perTeam - 1;
  for (const partyName of partyNames) {
    used.add(partyName);
    const pro = PRO_PLAYERS.find((p) => p.name === partyName);
    const grinderRegion = pro ? undefined : findGrinderRegion(partyName, currentYear);
    const isFiller = !pro && !grinderRegion && fillerLeaderboardNames().includes(partyName);
    const leaderboardMmr = pro
      ? useProLeaderboardStore.getState().getMmr(pro.name, queue, era, currentYear, currentDate, seasonStartDate)
      : grinderRegion
        ? useRegionalRosterStore.getState().getMmr(partyName, grinderRegion, queue, era, currentYear, currentDate, seasonStartDate)
        : isFiller
          ? useLeaderboardFillerStore.getState().getMmr(partyName, queue, era, currentYear, currentDate, seasonStartDate)
          : undefined;
    const friendOverride = !pro && !grinderRegion && !isFiller ? friendStatsForQueue[partyName] : undefined;
    const friendPlayer = buildOpponent(partyName, "blue", queue, rankTier, era, seasonNumber, currentYear, playerMmr, currentDate, seasonStartDate, leaderboardMmr, friendOverride, grinderRegion);
    players.push({ ...friendPlayer, partyId: selfPartyId });
    blueSlotsRemaining--;
  }
  for (let i = 0; i < blueSlotsRemaining; i++) {
    const picked = pickName(used, rankTier, currentYear, queue, playerMmr, era, currentDate, seasonStartDate, regions, hourOfDay);
    players.push(buildOpponent(picked.name, "blue", queue, rankTier, era, seasonNumber, currentYear, playerMmr, currentDate, seasonStartDate, picked.leaderboardMmr, undefined, picked.region));
  }
  for (let i = 0; i < perTeam; i++) {
    const picked = pickName(used, rankTier, currentYear, queue, playerMmr, era, currentDate, seasonStartDate, regions, hourOfDay);
    players.push(buildOpponent(picked.name, "orange", queue, rankTier, era, seasonNumber, currentYear, playerMmr, currentDate, seasonStartDate, picked.leaderboardMmr, undefined, picked.region));
  }
  return applyPartyFlavor(players);
}

/** Scans every region's grinder roster for a name — only ever needed for the rare party member/friend whose
 *  name happens to already be a generated grinder identity, generateRoster's other paths already know their
 *  own region up front. Cheap (~50 names x 7 regions), fine to call per lookup. */
function findGrinderRegion(name: string, currentYear: number): ProRegion | undefined {
  const regions: ProRegion[] = ["NA", "EU", "OCE", "SAM", "MENA", "APAC", "SSA"];
  for (const region of regions) {
    if (regionalGrinderRoster(region, currentYear).some((g) => g.name === name)) return region;
  }
  return undefined;
}

// GC+/SSL only: a small session-scale memory of who you've recently faced, so a real ranked-feeling
// "running into the same lobby a few games in a row" effect can happen — deliberately in-memory only (not
// persisted), this is a same-session recency effect, not a permanent history (the persistent MMR/stats
// stores are what make "you've met this AI before" durable across sessions).
interface RecentLobby {
  queue: QueueMode;
  names: string[];
  regions: ProRegion[];
  ageInMatches: number;
}
let recentLobbies: RecentLobby[] = [];
const RECENT_LOBBY_MEMORY = 6;
const REMATCH_CHANCE = 0.18;
const REMATCH_MAX_AGE_MATCHES = 5;

function recordRecentLobby(queue: QueueMode, names: string[], regions: ProRegion[]) {
  recentLobbies = recentLobbies
    .map((l) => ({ ...l, ageInMatches: l.ageInMatches + 1 }))
    .filter((l) => l.ageInMatches <= REMATCH_MAX_AGE_MATCHES);
  recentLobbies.unshift({ queue, names, regions, ageInMatches: 0 });
  recentLobbies = recentLobbies.slice(0, RECENT_LOBBY_MEMORY);
}

/** Resolves which region a real name (pro OR grinder) belongs to, for the online-schedule check below. */
function regionOfName(name: string, currentYear: number): ProRegion | undefined {
  return PRO_PLAYERS.find((p) => p.name === name)?.region ?? findGrinderRegion(name, currentYear);
}

/** Attempts to rebuild a GC+/SSL roster from a recent lobby instead of a fresh pickName roll — the "get
 *  rematched or get the same lobby" mechanic. Reuses the old opponent names (fresh MMR/stats relookup, not
 *  stale numbers), reshuffles team assignment for 2v2/3v3, and fills any now-offline slot with a normal
 *  pickName roll. Returns null (caller falls back to a normal generateRoster call) if no eligible lobby
 *  exists, or too few of its names are still online to be worth reusing. Skipped entirely when the player
 *  brought a party — team assignment math for "self's team keeps its party" gets messy combined with a
 *  reused lobby, and it's a rare enough overlap not to be worth it. */
function tryRematchRoster(
  queue: QueueMode,
  self: SelfStats,
  rankTier: RankTierId,
  era: RankEra,
  seasonNumber: number,
  currentYear: number,
  playerMmr: number,
  currentDate: SimDate,
  seasonStartDate: SimDate,
  regions: ProRegion[],
  hourOfDay: number
): MatchPlayer[] | null {
  const eligible = recentLobbies.filter((l) => l.queue === queue && l.regions.some((r) => regions.includes(r)));
  if (eligible.length === 0) return null;
  const lobby = eligible[Math.floor(Math.random() * eligible.length)];

  const stillOnline = lobby.names.filter((name) => {
    const region = regionOfName(name, currentYear);
    if (!region) return false;
    return isOnlineNow(name, region, currentDate, (hourOfDay + REGION_HOUR_OFFSET[region]) % 24);
  });
  if (stillOnline.length < Math.ceil(lobby.names.length / 2)) return null;

  const perTeam = queue === "1v1" ? 1 : queue === "2v2" ? 2 : 3;
  const used = new Set<string>([self.name, ...stillOnline]);
  const shuffled = [...stillOnline].sort(() => Math.random() - 0.5);
  const totalSlots = perTeam * 2 - 1;
  while (shuffled.length < totalSlots) {
    const picked = pickName(used, rankTier, currentYear, queue, playerMmr, era, currentDate, seasonStartDate, regions, hourOfDay);
    shuffled.push(picked.name);
  }

  const players: MatchPlayer[] = [
    { name: self.name, team: "blue", isSelf: true, gameSense: self.gameSense, mechanicalConsistency: self.mechanicalConsistency, foundationStats: self.foundationStats, title: self.title, mmr: playerMmr, points: 0, duelMastery: self.duelMastery, orgTag: self.orgTag },
  ];
  shuffled.slice(0, totalSlots).forEach((name, i) => {
    const team = i < perTeam - 1 ? "blue" : "orange";
    const pro = PRO_PLAYERS.find((p) => p.name === name);
    const grinderRegion = pro ? undefined : findGrinderRegion(name, currentYear);
    const leaderboardMmr = pro
      ? useProLeaderboardStore.getState().getMmr(pro.name, queue, era, currentYear, currentDate, seasonStartDate)
      : grinderRegion
        ? useRegionalRosterStore.getState().getMmr(name, grinderRegion, queue, era, currentYear, currentDate, seasonStartDate)
        : undefined;
    players.push(buildOpponent(name, team, queue, rankTier, era, seasonNumber, currentYear, playerMmr, currentDate, seasonStartDate, leaderboardMmr, undefined, grinderRegion));
  });
  return applyPartyFlavor(players);
}

// A single stat/mechanic gap shouldn't be an instant, guaranteed result: real players have good and bad
// days independent of their real skill level, someone can just be peaking (or off) for this one game. This
// rolls ONE multiplier per player for the whole match (not per possession, a "day" is consistent), applied
// to their effective Game Sense/Mechanical Consistency/foundation stats for this game only — their real
// saved stats never change, only how they play out this specific match.
const FORM_SPREAD = 0.18; // +/-18%
const FORM_NOTE_THRESHOLD = 0.1; // only call it out in the log if the swing is actually noticeable

/** A more consistent player (the trained playstyle trait, not the Mechanical Consistency stat which
 *  already governs in-match whiff variance) has tighter day-to-day form swings, a wildly inconsistent one
 *  swings harder both ways. */
function rollForm(consistencyTrait: number): number {
  const spread = Math.max(0.03, FORM_SPREAD * (1 - (consistencyTrait - 50) / 90));
  return 1 + (Math.random() * 2 - 1) * spread;
}

function applyForm(player: MatchPlayer, form: number): MatchPlayer {
  const scale = (v: number) => Math.max(0, Math.round(v * form));
  return {
    ...player,
    gameSense: scale(player.gameSense),
    mechanicalConsistency: scale(player.mechanicalConsistency),
    foundationStats: Object.fromEntries(
      Object.entries(player.foundationStats).map(([cat, v]) => [cat, scale(v as number)])
    ) as MatchPlayer["foundationStats"],
  };
}

/** 1v1-only for now: rolls each player's form for this match and applies it, returning the adjusted
 *  roster plus any log-worthy note about a noticeably good/bad day. */
function applyMatchDayForm(players: MatchPlayer[]): { players: MatchPlayer[]; formNotes: string[] } {
  const formNotes: string[] = [];
  const adjusted = players.map((p) => {
    const form = rollForm(effectivePlaystyle(p).consistency);
    if (form - 1 >= FORM_NOTE_THRESHOLD) formNotes.push(`${p.name} looks like they're playing above their usual level today.`);
    else if (1 - form >= FORM_NOTE_THRESHOLD) formNotes.push(`${p.name} looks a little off their usual game today.`);
    return applyForm(p, form);
  });
  return { players: adjusted, formNotes };
}

// Cosmetic flavor only, no gameplay effect: in 2v2/3v3, the enemy team sometimes includes two players who
// queued in together as a party, flagged with a shared partyId for the UI's duo icon.
const PARTY_CHANCE = 0.35;

function applyPartyFlavor(players: MatchPlayer[]): MatchPlayer[] {
  const enemyTeam = players.filter((p) => p.team === "orange");
  if (enemyTeam.length < 2 || Math.random() >= PARTY_CHANCE) return players;
  const shuffled = [...enemyTeam].sort(() => Math.random() - 0.5);
  const [a, b] = shuffled;
  const partyId = `${a.name}+${b.name}`;
  return players.map((p) => (p.name === a.name || p.name === b.name ? { ...p, partyId } : p));
}

function clockLabel(secondsRemaining: number): string {
  const m = Math.floor(secondsRemaining / 60);
  const s = secondsRemaining % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

let logIdCounter = 0;
// One pending search per queue mode, so multi-queueing (searching 1v1 and 2v2 at once, say) can have
// several running in parallel — whichever pops first cancels the rest.
let queueTimers: Partial<Record<QueueMode, ReturnType<typeof setTimeout>>> = {};
let foundTimer: ReturnType<typeof setTimeout> | null = null;
let matchInterval: ReturnType<typeof setInterval> | null = null;

function clearAllTimers() {
  Object.values(queueTimers).forEach((t) => t && clearTimeout(t));
  queueTimers = {};
  if (foundTimer) clearTimeout(foundTimer);
  if (matchInterval) clearInterval(matchInterval);
  foundTimer = null;
  matchInterval = null;
}

/** Rebuilds one queue's search request straight from the live save (mirrors RankedScreen's own
 *  buildQueueRequest exactly), so auto-queue's next cycle always reflects whatever's changed since the
 *  last search — a rank-up, freshly trained stats, a party change — never a stale snapshot from whenever
 *  auto-queue was first turned on. */
function buildAutoQueueRequest(save: ReturnType<typeof useSaveStore.getState>, era: RankEra, q: QueueMode): QueueSearchRequest {
  const p = save.rankedProfiles[q];
  const rankTier: RankTierId = p.placementMatchesRemaining > 0 ? deriveRankFromMmr(p.mmr, era, q).tier : p.rankTier;
  return {
    queue: q,
    rankTier,
    playerMmr: p.mmr,
    regions: save.selectedMatchmakingRegions,
    self: {
      name: save.displayName,
      gameSense: save.player.gameSense[q],
      mechanicalConsistency: save.player.mechanicalConsistency[q],
      foundationStats: save.foundationStats,
      title: save.titles.find((t) => t.id === save.equippedTitleId) ?? null,
      duelMastery: {
        mechanicMastery: flattenProgress(save.mechanicProgress),
        queueConceptMastery: flattenProgress(save.queueConceptProgress),
        playstyle: save.playstyleProfiles[q],
      },
      orgTag: save.orgContract ? orgTagForOrgName(save.orgContract.orgName) : undefined,
    },
  };
}

interface MatchStoreState {
  phase: MatchPhase;
  queue: QueueMode | null;
  /** While `phase === "searching"`, every queue currently being searched at once (multi-queue). A single
   *  queue is still just a one-element array. Cleared the moment one of them pops. */
  queuedModes: QueueMode[];
  /** Non-null while auto-queue is active: which queue(s) to immediately re-search once a ranked match ends
   *  (see `returnToMenu`), until the player stops it (the persistent AutoQueueBanner, or manually
   *  cancelling an in-progress search). Never touched by tournament/org/showmatch series, only the plain
   *  ranked "Continue" flow. */
  autoQueueModes: QueueMode[] | null;
  /** How long (real ms) this match's queue search took, per computeQueueDurationMs's rank/population/
   *  time-of-day model. Doubles as the realistic in-game queue time to advance the clock by once the
   *  match ends (see MatchScreen's handleContinue) — 0 for a tournament series, which skips matchmaking
   *  entirely. */
  queueDurationMs: number;
  /** Live estimate per queue (GC+/SSL's scarcity-aware computeQueueDurationMs result, or the plain formula
   *  below that), set the moment each search's timer is scheduled — read by RankedScreen's live queue timer
   *  UI instead of the number being trapped inside `startQueue`'s own closure. */
  estimatedQueueDurationsMs: Partial<Record<QueueMode, number>>;
  /** `Date.now()` when the current search began, or null while not searching — RankedScreen's live queue
   *  timer computes elapsed time against this. */
  searchStartedAt: number | null;
  clockSeconds: number;
  overtime: boolean;
  otSeconds: number;
  players: MatchPlayer[];
  scoreBlue: number;
  scoreOrange: number;
  log: MatchLogLine[];
  resultWin: boolean | null;
  selfGoals: number;
  selfSaves: number;

  /** 1v1-only: the ball's current field position, 0-100 both axes, for the 2D field display. See
   *  data/matchSim.ts's `DuelPossessionResult` for the axis convention. Unused (stays at 50/50) outside
   *  1v1, that engine doesn't track field position. */
  fieldX: number;
  fieldY: number;
  /** 1v1-only: who wins the ball next is normally a coin flip each tick, but after a defensive win, the
   *  defender's own tendency (see `prefersCounterAttack`) can force them to be the next attacker instead,
   *  on a fast counter. `null` means no forced pick, fall back to the coin flip. */
  duelNextAttacker: "blue" | "orange" | null;
  duelIsCounter: boolean;

  /** Best-of-N series support (tournament matches): ranked play always stays at seriesFormat 1, decided
   *  after its one game, so none of this changes ranked behavior. A tournament match sets seriesFormat
   *  to 3/5/7 via `startTournamentSeries`, `continueSeries` (the post-game "Continue" for a series match)
   *  either starts the next game on the same roster or, once decided, fires `onSeriesComplete`. */
  seriesFormat: number;
  seriesWinsSelf: number;
  seriesWinsOpp: number;
  seriesGameNumber: number;
  onSeriesComplete: ((selfWonSeries: boolean) => void) | null;

  /** Starts searching one or more queues at once (multi-queue): each request gets its own independent
   *  pop timer, whichever fires first wins and immediately cancels every other pending search. Pass a
   *  single-element array for an ordinary one-queue search. `partyFriendStats` (a "plain" party member's
   *  own persisted per-queue stats, see useSaveStore.ts's FriendRecord) is only ever consulted for a party
   *  member who isn't a real pro or filler-leaderboard regular, those already carry their own persistence. */
  startQueue: (
    requests: QueueSearchRequest[],
    hourOfDay: number,
    era: RankEra,
    seasonNumber: number,
    currentYear: number,
    currentDate: SimDate,
    seasonStartDate: SimDate,
    partyMemberNames?: string[],
    partyFriendStats?: Record<string, PartyFriendStats>
  ) => void;
  /** Starts a scheduled match directly (no queue wait) against a fixed opponent roster, for tournament
   *  play: same self as SelfStats, `opponentNames` become the enemy team at a competitive (GC-tier)
   *  baseline. `seriesFormat` is 3/5/7, `onSeriesComplete` fires once with the overall series result. */
  startTournamentSeries: (
    self: SelfStats,
    opponentNames: string[],
    seriesFormat: number,
    era: RankEra,
    seasonNumber: number,
    currentYear: number,
    onSeriesComplete: (selfWonSeries: boolean) => void,
    /** 0 (first stage) to 1 (final stage), how far into the bracket this match is — later stages roll a
     *  tougher amateur-tournament baseline (closer to real pro level), on top of the field itself already
     *  skewing pro-heavy the deeper it goes. Defaults to 0 (early-bracket toughness) when omitted. */
    stageProgress?: number,
    /** Real named teammates for this series (org scrims/tryouts), filling out the blue side alongside
     *  self instead of the player standing in alone against the full opposing lineup. Empty/omitted for
     *  every other tournament context, which still models the player's own match as a solo effort. */
    teammateNames?: string[]
  ) => void;
  /** The "Continue" action for a series match's post-game screen: starts the next game on the same
   *  roster if the series isn't decided yet, otherwise fires `onSeriesComplete` and returns to idle. */
  continueSeries: () => void;
  cancelQueue: () => void;
  acknowledgeFound: () => void;
  returnToMenu: () => void;
  /** Enables (a non-null queue list) or disables (null) auto-queue. Doesn't itself start a search — the
   *  caller (RankedScreen's Search button) still calls `startQueue` for the first cycle, this just decides
   *  whether `returnToMenu` re-triggers it after each match ends. */
  setAutoQueueModes: (modes: QueueMode[] | null) => void;
}

function seriesWinsNeeded(seriesFormat: number): number {
  return Math.ceil(seriesFormat / 2);
}

/** Runs one game's tick loop, shared by the first game (`acknowledgeFound`) and every subsequent game in
 *  a series (`continueSeries`), the only difference between them is what's already in `players` when it
 *  starts. On the game ending, also tallies the result into the series win counters, harmless for a
 *  normal ranked match since it always stays at seriesFormat 1 and is decided after this one game. */
function startTicking(
  set: (partial: Partial<MatchStoreState>) => void,
  get: () => MatchStoreState
) {
  matchInterval = setInterval(() => {
    const state = get();
    if (state.phase !== "in_match") return;
    const nextClock = state.overtime ? 0 : Math.max(0, state.clockSeconds - GAME_SECONDS_PER_TICK);
    const nextOtSeconds = state.overtime ? state.otSeconds + GAME_SECONDS_PER_TICK : 0;

    let { players, scoreBlue, scoreOrange, log, selfGoals, selfSaves } = state;
    const selfName = players.find((p) => p.isSelf)?.name;
    let goalScored = false;
    let fieldX = state.fieldX;
    let fieldY = state.fieldY;
    let duelNextAttacker: "blue" | "orange" | null = null;
    let duelIsCounter = false;

    if (Math.random() < POSSESSION_CHANCE_PER_TICK) {
      let result: PossessionResult;

      if (state.queue === "1v1") {
        const attackingTeam = state.duelNextAttacker ?? (Math.random() < 0.5 ? "blue" : "orange");
        const isCounter = state.duelNextAttacker !== null && state.duelIsCounter;
        const attacker = players.find((p) => p.team === attackingTeam)!;
        const defender = players.find((p) => p.team !== attackingTeam)!;
        const duelResult = simulateDuelPossession(attacker, defender, state.fieldY, isCounter);
        result = duelResult;
        fieldX = duelResult.fieldX;
        fieldY = duelResult.outcome === "goal" ? 50 : duelResult.fieldY;
        // Whichever side didn't just attack now effectively has the ball (a whiff/save/clear all hand
        // it over), decide whether they push a fast counter next tick instead of resetting neutral.
        if (duelResult.outcome !== "goal") {
          const winner = defender;
          if (prefersCounterAttack(winner)) {
            duelNextAttacker = winner.team;
            duelIsCounter = true;
          }
        }
      } else if (state.queue === "2v2") {
        const attackingTeam = Math.random() < 0.5 ? "blue" : "orange";
        const attackers = players.filter((p) => p.team === attackingTeam);
        const defenders = players.filter((p) => p.team !== attackingTeam);
        result = simulateTeamPossession(attackers, defenders);
      } else {
        const attackingTeam = Math.random() < 0.5 ? "blue" : "orange";
        const attackers = players.filter((p) => p.team === attackingTeam);
        const defenders = players.filter((p) => p.team !== attackingTeam);
        result = simulatePossession(attackers, defenders);
      }

      const clockText = state.overtime ? `OT ${clockLabel(nextOtSeconds)}` : clockLabel(nextClock);
      const newLines: MatchLogLine[] = result.lines.map((l, i) => ({
        id: logIdCounter++,
        clockLabel: clockText,
        text: l.text,
        emphasis: i === result.lines.length - 1 && (result.outcome === "goal" || result.outcome === "save"),
      }));
      log = [...log, ...newLines].slice(-60);

      if (result.pointsAwarded.length > 0) {
        const pointMap = new Map(result.pointsAwarded.map((p) => [p.name, p.amount]));
        players = players.map((p) => (pointMap.has(p.name) ? { ...p, points: p.points + pointMap.get(p.name)! } : p));
      }

      if (result.outcome === "goal" && result.scoringTeam) {
        goalScored = true;
        if (result.scoringTeam === "blue") scoreBlue += 1;
        else scoreOrange += 1;
        if (result.actorName === selfName) selfGoals += 1;
      }
      if (result.outcome === "save" && result.actorName === selfName) {
        selfSaves += 1;
      }
    }

    function finishGame(extra: Partial<MatchStoreState>) {
      const selfTeam = players.find((p) => p.isSelf)?.team;
      const wonThisGame = selfTeam === "blue" ? scoreBlue > scoreOrange : scoreOrange > scoreBlue;
      const seriesWinsSelf = state.seriesWinsSelf + (wonThisGame ? 1 : 0);
      const seriesWinsOpp = state.seriesWinsOpp + (wonThisGame ? 0 : 1);
      set({
        players,
        scoreBlue,
        scoreOrange,
        log,
        phase: "post_match",
        resultWin: wonThisGame,
        selfGoals,
        selfSaves,
        seriesWinsSelf,
        seriesWinsOpp,
        ...extra,
      });
    }

    // Sudden death: the first goal scored in overtime ends the match immediately, real RL rules.
    if (state.overtime && goalScored) {
      clearAllTimers();
      finishGame({ otSeconds: nextOtSeconds });
      return;
    }

    if (!state.overtime && !goalScored) {
      const selfTeam = players.find((p) => p.isSelf)?.team;
      const selfScore = selfTeam === "blue" ? scoreBlue : scoreOrange;
      const oppScore = selfTeam === "blue" ? scoreOrange : scoreBlue;
      const hopeless = selfScore - oppScore >= FORFEIT_GOAL_DIFF && nextClock > 0 && nextClock <= FORFEIT_TIME_THRESHOLD_SECONDS;
      if (hopeless && Math.random() < FORFEIT_CHANCE_PER_TICK) {
        clearAllTimers();
        log = [...log, { id: logIdCounter++, clockLabel: clockLabel(nextClock), text: "Opponents forfeit the match.", emphasis: true }].slice(-60);
        finishGame({ clockSeconds: nextClock });
        return;
      }
    }

    if (!state.overtime && nextClock <= 0) {
      if (scoreBlue === scoreOrange) {
        // Regulation ends level: real RL goes to unlimited sudden-death overtime, not a shootout.
        log = [...log, { id: logIdCounter++, clockLabel: "OT", text: "Overtime! Next goal wins.", emphasis: true }].slice(-60);
        set({ clockSeconds: 0, overtime: true, otSeconds: 0, players, scoreBlue, scoreOrange, log, selfGoals, selfSaves, fieldX, fieldY, duelNextAttacker, duelIsCounter });
        return;
      }
      clearAllTimers();
      finishGame({ clockSeconds: 0 });
      return;
    }

    set({ clockSeconds: nextClock, otSeconds: nextOtSeconds, players, scoreBlue, scoreOrange, log, selfGoals, selfSaves, fieldX, fieldY, duelNextAttacker, duelIsCounter });
  }, TICK_MS);
}

export const useMatchStore = create<MatchStoreState>((set, get) => ({
  phase: "idle",
  queue: null,
  queuedModes: [],
  autoQueueModes: null,
  queueDurationMs: 0,
  estimatedQueueDurationsMs: {},
  searchStartedAt: null,
  clockSeconds: GAME_DURATION_SECONDS,
  overtime: false,
  otSeconds: 0,
  players: [],
  scoreBlue: 0,
  scoreOrange: 0,
  log: [],
  resultWin: null,
  selfGoals: 0,
  selfSaves: 0,
  seriesFormat: 1,
  seriesWinsSelf: 0,
  seriesWinsOpp: 0,
  seriesGameNumber: 1,
  onSeriesComplete: null,
  fieldX: 50,
  fieldY: 50,
  duelNextAttacker: null,
  duelIsCounter: false,

  startQueue: (requests, hourOfDay, era, seasonNumber, currentYear, currentDate, seasonStartDate, partyMemberNames, partyFriendStats) => {
    clearAllTimers();
    const estimatedQueueDurationsMs: Partial<Record<QueueMode, number>> = {};
    requests.forEach((req) => {
      estimatedQueueDurationsMs[req.queue] = computeQueueDurationMs(req.queue, req.rankTier, hourOfDay, era, req.regions ?? [], req.playerMmr, currentYear, currentDate, seasonStartDate);
    });
    set({
      phase: "searching",
      queue: null,
      queuedModes: requests.map((r) => r.queue),
      seriesFormat: 1,
      seriesWinsSelf: 0,
      seriesWinsOpp: 0,
      seriesGameNumber: 1,
      onSeriesComplete: null,
      fieldX: 50,
      fieldY: 50,
      duelNextAttacker: null,
      duelIsCounter: false,
      estimatedQueueDurationsMs,
      searchStartedAt: Date.now(),
    });
    requests.forEach((req) => {
      const durationMs = estimatedQueueDurationsMs[req.queue]!;
      queueTimers[req.queue] = setTimeout(() => {
        // This queue popped first, every other pending search is moot now, tear them down immediately.
        Object.values(queueTimers).forEach((t) => t && clearTimeout(t));
        queueTimers = {};

        const friendStatsForQueue: Record<string, { mmr: number; gameSense: number; mechanicalConsistency: number }> = {};
        if (partyFriendStats) {
          for (const [name, record] of Object.entries(partyFriendStats)) {
            friendStatsForQueue[name] = { mmr: record.mmr[req.queue], gameSense: record.gameSense[req.queue], mechanicalConsistency: record.mechanicalConsistency[req.queue] };
          }
        }
        const regions = req.regions ?? [];
        const isEligibleTier = req.rankTier === "grand_champion" || req.rankTier === "ssl";
        const noParty = !partyMemberNames || partyMemberNames.length === 0;
        const rematch =
          isEligibleTier && noParty && regions.length > 0 && Math.random() < REMATCH_CHANCE
            ? tryRematchRoster(req.queue, req.self, req.rankTier, era, seasonNumber, currentYear, req.playerMmr, currentDate, seasonStartDate, regions, hourOfDay)
            : null;
        let players =
          rematch ??
          generateRoster(req.queue, req.self, req.rankTier, era, seasonNumber, currentYear, req.playerMmr, currentDate, seasonStartDate, partyMemberNames, friendStatsForQueue, regions, hourOfDay);
        if (isEligibleTier && regions.length > 0) {
          recordRecentLobby(req.queue, players.filter((p) => !p.isSelf).map((p) => p.name), regions);
        }
        logIdCounter = 0;
        const log: MatchLogLine[] = [{ id: logIdCounter++, clockLabel: clockLabel(GAME_DURATION_SECONDS), text: "Kickoff." }];
        if (req.queue === "1v1") {
          const formResult = applyMatchDayForm(players);
          players = formResult.players;
          formResult.formNotes.forEach((text) => log.push({ id: logIdCounter++, clockLabel: clockLabel(GAME_DURATION_SECONDS), text }));
        }
        set({
          phase: "found",
          queue: req.queue,
          queuedModes: [],
          queueDurationMs: durationMs,
          searchStartedAt: null,
          players,
          clockSeconds: GAME_DURATION_SECONDS,
          overtime: false,
          otSeconds: 0,
          scoreBlue: 0,
          scoreOrange: 0,
          log,
          resultWin: null,
          selfGoals: 0,
          selfSaves: 0,
        });
        foundTimer = setTimeout(() => {
          get().acknowledgeFound();
        }, 2000);
      }, durationMs);
    });
  },

  cancelQueue: () => {
    clearAllTimers();
    // A manual cancel stops auto-queue too, otherwise the persistent banner would keep claiming it's
    // still on even though nothing will actually restart the search from here.
    set({ phase: "idle", queue: null, queuedModes: [], autoQueueModes: null, searchStartedAt: null });
  },

  acknowledgeFound: () => {
    if (get().phase !== "found") return;
    clearAllTimers();
    set({ phase: "in_match" });
    startTicking(set, get);
  },

  startTournamentSeries: (self, opponentNames, seriesFormat, era, seasonNumber, currentYear, onSeriesComplete, stageProgress = 0, teammateNames = []) => {
    clearAllTimers();
    const perTeam = opponentNames.length;
    const queue = perTeam === 1 ? "1v1" : perTeam === 2 ? "2v2" : "3v3";
    logIdCounter = 0;
    const players: MatchPlayer[] = [
      {
        name: self.name,
        team: "blue",
        isSelf: true,
        gameSense: self.gameSense,
        mechanicalConsistency: self.mechanicalConsistency,
        foundationStats: self.foundationStats,
        title: self.title,
        mmr: 0,
        points: 0,
        duelMastery: self.duelMastery,
        orgTag: self.orgTag,
      },
      // Real named teammates (org scrims/tryouts) fill out the rest of the blue side at the same flat
      // elite/competitive strength as the opponents below, rather than the player standing in alone. They're
      // signed to the exact same org as the player, so they always carry the player's own tag rather than
      // whatever generateOpponentStats would have randomly assigned.
      ...teammateNames.map((name) => ({
        ...generateOpponentStats(name, "blue" as const, "grand_champion", era, seasonNumber, currentYear, 0, queue, undefined, true, undefined, undefined, stageProgress),
        points: 0,
        orgTag: self.orgTag,
      })),
      // Tournament opponents are evaluated at flat elite/competitive strength, not their casual ranked
      // ladder MMR, a pro's neglected ranked 3s number would badly understate an actual tournament team.
      ...opponentNames.map((name) => ({
        ...generateOpponentStats(name, "orange" as const, "grand_champion", era, seasonNumber, currentYear, 0, queue, undefined, true, undefined, undefined, stageProgress),
        points: 0,
      })),
    ];
    set({
      phase: "found",
      queue,
      queueDurationMs: 0, // scheduled tournament series, no real matchmaking queue
      players,
      clockSeconds: GAME_DURATION_SECONDS,
      overtime: false,
      otSeconds: 0,
      scoreBlue: 0,
      scoreOrange: 0,
      log: [{ id: logIdCounter++, clockLabel: clockLabel(GAME_DURATION_SECONDS), text: "Kickoff." }],
      resultWin: null,
      selfGoals: 0,
      selfSaves: 0,
      seriesFormat,
      seriesWinsSelf: 0,
      seriesWinsOpp: 0,
      seriesGameNumber: 1,
      onSeriesComplete,
      fieldX: 50,
      fieldY: 50,
      duelNextAttacker: null,
      duelIsCounter: false,
    });
    foundTimer = setTimeout(() => {
      get().acknowledgeFound();
    }, 2000);
  },

  continueSeries: () => {
    const state = get();
    const needed = seriesWinsNeeded(state.seriesFormat);
    if (state.seriesWinsSelf >= needed || state.seriesWinsOpp >= needed) {
      const onComplete = state.onSeriesComplete;
      const wonSeries = state.seriesWinsSelf > state.seriesWinsOpp;
      set({
        phase: "idle",
        queue: null,
        players: [],
        log: [],
        scoreBlue: 0,
        scoreOrange: 0,
        clockSeconds: GAME_DURATION_SECONDS,
        overtime: false,
        otSeconds: 0,
        resultWin: null,
        selfGoals: 0,
        selfSaves: 0,
        seriesFormat: 1,
        seriesWinsSelf: 0,
        seriesWinsOpp: 0,
        seriesGameNumber: 1,
        onSeriesComplete: null,
        fieldX: 50,
        fieldY: 50,
        duelNextAttacker: null,
        duelIsCounter: false,
      });
      onComplete?.(wonSeries);
      return;
    }

    logIdCounter = 0;
    clearAllTimers();
    set({
      phase: "in_match",
      clockSeconds: GAME_DURATION_SECONDS,
      overtime: false,
      otSeconds: 0,
      scoreBlue: 0,
      scoreOrange: 0,
      log: [{ id: logIdCounter++, clockLabel: clockLabel(GAME_DURATION_SECONDS), text: "Kickoff." }],
      resultWin: null,
      selfGoals: 0,
      selfSaves: 0,
      seriesGameNumber: state.seriesGameNumber + 1,
      fieldX: 50,
      fieldY: 50,
      duelNextAttacker: null,
      duelIsCounter: false,
    });
    startTicking(set, get);
  },

  returnToMenu: () => {
    clearAllTimers();
    const autoModes = get().autoQueueModes;
    set({
      phase: "idle",
      queue: null,
      players: [],
      log: [],
      scoreBlue: 0,
      scoreOrange: 0,
      clockSeconds: GAME_DURATION_SECONDS,
      overtime: false,
      otSeconds: 0,
      resultWin: null,
      selfGoals: 0,
      selfSaves: 0,
      seriesFormat: 1,
      seriesWinsSelf: 0,
      seriesWinsOpp: 0,
      seriesGameNumber: 1,
      onSeriesComplete: null,
      fieldX: 50,
      fieldY: 50,
      duelNextAttacker: null,
      duelIsCounter: false,
    });

    // Auto-queue: immediately re-search the same queue(s), built fresh off the live save (rank/stats/party
    // may have changed since the last cycle) rather than replaying a stale snapshot. Only ever fires from
    // here (the plain ranked "Continue" flow), never after a tournament/org/showmatch series.
    if (autoModes && autoModes.length > 0) {
      const save = useSaveStore.getState();
      const era = eraForDate(save.currentDate);
      const partyFriendStats: Record<string, PartyFriendStats> = {};
      for (const name of save.partyMembers) {
        const friend = save.friends[name];
        if (friend) partyFriendStats[name] = { mmr: friend.mmr, gameSense: friend.gameSense, mechanicalConsistency: friend.mechanicalConsistency };
      }
      get().startQueue(
        autoModes.map((q) => buildAutoQueueRequest(save, era, q)),
        save.clockHour,
        era,
        save.seasonNumber,
        save.currentDate.year,
        save.currentDate,
        save.seasonStartDate,
        save.partyMembers,
        partyFriendStats
      );
    }
  },

  setAutoQueueModes: (modes) => set({ autoQueueModes: modes }),
}));
