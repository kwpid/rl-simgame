import { create } from "zustand";
import {
  mockSave as initialSave,
  type QueueMode,
  type RecentMatchEntry,
  type SaveData,
  type FriendRecord,
  type ShowmatchInvite,
  type ShowmatchResultEntry,
  type OrgInvite,
  type OrgTryout,
  type OrgNewsEntry,
  type OrgTier,
  type PlaystyleProfile,
} from "@/data/mockSave";
import { TACTICAL_FOUNDATION_CATEGORIES, type FoundationCategory } from "@/data/mechanics";
import { addDays, daysBetween, type SimDate } from "@/data/dateUtils";
import { eraForDate, deriveRankFromMmr, divisionProgressFromMmr, tierRank, type RankTierId, type RankEra } from "@/data/rankSystem";
import { SEASON_LENGTH_DAYS, seasonEndDate, seasonTitleFor, softResetMmr, applyRewardProgress, rewardTierSequence, REWARD_WINS_REQUIRED, type TitleEntry } from "@/data/seasons";
import { STREAMERS, eligibleStreamers, pickShowmatchOpponent } from "@/data/showmatches";
import {
  meetsOrgRankRequirement,
  orgTalentDetail,
  orgTierForTalent,
  orgScoutingChance,
  resolveTryoutOutcome,
  rollContractLengthSeasons,
  scrimIntervalDaysForTier,
  coachingIntervalDaysForTier,
  bootcampIntervalDaysForTier,
  bootcampScrimWinChance,
  BOOTCAMP_SCRIM_COUNT,
  ORG_TIER_LABELS,
} from "@/data/orgs";
import { ORG_NAMES, saveRegionToProRegion, rlcsSeasonPhase, rlcsSeasonForDate, generateTeamsForRegion } from "@/data/tournaments";
import { QUEUES } from "@/data/queues";
import { PRO_PLAYERS, type ProRegion } from "@/data/proPlayers";
import { useTournamentStore } from "@/store/useTournamentStore";

// The save is now a live, mutable Zustand store instead of a frozen constant. `mockSave` in data/mockSave.ts
// still supplies a placeholder shape at module load (before the real active save finishes loading from
// IndexedDB, see data/saveManager.ts + the app boot flow), every screen reads through this store.

const BASE_TRAINING_GAIN_PER_HOUR = 55;
const FATIGUE_COST_PER_HOUR = 6;
const REST_RECOVERY_PER_HOUR = 15;
const SLEEP_RECOVERY = 45; // a full "End Day" sleep recovers much more than an hourly rest block

// Org-provided Game Sense/Mechanical Consistency training (see attendOrgCoaching/runOrgBootcamp): both run
// at a richer efficiency than a solo training session (a real coach/teammates accelerate learning), and
// both lean specifically into 3v3 since that's the org's actual competitive queue.
const ORG_3V3_EMPHASIS = 1.6;
const ORG_COACHING_HOURS = 3;

// Team chemistry (see OrgContract.chemistry): how well a roster actually plays together, separate from any
// individual player's own skill — a fresh signing barely knows its teammates yet.
const CHEMISTRY_FRESH_SIGNING = 20;
const CHEMISTRY_SCRIM_GAIN_FRACTION = 0.06; // fraction of the remaining gap to 100 closed per ordinary scrim
const CHEMISTRY_BOOTCAMP_GAIN_FRACTION = 0.35; // "a ton of scrims" closes a lot more of that gap at once
const CHEMISTRY_CHURN_RETENTION = 0.5; // a teammate swap (or org promotion) keeps only half of it
const ORG_COACHING_EFFICIENCY = 140;
// A bootcamp's in-fiction length (used for the calendar/fatigue cost) is deliberately separate from its
// training-formula "hours" (used only to size the stat gain) — the gain should read as "a serious multi-day
// block", not scale literally with 96 real hours of the diminishing-returns formula.
const ORG_BOOTCAMP_CALENDAR_DAYS = 4;
const ORG_BOOTCAMP_TRAINING_HOURS = 10;
const ORG_BOOTCAMP_EFFICIENCY = 130;

// EXP only comes from playing ranked, this is the whole point: tactical growth and playlist concepts
// require a Skill Point, and Skill Points only come from leveling up, which only comes from playing.
// 1v1 pays out more per game since it's the harder queue to rank up in, 3v3 slightly less since it's
// the more forgiving/casual-leaning queue.
const WIN_XP = 180;
const LOSS_XP = 70;
const QUEUE_XP_MULTIPLIER: Record<QueueMode, number> = { "1v1": 1.3, "2v2": 1.0, "3v3": 0.85 };
const XP_CURVE_GROWTH = 1.12; // each level requires ~12% more XP than the last
export const PLACEMENT_MMR_AMPLIFIER = 2.5; // placement matches swing MMR harder, same idea as real RL
const RECENT_MATCHES_LIMIT = 10;

// Skill Points come from two sources: a small flat award for just playing ranked (win pays more than a
// loss, so queuing up always moves you forward), plus a bigger lump on every level up.
const SKILL_POINTS_PER_WIN = 2;
const SKILL_POINTS_PER_LOSS = 1;

// Early game should be quick to get into: while a queue's still below Platinum, matches in it pay out
// noticeably more XP and an extra Skill Point per game, so the first stretch of the climb (where a fresh
// character's stats matter most and training options are thinnest) moves fast, then settles back to the
// normal rate once there's a real foundation to build on.
const EARLY_GAME_BOOST_MAX_TIER: RankTierId = "platinum";
const EARLY_GAME_XP_MULTIPLIER = 1.5;
const EARLY_GAME_SP_BONUS = 1;
function skillPointsForLevelUp(): number {
  return 3 + Math.floor(Math.random() * 2); // 3-4
}

// Playing a ranked match builds game sense passively, on top of whatever's trained directly, same
// diminishing curve as everything else but scaled down since it's incidental, not a focused session.
const PASSIVE_GAME_SENSE_HOURS_EQUIV = 0.5;

// 2v2 is the main/most-balanced gamemode, so the rotational and positional game sense it builds carries
// over into 1v1 and 3v3 too, just much more slowly than actually playing those queues directly. Purely
// one-directional: grinding 1v1 or 3v3 doesn't feed anything back into 2v2, habits built around exactly
// one teammate to rotate with don't map cleanly onto either extreme.
const CROSS_QUEUE_CARRYOVER_HOURS_EQUIV = 0.15;

const FRIEND_MOMENTS_LIMIT = 6;
const SHOWMATCH_INVITE_CHECK_INTERVAL_DAYS = 3;
const SHOWMATCH_INVITE_EXPIRY_DAYS = 5;
const SHOWMATCH_HISTORY_LIMIT = 20;

// Org/pro-scene track: a fresh scouting check only rolls every few days (real orgs aren't watching every
// single ranked match you play), an unanswered invite goes stale after a while same as a showmatch one,
// and a tryout runs a handful of scrims before the org actually makes a call on the player.
const ORG_SCOUT_CHECK_INTERVAL_DAYS = 4;
const ORG_INVITE_EXPIRY_DAYS = 6;
const ORG_TRYOUT_SCRIMS_PLANNED = 5;
const ORG_NEWS_LIMIT = 30;
const RECENTLY_PLAYED_WITH_LIMIT = 20;
const MAX_PARTY_MEMBERS = 2; // player + 2 friends = a full 3v3 stack

/** Ties a fresh org invite to one of this season's actual, region-locked real teams (see
 *  data/tournaments.ts's generateTeamsForRegion) instead of a bare org name with independently-picked
 *  teammates — the mismatch that used to let an invite say "Org X" while the tryout/contract named
 *  completely different players than Org X's real roster. Buckets the region's real teams into thirds by
 *  power to land roughly in the right tier (top/mid/bubble), picks one team from that bucket, and takes 2
 *  of its 3 real players as the teammates — the 3rd slot is the one the player is trying out to fill.
 *  Returns null only when the region has no real teams yet at all (too early in a fresh save for enough
 *  pros to have debuted), same "try again later" case pickTryoutTeammates used to guard against. */
function pickRealOrgTeam(
  proRegion: ProRegion,
  tier: OrgTier,
  currentYear: number,
  era: RankEra,
  currentDate: SimDate,
  resetSeed: number
): { orgName: string; teammates: [string, string] } | null {
  const { seasonNumber, seasonStartDate } = rlcsSeasonForDate(currentDate);
  const teams = generateTeamsForRegion(proRegion, currentYear, seasonNumber, resetSeed, "orginvite", era, currentDate, seasonStartDate);
  if (teams.length === 0) return null;
  const sorted = [...teams].sort((a, b) => b.power - a.power);
  const bucketSize = Math.max(1, Math.ceil(sorted.length / 3));
  const bucket =
    tier === "top" ? sorted.slice(0, bucketSize)
    : tier === "mid" ? sorted.slice(bucketSize, bucketSize * 2)
    : sorted.slice(bucketSize * 2);
  const pool = bucket.length > 0 ? bucket : sorted;
  const team = pool[Math.floor(Math.random() * pool.length)];
  const excludedIdx = Math.floor(Math.random() * team.players.length);
  const teammates = team.players.filter((_, i) => i !== excludedIdx);
  if (teammates.length < 2) return null;
  return { orgName: team.name, teammates: [teammates[0], teammates[1]] };
}

