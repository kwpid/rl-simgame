// Placeholder save data so UI screens render real-looking content before the engine exists.
// Shape follows docs/DATA_MODEL.md, trimmed to what the current screens need.

import type { RankTierId, RankEra } from "./rankSystem";
import { MECHANICS, type FoundationCategory } from "./mechanics";
import type { TitleEntry, SeasonAnnouncement } from "./seasons";
import type { SimDate } from "./dateUtils";
import type { ProRegion } from "./proPlayers";

export type QueueMode = "1v1" | "2v2" | "3v3";
export type { RankTierId as RankTier };

export type Region = "north_america" | "europe" | "oceania" | "south_america" | "mena" | "asia_pacific";

// Username is the fixed account id (matches real platforms: Steam/Epic/Xbox IDs), letters and digits only,
// set once at save creation and never editable again. Display Name is the free-text name actually shown
// everywhere in-game (leaderboards, matches, tournaments), can use any characters, and can be changed
// any time from Settings, same as a real platform's separate "display name" vs "account ID" split.
export const USERNAME_PATTERN = /^[A-Za-z0-9]+$/;
export function isValidUsername(value: string): boolean {
  return USERNAME_PATTERN.test(value);
}

export const REGION_LABELS: Record<Region, string> = {
  north_america: "North America",
  europe: "Europe",
  oceania: "Oceania",
  south_america: "South America",
  mena: "MENA",
  asia_pacific: "Asia Pacific",
};

export interface RankedProfile {
  queue: QueueMode;
  mmr: number;
  rankTier: RankTierId;
  division: number; // ignored by rankSystem when the tier has no divisions in the current era
  divisionProgress: number; // 0-5 pips filled within the current division, ~2 wins per pip, like real RL
  seasonMatchesPlayed: number;
  /** Matches left before this queue's real rank is assigned from placement performance. A fresh save
   *  starts every queue at 600 MMR with 10 remaining. 0 once placed, existing veteran saves are pre-placed. */
  placementMatchesRemaining: number;
  /** Highest tier/division reached so far this season, used to grant the season-end title even if the
   *  player's current rank has since slipped. Reset to the placement result at season rollover. */
  peakRankTier: RankTierId;
  peakDivision: number;
  /** Highest raw MMR ever reached in this queue, career-wide (not reset each season, unlike peakRankTier/
   *  peakDivision), plus which ranked season it happened in, for the Stats screen. */
  peakMmr: number;
  peakMmrSeason: number;
  /** Current consecutive run, "win"/"loss" plus how many in a row. Resets to the opposite type at 1 the
   *  moment the streak breaks, null/0 only ever at a fresh save/queue with no games played yet. */
  streakType: "win" | "loss" | null;
  streakCount: number;
}

/** One past season's result, captured right before `processSeasonRollover` resets everything for the new
 *  season — this is the only place a season's peak rank/reward survives once it's over. */
export interface SeasonHistoryEntry {
  seasonNumber: number;
  era: RankEra;
  endDate: SimDate;
  peaks: Record<QueueMode, { tier: RankTierId; division: number }>;
  rewardTierAchieved: RankTierId;
}

/** A queue that just finished placements, shown once as a dedicated reveal on the Ranked screen rather
 *  than just quietly updating the rank badge. Cleared once the player's seen it. */
export interface PlacementResult {
  queue: QueueMode;
  tier: RankTierId;
  division: number;
  mmr: number;
}

/** A queue that was just promoted (tier or division increased) by the most recent match, used to trigger
 *  a one-off rank-up animation on the Ranked screen. Cleared once the player's seen it (or once a
 *  different queue's promotion replaces it). */
export interface PromotionEvent {
  queue: QueueMode;
  tier: RankTierId;
  division: number;
}

/** Presentational per-queue tendency profile, placeholder formulas until the match-sim can derive these
 *  from real event logs. Answers "how do I actually play this queue" instead of raw counting stats. */
export interface PlaystyleProfile {
  aggression: number; // 0-100
  rotationDiscipline: number;
  mechanicalFlair: number;
  consistency: number;
}

