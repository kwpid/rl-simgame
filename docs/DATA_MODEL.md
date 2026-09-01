# Rocket League Sim, Data Model

Written as TypeScript interfaces for precision. These live conceptually in `src/engine/*/types.ts`, split by domain, shown together here for readability.

---

## Career / Save

```ts
interface CareerSave {
  id: string;
  createdAt: string;
  startDate: GameDate;          // the chosen starting year/month, locks initial meta era
  currentDate: GameDate;
  username: string;
  realName: string;
  age: number;
  region: Region;
  player: Player;
  weekPlan: WeekPlan;
  rankedProfiles: Record<QueueMode, RankedProfile>;
  tournamentHistory: TournamentResult[];
  friends: Friend[];
  parties: Party[];
  orgRelationships: OrgRelationship[];   // see Org System below
  inventory: CosmeticItem[];
  titles: string[];              // earned title ids
  seasonProgress: SeasonProgress;
  matchHistory: MatchSummary[];  // lightweight refs, not full logs (logs pruned/archived)
  retired: boolean;              // gates fame decay rate, see Fame System
}

interface GameDate {
  year: number;
  month: number;   // 1-12
  day: number;     // 1-7 within a sim "week", or absolute day counter, TBD when calendar is built
}
```

### Save creation inputs
Collected at new-save time, not derivable/defaulted:
```ts
interface NewSaveConfig {
  username: string;        // public/recognized name, what fame, leaderboards, org scouting see
  realName: string;        // flavor-only, shown in "profile" screens, not used in matchmaking display
  startingAge: number;
  startDate: GameDate;     // the year/month that locks initial meta era
  region: Region;
}

type Region = "north_america" | "europe" | "oceania" | "south_america" | "mena" | "asia_pacific";
```
Age isn't just flavor, worth deciding now whether it feeds a long-term mechanical-learning-speed curve and a soft "retirement window," or stays cosmetic for v1. Recommend: stays cosmetic/flavor for v1, add the aging curve later if the core loop needs more long-game texture.

---

## Player

```ts
interface Player {
  name: string;
  playstyle: PlaystyleId;         // chosen at creation, can drift slightly via training bias
  foundationStats: Record<FoundationCategory, number>;  // UNCAPPED, same growth shape as Game Sense
                                    // (diminishing returns, no hard ceiling). See Foundation Stats section.
  mechanicalStats: Record<MechanicId, number>;  // UNCAPPED mastery value per named mechanic, no hard gate
                                    // besides era, see Mechanic Fund section, training efficiency varies instead
  gameSense: number;              // UNCAPPED, see Game Sense section. Elite pros sit at 10k+, a fresh
                                    // low-rank player in the low hundreds. Not directly trainable via tree.
  mechanicalConsistency: number;  // UNCAPPED, see Mechanical Consistency section. Overall execution
                                    // reliability, distinct from any single foundation stat or Game Sense.
  fame: StatValue;                // 0-100, separate track from rank/gamesense, see Fame System
  fatigue: StatValue;             // 0-100, rises with hours played, decays with rest
  cumulativeGameHours: number;    // feeds gamesense trickle growth
  mechanicProgress: Record<MechanicId, { hoursInvested: number; currentValue: number }>;  // see Mechanic Fund
  careerStats: CareerStats;       // wins/losses/goals/saves/MVPs etc, per queue
}

type StatValue = number; // 0-100. Only for stats that genuinely have a real ceiling (fame, fatigue).
                          // Game sense, foundation stats, and mechanic mastery are all uncapped `number`
                          // instead, see [[feedback-depth]] memory: don't default to 0-100 caps everywhere.

interface CareerStats {
  perQueue: Record<QueueMode, { wins: number; losses: number; goals: number; assists: number; saves: number; mvps: number }>;
}
```

### Daily Form (hidden, ephemeral, not persisted, not shown in UI)
Rolled fresh each sim-day, not stored on the save, this is intentionally not a stat the player manages, just texture on the match sim.
```ts
interface DailyForm {
  modifier: number;   // small multiplier applied to all stat checks for that day's matches, e.g. 0.9-1.1
}

// generateDailyForm(): rare outliers (~8-10% chance of a below-average roll, symmetric small chance of an
// above-average one), otherwise clusters near 1.0. Never surfaced numerically in UI, at most, a match log
// line might hint at it ("felt a step behind all game") without stating a number, and only on notably off days.
```

---

## Playstyle