/** A real org teammate is either an actual named pro (their own region, from PRO_PLAYERS) or one of the
 *  player's own region's grinders (regionalGrinderRoster only ever draws from that one region, see
 *  eligibleRealPlayersForRegion) — never anything else, so this is a simple either/or, no separate lookup
 *  table needed. */
function resolveTeammateFriendInfo(name: string, proRegion: ProRegion): { region: string; isPro: boolean } {
  const pro = PRO_PLAYERS.find((p) => p.name === name);
  return pro ? { region: pro.region, isPro: true } : { region: proRegion, isPro: false };
}

function fatiguePenalty(fatigue: number): number {
  return Math.max(0.5, 1 - fatigue / 200);
}

// Past roughly the SSL-floor Game Sense level, returns get noticeably harder to squeeze out on top of the
// normal curve below — keeping pace once you're already competing near the top costs real, ongoing
// training investment, not just more of the same easy early gains. Foundation stats/mechanic mastery
// rarely if ever reach this range in practice, so this only actually bites for Game Sense/Mechanical
// Consistency at high-SSL-and-up levels, exactly where it's meant to.
const HIGH_VALUE_STEEPENING_THRESHOLD = 15000;

/** Uncapped stats (game sense, foundation stats, mechanic/concept mastery) all use this same diminishing
 *  curve: big early gains, slow late gains, but never truly capped, and steeper still once a stat is
 *  already deep into SSL-and-up territory (see `HIGH_VALUE_STEEPENING_THRESHOLD`). Scales with hours spent. */
function diminishingGain(currentValue: number, hours: number, efficiencyPct: number, fatigue: number): number {
  const highValueFactor = 1 + Math.max(0, currentValue - HIGH_VALUE_STEEPENING_THRESHOLD) / HIGH_VALUE_STEEPENING_THRESHOLD;
  const diminishing = 3000 / (3000 + currentValue * highValueFactor);
  const efficiency = efficiencyPct / 100;
  const gain = BASE_TRAINING_GAIN_PER_HOUR * hours * diminishing * efficiency * fatiguePenalty(fatigue);
  return Math.max(3, Math.round(gain));
}

/** Playstyle traits are the odd one out: a deliberately capped 0-100 identity slider (see mockSave.ts's
 *  PlaystyleProfile), not an uncapped skill ceiling, so they get their own bounded formula instead of
 *  diminishingGain above. Reshaping who you are as a player costs a Skill Point per session same as any
 *  other deliberate career decision, and gets harder to push the closer you get to either extreme. */
const PLAYSTYLE_TRAIT_GAIN_PER_HOUR = 5;

function playstyleShiftGain(currentValue: number, direction: 1 | -1, hours: number, fatigue: number): number {
  const roomLeft = direction > 0 ? 100 - currentValue : currentValue;
  const diminishing = Math.max(0.15, roomLeft / 100);
  const gain = PLAYSTYLE_TRAIT_GAIN_PER_HOUR * hours * diminishing * fatiguePenalty(fatigue);
  return Math.max(1, Math.round(gain));
}

export interface MatchResultInput {
  queue: QueueMode;
  win: boolean;
  mmrDelta: number;
  scoreSelf: number;
  scoreOpp: number;
  selfGoals: number;
  selfSaves: number;
  note: string;
  /** Every other player's name from this match (teammates and opponents alike), shown in the Recent
   *  Matches list and clickable there to pull up that name's stats (see AiProfileModal.tsx). */
  opponentNames: string[];
}

interface SaveStoreState extends SaveData {
  /** Wholesale-replaces every data field with a loaded save, action functions stay put. Called once by
   *  the app boot flow after loading from IndexedDB (or creating a fresh save). */
  initFromSave: (data: SaveData) => void;

  /** Applies a ranked match result: MMR (amplified during placements), division progress, career
   *  W/L/goals/saves, a recentMatches entry, peak-rank tracking, and the EXP/level/Skill Point payout.
   *  Placements: while a queue still has `placementMatchesRemaining`, division/tier don't move, MMR
   *  swings are bigger, and once the last placement match finishes, the real rank is derived from
   *  final MMR via `deriveRankFromMmr` and recorded as this season's peak. */
  recordMatchResult: (input: MatchResultInput) => void;
  /** Changes the free-text display name shown everywhere in-game (leaderboards, matches, tournaments),
   *  unlike `username` (the fixed account id, letters/digits only) this can be anything and changed any
   *  time. A blank/whitespace-only value is ignored rather than leaving the player with an empty name. */
  setDisplayName: (name: string) => void;
  /** Which regions GC+/SSL ranked matchmaking draws real named opponents from (see useMatchStore.ts's
   *  pickName/gatherEligibleOpponents) — account-wide, not per-queue. Ignored below GC. */
  setSelectedMatchmakingRegions: (regions: ProRegion[]) => void;
  /** Dev-only: bumps `rlcsTeamsResetSeed` so every region's real RLCS roster reshuffles from scratch (see
   *  data/tournaments.ts's generateTeamsForRegion/generateGlobalTeams), and also wipes every tracked
   *  tournament instance (a roster change invalidates any in-progress bracket) — a fresh-team test run
   *  without needing a whole new save. */
  resetRlcsTeams: () => void;
  setEquippedTitleId: (id: string | null) => void;
  /** Adds a title to the player's collection if they don't already have it (deduped by id). Used for
   *  tournament results, competitive titles are earned once and kept forever, same as season titles. */
  addTitle: (title: TitleEntry) => void;
  /** Clears the season-rollover popup once the player has seen it. */
  dismissSeasonAnnouncement: () => void;
  /** Clears the placement-result reveal / rank-up animation trigger once the Ranked screen has shown it. */
  dismissPendingPlacementResult: () => void;
  dismissPendingPromotion: () => void;

  /** Adds a name (a pro or a leaderboard filler regular) as a friend, no-op if already added. */
  addFriend: (name: string, region: string, isPro: boolean, currentDate: SimDate) => void;
  removeFriend: (name: string) => void;
  /** Records one match's outcome against/with a friend, if `name` isn't a current friend this is a no-op. */
  recordFriendMatch: (name: string, relation: "against" | "with", win: boolean, note: string) => void;
  /** Updates a "plain" friend's persisted per-queue MMR/stats after a match they were actually in: `mmrDelta`
   *  is the same signed Elo delta a real ranked result would apply (positive for them winning, already
   *  accounting for which team they were on), Game Sense/Mechanical Consistency both creep up a little
   *  from ordinary play regardless of the result, same passive growth the player's own stats get. No-op
   *  if `name` isn't a current friend. */
  applyFriendMatchStats: (name: string, queue: QueueMode, mmrDelta: number) => void;
  /** Moves each name to the front of the "recently played with" list (opponents and teammates alike),
   *  deduped, capped short. This is what the Social screen's Add Friend list is drawn from. */
  recordRecentlyPlayedWith: (names: string[]) => void;

  /** Adds a friend to the player's ranked party (max 2, a full 3v3 stack), no-op if not a friend, already
   *  partied, or the party's already full. */
  invitePartyMember: (name: string) => void;
  removePartyMember: (name: string) => void;
  clearParty: () => void;

  /** Date-gated (checks at most every few in-game days): rolls whether a streamer whose 1v1 band fits
   *  the player's current level books a showmatch. Only one pending invite at a time, an unanswered one
   *  simply expires after a few days rather than piling up. Call from a `useEffect`, never render-time. */
  ensureShowmatchInvitations: (currentDate: SimDate, era: RankEra, currentYear: number) => void;
  /** Dismisses the current invite without playing it, no penalty, showmatches are opt-in. */
  declineShowmatchInvite: () => void;
  /** Grants the Fame reward and logs the result, called once the exhibition match itself (run through
   *  useMatchStore like a tournament series) actually completes. */
  recordShowmatchResult: (win: boolean) => void;