/** A player or pro/filler leaderboard name the player has added as a friend. Rivalry record splits
 *  "against" (faced them as an opponent) from "with" (partied up together in ranked), since both can
 *  happen with the same friend over time. */
export interface FriendRecord {
  name: string;
  region: string;
  isPro: boolean;
  addedDate: SimDate;
  winsAgainst: number;
  lossesAgainst: number;
  winsWith: number;
  lossesWith: number;
  /** Most recent notable moments first, capped short, just flavor for the Social screen. */
  moments: string[];
  /** Persistent per-queue stats, seeded once when added and updated after every match they're actually
   *  in (see useSaveStore.ts's applyFriendMatchStats), so a friend reads as the SAME person match to
   *  match — MMR moves on real wins/losses, Game Sense/Mechanical Consistency creep up from ordinary play,
   *  same as everyone else tracked in this sim, not a fresh random roll every single game. A real pro or
   *  leaderboard-tracked friend's actual in-match stats still come from their own dedicated leaderboard
   *  entry (kept in sync with how they show up everywhere else), these fields only ever drive a "plain"
   *  friend nobody else in the sim is separately tracking. */
  mmr: Record<QueueMode, number>;
  gameSense: Record<QueueMode, number>;
  mechanicalConsistency: Record<QueueMode, number>;
}

export interface ShowmatchInvite {
  id: string;
  streamerId: "shadow" | "feer" | "johnboi";
  opponentName: string;
  offeredDate: SimDate;
  expiresDate: SimDate;
}

export interface ShowmatchResultEntry {
  streamerId: "shadow" | "feer" | "johnboi";
  opponentName: string;
  win: boolean;
  fameGained: number;
  date: SimDate;
}

export interface RecentMatchEntry {
  queue: QueueMode;
  result: "win" | "loss";
  score: string;
  note: string;
}

// Org/pro-scene system: entirely separate from ranked (an org contract never touches ranked MMR/progress),
// this is the competitive 3v3 track — tryouts, a real roster of two named pro teammates, scrims, and (once
// signed) RLCS/Rival Series registration through the org rather than solo. See data/orgs.ts for the
// eligibility/tier math this all runs on.
export type OrgTier = "bubble" | "mid" | "top";

export interface OrgInvite {
  id: string;
  orgName: string;
  tier: OrgTier;
  offeredDate: SimDate;
  expiresDate: SimDate;
}

/** An accepted invite's tryout: the org pairs the player with two real pro teammates in roughly their own
 *  skill range and runs a handful of best-of-5/7 scrims against other org-caliber lineups, a few can
 *  happen in the same day. Once `scrimsPlayed` reaches `scrimsPlanned`, the win rate decides whether the
 *  player is cut, kept on as a sub, or signed as a full starter. */
export interface OrgTryout {
  orgName: string;
  tier: OrgTier;
  teammates: [string, string];
  scrimsPlanned: number;
  scrimsPlayed: number;
  scrimWins: number;
  scrimLosses: number;
  startedDate: SimDate;
}

export interface OrgContract {
  orgName: string;
  tier: OrgTier;
  teammates: [string, string];
  role: "starter" | "sub";
  signedSeason: number; // RLCS season number the contract started in
  lengthSeasons: number;
  // Ongoing scrims while signed (separate from the tryout's own scrim count): a running record that
  // decides renewal/release once the contract's `lengthSeasons` runs out, and the next date the org has
  // another scrim lined up. Resets to 0-0 on every renewal, this season's form is what gets judged.
  scrimWins: number;
  scrimLosses: number;
  nextScrimDate: SimDate;
}

export interface OrgNewsEntry {
  id: string;
  date: SimDate;
  text: string;
}

const DEMO_CURRENT_DATE = { year: 2018, month: 4, day: 12 };