```ts
type PlaystyleId = "defensive" | "speed_nwpo" | "mechanical" | "gamesense" | "hybrid";

interface PlaystyleDefinition {
  id: PlaystyleId;
  label: string;
  description: string;
  xpCostModifiers: Partial<Record<SkillCategory, number>>; // e.g. mechanical playstyle: cheaper mechanical nodes
  matchSimBias: Partial<Record<EventNodeType, number>>;    // nudges event-chain probabilities/branch choices
}
```

---

## Meta Timeline (mechanic/era gating)

```ts
interface MetaTimelineEntry {
  mechanicId: MechanicId;
  label: string;                  // "Flip Reset", "Speedflip", "Ceiling Shot", "Air Dribble"
  eraStart: GameDate;             // when it starts appearing as viable/known
  prerequisiteMechanics: MechanicId[];
  category: SkillCategory;
}

type MechanicId = string; // keys into skill-tree.json + meta-timeline.json, kept in sync
```

Query used constantly: `isUnlockedAtDate(mechanicId, currentDate): boolean`, gates both the player's own skill tree AND what opponents/NPCs are allowed to use in the match sim.

---

## Foundation Stats (the trunk beneath the mechanic fund)

A small set of broad, uncapped stats trained through general freeplay/drill packs, not tied to any one named move. Two groups: mechanical (raw execution) and tactical (trained via scripted scenario packs, not live reps, distinct from Game Sense which only comes from actual matches/coaching per the Game Sense section above).

```ts
type FoundationCategory = "carControl" | "aerialControl" | "boostManagement" | "offense" | "defense" | "passing";
```
- Mechanical: `carControl`, `aerialControl`, `boostManagement`
- Tactical: `offense`, `defense`, `passing`

Named mechanics scale their training efficiency off these (see the Mechanic Fund section below), rather than being hard-gated by them.

Implemented in `src/data/mechanics.ts` for the current prototype (`FOUNDATION_LABELS`, `FOUNDATION_GROUPS`).

---

## Mechanic Fund, no hard prerequisites, only era gating and training efficiency

**Design decision, replacing an earlier hard-prerequisite skill tree:** a real player can attempt Flip Reset before mastering Ceiling Shot, they'll just be bad at it and progress slowly. So mechanics are NOT gated behind each other. The only hard gate is era, a mechanic literally doesn't exist in the game world before its discovery date. Everything else (a foundation stat being underdeveloped, not having trained a related mechanic yet) affects **efficiency**, how fast training hours convert into mastery, not whether you're allowed to train it at all. This is the "fund" model: invest hours in whatever mechanic you want, get better returns when you're prepared for it.

Every mechanic is a standalone entry in `data/mechanics/*.json` (one file per mechanic, or one array file if the list stays small, either way, **adding a mechanic never touches engine code**).

**Content scale**: `src/data/mechanics.ts` currently holds ~80 mechanics across 10 branches (Movement, Ground Control, Flicks, Aerial Control, Pinches, Defensive Mechanics, Positioning, Kickoff, Passing, Boost Management). At that size a flat list would overwhelm the Training screen, so the Mechanics tab uses a branch-pill selector (`TrainingScreen.tsx`), one branch's mechanics visible at a time, rather than stacking every branch's full card grid on one page.

```ts
type TrainingStyle = "solo_training" | "training_plus_reps"; // flavor only, not a gate

interface MechanicDefinition {
  id: MechanicId;
  label: string;
  description: string;
  branch: string;                        // category grouping for the UI (Aerial, Positioning, Kickoff, ...),
                                          // no gating meaning, just organizes the fund's list into sections
  eraStart: GameDate;                     // hard gate, see Meta Timeline above
  trainingStyle: TrainingStyle;
  recommendedStat?: FoundationCategory;   // scales efficiency, does not block training
  recommendedStatValue?: number;
  recommendedAfter?: MechanicId[];        // soft synergy hint: efficiency bonus if these are already
                                          // trained, shown as a UI tip, never a lock
}

interface MechanicAvailability {
  discovered: boolean;      // false only if era not yet reached, the one hard gate
  eraDetail?: string;       // set only when !discovered, e.g. "Not discovered until Aug 2018"
  statReadiness: number;    // 0-100+, % of recommendedStatValue currently met (100 if no stat requirement)
  synergyBonus: number;     // 0-30, % bonus from already-trained recommendedAfter mechanics
  efficiency: number;       // overall %, floor of 25% even when completely underprepared, so training
                            // is always possible, just slow, never impossible
}
```