  /** Org/pro-scene track, entirely separate from ranked (see mockSave.ts's OrgContract doc comment).
   *  Date-gated same as showmatches: 2v2 rank is a simple hard gate (meetsOrgRankRequirement), then the
   *  player's ACTUAL stats compared against top-player caliber (data/orgs.ts's orgTalentDetail) decide
   *  both the odds of a scouting invite firing at all and which tier of org does the scouting. No-op while
   *  a contract, tryout, or unanswered invite is already active — only one thing happening at a time. */
  ensureOrgScouting: (currentDate: SimDate, era: RankEra, currentYear: number) => void;
  /** Dev-tools-only escape hatch for testing the org track: creates a pending invite immediately, ignoring
   *  every real-world gate ensureOrgScouting applies (RLCS phase, rank floor, scout-check cooldown, the
   *  random chance roll) and clearing whatever invite/tryout/contract already exists so it always produces
   *  a fresh one. Tier is still computed from the player's actual talent, same as a real invite. */
  forceOrgInvite: (currentDate: SimDate, era: RankEra, currentYear: number) => void;
  declineOrgInvite: () => void;
  /** Accepts the pending invite and starts the tryout, using the exact teammates already carried on the
   *  invite (see OrgInvite's doc comment) — always 2 of the 3 real players on that org's actual current
   *  roster, so the tryout/contract never names anyone other than who the invite itself said. */
  acceptOrgInvite: (currentDate: SimDate) => void;
  /** Records one scrim's result during an active tryout. Once every planned scrim has been played, the
   *  overall win rate decides the outcome (signed as a starter, kept on as a sub, or cut back to free
   *  agency) via `resolveTryoutOutcome`, posting the result to Org News either way. `rlcsSeasonNumber` is
   *  only used to stamp a new contract's `signedSeason`, irrelevant otherwise. */
  recordOrgTryoutScrim: (won: boolean, currentDate: SimDate, rlcsSeasonNumber: number) => void;
  /** Records one ongoing scrim's result for an already-signed contract (separate running record from the
   *  tryout's), and schedules the next one. This record is what `resolveContractRenewal` judges once the
   *  contract's length runs out. No-op without an active contract. */
  recordOrgScrimResult: (won: boolean, currentDate: SimDate) => void;
  /** Ends the contract (a release, judged by `resolveContractRenewal`): back to free agency, same eligibility
   *  gate as the first signing applies again from here. */
  releaseOrgContract: (currentDate: SimDate) => void;
  /** Renews (in place, or at a new/better org if promoted) with a fresh scrim record and contract length.
   *  `newOrgName`/`newTier`/`newTeammates` are computed by the caller (OrgScreen.tsx, needs live pro-
   *  leaderboard lookups for a churned teammate the same way accepting an invite does). */
  renewOrgContract: (currentDate: SimDate, newOrgName: string, newTier: OrgTier, newTeammates: [string, string]) => void;
  /** A routine perk of being signed to an org: a coaching session bumps Game Sense and Mechanical
   *  Consistency in all three queues (Game Sense leaning hardest into 3v3, the org's own competitive
   *  queue), gated to a tryout-free `orgContract` (a tryout doesn't qualify) and a per-tier cooldown (see
   *  coachingIntervalDaysForTier). Returns null (no-op) if not signed or still on cooldown. */
  attendOrgCoaching: () => { gameSense: Record<QueueMode, number>; mechanicalConsistency: Record<QueueMode, number> } | null;
  /** "A ton of scrims" in one intensive multi-day block: resolves BOOTCAMP_SCRIM_COUNT scrims at once
   *  (rolled abstractly, not played live) into the contract's running scrim record, plus a bigger Game
   *  Sense/Mechanical Consistency bump than a single coaching session (again leaning into 3v3). Same signed-
   *  contract gate as coaching, on its own (much longer) per-tier cooldown. Returns null if not signed or
   *  still on cooldown. */
  runOrgBootcamp: () => { scrimWins: number; scrimLosses: number; gameSense: Record<QueueMode, number>; mechanicalConsistency: Record<QueueMode, number> } | null;

  /** All three roll the clock forward and, if enough days pass, process one or more ranked-season
   *  rollovers (soft MMR reset, fresh placements, season-title/reward payout) via `processSeasonRollover`. */
  advanceClock: (hours: number) => void;
  /** Same as `advanceClock` but for anything measured in minutes rather than whole hours, e.g. a ranked
   *  match's real queue time + the match itself. */
  advanceMinutes: (minutes: number) => void;
  rest: (hours: number) => void;
  sleepToNextDay: () => void;

  /** Freeplay-trainable, no Skill Point cost, just hours + fatigue, same as before. */
  trainMechanic: (id: string, efficiencyPct: number, hours?: number) => number;
  /** One freeplay session working several mechanics at once instead of one at a time. The session's
   *  total hours are split evenly across every selected mechanic (bouncing between them, not each
   *  getting the full duration), so grouping mechanics together is a convenience, not a way to get more
   *  total training out of the same block of time. Clock advances once for the whole session, not once
   *  per mechanic. Returns the gain for each mechanic id. */
  trainMechanicsGroup: (entries: { id: string; efficiencyPct: number }[], hours?: number) => Record<string, number>;
  /** Costs 1 Skill Point for the four Tactical categories (boostManagement/offense/defense/passing),
   *  free for the two Mechanical ones (carControl/aerialControl). Returns 0 without mutating anything
   *  if a Tactical session is attempted with no Skill Points, callers should check `skillPoints > 0`
   *  before offering the button in the first place rather than relying on this as the only gate. */
  trainFoundationStat: (category: FoundationCategory, hours?: number) => number;
  /** Always costs 1 Skill Point, queue concepts are tactical/mental by definition, same 0-without-Skill-
   *  Points behavior as the Tactical foundation stats. */
  trainQueueConcept: (id: string, efficiencyPct: number, hours?: number) => number;
  /** Nudges one playstyle trait for one queue toward (direction 1) or away from (direction -1) 100, costs
   *  1 Skill Point per session same as a Tactical/Playlist session. Returns the magnitude actually gained
   *  (always >= 0, direction decides which way it was applied), or 0 if out of Skill Points. */
  trainPlaystyleTrait: (queue: QueueMode, trait: keyof PlaystyleProfile, direction: 1 | -1, hours?: number) => number;

  /** Dev-mode only testing shortcuts, gated behind the Developer Mode toggle in Settings. None of these
   *  cost time, fatigue, or Skill Points, they're for jumping straight to a game state to test against. */
  devAddGameSense: (queue: QueueMode, amount: number) => void;
  devAddMechanicalConsistency: (queue: QueueMode, amount: number) => void;
  /** Sets one queue's Game Sense/Mechanical Consistency to an exact value (not additive), for testing any
   *  arbitrary skill level rather than only nudging up by a fixed amount. */
  devSetGameSense: (queue: QueueMode, value: number) => void;
  devSetMechanicalConsistency: (queue: QueueMode, value: number) => void;
  devMaxFoundationStats: () => void;
  devMaxMechanics: () => void;
  devMaxQueueConcepts: () => void;
  /** Sets one specific mechanic's or foundation stat's mastery to an exact value, for testing a single
   *  mechanic/stat's efficiency or unlock state without touching everything else. */
  devSetMechanic: (id: string, value: number) => void;
  /** Rolls a fresh independent random value between min and max (inclusive) for every mechanic, for
   *  quickly testing a believable, varied save instead of every mechanic sitting at the same number. */
  devRandomizeMechanics: (min: number, max: number) => void;
  devSetQueueConcept: (id: string, value: number) => void;
  /** Same idea as `devRandomizeMechanics` but for playlist concepts: a fresh independent random value
   *  between min and max (inclusive) for every queue concept. */
  devRandomizeQueueConcepts: (min: number, max: number) => void;
  devSetFoundationStat: (category: FoundationCategory, value: number) => void;
  devAddSkillPoints: (amount: number) => void;
  /** Sets a queue's MMR directly and re-derives rank/division from it via the same bracket table live
   *  matches use, clearing placements and bumping peak rank if this is a new high. */
  devSetMmr: (queue: QueueMode, mmr: number) => void;
  devSetRewardLevel: (tier: RankTierId, winsProgress: number) => void;
}

function rollClock(
  currentDate: SimDate,
  clockHour: number,
  clockMinute: number,
  minutesToAdd: number
): { currentDate: SimDate; clockHour: number; clockMinute: number } {
  const totalMinutes = clockHour * 60 + clockMinute + minutesToAdd;
  const daysPassed = Math.floor(totalMinutes / 1440);
  const minutesIntoDay = ((totalMinutes % 1440) + 1440) % 1440;
  return {
    currentDate: daysPassed > 0 ? addDays(currentDate, daysPassed) : currentDate,
    clockHour: Math.floor(minutesIntoDay / 60),
    clockMinute: minutesIntoDay % 60,
  };
}

function applyExp(state: SaveData, amount: number): Pick<SaveData, "xp" | "xpToNextLevel" | "level" | "skillPoints"> {
  let { xp, xpToNextLevel, level, skillPoints } = state;
  xp += amount;
  while (xp >= xpToNextLevel) {
    xp -= xpToNextLevel;
    level += 1;
    skillPoints += skillPointsForLevelUp();
    xpToNextLevel = Math.round(xpToNextLevel * XP_CURVE_GROWTH);
  }
  return { xp, xpToNextLevel, level, skillPoints };
}

/** Checks whether enough days have passed since `seasonStartDate` for one or more ranked seasons to have
 *  ended, and if so, applies the full rollover to every queue: soft MMR reset, fresh placements, a
 *  season-end title (only Grand Champion/Supersonic Legend qualify) if not already owned, and the shared
 *  season number (which resets to 1 the first time a season ends inside the modern/SSL era). Handles
 *  more than one rollover in a single big time jump via the guarded loop. Returns null if no season ended. */