// A few ids get a hand-picked value to match notes/examples used elsewhere in this project's docs and
// memory (e.g. "flip_reset: 0, era not reached yet"). Everything else in MECHANICS gets a deterministic
// seeded value below, era-locked mechanics always land on 0, discovered ones get a plausible mixed
// trained/untrained spread, this is what lets an ~80-entry mechanic list stay populated without hand
// authoring every single line.
const HAND_SEEDED_MECHANIC_PROGRESS: Record<string, number> = {
  basic_aerial: 850,
  fast_aerial: 950,
  air_roll_shot: 500,
  air_dribble: 1400,
  redirected_aerial: 300,
  ceiling_shot: 600,
  double_tap: 0, // era not reached yet (Nov 2018)
  flip_reset: 0, // era not reached yet (Aug 2018)
  powerslide: 1200,
  wavedash: 0,
  musty_flick: 0,
  front_flick: 650,
  wall_read: 700,
  shadow_defense: 800,
  last_man_positioning: 400,
  backboard_pinch: 0,
  fast_kickoff_recovery: 700,
  delayed_kickoff: 0,
  speedflip: 0, // era not reached yet (2019)
  wall_pass: 550,
  redirect_pass: 0,
  fake_pass: 0, // era not reached yet (Jun 2018)
  panic_clear: 900,
  buzzer_save: 0,
  boost_stealing: 750,
  boost_starved_play: 0,
};

function isMechanicDiscovered(eraStart: { year: number; month: number }, currentDate: { year: number; month: number }): boolean {
  return currentDate.year > eraStart.year || (currentDate.year === eraStart.year && currentDate.month >= eraStart.month);
}

/** Deterministic (not truly random, same id always gives the same value) so the demo save is stable
 *  across reloads without needing to persist a random seed. ~1 in 4 discovered mechanics lands on 0
 *  (untrained but available), matching "nobody trains everything at once". */
function seededMechanicProgress(id: string, eraStart: { year: number; month: number }): number {
  if (!isMechanicDiscovered(eraStart, DEMO_CURRENT_DATE)) return 0;
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  if (hash % 4 === 0) return 0;
  return 150 + (hash % 900);
}