Efficiency formula (`getMechanicAvailability` in `src/data/mechanics.ts`): `efficiency = min(150, max(25, min(100, statReadiness)) + synergyBonus)`, where `synergyBonus` is +15% per already-trained `recommendedAfter` mechanic, capped at +30%. A well-prepared player training a mechanic they have real synergy for can exceed 100% efficiency; an underprepared player training something far above their level still makes progress, just slowly.

**Adding a new mechanic later (e.g. a hypothetical "Raddah Reset" discovered in-universe in 2026) is just:** one new entry in `data/meta-timeline.json` for the era gate, and one new entry in `data/mechanics.ts`/`data/mechanics/*.json` with its branch, recommended stat, and synergy hints. No code changes, no branching logic to write.

**Training is now functional in the current prototype** (`useSaveStore.trainFoundationStat/trainMechanic/trainQueueConcept`): each session applies a diminishing-returns gain (`3000 / (3000 + currentValue)` curve, big early gains, slow late gains, never a hard cap) scaled by the mechanic/concept's efficiency percentage and dampened by the player's current fatigue (training while worn out returns less), and raises fatigue slightly. This is what makes the efficiency number mean something concrete rather than being cosmetic.

**Skill Point gate, closing the loop from the original design chat.** Without a cost, nothing stopped a player from just spamming Train → Rest → repeat forever without ever touching ranked, so mechanics (freeplay-trainable, unlimited, matches how real practice packs work) are the only fully free category. Foundation stats split into Mechanical (Car Control, Aerial Control, still free) and Tactical (Boost Management, Offense, Defense, Passing, moved out of Mechanical on purpose since these are resource-management/decision skills, not raw execution). Tactical sessions and all Playlist Concept sessions cost 1 Skill Point each. Skill Points only come from leveling up (`applyExp` in `useSaveStore.ts`), and leveling only comes from ranked-match EXP (`recordMatchResult`, win/loss payout scaled by queue, 1v1 pays the most since it's the hardest queue to rank up in). This is the "EXP → Level → Skill Points" flow sketched all the way back in the original design conversation, finally wired up.

---

## Playlist Concepts (queue-specific tactical/mental skills, separate from the Mechanic Fund)

1v1, 2v2, and 3v3 are different games in practice, not just "the same mechanics with fewer players." A 1v1 grinder needs to read an opponent's habits and defend on low boost; a 2v2 player needs to adapt to a specific teammate and know when to leave one back; a 3v3 player needs full-team rotation discipline. `src/data/queueConcepts.ts` models this as its own fund, same no-hard-gate philosophy as the Mechanic Fund (only a readiness stat and synergy affect efficiency, never availability), but keyed by `QueueMode` instead of era, these are tactical/mental concepts, not physically discovered tech, so there's no era gate at all.

```ts
type ConceptCategory = "mindset" | "rotation" | "boost" | "pressure" | "teamplay";
type ReadinessStat = FoundationCategory | "gameSense"; // mindset concepts often scale off gameSense directly

interface QueueConceptDefinition {
  id: string;
  label: string;
  description: string;
  queue: QueueMode;
  category: ConceptCategory;
  recommendedStat?: ReadinessStat;
  recommendedStatValue?: number;
  recommendedAfter?: string[];   // other concept ids, synergy only, same as Mechanic Fund
}
```

Current prototype has 10 concepts for 1v1 (mid-match adaptation, reading an opponent, car reading, mind games, air-dribble bumps, low-boost attacking/defending, boost starving, shot selection, tilt management), 9 for 2v2 (teammate adaptation, possession play, rotation basics, leaving one back, punishing overcommits, backpost rotation, fake challenges, duo boost starving, communication timing), and 6 for 3v3 (full rotation discipline, third man, passback setups, boost distribution, field awareness, defensive shell). `getConceptAvailability()` mirrors `getMechanicAvailability()`'s efficiency formula exactly.

---

## Game Sense (explicitly separate growth model, UNCAPPED)

Unlike most stats, game sense has no ceiling. It's raw accumulated points, not a 0-100 percentage, an elite pro might carry 10,000+, a fresh low-rank player a few hundred. This is intentional: it should keep meaningfully separating skill levels for the entire length of a long career save instead of everyone asymptoting toward the same cap.

```ts
interface GameSenseGrowthEvent {
  source: "ranked_1s" | "ranked_2s" | "ranked_3s" | "coaching" | "passive_hours";
  amount: number;                  // small per-event gain, NOT diminishing-returns-capped like a 0-100 stat ,
                                    // amount itself shrinks slightly as current gameSense rises (harder to
                                    // eke out new reads the more you already know), but never hits a hard wall
}

interface GameSenseDecayEvent {
  weeksInactive: number;
  amount: number;   // negative; very slow, losing game sense should take real, sustained inactivity
}
```

No tree node grants game sense directly, it only accrues via logged `GameSenseGrowthEvent`s emitted by match-sim results (1v1 reps weighted highest per match since you're solely responsible for every read), coaching-session resolution, and the passive hours trickle. Coaching sessions are rate-limited (e.g. max N/week) and cost in-game currency/time. Decay applies weekly when no ranked matches were played that week, the rate should be small enough that a short break barely registers and only extended inactivity (full retirement-length gaps) produces a real drop, since game sense is framed as the "stickiest" stat in the game.

**UI implication:** since this isn't a 0-100 stat, don't render it as a percentage-fill bar (misleading, implies a ceiling that doesn't exist). Show the raw number, optionally with a relative/percentile framing ("top 8% of tracked pros") if we want a legible sense of where a value sits without implying a max.

---

## Fame System

Deliberately separate from Rank and Game Sense, skill and marketability can diverge on purpose (a mechanically dominant but "boring" grinder vs. a flashy lower-rank player who's fun to watch).

```ts
type FameSource =
  | "flashy_play"            // detected from match-sim event log: high-flair outcomes (air dribble/ceiling
                              // goals, innovative reads) weighted up for "innovative" playstyle traits
  | "showmatch_result"       // community-creator showmatches (Feer/Johnnyboi-style, fictionalized)
  | "community_tournament"
  | "media_moment"           // a rare, big highlight-reel event roll
  | "content_creation";      // streaming/clips, see DayActivity below

interface FameGrowthEvent {
  source: FameSource;
  amount: StatValue;
}

// Fame decay: applied weekly if no FameGrowthEvent occurred that week. Slow while actively grinding ranked/
// tournaments even without a fame-specific event (staying visible via results counts for a little), much
// faster if `CareerSave.retired === true` or the player has gone quiet for an extended stretch.
```

**Content creation is a real time trade-off, not a free fame source**, modeled as its own `DayActivity` (below) that competes directly for calendar slots against training/ranked/coaching. Leaning hard into content (the Mizu/Flitz pattern) grows Fame fast but starves EXP, gamesense reps, and training hours, so going full-creator measurably slows a competitive career rather than just being strictly additive.

---

## Org System

Its own domain, not a simple fame threshold, fit depends on region, playstyle, and results, and the relationship progresses through real stages.

```ts
interface Org {
  id: string;
  name: string;              // fictional, not a real org
  region: Region;
  prestige: StatValue;       // gates which tournament tiers a signed player can access
  playstyleFit: Partial<Record<PlaystyleId, number>>;   // affinity weighting per org identity
}

type OrgRelationshipStatus =
  | "none" | "scouted_interest" | "tryout_invited" | "tryout_passed"
  | "bootcamp_trial" | "signed" | "released";

interface OrgRelationship {
  orgId: string;
  status: OrgRelationshipStatus;
  fitScore: number;   // derived from fame + rank + region match + playstyleFit affinity
}
```

Progression is stage-gated, not a single roll: fame/rank/region/fit crossing a threshold produces `scouted_interest` → the org offers a `tryout_invited` (a scheduled evaluation, see DayActivity) → passing leads to `bootcamp_trial` (a period of exclusive training with the org, boosting chemistry/mechanics faster than solo practice but consuming calendar time) → `signed`. A signed player can later be `released` (poor results, org restructuring) and re-enter the scouting pool, keeps org status a living thing, not a one-way unlock.

---

## Ranked

```ts
type QueueMode = "1v1" | "2v2" | "3v3";

interface RankedProfile {
  queue: QueueMode;
  mmr: number;
  rankTier: RankTier;              // Bronze..SSL, derived from mmr
  division: number;                // I-IV per tier (matches real RL), ignored when the tier has no split
                                    // in the current era (SSL, legacy Grand Champion)
  divisionProgress: number;        // 0-5 pips filled within the current division, ~2 wins per pip, like
                                    // real RL. Filling all 5 promotes to the next division (or next rank
                                    // if already at the top division of the current tier).
  seasonMatchesPlayed: number;
}

type RankTier = "bronze" | "silver" | "gold" | "platinum" | "diamond" | "champion" | "grand_champion" | "ssl";
```

### Rank visual era (a second, separate "in-universe date gates content" system)
Mirrors real RL's Sept 2020 free-to-play relaunch, which changed both rank art AND tier structure, not just the mechanic meta-timeline. Implemented in `src/data/rankSystem.ts`:
- **Legacy era** (saves before Sept 2020): flat Grand Champion cap, no Supersonic Legend, no GC division split.
- **Modern era** (Sept 2020+): Grand Champion splits into I/II/III, Supersonic Legend added above it.
- Rank badge images are pure content, dropped into `public/ranks/{legacy,modern}/{tier}-{division}.png` (naming convention documented in `public/ranks/README.md`), missing files fall back to a generated color badge so the UI never breaks waiting on art.
- This is intentionally decoupled from the mechanic meta-timeline (`MetaTimelineEntry`) even though both key off `GameDate`, one gates what mechanics exist, the other gates what rank tiers/art exist. Don't merge them; they model different things and might diverge later (e.g. a rank-art refresh with no mechanic changes).

---

## Ranked Seasons

Implemented in `src/data/seasons.ts` + the date-advancing actions in `useSaveStore.ts`. One shared season number/clock across all 3 queues (`seasonNumber`, `seasonStartDate`, `seasonNumberingReset` on the save), but each queue's rank resets and re-places independently. `SEASON_LENGTH_DAYS` (84, ~12 weeks) controls the cadence. Every action that advances the clock (`trainFoundationStat`, `trainMechanic`, `trainQueueConcept`, `rest`, `sleepToNextDay`, `advanceClock`) routes through `withDateAdvance`, which checks `processSeasonRollover` after moving the clock, so a season can end mid-training-session or mid-rest, not just from a dedicated "end season" action. Handles more than one season ending in a single big time jump via a guarded loop.

**Rollover, per queue:**
- MMR soft reset (`softResetMmr`): compresses toward the 600 baseline by 30%, doesn't wipe it, a Champion doesn't fall to Bronze.
- `placementMatchesRemaining` reset to 10, `rankTier` back to `"unranked"`, division/divisionProgress/seasonMatchesPlayed reset to 0.
- `peakRankTier`/`peakDivision` (tracked on `RankedProfile`, set whenever placements complete) resets to unranked for the new season, after being read for the reward payout above.

**Season numbering resets to 1 the first time a season ends inside the modern (SSL) era**, mirroring real RL's post-free-to-play renumbering, tracked via the one-way `seasonNumberingReset` flag so it only happens once.

**Season titles, only Grand Champion and Supersonic Legend qualify** (`seasonTitleFor` in `seasons.ts`), everything below earns no title, matching real RL:
- Legacy era: `"SEASON {n} GRAND CHAMPION"`, gold glow.
- Modern era: `"S{n} GRAND CHAMPION"` (red glow) or `"S{n} SUPERSONIC LEGEND"` (white glow).
- One title per season is granted regardless of how many queues reached the qualifying tier, dedup'd by a deterministic id so hitting GC in both 2v2 and 3v3 the same season doesn't produce two copies.
- `seasonRewardTier` (0-8) is set from the best peak tier across all three queues via `rewardTierForPeak`.

---

## Titles (reworked to match real RL's title system)

```ts
type TitleGlow = "none" | "gold" | "red" | "white";
interface TitleEntry { id: string; label: string; glow: TitleGlow; }
```
`titles: TitleEntry[]` replaces the old flat `string[]`, and `equippedTitleId: string | null` replaces `equippedTitle: string`, `null` is a first-class choice (no title displayed), same as real RL. Most titles are grey (`glow: "none"`), earned through ordinary play (a starting "Rookie" title, mechanic-adjacent ones like "Speedflip Adopter"). Only season-end rewards (and eventually RLCS results) produce a glow title, rendered with a colored text-shadow/border in the Locker (`GLOW_STYLES` in `LockerScreen.tsx`).

---

## Match Simulation (event chain)

```ts
type EventNodeType =
  | "kickoff" | "fifty_fifty" | "wall_read" | "aerial_attempt" | "flip_reset_attempt"
  | "bump" | "rotation_check" | "shot_attempt" | "save_attempt" | "clear" | "goal" | "whiff";

interface MatchEventNode {
  type: EventNodeType;
  possibleOutcomes: EventOutcome[];  // weighted by relevant Player/Playstyle/GameSense/era-gated stats
}

interface EventOutcome {
  label: string;                    // becomes a MatchLog line, template-filled
  weightFn: (ctx: MatchSimContext) => number;  // stat-driven probability
  next?: EventNodeType;              // chains into the next node, or null/undefined = possession ends
  movementIntent: MovementIntentTemplate;  // Tier 2 viewer hook, see below
}

interface MatchSimContext {
  attacker: Player; defender: Player; // or teams for 2s/3s
  currentDate: GameDate;
  queue: QueueMode;
}

interface MatchResult {
  log: MatchLogLine[];
  movementIntents: MovementIntent[];   // full timestamped sequence for the viewer
  score: { self: number; opponent: number };
  xpGained: number;
  gameSenseEvents: GameSenseGrowthEvent[];
}

interface MatchLogLine {
  timestamp: number;    // seconds into the match
  text: string;
}
```

**Current prototype** (`src/data/matchSim.ts`, `src/store/useMatchStore.ts`): a hand-authored possession-chain resolver rather than the fully generic node-graph above, same spirit, smaller scope for now. Each possession picks an attacker (weighted toward higher offense/gameSense), picks a play type (aerial, wall read, ground flick, 50/50, weighted by the attacker's own stats, e.g. higher aerialControl makes attempting an aerial more likely), then resolves a short chain of stat-checked steps (attempt, whiff, contest, finish, save), each producing a log line. Stat comparisons use a logistic function (`statProbability`) converting an arbitrary stat gap into a win probability, so a big lead is decisive but never a guaranteed lock. AI opponents/teammates are generated fresh per match, scaled to the queue's rank tier (`RANK_STAT_BASELINE`) with individual jitter, not identical clones. See Mechanical Consistency below for the whiff/variance side of the formula.

---

## Mechanical Consistency (new stat alongside Game Sense, UNCAPPED)

Represents overall training-derived execution reliability, separate from any single foundation stat or mechanic mastery, and separate from Game Sense (decision-making). A player can have high Aerial Control but low consistency (talented but streaky), or the reverse (steady fundamentals, rarely spectacular). In the match sim it reduces whiff chance and variance on skill-check events, alongside the relevant foundation stat itself (e.g. an aerial attempt's whiff chance factors both `aerialControl`, can they do the move at all, and `mechanicalConsistency`, do they reliably execute it). Uncapped, same growth shape as Game Sense. Growth model (training breadth feeding this over time) isn't implemented yet, current prototype just seeds a static value per save.

## Match Viewer (Tier 2, continuous tween, event-driven)

```ts
interface MovementIntentTemplate {
  // authored per EventOutcome, instantiated with real positions at resolve time
  entities: ("self" | "teammate" | "opponent1" | "opponent2" | "ball")[];
  pathShape: "arc" | "straight" | "hold" | "curve_to_goal";
  durationMs: number;
}

interface MovementIntent {
  entityId: string;           // resolves to a team-colored dot (orange/blue) or the ball
  from: PitchPosition;
  to: PitchPosition;
  startMs: number;            // offset within the match's real-time playback
  durationMs: number;
  easing: "linear" | "ease_in" | "ease_out" | "arc_high" | "arc_low";
}

interface PitchPosition { x: number; y: number; z: number; } // z for wall/air height, normalized 0-1 pitch coords
```

`intent-player.ts` walks `MovementIntent[]` sorted by `startMs` and drives the Canvas renderer frame-by-frame, this is the whole Tier 2 viewer, no physics engine involved.

---

## Calendar / Week Plan

```ts
interface WeekPlan {
  days: Record<1 | 2 | 3 | 4 | 5 | 6 | 7, DayActivity>;
}

type DayActivity =
  | { type: "training"; mechanicId: MechanicId; hours: number }
  | { type: "ranked"; queue: QueueMode; hours: number }
  | { type: "coaching"; hours: number; cost: number }
  | { type: "tournament"; tournamentId: string }
  | { type: "content_creation"; hours: number }         // fame growth, trades off vs. training/ranked time
  | { type: "org_tryout"; orgId: string }
  | { type: "bootcamp"; orgId: string; hours: number }
  | { type: "rest" };
```

**Current prototype uses a lighter model than the `WeekPlan` above, by deliberate choice, not yet built out.** Rather than pre-planning a full week of `DayActivity` slots in advance, `src/data/dateUtils.ts` + `clockHour` on the save implement a live clock: every action (training, a ranked match) costs real hours and advances `currentDate`/`clockHour` directly at the moment you do it, "spend the next hour training Defense" rather than "assign 3-4pm Monday to Defense training in advance." `useSaveStore.rest`/`sleepToNextDay`/`advanceClock` handle passing time without a specific activity. The `WeekPlan` structure above may still be worth building later for genuine forward scheduling (e.g. "block off tomorrow morning for a coaching session"), but the user explicitly chose the simpler live-clock model for now over full advance planning.

---

## Tournaments

```ts
type TournamentTier = "local" | "regional" | "major" | "rlcs";

interface Tournament {
  id: string;
  tier: TournamentTier;
  queue: QueueMode;             // most tournaments 3v3, but keep generic
  bracket: BracketMatch[];
  entryRequirement?: { minRankTier?: RankTier; invite?: boolean };
}

interface BracketMatch {
  round: number;
  participants: [string, string]; // player/team ids, "self" for the user
  result?: MatchResult;
}

interface TournamentResult {
  tournamentId: string;
  placement: number;
  rewards: Reward[];
}
```

---

## Social

```ts
interface Friend {
  id: string;
  name: string;
  metVia: QueueMode;
  relationshipLevel: number;   // maybe affects party synergy/chemistry bonus
}

interface Party {
  id: string;
  memberIds: string[];         // includes "self"
  queue: QueueMode;
}
```

---

## Progression / Rewards

```ts
interface SeasonProgress {
  seasonId: string;
  xp: number;
  rewardTierUnlocked: number;
}

interface Reward {
  type: "title" | "cosmetic" | "currency";
  refId: string;
  amount?: number;
}

interface CosmeticItem {
  id: string;
  slot: "car_body" | "wheels" | "boost" | "decal" | "topper" | "banner" | "avatar_border";
  unlockedVia: "season_reward" | "tournament" | "shop" | "achievement";
}
```

---

## NPC Opponent Identity Pool

Opponent/teammate names should feel right for the context, a Bronze ranked lobby reads completely differently from an RLCS grand final. This is pure data, tiered by context, with the match-sim just picking from the right pool:

```ts
type NamePoolTier =
  | "low_rank_random"     // xbox-gamertag energy: "xX_Toaster_Xx", "yeetmaster420", "Guest-9284104"
  | "mid_rank_grinder"    // sweatier but still amateur: "ZenBoostReset", "FlickGodTTV", "NoScopeNoah"
  | "high_rank_grinder"   // GC/SSL-flavored, more "serious player" energy
  | "pro_circuit";        // RLCS-caliber fictional pro names/orgs, deliberately NOT real pro names (see note)

interface NamePoolEntry {
  name: string;
  tier: NamePoolTier;
  orgTag?: string;         // pro circuit only, e.g. "[NRG]" style fictional org tags
}
```

- Stored as flat lists in `data/names/{tier}.json`, easy to bulk-edit or extend (just append strings).
- Opponent generation picks: `rankTier → NamePoolTier` mapping (Bronze/Silver → low_rank_random, Gold/Plat → mid_rank_grinder, Diamond/Champ → high_rank_grinder, GC/SSL + tournament/RLCS fields → pro_circuit).
- **Naming note:** I'd generate fictional-but-plausible pro/org names rather than real pro players' names/likenesses, real players' names carry real-world reputations and using them in a simulated-loss context could be legally/ethically messy (right of publicity) even in a hobby project. Easy to make them feel authentic without being 1:1 real people. Worth confirming this is fine with you before we seed the pro-tier list.

---

## Cross-cutting notes
- `MechanicId` is the join key between `meta-timeline.json`, `skill-tree.json`, `Player.mechanicalStats`, and event-chain gating, keep these in lockstep, probably worth a small build-time validator that errors if a skill node references a mechanic missing from the timeline.
- `MatchResult.movementIntents` is the only Tier-2-specific payload, everything else in `MatchResult` is viewer-agnostic, so dropping the viewer for fast-sim weeks is just "don't render this field."
- Full `MatchLogLine[]` per match is probably too heavy to keep for every historical match, `matchHistory: MatchSummary[]` on the save should store a condensed summary, with full logs either discarded after viewing or capped to "last N matches."