function processSeasonRollover(state: SaveData, newDate: SimDate): Partial<SaveData> | null {
  let seasonStartDate = state.seasonStartDate;
  let seasonNumber = state.seasonNumber;
  let seasonNumberingReset = state.seasonNumberingReset;
  let rankedProfiles = state.rankedProfiles;
  let titles = state.titles;
  let seasonRewardTier = state.seasonRewardTier;
  let rewardTierUnlocked = state.rewardTierUnlocked;
  let rewardProgressByTier = state.rewardProgressByTier;
  let seasonHistory = state.seasonHistory;
  let rolledAtLeastOnce = false;
  let sslIntroducedAnyRollover = false;
  let lastRewardTierAchieved: RankTierId = rewardTierUnlocked;

  let guard = 0;
  while (daysBetween(seasonStartDate, newDate) >= SEASON_LENGTH_DAYS && guard < 10) {
    guard++;
    rolledAtLeastOnce = true;
    const endDate = seasonEndDate(seasonStartDate);
    const era = eraForDate(endDate);

    const newTitles: TitleEntry[] = [];
    const nextProfiles = { ...rankedProfiles };
    const seasonPeaks = {} as Record<QueueMode, { tier: RankTierId; division: number }>;
    (Object.keys(rankedProfiles) as QueueMode[]).forEach((q) => {
      const p = rankedProfiles[q];
      seasonPeaks[q] = { tier: p.peakRankTier, division: p.peakDivision };
      const earned = seasonTitleFor(seasonNumber, era, p.peakRankTier);
      if (earned && !titles.some((t) => t.id === earned.id) && !newTitles.some((t) => t.id === earned.id)) {
        newTitles.push(earned);
      }
      nextProfiles[q] = {
        ...p,
        mmr: softResetMmr(p.mmr),
        rankTier: "unranked",
        division: 0,
        divisionProgress: 0,
        seasonMatchesPlayed: 0,
        placementMatchesRemaining: 10,
        peakRankTier: "unranked",
        peakDivision: 0,
        streakType: null,
        streakCount: 0,
      };
    });

    const crossingToModern = era === "modern" && !seasonNumberingReset;
    if (crossingToModern) sslIntroducedAnyRollover = true;

    rankedProfiles = nextProfiles;
    titles = [...titles, ...newTitles];
    lastRewardTierAchieved = rewardTierUnlocked;
    seasonHistory = [...seasonHistory, { seasonNumber, era, endDate, peaks: seasonPeaks, rewardTierAchieved: rewardTierUnlocked }];
    seasonRewardTier = tierRank(rewardTierUnlocked);
    rewardTierUnlocked = "unranked";
    rewardProgressByTier = {};
    seasonNumber = crossingToModern ? 1 : seasonNumber + 1;
    seasonNumberingReset = seasonNumberingReset || era === "modern";
    seasonStartDate = endDate;
  }

  if (!rolledAtLeastOnce) return null;
  return {
    seasonNumber,
    seasonStartDate,
    seasonNumberingReset,
    rankedProfiles,
    titles,
    seasonRewardTier,
    rewardTierUnlocked,
    rewardProgressByTier,
    seasonHistory,
    pendingSeasonAnnouncement: {
      seasonNumber,
      sslIntroduced: sslIntroducedAnyRollover,
      rewardTierAchieved: lastRewardTierAchieved,
    },
  };
}

/** Rolls the clock forward by `hours` and layers a season-rollover patch on top if one or more ranked
 *  seasons ended in the process. Every action that advances time should merge this into its `set` call. */
function withDateAdvance(state: SaveData, hours: number): Partial<SaveData> {
  return withMinuteAdvance(state, hours * 60);
}

/** Same as `withDateAdvance`, but at minute granularity, for anything that doesn't advance in clean whole
 *  hours (a ranked match's queue time + the match itself, see MatchScreen's `handleContinue`). */
function withMinuteAdvance(state: SaveData, minutes: number): Partial<SaveData> {
  const { currentDate, clockHour, clockMinute } = rollClock(state.currentDate, state.clockHour, state.clockMinute, minutes);
  const seasonPatch = processSeasonRollover(state, currentDate);
  return { currentDate, clockHour, clockMinute, ...(seasonPatch ?? {}) };
}