export const mockSave = {
  username: "VoltKinetic17",
  displayName: "Volt.Kinetic",
  realName: "Jordan Reyes",
  age: 19,
  region: "north_america" as Region,
  // GC+/SSL ranked matchmaking's region multi-select (see useMatchStore.ts's pickName/gatherEligibleOpponents),
  // account-wide rather than per-queue since "which regions am I searching" is one decision, not per-playlist.
  // Defaults to just the player's own region; NA here matches the demo save's own "north_america".
  selectedMatchmakingRegions: ["NA"] as ProRegion[],
  startDate: { year: 2017 },
  currentDate: DEMO_CURRENT_DATE,
  clockHour: 9, // 24h internally, displayed 12h with AM/PM, see data/dateUtils.ts
  clockMinute: 0, // fine-grained leftover minutes within the current hour, matches advance the clock by minutes
  // Combined "hours played" across ranked queuing/matches, freeplay mechanic training, and paid Skill
  // Point training — stored in minutes for precision, shown as hours on the Stats screen. Deliberately
  // doesn't include resting/sleeping, those aren't time spent actually playing.
  totalMinutesPlayed: 2640, // ~44h, a plausible amount for a level-14 save with this much career history
  level: 14,
  xp: 6420,
  xpToNextLevel: 9000,
  skillPoints: 3,
  playstyle: "mechanical" as const,

  // Real RL's season reward system: account-wide, not per-playlist. A win in ANY ranked queue counts
  // toward it, gated by your current rank IN THAT QUEUE for that win. Every tier at-or-below your current
  // rank tracks its own 10-win count IN PARALLEL (an SSL-ranked player's win counts toward Bronze through
  // SSL simultaneously, not one sequential unlock at a time), permanently unlocking that tier's reward for
  // the season once it hits 10, even if you derank afterward. Losses don't count.
  rewardTierUnlocked: "champion" as RankTierId,
  rewardProgressByTier: {
    bronze: 10, silver: 10, gold: 10, platinum: 10, diamond: 10, champion: 10, grand_champion: 6,
  } as Partial<Record<RankTierId, number>>,

  player: {
    fame: 22,
    // Game sense is tracked per playlist, not as one flat number: 1v1 reads are a genuinely different
    // skill from 2v2/3v3 rotation and boost management, playing/training a queue grows THAT queue's game
    // sense, so a player who's grinded 1v1 hard can out-read a 2v2 pro in duel even if that pro's overall
    // MMR/experience dwarfs theirs. Uncapped, raw accumulated points, not a percentage. Elite pros run 10k+.
    gameSense: { "1v1": 2450, "2v2": 3180, "3v3": 2100 } satisfies Record<QueueMode, number>,
    // Overall training-derived reliability: how rarely you botch execution regardless of raw skill
    // level, distinct from any single foundation stat or gameSense (decision-making). Uncapped, same
    // growth shape as gameSense, also tracked per playlist. Reduces whiff chance and variance in the sim.
    mechanicalConsistency: { "1v1": 2100, "2v2": 2600, "3v3": 1900 } satisfies Record<QueueMode, number>,
    fatigue: 28,
  },

  // Foundation stats: uncapped, same growth shape as game sense (diminishing returns, no hard ceiling).
  foundationStats: {
    carControl: 1450,
    aerialControl: 2100,
    boostManagement: 900,
    offense: 1200,
    defense: 1600,
    passing: 700,
  } satisfies Record<FoundationCategory, number>,

  // Named mechanic mastery, keyed by MechanicDefinition.id from data/mechanics.ts. A currentValue of 0
  // means never trained, used as the "already trained" signal for synergy bonuses elsewhere. Generated
  // from MECHANICS (~80 entries) via HAND_SEEDED_MECHANIC_PROGRESS for a handful of notable ones and a
  // deterministic seed for the rest, see the comment above HAND_SEEDED_MECHANIC_PROGRESS.
  mechanicProgress: Object.fromEntries(
    MECHANICS.map((m) => [
      m.id,
      { currentValue: HAND_SEEDED_MECHANIC_PROGRESS[m.id] ?? seededMechanicProgress(m.id, m.eraStart) },
    ])
  ) as Record<string, { currentValue: number }>,

  // Playlist-specific tactical/mental concepts, keyed by QueueConceptDefinition.id from data/queueConcepts.ts.
  // Same mix of trained/untrained as mechanicProgress, nobody drills every concept in every playlist.
  queueConceptProgress: {
    // 1v1
    "1v1_adaptation": { currentValue: 900 },
    "1v1_opponent_read": { currentValue: 500 },
    "1v1_car_reading": { currentValue: 0 },
    "1v1_mind_games": { currentValue: 400 },
    "1v1_air_dribble_bump": { currentValue: 700 },
    "1v1_low_boost_defense": { currentValue: 600 },
    "1v1_low_boost_offense": { currentValue: 300 },
    "1v1_boost_starving": { currentValue: 0 },
    "1v1_shot_selection": { currentValue: 800 },
    "1v1_tilt_management": { currentValue: 1000 },
    // 2v2
    "2v2_teammate_adaptation": { currentValue: 850 },
    "2v2_possession": { currentValue: 700 },
    "2v2_rotation_basics": { currentValue: 1200 },
    "2v2_leave_one_back": { currentValue: 600 },
    "2v2_punish_overcommit": { currentValue: 500 },
    "2v2_backpost_rotation": { currentValue: 0 },
    "2v2_fake_challenge": { currentValue: 0 },
    "2v2_duo_boost_starving": { currentValue: 300 },
    "2v2_callouts": { currentValue: 400 },
    // 3v3
    "3v3_full_rotation": { currentValue: 500 },
    "3v3_third_man": { currentValue: 0 },
    "3v3_passback_setups": { currentValue: 300 },
    "3v3_boost_distribution": { currentValue: 400 },
    "3v3_field_awareness": { currentValue: 0 },
    "3v3_defensive_shell": { currentValue: 200 },
  } as Record<string, { currentValue: number }>,

  rankedProfiles: {
    "1v1": { queue: "1v1", mmr: 1820, rankTier: "grand_champion", division: 0, divisionProgress: 0, seasonMatchesPlayed: 63, placementMatchesRemaining: 0, peakRankTier: "grand_champion", peakDivision: 0, peakMmr: 1820, peakMmrSeason: 4, streakType: "win", streakCount: 3 }, // temp: set to top rank for testing
    "2v2": { queue: "2v2", mmr: 940, rankTier: "champion", division: 2, divisionProgress: 3, seasonMatchesPlayed: 118, placementMatchesRemaining: 0, peakRankTier: "champion", peakDivision: 2, peakMmr: 1010, peakMmrSeason: 3, streakType: "loss", streakCount: 1 },
    "3v3": { queue: "3v3", mmr: 705, rankTier: "platinum", division: 3, divisionProgress: 1, seasonMatchesPlayed: 40, placementMatchesRemaining: 0, peakRankTier: "platinum", peakDivision: 3, peakMmr: 705, peakMmrSeason: 4, streakType: "win", streakCount: 1 },
  } satisfies Record<QueueMode, RankedProfile> as Record<QueueMode, RankedProfile>,

  careerStats: {
    "1v1": { wins: 38, losses: 25, goals: 210, assists: 12, saves: 88, mvps: 14 },
    "2v2": { wins: 71, losses: 47, goals: 340, assists: 205, saves: 190, mvps: 22 },
    "3v3": { wins: 22, losses: 18, goals: 96, assists: 88, saves: 60, mvps: 5 },
  },

  playstyleProfiles: {
    "1v1": { aggression: 78, rotationDiscipline: 40, mechanicalFlair: 82, consistency: 55 },
    "2v2": { aggression: 60, rotationDiscipline: 68, mechanicalFlair: 74, consistency: 71 },
    "3v3": { aggression: 35, rotationDiscipline: 74, mechanicalFlair: 48, consistency: 62 },
  } satisfies Record<QueueMode, PlaystyleProfile>,

  // Org/pro-scene track, entirely separate from ranked (see OrgContract's doc comment). Empty/null on a
  // save that hasn't been scouted yet, same "nothing until it happens" shape as the showmatch fields below.
  pendingOrgInvite: null as OrgInvite | null,
  pendingOrgTryout: null as OrgTryout | null,
  orgContract: null as OrgContract | null,
  orgNews: [] as OrgNewsEntry[],
  lastOrgScoutCheckDate: DEMO_CURRENT_DATE,
  // Both null until the player's first session of each kind (only reachable once actually signed, not
  // during a tryout), see useSaveStore.ts's attendOrgCoaching/runOrgBootcamp.
  lastOrgCoachingDate: null as SimDate | null,
  lastOrgBootcampDate: null as SimDate | null,

  recentMatches: [
    { queue: "2v2" as const, result: "win" as const, score: "4-2", note: "Clean rotation, one whiffed flip reset attempt." },
    { queue: "1v1" as const, result: "loss" as const, score: "2-3", note: "Lost the double-tap read late in OT." },
    { queue: "2v2" as const, result: "win" as const, score: "3-1", note: "MVP, two solo plays off boost-starved reads." },
  ] satisfies RecentMatchEntry[] as RecentMatchEntry[],

  // Default titles are grey ("none" glow), earned through ordinary play. Glow titles (gold/red/white)
  // only come from season-end rewards or RLCS results, see data/seasons.ts. `equippedTitleId: null` is
  // a valid, first-class choice, real RL lets you display no title at all.
  titles: [
    { id: "rookie", label: "Rookie", glow: "none" },
    { id: "speedflip_adopter", label: "Speedflip Adopter", glow: "none" },
    { id: "season_legacy_2_gc", label: "SEASON 2 GRAND CHAMPION", glow: "gold" },
  ] satisfies TitleEntry[] as TitleEntry[],
  equippedTitleId: "season_legacy_2_gc" as string | null,
  seasonRewardTier: 5,

  // Ranked seasons: one shared season number/clock across all 3 queues, each queue resets/re-places
  // independently when the season rolls over. See data/seasons.ts for the rollover math.
  seasonNumber: 3,
  seasonStartDate: { year: 2018, month: 3, day: 1 },
  seasonNumberingReset: false, // flips true the first time a season ends inside the modern (SSL) era
  pendingSeasonAnnouncement: null as SeasonAnnouncement | null,
  // Every past season's peak rank per queue + reward tier earned, captured right before a rollover resets
  // everything. Empty until the player's actually lived through a full season.
  seasonHistory: [] as SeasonHistoryEntry[],
  // One-shot UI reveals: cleared once the player's seen them (see RankedScreen.tsx).
  pendingPlacementResult: null as PlacementResult | null,
  pendingPromotion: null as PromotionEvent | null,

  // Social: a friends list (rivalry record split "against" vs partied-up "with") plus 1v1 showmatch
  // invitations from streamers, see data/showmatches.ts. Neither affects ranked MMR.
  friends: {} as Record<string, FriendRecord>,
  pendingShowmatchInvite: null as ShowmatchInvite | null,
  showmatchHistory: [] as ShowmatchResultEntry[],
  lastShowmatchInviteCheckDate: DEMO_CURRENT_DATE,
  // Names encountered in recent matches (opponents and teammates alike), most recent first, capped short.
  // Adding a friend is done from this list rather than an open search of every name in the sim.
  recentlyPlayedWith: [] as string[],
  // Friends currently partied up with the player, ranked queueing uses this instead of a per-queue picker.
  // Max 2 (a full 3v3 stack), and 1v1 is unavailable outright whenever this isn't empty (real RL rule:
  // can't queue Duel while partied with anyone).
  partyMembers: [] as string[],
};

/** The full save shape, used by useSaveStore and the persistence layer. `mockSave` above is one concrete
 *  example (a pre-built veteran save), not the type's only possible values, see data/saveManager.ts for
 *  the fresh-save factory that produces all-zero saves matching this same shape. */
export type SaveData = typeof mockSave;

/** Leaderboard rows are built live from the pro leaderboard store (see store/useProLeaderboardStore.ts)
 *  plus these generic filler names for whatever's left once real pros run out (mostly early-game years,
 *  before enough pros have debuted to fill the board). See RankedScreen.tsx for the actual assembly. */
export interface LeaderboardEntry {
  rank: number;
  name: string;
  mmr: number;
  rankTier: RankTierId;
  division: number;
  region: string;
}

// A big, deliberately eclectic pool of generic (non-pro) AI names, in the same rough vein as gamertags you'd
// actually see on Steam/Epic/Xbox/PSN, so a ranked lobby or the filler leaderboard doesn't keep recycling the
// same handful of names. Purely cosmetic, no gameplay meaning attached to any individual name.
export const LB_NAMES = [
  "Kairos", "Nullstate", "Vantablack", "Redline.exe", "Ghostframe", "Aetherius", "Blipmaster",
  "Zenon", "Voidwake", "Crestfall", "Ironclad_", "Slipstream", "Halcyon.gg", "Driftcore",
  "Nova_Kinetic", "Wraithbyte", "Solstice", "Ember.tv", "Frostline", "Obsidian_RL", "Callisto",
  "Fugue", "Ashborn", "Tempest.gg", "Lucid_Flow", "Nightglass", "Paragon.exe", "Ricochet_",
  "Meridian", "Static_Haze",

  // Abstract/sci-fi single-word handles.
  "Nebulyte", "Cryptid", "Fathomless", "Quasar_", "Aurorae", "Glacius", "Pyrexis", "Umbralis",
  "Seraphex", "Nyxwood", "Solarflux", "Terravane", "Lumen.rl", "Driftwake", "Ashfall_", "Zephyrun",
  "Hollowpoint", "Ferrofluid", "Kinetic_Drift", "Vortyx", "Chronopulse", "Emberlyn", "Frostbyte_",
  "Glasswing", "Ironvein", "Nightcrawl3r", "Fluxguard", "Paragon_X", "Ricochet2", "Meridian_X",
  "Static_Wave", "Cinderwake", "Duskrunner", "Echoform", "Graviton_", "Hexshade", "Ionfall",
  "Jettison.gg", "Kelvinstorm", "Luminael", "Monarchy_", "Novastrike", "Oblivioux", "Photonis",
  "Quartzline", "Riftborn", "Skyfracture", "Thornveil", "Umberto_RL", "Vexcaliber", "Windrend",
  "Xenolith", "Yieldbreaker", "Zerofield",

  // Xbox/PSN/Steam-style tags with numbers or leet-speak flourishes.
  "xX_Shadow117_Xx", "xXDarkPhoenixXx", "iiTzFrosty", "xX_Reaper99_Xx", "TTV_Kolt", "yt_Bl4ze",
  "PS5_Nomad", "Xbox_Wraith", "GGWP_Sniper", "iCrash_", "xXNovaXx", "xX_Silent_Xx", "iiFlicker",
  "xX_Glitch404_Xx", "TTV_Ashenn", "yt_Vortex_", "iiPixel", "xXRustyXx", "Gamertag_Null",
  "xX_Kolby22_Xx", "iiSnowfall", "TTV_Drex", "yt_Krispy", "xX_Fable7_Xx", "iiShatter",

  // Bracket/clan-tag style.
  "[FLCN]Drexel", "[NRG]Wisp", "[GLC]Talon", "[OG]Ember", "[VX]Riptide", "[KZ]Fable",
  "[TDM]Ashryn", "[LFT]Quill", "[APX]Rowan", "[SNK]Dax", "[CTL]Brisk", "[PXL]Wyre",

  // Word+number combos.
  "Blaze420", "Kolt99", "Riven7", "Skye88", "Onyx23", "Vex13", "Draven44", "Kade07", "Fenwick19",
  "Nash31", "Talyn64", "Brix21", "Corvid09", "Waylen56", "Ashby12", "Dorian77", "Sable03",

  // Gamer-humor/pun handles.
  "NoScopeNolan", "FlickOrTreat", "ClutchOrBust", "BoostStarved", "DemoDerby", "WhiffKing",
  "CeilingShotCurt", "AirDribbleAndy", "FiftyFiftyFred", "GoalExplosion", "OverCommitOllie",
  "PancakeQueen", "RotationRotisserie", "BallChaserBrett", "SupersonicSue", "MustyMorgan",

  // Plain stylized handles.
  "shadow_wolf", "midnightrunner", "pixelghost", "crimsonfox", "lunar_eclipse", "thunderstrike",
  "silentassassin", "phantomrider", "ironfistx", "blazing_arrow", "frostwhisper", "shadowfang",
  "neonviper", "duskstalker", "wildcard_", "rustyknight", "hollow_echo", "cobaltraven",
  "emberstorm", "wraithwalker", "glacierheart", "voidrunner", "starlit_wolf", "crimson_tide",
  "moonshadow_", "steelrender", "brokenhalo", "ashen_knight", "driftking_", "nightowl_rl",

  // More scifi/fantasy-flavored abstract nouns, kept distinct from anything above.
  "Palisade_", "Ember_Cascade", "Thornbrook", "Windshear", "Cindergate", "Mistvale", "Ravensworn",
  "Frostgale", "Sunderfall", "Coalfire_", "Duskmarch", "Ironsong", "Wispmourne", "Galeforce_",
  "Brimstone_RL", "Hollowreach", "Silvermarch", "Ashenvale_", "Duneshroud", "Nightspire",

  // Short, punchy single-word tags.
  "Kindred", "Rictus", "Marrow", "Talonis", "Vantage_", "Cipherx", "Runeblade", "Fenrisk",
  "Talisker", "Wrenfield", "Corvusx", "Halberd_", "Grimwald", "Bastion_RL", "Skarn",
  "Thistledown", "Warden_X", "Faelan", "Duskrider", "Ashgrove",

  // A handful with playful decimal/percent flair, common on modern platforms.
  "99.Percentile", "Ping_Zero", "Overtime.exe", "DoubleTap_", "FastKickoff", "SaveOrDie",
  "BackboardBanger", "CornerPinch_", "ZeroBoost", "FullSend.gg",
];