export const useSaveStore = create<SaveStoreState>((set, get) => ({
  ...initialSave,

  initFromSave: (data) => set({ ...data }),

  recordMatchResult: ({ queue, win, mmrDelta, scoreSelf, scoreOpp, selfGoals, selfSaves, note, opponentNames }) => {
    const state = get();
    const profile = state.rankedProfiles[queue];
    const careerStats = state.careerStats[queue];
    const isEarlyGame = tierRank(profile.rankTier) < tierRank(EARLY_GAME_BOOST_MAX_TIER);
    const expGain = Math.round((win ? WIN_XP : LOSS_XP) * QUEUE_XP_MULTIPLIER[queue] * (isEarlyGame ? EARLY_GAME_XP_MULTIPLIER : 1));
    const inPlacements = profile.placementMatchesRemaining > 0;
    const placementsRemaining = Math.max(0, profile.placementMatchesRemaining - 1);
    const justFinishedPlacements = inPlacements && placementsRemaining === 0;

    const newMmr = Math.max(0, Math.round(profile.mmr + mmrDelta * (inPlacements ? PLACEMENT_MMR_AMPLIFIER : 1)));
    const isNewPeakMmr = newMmr > profile.peakMmr;
    const era = eraForDate(state.currentDate);
    // Tier/division come straight from the new MMR every match (once placements are done), not an
    // independently win/loss-incremented pip counter — that used to be able to drift arbitrarily far from
    // what the player's actual MMR said (a win streak against weak opponents could pip-promote someone
    // through Champion/GC while their real Elo-based MMR barely moved, or the reverse), which is exactly
    // why the same raw MMR could show Grand Champion one match and Champion III another. Deriving both
    // tier and pip progress from MMR every time makes them agree by construction, and matches the Stats
    // screen's own MMR-floor numbers exactly, no separate system to drift out of sync with it.
    const stillInPlacements = inPlacements && !justFinishedPlacements;
    const derived = stillInPlacements ? null : deriveRankFromMmr(newMmr, era, queue);
    const nextRankTier = derived?.tier ?? profile.rankTier;
    const nextDivision = derived?.division ?? profile.division;
    const nextDivisionProgress = inPlacements ? 0 : divisionProgressFromMmr(newMmr, era, queue);
    const isNewPeakRank = tierRank(nextRankTier) > tierRank(profile.peakRankTier) || (nextRankTier === profile.peakRankTier && nextDivision > profile.peakDivision);

    // Streak resets to 1 of the opposite type the moment it breaks, otherwise extends.
    const nextStreakType: "win" | "loss" = win ? "win" : "loss";
    const nextStreakCount = profile.streakType === nextStreakType ? profile.streakCount + 1 : 1;

    // A promotion (tier or division actually went up, from ordinary play, not placements which get their
    // own reveal below) triggers a one-off rank-up animation on the Ranked screen.
    const isPromotionEvent =
      !stillInPlacements &&
      !justFinishedPlacements &&
      (tierRank(nextRankTier) > tierRank(profile.rankTier) || (nextRankTier === profile.rankTier && nextDivision > profile.division));

    // Reward level is account-wide, not per-playlist: a win in ANY queue counts, gated by the live rank
    // in THAT queue. Only progresses on wins, at or above the current live rank, never during placements
    // (no stable rank to check against yet), matching real RL exactly.
    const rewardProgress =
      win && !inPlacements
        ? applyRewardProgress(era, nextRankTier, tierRank, {
            rewardTierUnlocked: state.rewardTierUnlocked,
            rewardProgressByTier: state.rewardProgressByTier,
          })
        : { rewardTierUnlocked: state.rewardTierUnlocked, rewardProgressByTier: state.rewardProgressByTier };

    const recentEntry: RecentMatchEntry = {
      queue,
      result: win ? "win" : "loss",
      score: `${scoreSelf}-${scoreOpp}`,
      note,
      opponents: opponentNames,
    };

    set({
      rankedProfiles: {
        ...state.rankedProfiles,
        [queue]: {
          ...profile,
          mmr: newMmr,
          rankTier: nextRankTier,
          division: nextDivision,
          divisionProgress: nextDivisionProgress,
          seasonMatchesPlayed: profile.seasonMatchesPlayed + 1,
          placementMatchesRemaining: placementsRemaining,
          peakRankTier: isNewPeakRank ? nextRankTier : profile.peakRankTier,
          peakDivision: isNewPeakRank ? nextDivision : profile.peakDivision,
          peakMmr: isNewPeakMmr ? newMmr : profile.peakMmr,
          peakMmrSeason: isNewPeakMmr ? state.seasonNumber : profile.peakMmrSeason,
          streakType: nextStreakType,
          streakCount: nextStreakCount,
        },
      },
      rewardTierUnlocked: rewardProgress.rewardTierUnlocked,
      rewardProgressByTier: rewardProgress.rewardProgressByTier,
      pendingPlacementResult: justFinishedPlacements
        ? { queue, tier: nextRankTier, division: nextDivision, mmr: newMmr }
        : state.pendingPlacementResult,
      pendingPromotion: isPromotionEvent ? { queue, tier: nextRankTier, division: nextDivision } : state.pendingPromotion,
      careerStats: {
        ...state.careerStats,
        [queue]: {
          ...careerStats,
          wins: careerStats.wins + (win ? 1 : 0),
          losses: careerStats.losses + (win ? 0 : 1),
          goals: careerStats.goals + selfGoals,
          saves: careerStats.saves + selfSaves,
        },
      },
      recentMatches: [recentEntry, ...state.recentMatches].slice(0, RECENT_MATCHES_LIMIT),
      // Passive game sense growth from just playing lands on the queue actually played, not account-wide,
      // this is exactly what makes a queue you grind pull ahead of your other playlists over time.
      player: {
        ...state.player,
        gameSense: {
          ...state.player.gameSense,
          [queue]: state.player.gameSense[queue] + diminishingGain(state.player.gameSense[queue], PASSIVE_GAME_SENSE_HOURS_EQUIV, 100, state.player.fatigue),
          ...(queue === "2v2"
            ? {
                "1v1": state.player.gameSense["1v1"] + diminishingGain(state.player.gameSense["1v1"], CROSS_QUEUE_CARRYOVER_HOURS_EQUIV, 100, state.player.fatigue),
                "3v3": state.player.gameSense["3v3"] + diminishingGain(state.player.gameSense["3v3"], CROSS_QUEUE_CARRYOVER_HOURS_EQUIV, 100, state.player.fatigue),
              }
            : {}),
        },
        // Mechanical Consistency's only real growth path used to be dev tools, actually playing ranked
        // matches builds it passively too, same shape (and same 2v2-leads carryover) as Game Sense above,
        // reps under real pressure sharpen execution reliability same as they sharpen decision-making.
        mechanicalConsistency: {
          ...state.player.mechanicalConsistency,
          [queue]:
            state.player.mechanicalConsistency[queue] +
            diminishingGain(state.player.mechanicalConsistency[queue], PASSIVE_GAME_SENSE_HOURS_EQUIV, 100, state.player.fatigue),
          ...(queue === "2v2"
            ? {
                "1v1":
                  state.player.mechanicalConsistency["1v1"] +
                  diminishingGain(state.player.mechanicalConsistency["1v1"], CROSS_QUEUE_CARRYOVER_HOURS_EQUIV, 100, state.player.fatigue),
                "3v3":
                  state.player.mechanicalConsistency["3v3"] +
                  diminishingGain(state.player.mechanicalConsistency["3v3"], CROSS_QUEUE_CARRYOVER_HOURS_EQUIV, 100, state.player.fatigue),
              }
            : {}),
        },
      },
      ...(() => {
        const expResult = applyExp(state, expGain);
        const spGain = (win ? SKILL_POINTS_PER_WIN : SKILL_POINTS_PER_LOSS) + (isEarlyGame ? EARLY_GAME_SP_BONUS : 0);
        return { ...expResult, skillPoints: expResult.skillPoints + spGain };
      })(),
    });
  },

  setDisplayName: (name) => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    set({ displayName: trimmed.slice(0, 24) });
  },
  setSelectedMatchmakingRegions: (regions) => set({ selectedMatchmakingRegions: regions.length > 0 ? regions : get().selectedMatchmakingRegions }),
  resetRlcsTeams: () => {
    const state = get();
    // The player's own org career (contract/tryout/invite) was picked independently of the generated team
    // rosters (see OrgScreen.tsx's pickOrgPros) — reset it too, otherwise "Reset Teams" would regenerate
    // every AI team while the player stayed parked on whatever org/teammates they'd already signed with
    // before this system existed, which isn't a real fresh-team test run at all.
    set({
      rlcsTeamsResetSeed: state.rlcsTeamsResetSeed + 1,
      pendingOrgInvite: null,
      pendingOrgTryout: null,
      orgContract: null,
    });
    useTournamentStore.getState().resetAllInstances();
  },
  setEquippedTitleId: (id) => set({ equippedTitleId: id }),
  dismissSeasonAnnouncement: () => set({ pendingSeasonAnnouncement: null }),
  dismissPendingPlacementResult: () => set({ pendingPlacementResult: null }),
  dismissPendingPromotion: () => set({ pendingPromotion: null }),

  addTitle: (title) => {
    const state = get();
    if (state.titles.some((t) => t.id === title.id)) return;
    set({ titles: [...state.titles, title] });
  },

  addFriend: (name, region, isPro, currentDate) => {
    const state = get();
    if (state.friends[name]) return;
    // Seeded near the player's own current level, per queue, since that's realistically how they were
    // encountered — a fresh friend isn't some wildly different rank, and a real pro/leaderboard-tracked
    // friend's actual in-match stats defer to their own dedicated store anyway (see FriendRecord's doc
    // comment), these seeds only ever end up mattering for a "plain" friend.
    const seedFor = (queue: QueueMode, base: number) => Math.max(0, Math.round(base * (0.9 + Math.random() * 0.2)));
    const record: FriendRecord = {
      name,
      region,
      isPro,
      addedDate: currentDate,
      winsAgainst: 0,
      lossesAgainst: 0,
      winsWith: 0,
      lossesWith: 0,
      moments: [],
      mmr: {
        "1v1": seedFor("1v1", state.rankedProfiles["1v1"].mmr),
        "2v2": seedFor("2v2", state.rankedProfiles["2v2"].mmr),
        "3v3": seedFor("3v3", state.rankedProfiles["3v3"].mmr),
      },
      gameSense: {
        "1v1": seedFor("1v1", state.player.gameSense["1v1"]),
        "2v2": seedFor("2v2", state.player.gameSense["2v2"]),
        "3v3": seedFor("3v3", state.player.gameSense["3v3"]),
      },
      mechanicalConsistency: {
        "1v1": seedFor("1v1", state.player.mechanicalConsistency["1v1"]),
        "2v2": seedFor("2v2", state.player.mechanicalConsistency["2v2"]),
        "3v3": seedFor("3v3", state.player.mechanicalConsistency["3v3"]),
      },
      peakMmr: {
        "1v1": seedFor("1v1", state.rankedProfiles["1v1"].mmr),
        "2v2": seedFor("2v2", state.rankedProfiles["2v2"].mmr),
        "3v3": seedFor("3v3", state.rankedProfiles["3v3"].mmr),
      },
    };
    set({ friends: { ...state.friends, [name]: record } });
  },

  removeFriend: (name) => {
    const state = get();
    if (!state.friends[name]) return;
    const next = { ...state.friends };
    delete next[name];
    set({ friends: next, partyMembers: state.partyMembers.filter((n) => n !== name) });
  },

  recordFriendMatch: (name, relation, win, note) => {
    const state = get();
    const friend = state.friends[name];
    if (!friend) return;
    const moments = [note, ...friend.moments].slice(0, FRIEND_MOMENTS_LIMIT);
    const next: FriendRecord =
      relation === "against"
        ? { ...friend, winsAgainst: friend.winsAgainst + (win ? 1 : 0), lossesAgainst: friend.lossesAgainst + (win ? 0 : 1), moments }
        : { ...friend, winsWith: friend.winsWith + (win ? 1 : 0), lossesWith: friend.lossesWith + (win ? 0 : 1), moments };
    set({ friends: { ...state.friends, [name]: next } });
  },

  applyFriendMatchStats: (name, queue, mmrDelta) => {
    const state = get();
    const friend = state.friends[name];
    if (!friend) return;
    const nextGameSense = friend.gameSense[queue] + diminishingGain(friend.gameSense[queue], PASSIVE_GAME_SENSE_HOURS_EQUIV, 100, 0);
    const nextMech = friend.mechanicalConsistency[queue] + diminishingGain(friend.mechanicalConsistency[queue], PASSIVE_GAME_SENSE_HOURS_EQUIV, 100, 0);
    const nextMmr = Math.max(0, friend.mmr[queue] + mmrDelta);
    const next: FriendRecord = {
      ...friend,
      mmr: { ...friend.mmr, [queue]: nextMmr },
      gameSense: { ...friend.gameSense, [queue]: nextGameSense },
      mechanicalConsistency: { ...friend.mechanicalConsistency, [queue]: nextMech },
      peakMmr: { ...friend.peakMmr, [queue]: Math.max(friend.peakMmr?.[queue] ?? 0, nextMmr) },
    };
    set({ friends: { ...state.friends, [name]: next } });
  },

  recordRecentlyPlayedWith: (names) => {
    if (names.length === 0) return;
    const state = get();
    const deduped = [...names, ...state.recentlyPlayedWith].filter((n, i, arr) => arr.indexOf(n) === i);
    set({ recentlyPlayedWith: deduped.slice(0, RECENTLY_PLAYED_WITH_LIMIT) });
  },

  invitePartyMember: (name) => {
    const state = get();
    if (!state.friends[name]) return;
    if (state.partyMembers.includes(name)) return;
    if (state.partyMembers.length >= MAX_PARTY_MEMBERS) return;
    set({ partyMembers: [...state.partyMembers, name] });
  },

  removePartyMember: (name) => {
    const state = get();
    set({ partyMembers: state.partyMembers.filter((n) => n !== name) });
  },

  clearParty: () => set({ partyMembers: [] }),

  ensureShowmatchInvitations: (currentDate, era, currentYear) => {
    const state = get();
    // An expired, unanswered invite just quietly goes away, real streamers don't hold a slot forever.
    if (state.pendingShowmatchInvite && daysBetween(state.pendingShowmatchInvite.expiresDate, currentDate) >= 0) {
      set({ pendingShowmatchInvite: null });
      return;
    }
    if (state.pendingShowmatchInvite) return; // already have one to answer
    if (daysBetween(state.lastShowmatchInviteCheckDate, currentDate) < SHOWMATCH_INVITE_CHECK_INTERVAL_DAYS) return;

    const profile = state.rankedProfiles["1v1"];
    const candidates = profile.placementMatchesRemaining > 0 ? [] : eligibleStreamers(profile.mmr, profile.rankTier, era);
    const picked = candidates.length > 0 ? candidates[Math.floor(Math.random() * candidates.length)] : null;
    const streamer = picked && Math.random() < picked.inviteChance ? picked : null;

    if (!streamer) {
      set({ lastShowmatchInviteCheckDate: currentDate });
      return;
    }

    const invite: ShowmatchInvite = {
      id: `showmatch_${streamer.id}_${currentDate.year}${currentDate.month}${currentDate.day}`,
      streamerId: streamer.id,
      opponentName: pickShowmatchOpponent(streamer.id, currentYear),
      offeredDate: currentDate,
      expiresDate: addDays(currentDate, SHOWMATCH_INVITE_EXPIRY_DAYS),
    };
    set({ pendingShowmatchInvite: invite, lastShowmatchInviteCheckDate: currentDate });
  },

  declineShowmatchInvite: () => set({ pendingShowmatchInvite: null }),

  recordShowmatchResult: (win) => {
    const state = get();
    const invite = state.pendingShowmatchInvite;
    if (!invite) return;
    const streamer = STREAMERS.find((s) => s.id === invite.streamerId);
    const fameGained = win ? streamer?.fameReward.win ?? 0 : streamer?.fameReward.loss ?? 0;
    const entry: ShowmatchResultEntry = {
      streamerId: invite.streamerId,
      opponentName: invite.opponentName,
      win,
      fameGained,
      date: state.currentDate,
    };
    set({
      pendingShowmatchInvite: null,
      showmatchHistory: [entry, ...state.showmatchHistory].slice(0, SHOWMATCH_HISTORY_LIMIT),
      player: { ...state.player, fame: state.player.fame + fameGained },
    });
  },

  ensureOrgScouting: (currentDate, era, currentYear) => {
    const state = get();
    if (state.pendingOrgInvite && daysBetween(state.pendingOrgInvite.expiresDate, currentDate) >= 0) {
      set({ pendingOrgInvite: null });
      return;
    }
    if (state.pendingOrgInvite || state.pendingOrgTryout || state.orgContract) return; // one thing at a time
    // Real orgs don't sign new players mid-split — scouting only happens at all during the RLCS off-season
    // (an already-signed contract rides out its season untouched regardless, see releaseOrgContract/
    // renewOrgContract, this only gates whether a FRESH invite can appear).
    if (rlcsSeasonPhase(currentDate) === "in_season") return;
    if (daysBetween(state.lastOrgScoutCheckDate, currentDate) < ORG_SCOUT_CHECK_INTERVAL_DAYS) return;

    const profile = state.rankedProfiles["2v2"];
    if (profile.placementMatchesRemaining > 0 || !meetsOrgRankRequirement(era, profile.mmr)) {
      set({ lastOrgScoutCheckDate: currentDate });
      return;
    }

    const talent = orgTalentDetail(era, currentYear, state.foundationStats, state.player.mechanicalConsistency["2v2"], state.player.gameSense["2v2"]);
    if (Math.random() > orgScoutingChance(talent.overallScore)) {
      set({ lastOrgScoutCheckDate: currentDate });
      return;
    }

    const tier = orgTierForTalent(talent.overallScore);
    const proRegion = saveRegionToProRegion(state.region);
    const picked = pickRealOrgTeam(proRegion, tier, currentYear, era, currentDate, state.rlcsTeamsResetSeed);
    if (!picked) {
      set({ lastOrgScoutCheckDate: currentDate });
      return;
    }
    const invite: OrgInvite = {
      id: `org_${picked.orgName.replace(/\s+/g, "_")}_${currentDate.year}${currentDate.month}${currentDate.day}`,
      orgName: picked.orgName,
      tier,
      teammates: picked.teammates,
      offeredDate: currentDate,
      expiresDate: addDays(currentDate, ORG_INVITE_EXPIRY_DAYS),
    };
    set({ pendingOrgInvite: invite, lastOrgScoutCheckDate: currentDate });
  },

  forceOrgInvite: (currentDate, era, currentYear) => {
    const state = get();
    const talent = orgTalentDetail(era, currentYear, state.foundationStats, state.player.mechanicalConsistency["2v2"], state.player.gameSense["2v2"]);
    const tier = orgTierForTalent(talent.overallScore);
    const proRegion = saveRegionToProRegion(state.region);
    const picked = pickRealOrgTeam(proRegion, tier, currentYear, era, currentDate, state.rlcsTeamsResetSeed);
    if (!picked) return; // no real team in this region yet (too early in a fresh save), nothing to force
    const invite: OrgInvite = {
      id: `org_${picked.orgName.replace(/\s+/g, "_")}_${currentDate.year}${currentDate.month}${currentDate.day}`,
      orgName: picked.orgName,
      tier,
      teammates: picked.teammates,
      offeredDate: currentDate,
      expiresDate: addDays(currentDate, ORG_INVITE_EXPIRY_DAYS),
    };
    set({ pendingOrgInvite: invite, pendingOrgTryout: null, orgContract: null, lastOrgScoutCheckDate: currentDate });
  },

  declineOrgInvite: () => set({ pendingOrgInvite: null }),

  acceptOrgInvite: (currentDate) => {
    const state = get();
    const invite = state.pendingOrgInvite;
    if (!invite) return;
    const tryout: OrgTryout = {
      orgName: invite.orgName,
      tier: invite.tier,
      teammates: invite.teammates,
      scrimsPlanned: ORG_TRYOUT_SCRIMS_PLANNED,
      scrimsPlayed: 0,
      scrimWins: 0,
      scrimLosses: 0,
      startedDate: currentDate,
    };
    const news: OrgNewsEntry = {
      id: `orgnews_${currentDate.year}${currentDate.month}${currentDate.day}_tryout`,
      date: currentDate,
      text: `${invite.orgName} invited you to tryouts, partnered with ${invite.teammates[0]} and ${invite.teammates[1]}.`,
    };
    set({ pendingOrgInvite: null, pendingOrgTryout: tryout, orgNews: [news, ...state.orgNews].slice(0, ORG_NEWS_LIMIT) });
  },

  recordOrgTryoutScrim: (won, currentDate, rlcsSeasonNumber) => {
    const state = get();
    const tryout = state.pendingOrgTryout;
    if (!tryout) return;
    const scrimsPlayed = tryout.scrimsPlayed + 1;
    const scrimWins = tryout.scrimWins + (won ? 1 : 0);
    const scrimLosses = tryout.scrimLosses + (won ? 0 : 1);

    if (scrimsPlayed < tryout.scrimsPlanned) {
      set({ pendingOrgTryout: { ...tryout, scrimsPlayed, scrimWins, scrimLosses } });
      return;
    }

    const outcome = resolveTryoutOutcome(scrimWins, scrimLosses);
    const record = `${scrimWins}-${scrimLosses}`;
    if (outcome === "cut") {
      const news: OrgNewsEntry = {
        id: `orgnews_${currentDate.year}${currentDate.month}${currentDate.day}_cut`,
        date: currentDate,
        text: `${tryout.orgName} cut you after tryouts (${record} in scrims). Back to free agency.`,
      };
      set({ pendingOrgTryout: null, orgNews: [news, ...state.orgNews].slice(0, ORG_NEWS_LIMIT) });
      return;
    }

    const contract = {
      orgName: tryout.orgName,
      tier: tryout.tier,
      teammates: tryout.teammates,
      role: outcome,
      signedSeason: rlcsSeasonNumber,
      lengthSeasons: rollContractLengthSeasons(),
      scrimWins: 0,
      scrimLosses: 0,
      nextScrimDate: addDays(currentDate, scrimIntervalDaysForTier(tryout.tier)),
      chemistry: CHEMISTRY_FRESH_SIGNING,
    };
    const news: OrgNewsEntry = {
      id: `orgnews_${currentDate.year}${currentDate.month}${currentDate.day}_signed`,
      date: currentDate,
      text: `${tryout.orgName} signed you as a ${outcome === "starter" ? "full starter" : "sub"} after tryouts (${record} in scrims), alongside ${tryout.teammates[0]} and ${tryout.teammates[1]}.`,
    };
    set({ pendingOrgTryout: null, orgContract: contract, orgNews: [news, ...state.orgNews].slice(0, ORG_NEWS_LIMIT) });
    // Getting signed alongside two real teammates is the kind of thing you'd actually add each other over,
    // not something the player has to separately go find them on the Social screen and friend-request.
    const proRegion = saveRegionToProRegion(state.region);
    for (const name of tryout.teammates) {
      const info = resolveTeammateFriendInfo(name, proRegion);
      get().addFriend(name, info.region, info.isPro, currentDate);
    }
  },

  recordOrgScrimResult: (won, currentDate) => {
    const state = get();
    const contract = state.orgContract;
    if (!contract) return;
    const scrimWins = contract.scrimWins + (won ? 1 : 0);
    const scrimLosses = contract.scrimLosses + (won ? 0 : 1);
    const chemistry = Math.round(contract.chemistry + (100 - contract.chemistry) * CHEMISTRY_SCRIM_GAIN_FRACTION);
    const news: OrgNewsEntry = {
      id: `orgnews_${currentDate.year}${currentDate.month}${currentDate.day}_scrim_${scrimWins + scrimLosses}`,
      date: currentDate,
      text: `Scrim result vs an org-caliber lineup: ${won ? "Won" : "Lost"}.`,
    };
    set({
      orgContract: { ...contract, scrimWins, scrimLosses, chemistry, nextScrimDate: addDays(currentDate, scrimIntervalDaysForTier(contract.tier)) },
      orgNews: [news, ...state.orgNews].slice(0, ORG_NEWS_LIMIT),
    });
  },

  releaseOrgContract: (currentDate) => {
    const state = get();
    const contract = state.orgContract;
    if (!contract) return;
    const news: OrgNewsEntry = {
      id: `orgnews_${currentDate.year}${currentDate.month}${currentDate.day}_release`,
      date: currentDate,
      text: `${contract.orgName} released you (${contract.scrimWins}-${contract.scrimLosses} in scrims this contract). Back to free agency.`,
    };
    set({ orgContract: null, orgNews: [news, ...state.orgNews].slice(0, ORG_NEWS_LIMIT) });
  },

  renewOrgContract: (currentDate, newOrgName, newTier, newTeammates) => {
    const state = get();
    const contract = state.orgContract;
    if (!contract) return;
    const promoted = newOrgName !== contract.orgName;
    const churned = newTeammates[0] !== contract.teammates[0] || newTeammates[1] !== contract.teammates[1];
    const nextContract = {
      orgName: newOrgName,
      tier: newTier,
      teammates: newTeammates,
      role: contract.role,
      signedSeason: contract.signedSeason + contract.lengthSeasons,
      lengthSeasons: rollContractLengthSeasons(),
      scrimWins: 0,
      scrimLosses: 0,
      nextScrimDate: addDays(currentDate, scrimIntervalDaysForTier(newTier)),
      // A roster that stays together keeps its chemistry into the new contract; a teammate swap (or a
      // promotion to a new org, which is really a re-formed roster in spirit) knocks a chunk of it back down.
      chemistry: churned || promoted ? Math.round(contract.chemistry * CHEMISTRY_CHURN_RETENTION) : contract.chemistry,
    };
    const text = promoted
      ? `Poached by ${newOrgName} (${ORG_TIER_LABELS[newTier]}) after a strong contract, alongside ${newTeammates[0]} and ${newTeammates[1]}.`
      : churned
        ? `Renewed with ${contract.orgName}, new teammate lineup: ${newTeammates[0]} and ${newTeammates[1]}.`
        : `Renewed with ${contract.orgName} for another contract.`;
    const news: OrgNewsEntry = {
      id: `orgnews_${currentDate.year}${currentDate.month}${currentDate.day}_renew`,
      date: currentDate,
      text,
    };
    set({ orgContract: nextContract, orgNews: [news, ...state.orgNews].slice(0, ORG_NEWS_LIMIT) });
    if (churned || promoted) {
      const proRegion = saveRegionToProRegion(state.region);
      for (const name of newTeammates) {
        const info = resolveTeammateFriendInfo(name, proRegion);
        get().addFriend(name, info.region, info.isPro, currentDate);
      }
    }
  },

  attendOrgCoaching: () => {
    const state = get();
    const contract = state.orgContract;
    if (!contract) return null;
    if (
      state.lastOrgCoachingDate &&
      daysBetween(state.lastOrgCoachingDate, state.currentDate) < coachingIntervalDaysForTier(contract.tier)
    ) {
      return null;
    }

    const gameSenseGains = {} as Record<QueueMode, number>;
    const consistencyGains = {} as Record<QueueMode, number>;
    const nextGameSense = { ...state.player.gameSense };
    const nextConsistency = { ...state.player.mechanicalConsistency };
    for (const q of QUEUES) {
      const emphasis = q === "3v3" ? ORG_3V3_EMPHASIS : 1;
      const gsGain = Math.round(diminishingGain(nextGameSense[q], ORG_COACHING_HOURS, ORG_COACHING_EFFICIENCY, state.player.fatigue) * emphasis);
      const mcGain = Math.round(diminishingGain(nextConsistency[q], ORG_COACHING_HOURS, ORG_COACHING_EFFICIENCY, state.player.fatigue) * emphasis);
      nextGameSense[q] = nextGameSense[q] + gsGain;
      nextConsistency[q] = nextConsistency[q] + mcGain;
      gameSenseGains[q] = gsGain;
      consistencyGains[q] = mcGain;
    }

    set({
      player: {
        ...state.player,
        gameSense: nextGameSense,
        mechanicalConsistency: nextConsistency,
        // A classroom/VOD-review session is far less taxing than actually playing, half the usual training cost.
        fatigue: Math.min(100, state.player.fatigue + FATIGUE_COST_PER_HOUR * ORG_COACHING_HOURS * 0.5),
      },
      lastOrgCoachingDate: state.currentDate,
      totalMinutesPlayed: state.totalMinutesPlayed + ORG_COACHING_HOURS * 60,
      ...withDateAdvance(state, ORG_COACHING_HOURS),
    });
    return { gameSense: gameSenseGains, mechanicalConsistency: consistencyGains };
  },

  runOrgBootcamp: () => {
    const state = get();
    const contract = state.orgContract;
    if (!contract) return null;
    if (
      state.lastOrgBootcampDate &&
      daysBetween(state.lastOrgBootcampDate, state.currentDate) < bootcampIntervalDaysForTier(contract.tier)
    ) {
      return null;
    }

    const era = eraForDate(state.currentDate);
    const talent = orgTalentDetail(era, state.currentDate.year, state.foundationStats, state.player.mechanicalConsistency["2v2"], state.player.gameSense["2v2"]);
    const winChance = bootcampScrimWinChance(talent.overallScore);
    let scrimWins = 0;
    let scrimLosses = 0;
    for (let i = 0; i < BOOTCAMP_SCRIM_COUNT; i++) {
      if (Math.random() < winChance) scrimWins++;
      else scrimLosses++;
    }

    const gameSenseGains = {} as Record<QueueMode, number>;
    const consistencyGains = {} as Record<QueueMode, number>;
    const nextGameSense = { ...state.player.gameSense };
    const nextConsistency = { ...state.player.mechanicalConsistency };
    for (const q of QUEUES) {
      const emphasis = q === "3v3" ? ORG_3V3_EMPHASIS : 1;
      const gsGain = Math.round(diminishingGain(nextGameSense[q], ORG_BOOTCAMP_TRAINING_HOURS, ORG_BOOTCAMP_EFFICIENCY, state.player.fatigue) * emphasis);
      const mcGain = Math.round(diminishingGain(nextConsistency[q], ORG_BOOTCAMP_TRAINING_HOURS, ORG_BOOTCAMP_EFFICIENCY, state.player.fatigue) * emphasis);
      nextGameSense[q] = nextGameSense[q] + gsGain;
      nextConsistency[q] = nextConsistency[q] + mcGain;
      gameSenseGains[q] = gsGain;
      consistencyGains[q] = mcGain;
    }

    const news: OrgNewsEntry = {
      id: `orgnews_${state.currentDate.year}${state.currentDate.month}${state.currentDate.day}_bootcamp`,
      date: state.currentDate,
      text: `Bootcamp with ${contract.orgName}: ${scrimWins}-${scrimLosses} in scrims, noticeable reps gained.`,
    };

    set({
      player: {
        ...state.player,
        gameSense: nextGameSense,
        mechanicalConsistency: nextConsistency,
        fatigue: Math.min(100, state.player.fatigue + FATIGUE_COST_PER_HOUR * ORG_BOOTCAMP_CALENDAR_DAYS * 4),
      },
      orgContract: {
        ...contract,
        scrimWins: contract.scrimWins + scrimWins,
        scrimLosses: contract.scrimLosses + scrimLosses,
        nextScrimDate: addDays(state.currentDate, scrimIntervalDaysForTier(contract.tier)),
        // "A ton of scrims" builds real chemistry fast — a much bigger jump than one ordinary scrim.
        chemistry: Math.round(contract.chemistry + (100 - contract.chemistry) * CHEMISTRY_BOOTCAMP_GAIN_FRACTION),
      },
      lastOrgBootcampDate: state.currentDate,
      orgNews: [news, ...state.orgNews].slice(0, ORG_NEWS_LIMIT),
      totalMinutesPlayed: state.totalMinutesPlayed + ORG_BOOTCAMP_CALENDAR_DAYS * 24 * 60,
      ...withDateAdvance(state, ORG_BOOTCAMP_CALENDAR_DAYS * 24),
    });
    return { scrimWins, scrimLosses, gameSense: gameSenseGains, mechanicalConsistency: consistencyGains };
  },

  advanceClock: (hours) => {
    const state = get();
    set(withDateAdvance(state, hours));
  },

  advanceMinutes: (minutes) => {
    const state = get();
    // This is specifically the ranked-match path (queue time + the game itself, see MatchScreen's
    // handleContinue), so it counts toward total hours played, unlike a bare `advanceClock`/`rest`.
    set({ ...withMinuteAdvance(state, minutes), totalMinutesPlayed: state.totalMinutesPlayed + minutes });
  },

  rest: (hours) => {
    const state = get();
    set({
      ...withDateAdvance(state, hours),
      player: { ...state.player, fatigue: Math.max(0, state.player.fatigue - REST_RECOVERY_PER_HOUR * hours) },
    });
  },

  sleepToNextDay: () => {
    const state = get();
    const nextDate = addDays(state.currentDate, 1);
    const seasonPatch = processSeasonRollover(state, nextDate);
    set({
      currentDate: nextDate,
      clockHour: 8,
      clockMinute: 0,
      ...(seasonPatch ?? {}),
      player: { ...state.player, fatigue: Math.max(0, state.player.fatigue - SLEEP_RECOVERY) },
    });
  },

  trainMechanic: (id, efficiencyPct, hours = 1) => {
    const state = get();
    const current = state.mechanicProgress[id]?.currentValue ?? 0;
    const gain = diminishingGain(current, hours, efficiencyPct, state.player.fatigue);
    set({
      mechanicProgress: { ...state.mechanicProgress, [id]: { currentValue: current + gain } },
      player: { ...state.player, fatigue: Math.min(100, state.player.fatigue + FATIGUE_COST_PER_HOUR * hours) },
      totalMinutesPlayed: state.totalMinutesPlayed + hours * 60,
      ...withDateAdvance(state, hours),
    });
    return gain;
  },

  trainMechanicsGroup: (entries, hours = 1) => {
    const state = get();
    if (entries.length === 0) return {};
    const perMechanicHours = hours / entries.length;
    const gains: Record<string, number> = {};
    const nextProgress = { ...state.mechanicProgress };
    for (const { id, efficiencyPct } of entries) {
      const current = nextProgress[id]?.currentValue ?? 0;
      const gain = diminishingGain(current, perMechanicHours, efficiencyPct, state.player.fatigue);
      nextProgress[id] = { currentValue: current + gain };
      gains[id] = gain;
    }
    set({
      mechanicProgress: nextProgress,
      player: { ...state.player, fatigue: Math.min(100, state.player.fatigue + FATIGUE_COST_PER_HOUR * hours) },
      totalMinutesPlayed: state.totalMinutesPlayed + hours * 60,
      ...withDateAdvance(state, hours),
    });
    return gains;
  },

  trainFoundationStat: (category, hours = 1) => {
    const state = get();
    const isTactical = TACTICAL_FOUNDATION_CATEGORIES.includes(category);
    if (isTactical && state.skillPoints < 1) return 0;

    const current = state.foundationStats[category];
    const gain = diminishingGain(current, hours, 100, state.player.fatigue);
    set({
      foundationStats: { ...state.foundationStats, [category]: current + gain },
      player: { ...state.player, fatigue: Math.min(100, state.player.fatigue + FATIGUE_COST_PER_HOUR * hours) },
      skillPoints: isTactical ? state.skillPoints - 1 : state.skillPoints,
      totalMinutesPlayed: state.totalMinutesPlayed + hours * 60,
      ...withDateAdvance(state, hours),
    });
    return gain;
  },

  trainQueueConcept: (id, efficiencyPct, hours = 1) => {
    const state = get();
    if (state.skillPoints < 1) return 0;

    const current = state.queueConceptProgress[id]?.currentValue ?? 0;
    const gain = diminishingGain(current, hours, efficiencyPct, state.player.fatigue);
    set({
      queueConceptProgress: { ...state.queueConceptProgress, [id]: { currentValue: current + gain } },
      player: { ...state.player, fatigue: Math.min(100, state.player.fatigue + FATIGUE_COST_PER_HOUR * hours) },
      skillPoints: state.skillPoints - 1,
      totalMinutesPlayed: state.totalMinutesPlayed + hours * 60,
      ...withDateAdvance(state, hours),
    });
    return gain;
  },

  trainPlaystyleTrait: (queue, trait, direction, hours = 1) => {
    const state = get();
    if (state.skillPoints < 1) return 0;

    const current = state.playstyleProfiles[queue][trait];
    const gain = playstyleShiftGain(current, direction, hours, state.player.fatigue);
    const nextValue = Math.max(0, Math.min(100, current + direction * gain));
    set({
      playstyleProfiles: {
        ...state.playstyleProfiles,
        [queue]: { ...state.playstyleProfiles[queue], [trait]: nextValue },
      },
      player: { ...state.player, fatigue: Math.min(100, state.player.fatigue + FATIGUE_COST_PER_HOUR * hours) },
      skillPoints: state.skillPoints - 1,
      totalMinutesPlayed: state.totalMinutesPlayed + hours * 60,
      ...withDateAdvance(state, hours),
    });
    return Math.abs(nextValue - current);
  },

  devAddGameSense: (queue, amount) => {
    const state = get();
    set({
      player: {
        ...state.player,
        gameSense: { ...state.player.gameSense, [queue]: Math.max(0, state.player.gameSense[queue] + amount) },
      },
    });
  },

  devAddMechanicalConsistency: (queue, amount) => {
    const state = get();
    set({
      player: {
        ...state.player,
        mechanicalConsistency: {
          ...state.player.mechanicalConsistency,
          [queue]: Math.max(0, state.player.mechanicalConsistency[queue] + amount),
        },
      },
    });
  },

  devSetGameSense: (queue, value) => {
    const state = get();
    set({ player: { ...state.player, gameSense: { ...state.player.gameSense, [queue]: Math.max(0, value) } } });
  },

  devSetMechanicalConsistency: (queue, value) => {
    const state = get();
    set({ player: { ...state.player, mechanicalConsistency: { ...state.player.mechanicalConsistency, [queue]: Math.max(0, value) } } });
  },

  devMaxFoundationStats: () => {
    const state = get();
    const maxed = Object.fromEntries(
      (Object.keys(state.foundationStats) as FoundationCategory[]).map((cat) => [cat, 20000])
    ) as Record<FoundationCategory, number>;
    set({ foundationStats: maxed });
  },

  devMaxMechanics: () => {
    const state = get();
    const maxed = Object.fromEntries(
      Object.keys(state.mechanicProgress).map((id) => [id, { currentValue: 20000 }])
    );
    set({ mechanicProgress: maxed });
  },

  devMaxQueueConcepts: () => {
    const state = get();
    const maxed = Object.fromEntries(
      Object.keys(state.queueConceptProgress).map((id) => [id, { currentValue: 20000 }])
    );
    set({ queueConceptProgress: maxed });
  },

  devSetMechanic: (id, value) => {
    const state = get();
    set({ mechanicProgress: { ...state.mechanicProgress, [id]: { currentValue: Math.max(0, value) } } });
  },

  devRandomizeMechanics: (min, max) => {
    const state = get();
    const lo = Math.max(0, Math.min(min, max));
    const hi = Math.max(min, max);
    const randomized = Object.fromEntries(
      Object.keys(state.mechanicProgress).map((id) => [id, { currentValue: Math.round(lo + Math.random() * (hi - lo)) }])
    );
    set({ mechanicProgress: randomized });
  },

  devSetQueueConcept: (id, value) => {
    const state = get();
    set({ queueConceptProgress: { ...state.queueConceptProgress, [id]: { currentValue: Math.max(0, value) } } });
  },

  devRandomizeQueueConcepts: (min, max) => {
    const state = get();
    const lo = Math.max(0, Math.min(min, max));
    const hi = Math.max(min, max);
    const randomized = Object.fromEntries(
      Object.keys(state.queueConceptProgress).map((id) => [id, { currentValue: Math.round(lo + Math.random() * (hi - lo)) }])
    );
    set({ queueConceptProgress: randomized });
  },

  devSetFoundationStat: (category, value) => {
    const state = get();
    set({ foundationStats: { ...state.foundationStats, [category]: Math.max(0, value) } });
  },

  devAddSkillPoints: (amount) => {
    const state = get();
    set({ skillPoints: Math.max(0, state.skillPoints + amount) });
  },

  devSetMmr: (queue, mmr) => {
    const state = get();
    const profile = state.rankedProfiles[queue];
    const era = eraForDate(state.currentDate);
    const roundedMmr = Math.round(mmr);
    const derived = deriveRankFromMmr(roundedMmr, era, queue);
    const isNewPeak = tierRank(derived.tier) > tierRank(profile.peakRankTier);
    const isNewPeakMmr = roundedMmr > profile.peakMmr;
    set({
      rankedProfiles: {
        ...state.rankedProfiles,
        [queue]: {
          ...profile,
          mmr: roundedMmr,
          rankTier: derived.tier,
          division: derived.division,
          placementMatchesRemaining: 0,
          peakRankTier: isNewPeak ? derived.tier : profile.peakRankTier,
          peakDivision: isNewPeak ? derived.division : profile.peakDivision,
          peakMmr: isNewPeakMmr ? roundedMmr : profile.peakMmr,
          peakMmrSeason: isNewPeakMmr ? state.seasonNumber : profile.peakMmrSeason,
        },
      },
    });
  },

  devSetRewardLevel: (tier, winsProgress) => {
    const state = get();
    const era = eraForDate(state.currentDate);
    const sequence = rewardTierSequence(era);
    const tierIdx = sequence.indexOf(tier);
    const rewardProgressByTier: Partial<Record<RankTierId, number>> = {};
    for (let i = 0; i <= tierIdx; i++) rewardProgressByTier[sequence[i]] = REWARD_WINS_REQUIRED;
    const nextTier = sequence[tierIdx + 1];
    if (nextTier) rewardProgressByTier[nextTier] = Math.max(0, Math.min(REWARD_WINS_REQUIRED, winsProgress));
    set({ rewardTierUnlocked: tier, rewardProgressByTier });
  },
}));
