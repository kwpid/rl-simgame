// Runs every scheduled tournament instance (RLCS regionals + EWC/ELEAGUE), purely date-driven like the
// pro leaderboard's season ramp: nothing ticks in the background, `ensureProgress` (called from a
// `useEffect`, never render-time) checks how many in-game days have passed and resolves whatever stage
// should have finished by now for each instance, persisting the result. New instances are created lazily
// once their scheduled start date arrives, per data/tournaments.ts's `buildSeasonSchedule`.

import { create } from "zustand";
import type { SimDate } from "@/data/dateUtils";
import { daysBetween, addDays } from "@/data/dateUtils";
import { PRO_PLAYERS, type ProRegion } from "@/data/proPlayers";
import { eraForDate } from "@/data/rankSystem";
import {
  buildSeasonSchedule,
  rlcsSeasonForDate,
  rlcsStructureEra,
  generateTeamsForRegion,
  realTeamsForRegion,
  generateGlobalTeams,
  generateSoloEntrantsForRegion,
  generateRivalSeriesTeamsForRegion,
  titlesEarnedForKind,
  pickFictionalPastRlcsTitle,
  MAJOR_GROUPS,
  MAJOR_STAGES,
  WORLDS_STAGES,
  RLCS_REGIONS,
  RLCS_1V1_REGIONS,
  RLCS_1V1_INTRODUCED_SEASON,
  type ScheduledTournament,
  type TournamentKind,
} from "@/data/tournaments";
import type { TitleEntry } from "@/data/seasons";
import {
  runSwissStage,
  runGslGroupStage,
  buildDoubleElimBracket,
  buildSingleElimBracket,
  resolveRemainingBracket,
  resolveNodeAndAncestors,
  resolvePlayerNode,
  bracketStageResult,
  feederFor,
  type StageConfig,
  type TournamentTeam,
  type StandingEntry,
  type StageResult,
} from "@/data/tournamentFormats";
import { allNodes, findNodeForTeam, type BracketTree } from "@/data/bracketTypes";

const STORAGE_KEY_PREFIX = "rl-sim:tournament-instances-v2";

// Tournament progress (majors, regionals, the player's own registration/bracket) is scoped to whichever
// save is currently active, same as the save's own data — otherwise switching saves, or deleting one and
// starting fresh, would leave a "ghost" registration (a different username, a bracket state that makes no
// sense for the new save's timeline) sitting in a single shared blob forever, silently confusing every
// readiness/major-formation check that assumed it was the current player's. `loadForSave` (called from
// AppRoot alongside `initFromSave`) is what actually switches which save's data this store is reading from.
let activeSaveId: string | null = null;

/** Set only by the dev "Restart RLCS Season" tool (see resetAllInstances) — when non-null and its RLCS
 *  season number still matches the current one, `ensureProgress` builds this season's schedule from
 *  `addDays(seasonRestartAnchor, RLCS_RESTART_DELAY_DAYS)` instead of the real Jan-1 anchor, so every
 *  region's regional (and majors/Worlds downstream of them) reopens with a fresh on-ramp from the moment of
 *  the restart, the same way a brand-new save's first season gets one, rather than recomputing the exact
 *  same already-stale Jan-1-anchored schedule the reset was trying to escape. Reverts to the real Jan-1
 *  anchor on its own once the calendar actually reaches next season, no explicit clearing needed. */
let seasonRestartAnchor: SimDate | null = null;
const RLCS_RESTART_DELAY_DAYS = 7;

/** The real RLCS season number/start-date to actually schedule from, accounting for BOTH a fresh save's
 *  first-season on-ramp (RLCS_FIRST_SEASON_DELAY_DAYS) and a dev restart's on-ramp (`seasonRestartAnchor`)
 *  — this MUST be the single source of truth for "what season start date is RLCS actually using right
 *  now", since `ensureProgress` (which creates/advances instances) and any UI code that independently
 *  recomputes the season's schedule for DISPLAY purposes (TourneysScreen.tsx's own `buildSeasonSchedule`
 *  call, and `projectedSeasonSchedule` below) both need to agree on it.
 *
 *  Critically, this shifts the WHOLE anchor `buildSeasonSchedule` staggers every region from, rather than
 *  gating/clamping each item's own date independently — the latter was tried and is wrong: once a delay
 *  (90 days for a first season, say) is longer than the stagger spread between regions (at most ~70 days
 *  for 7 regions), EVERY region's individually-clamped date collapses onto the exact same day, destroying
 *  the whole point of staggering regions apart. Shifting the anchor instead means `buildSeasonSchedule`
 *  computes each region's date as normal (anchor + its own offset), so regions still open on different,
 *  staggered days — they're just all pushed later as a whole. */
export function effectiveRlcsSeason(currentDate: SimDate, saveStartYear: number): { seasonNumber: number; seasonStartDate: SimDate } {
  const { seasonNumber, seasonStartDate: realSeasonStartDate } = rlcsSeasonForDate(currentDate);
  const candidates: SimDate[] = [realSeasonStartDate];
  if (seasonNumber === saveStartYear) candidates.push(addDays(realSeasonStartDate, RLCS_FIRST_SEASON_DELAY_DAYS));
  const restartAppliesThisSeason = seasonRestartAnchor !== null && rlcsSeasonForDate(seasonRestartAnchor).seasonNumber === seasonNumber;
  if (restartAppliesThisSeason) candidates.push(addDays(seasonRestartAnchor!, RLCS_RESTART_DELAY_DAYS));
  const seasonStartDate = candidates.reduce((latest, d) => (daysBetween(latest, d) > 0 ? d : latest));
  return { seasonNumber, seasonStartDate };
}

function tournamentStorageKeyFor(saveId: string | null): string {
  return `${STORAGE_KEY_PREFIX}:${saveId ?? "unsaved"}`;
}

/** Exported so `saveManager.ts`'s `deleteSave` can wipe a save's tournament progress along with everything
 *  else, instead of leaving it as an orphaned blob nothing ever reads again but that still sits in storage. */
export function clearTournamentDataForSave(saveId: string): void {
  try {
    localStorage.removeItem(tournamentStorageKeyFor(saveId));
    localStorage.removeItem(restartAnchorStorageKeyFor(saveId));
  } catch {
    // Storage unavailable, nothing to clear.
  }
}

/** Raw (already-JSON-string) tournament progress for one save — RLCS history/instances plus the dev-restart
 *  anchor — read verbatim rather than parsed/re-typed, so `saveManager.ts`'s export/import can round-trip it
 *  without needing to know this store's internal shape. Exported so a save's full RLCS history actually
 *  travels with an export/import instead of being silently left behind (it lives in its own localStorage
 *  blob, not on the SaveData object itself). */
export function exportTournamentDataForSave(saveId: string): { instances: string | null; restartAnchor: string | null } {
  return {
    instances: localStorage.getItem(tournamentStorageKeyFor(saveId)),
    restartAnchor: localStorage.getItem(restartAnchorStorageKeyFor(saveId)),
  };
}

/** Writes a previously-exported blob (see `exportTournamentDataForSave`) into storage under a NEW save id —
 *  a plain localStorage write, doesn't touch this store's in-memory state at all, the normal `loadForSave`
 *  call that happens whenever a save is actually opened picks it up from here naturally. */
export function importTournamentDataForSave(saveId: string, data: { instances?: string | null; restartAnchor?: string | null }): void {
  try {
    if (data.instances) localStorage.setItem(tournamentStorageKeyFor(saveId), data.instances);
    if (data.restartAnchor) localStorage.setItem(restartAnchorStorageKeyFor(saveId), data.restartAnchor);
  } catch {
    // Storage full/unavailable, the imported RLCS history just won't carry over this session.
  }
}

const RESTART_ANCHOR_KEY_PREFIX = "rl-sim:tournament-restart-anchor";
function restartAnchorStorageKeyFor(saveId: string | null): string {
  return `${RESTART_ANCHOR_KEY_PREFIX}:${saveId ?? "unsaved"}`;
}
function loadRestartAnchor(): SimDate | null {
  try {
    const raw = localStorage.getItem(restartAnchorStorageKeyFor(activeSaveId));
    return raw ? (JSON.parse(raw) as SimDate) : null;
  } catch {
    return null;
  }
}
function persistRestartAnchor(anchor: SimDate | null) {
  try {
    if (anchor) localStorage.setItem(restartAnchorStorageKeyFor(activeSaveId), JSON.stringify(anchor));
    else localStorage.removeItem(restartAnchorStorageKeyFor(activeSaveId));
  } catch {
    // Storage full/unavailable, the dev restart buffer just won't survive a reload this session.
  }
}

export interface PendingPlayerMatch {
  opponentId: string;
  opponentName: string;
  seriesFormat: number;
}

export interface PlayerBracketProgress {
  teamId: string;
  wins: number;
  losses: number;
  eliminated: boolean;
}

export interface TournamentInstance {
  id: string;
  kind: TournamentKind;
  label: string;
  region: ProRegion | null;
  startDate: SimDate;
  stages: StageConfig[];
  stageIndex: number;
  stageStartDate: SimDate;
  currentTeams: TournamentTeam[];
  lastStandings: StandingEntry[];
  completed: boolean;
  championName: string | null;
  /** Set once the human player registers for this instance. Their journey through each stage is played
   *  out live match-by-match instead of simulated in bulk with everyone else, see `queuePlayerMatch`/
   *  `resolvePlayerMatch`. `playerFinalPlacement` is set once they're eliminated (or crowned champion),
   *  after which this instance goes back to resolving normally for the remaining AI field. */
  playerTeamId: string | null;
  playerBracket: PlayerBracketProgress | null;
  pendingMatch: PendingPlayerMatch | null;
  playerFinalPlacement: number | null;
  /** Real bracket trees (see data/bracketTypes.ts) for `double_elim`/`single_elim` stages, keyed by
   *  `stageIndex` — `swiss`/`gsl_group` stages never get an entry, they stay a plain standings table.
   *  Retention: only the CURRENT stage's tree is kept while the instance isn't completed (a superseded
   *  stage's entry is deleted the moment the instance advances past it — its outcome already lives in
   *  `lastStandings`); once `completed`, the FINAL stage's tree is kept permanently as the "how the
   *  champion was crowned" bracket, every earlier stage stays standings-only. Keeps storage bounded — a
   *  full Stage-1 tree runs ~70-85KB, everything else is a few KB. */
  stageBrackets: Record<number, BracketTree>;
}

/** How many days before an instance's scheduled start date registration opens (and its field is
 *  generated), so the player can see and join it ahead of time, not just the instant it begins. */
export const REGISTRATION_WINDOW_DAYS = 7;

/** A fresh save doesn't open its very first RLCS season immediately — a few months' on-ramp first, same
 *  spirit as a real rookie season not starting mid-split. Only ever applies to the save's first season. */
export const RLCS_FIRST_SEASON_DELAY_DAYS = 90;


/** Simplified, uniform rule for the player's own live journey through a stage: win enough series to
 *  clinch one of the stage's advancing spots, two losses (regardless of the stage's real-world format,
 *  Swiss/GSL included) always ends your run there, a generous safety net so one bad series doesn't feel
 *  as brutal as true single-elimination. The rest of the field still resolves via the real per-format
 *  logic, only the player's own path is simplified this way, for a consistent, always-fair play experience.
 *  Uses the ACTUAL current field size, not the stage's static config, a real double-elim round can
 *  overshoot below its target advanceCount in one pass, so the config's `entrants` isn't always accurate
 *  by the time the player is playing through it. */
function stageWinsNeeded(stage: StageConfig, actualFieldSize: number): number {
  return Math.max(1, Math.ceil(Math.log2(Math.max(2, actualFieldSize) / stage.advanceCount)));
}
const PLAYER_LOSSES_ALLOWED = 2;

type InstanceTable = Record<string, TournamentInstance>;

/** A standings entry with a missing/undefined `team` (the shape a save could have picked up from the
 *  empty-AI-field crash before that was fixed) would keep crashing forever otherwise, since the broken
 *  instance just gets loaded back out of storage as-is every session. Any instance that fails this check
 *  is dropped entirely rather than repaired in place, `ensureProgress` regenerates a fresh one on its own
 *  the next time it's due, which is simpler and safer than trying to patch a corrupted bracket. */
function isInstanceValid(instance: unknown): instance is TournamentInstance {
  if (!instance || typeof instance !== "object") return false;
  const inst = instance as Partial<TournamentInstance>;
  if (!Array.isArray(inst.currentTeams) || inst.currentTeams.some((t) => !t || typeof t.name !== "string")) return false;
  if (!Array.isArray(inst.lastStandings) || inst.lastStandings.some((e) => !e || !e.team || typeof e.team.name !== "string")) return false;
  if (!Array.isArray(inst.stages)) return false;
  // A won-it-all playerBracket resets to non-eliminated the same way advancing mid-tournament does, so a
  // save from before `completed`/`stageIndex` were guarded together could have a stageIndex that's already
  // past the end of `stages` for an instance that isn't marked completed, queuePlayerMatch would then index
  // past the stages array and crash on the very next visit.
  if (typeof inst.stageIndex === "number" && !inst.completed && inst.stageIndex >= inst.stages.length) return false;
  return true;
}

/** Drops any non-completed, non-player major/Worlds instance that the current (season-scoped) readiness
 *  rules would no longer actually create, e.g. one an earlier build spawned by treating any historically-
 *  completed regional as satisfying its prerequisites instead of only this season's. Leaves completed
 *  instances (they're just history now) and anything the player is actively playing (`playerTeamId` set)
 *  alone, so no live progress is ever lost — a bogus AI-only bracket just quietly disappears and is free
 *  to be recreated correctly, for real, once its regions actually earn it. */
function sanitizeMajorsAndWorlds(table: InstanceTable): boolean {
  let droppedAny = false;
  for (const id of Object.keys(table)) {
    const inst = table[id];
    if (inst.kind !== "rlcs_major" && inst.kind !== "rlcs_worlds") continue;
    if (inst.completed || inst.playerTeamId) continue;

    const discipline: RlcsDiscipline | null = id.includes("_1v1_") ? "1v1" : id.includes("_3v3_") ? "3v3" : null;
    if (!discipline) {
      delete table[id]; // pre-multi-discipline id shape, unreachable by any current lookup
      droppedAny = true;
      continue;
    }

    if (inst.kind === "rlcs_major") {
      const groupId = id.split("_")[2];
      const group = MAJOR_GROUPS.find((g) => g.id === groupId);
      const readiness = group ? getMajorReadiness(table, discipline, group, inst.startDate) : null;
      if (!readiness || readiness.kind !== "scheduled") {
        delete table[id];
        droppedAny = true;
      }
    } else if (rlcsStructureEra(inst.startDate.year) === "early") {
      const readiness = getEarlyEraWorldsReadiness(table, discipline, inst.startDate);
      if (readiness.kind !== "scheduled") {
        delete table[id];
        droppedAny = true;
      }
    } else {
      const bothMajorsDone = MAJOR_GROUPS.every((group) =>
        Object.values(table).some((m) => m.kind === "rlcs_major" && m.completed && m.id.startsWith(`major_${discipline}_${group.id}_`)),
      );
      if (!bothMajorsDone) {
        delete table[id];
        droppedAny = true;
      }
    }
  }
  return droppedAny;
}

function loadStored(): InstanceTable {
  try {
    const raw = localStorage.getItem(tournamentStorageKeyFor(activeSaveId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as InstanceTable;
    const clean: InstanceTable = {};
    let droppedAny = false;
    for (const [id, instance] of Object.entries(parsed)) {
      if (!isInstanceValid(instance)) {
        droppedAny = true;
        continue;
      }
      // stageBrackets didn't exist before this feature — an instance saved before it is missing the field
      // entirely, default to empty (its stages just rebuild a fresh tree the next time one's needed).
      clean[id] = (instance as TournamentInstance).stageBrackets ? instance : { ...instance, stageBrackets: {} };
    }
    if (sanitizeMajorsAndWorlds(clean)) droppedAny = true;
    if (droppedAny) persist(clean); // overwrite the corrupted blob on disk, not just in memory
    return clean;
  } catch {
    return {};
  }
}

function persist(table: InstanceTable) {
  try {
    localStorage.setItem(tournamentStorageKeyFor(activeSaveId), JSON.stringify(table));
  } catch {
    // Storage full/unavailable, tournament progress just won't persist across reloads this session.
  }
}

function bestOfForFormat(format: StageConfig["format"]): number {
  return format === "single_elim" ? 5 : 3;
}

/** Builds the real bracket tree for the instance's CURRENT stage if it's a bracket-shaped format
 *  (`double_elim`/`single_elim`) and doesn't already have one — no-op for `swiss`/`gsl_group` (they never
 *  get a tree) and no-op if a tree already exists for this stageIndex. Called whenever a stage becomes
 *  current (instance creation, advancing into a new stage) so the bracket is browsable — seeded and
 *  showing "who's playing who" — the moment the stage starts, even before any match has actually resolved. */
function ensureStageBracketBuilt(instance: TournamentInstance): TournamentInstance {
  const stage = instance.stages[instance.stageIndex];
  if (!stage || (stage.format !== "double_elim" && stage.format !== "single_elim")) return instance;
  if (instance.stageBrackets[instance.stageIndex]) return instance;
  const tree = stage.format === "double_elim" ? buildDoubleElimBracket(instance.currentTeams, stage.advanceCount) : buildSingleElimBracket(instance.currentTeams);
  return { ...instance, stageBrackets: { ...instance.stageBrackets, [instance.stageIndex]: tree } };
}

/** Resolves the instance's CURRENT stage in full (bulk AI simulation, no player involved) and returns the
 *  usual `{ advanced, standings }` shape — dispatches to the real bracket-tree path for `double_elim`/
 *  `single_elim` (resolving whatever the tree hasn't already had resolved lazily, e.g. by a player who was
 *  eliminated partway through and left the rest of the field to finish on its own) or straight to the
 *  unchanged Swiss/GSL simulators otherwise. */
function resolveStage(instance: TournamentInstance, currentDate: SimDate): StageResult {
  const stage = instance.stages[instance.stageIndex];
  if (instance.currentTeams.length === 0) return { advanced: [], standings: [] };
  if (stage.format === "double_elim" || stage.format === "single_elim") {
    const tree = instance.stageBrackets[instance.stageIndex];
    if (!tree) return { advanced: [], standings: [] }; // shouldn't happen, ensureStageBracketBuilt always runs first
    resolveRemainingBracket(tree, currentDate, bestOfForFormat(stage.format));
    return bracketStageResult(tree, stage.advanceCount);
  }
  if (stage.format === "swiss") return runSwissStage(instance.currentTeams, stage.advanceCount);
  return runGslGroupStage(instance.currentTeams, stage.advanceCount);
}

/** `aiSeasonStartDate` here is deliberately the player's own RANKED-LADDER season anchor, not the RLCS
 *  schedule's own season start date, even though this function otherwise deals entirely in RLCS terms
 *  (`seasonNumber`, `scheduled.startDate`, etc). The real pro/grinder MMR entries this reads via
 *  `generateTeamsForRegion`/`generateGlobalTeams` (see tournaments.ts's `eligibleRealPlayersForRegion`) are
 *  a single shared table keyed by `seasonStartKey` — every other caller of that same table (ranked
 *  matchmaking, org invites) already keys off the ranked ladder's season, so feeding it the RLCS schedule's
 *  differently-timed date here instead would make the SAME entries constantly reseed back and forth
 *  between two disagreeing season anchors every time a different subsystem queried them, each reseed
 *  landing near the fresh-reset floor — this was the actual cause of a thin region like MENA sometimes
 *  fielding almost no real teams (everyone eligible kept getting caught below the org rank floor). */
function createInstance(scheduled: ScheduledTournament, currentYear: number, seasonNumber: number, teamsResetSeed: number, currentDate: SimDate, aiSeasonStartDate: SimDate): TournamentInstance {
  const era = eraForDate(currentDate);
  const teams =
    scheduled.region === null
      ? generateGlobalTeams(currentYear, seasonNumber, teamsResetSeed, scheduled.id, era, currentDate, aiSeasonStartDate)
      : scheduled.kind === "rlcs_1v1_regional"
        ? generateSoloEntrantsForRegion(scheduled.region, currentYear, scheduled.fieldSize, scheduled.id)
        : scheduled.kind === "rlrs_regional"
          ? generateRivalSeriesTeamsForRegion(scheduled.region, scheduled.fieldSize, scheduled.id)
          : realTeamsForRegion(scheduled.region, currentYear, seasonNumber, teamsResetSeed, scheduled.id, era, currentDate, aiSeasonStartDate);
  const instance: TournamentInstance = {
    id: scheduled.id,
    kind: scheduled.kind,
    label: scheduled.label,
    region: scheduled.region,
    startDate: scheduled.startDate,
    stages: scheduled.stages,
    stageIndex: 0,
    stageStartDate: scheduled.startDate,
    currentTeams: teams,
    lastStandings: [],
    completed: false,
    championName: null,
    playerTeamId: null,
    playerBracket: null,
    pendingMatch: null,
    playerFinalPlacement: null,
    stageBrackets: {},
  };
  return ensureStageBracketBuilt(instance);
}

function advanceInstance(instance: TournamentInstance, currentDate: SimDate): TournamentInstance {
  // While the player is still alive in this tournament, this stage (and every stage after it) advances
  // only through them actually playing their matches (see queuePlayerMatch/resolvePlayerMatch), not on
  // the calendar. Once they're eliminated (or crowned champion), normal day-based auto-resolution resumes.
  if (instance.playerTeamId && instance.playerFinalPlacement === null) return instance;

  let current = ensureStageBracketBuilt(instance);
  let guard = 0;
  while (!current.completed && guard < current.stages.length + 1) {
    guard++;
    const stage = current.stages[current.stageIndex];
    if (daysBetween(current.stageStartDate, currentDate) < stage.days) break;

    const result = resolveStage(current, currentDate);
    const isLastStage = current.stageIndex + 1 >= current.stages.length;
    const hadTree = stage.format === "double_elim" || stage.format === "single_elim";
    const nextStageBrackets = { ...current.stageBrackets };
    // A superseded stage's tree is dropped (its outcome already lives in lastStandings) unless this was
    // the FINAL stage of a now-completed instance, in which case it's kept permanently as the "how the
    // champion was crowned" bracket.
    if (hadTree && !isLastStage) delete nextStageBrackets[current.stageIndex];

    current = {
      ...current,
      stageIndex: current.stageIndex + 1,
      stageStartDate: currentDate,
      currentTeams: result.advanced,
      lastStandings: result.standings,
      completed: isLastStage,
      championName: isLastStage ? result.standings.find((s) => s.placement === 1)?.team.name ?? null : null,
      stageBrackets: nextStageBrackets,
    };
    if (!isLastStage) current = ensureStageBracketBuilt(current);
  }
  return current;
}

/** A major/Worlds becomes possible some time after its prerequisites (regionals, or both majors) are
 *  actually done, not on a fixed calendar month, this is how long after that "readiness" moment it's
 *  scheduled to begin, real RLCS majors/Worlds land a month or two after the qualifiers that feed them. */
const MAJOR_DELAY_DAYS = 45;
const WORLDS_DELAY_DAYS = 35;

function dateKey(d: SimDate): string {
  return `${d.year}-${d.month}-${d.day}`;
}

export type RlcsDiscipline = "1v1" | "3v3";

/** 3v3 only has 5 regions (no APAC/SSA), so a major group's region list — written for 1v1's fuller
 *  7-region map — has to be filtered down to the regions that discipline actually has before it's used
 *  to look up regional champions. */
function groupRegionsForDiscipline(group: (typeof MAJOR_GROUPS)[number], discipline: RlcsDiscipline): ProRegion[] {
  if (discipline === "1v1") return group.regions;
  return group.regions.filter((r) => RLCS_REGIONS.includes(r));
}

type ChampionInfo = { team: TournamentTeam; completionDate: SimDate; isPlayerChampion: boolean };

/** A region's regional id embeds its RLCS season number directly (see buildSeasonSchedule), so a specific
 *  season's regional can be looked up exactly rather than scanned for. This matters: majors must only
 *  ever draw on THIS season's regional champions, never an older completed regional left over from a
 *  prior season/schedule generation, or a stale save could suddenly satisfy a major's prerequisites out
 *  of old history the moment it loads, with no fresh regional actually having just finished. */
function regionalIdFor(discipline: RlcsDiscipline, seasonNumber: number, region: ProRegion): string {
  return discipline === "1v1" ? `rlcs1v1_s${seasonNumber}_${region}` : `rlcs_s${seasonNumber}_${region}`;
}

/** This season's completed regional champion team for a region in a given discipline, with the date it
 *  was decided (a completed instance's `stageStartDate` is the date its final stage resolved). Keeps the
 *  real team object (1 player for 1v1, 3 for 3v3's orgs) rather than just a name, so a 3v3 major's
 *  entrants keep the actual roster instead of collapsing to a single name, and flags whether that
 *  specific champion run was the player's own (so majors/Worlds can auto-qualify them). */
function championForSeason(table: InstanceTable, discipline: RlcsDiscipline, region: ProRegion, seasonNumber: number): ChampionInfo | null {
  const inst = table[regionalIdFor(discipline, seasonNumber, region)];
  if (!inst || !inst.completed || !inst.championName) return null;
  const championTeam = inst.lastStandings.find((s) => s.placement === 1)?.team;
  if (!championTeam) return null;
  return { team: championTeam, completionDate: inst.stageStartDate, isPlayerChampion: inst.playerTeamId === championTeam.id && inst.playerFinalPlacement === 1 };
}

function latestDate(dates: SimDate[]): SimDate {
  return dates.reduce((latest, d) => (daysBetween(latest, d) > 0 ? d : latest));
}

function findParent3v3Major(table: InstanceTable, group: (typeof MAJOR_GROUPS)[number]): TournamentInstance | null {
  let best: TournamentInstance | null = null;
  for (const inst of Object.values(table)) {
    if (inst.kind !== "rlcs_major" || !inst.completed || !inst.id.startsWith(`major_3v3_${group.id}_`)) continue;
    if (!best || daysBetween(best.stageStartDate, inst.stageStartDate) > 0) best = inst;
  }
  return best;
}

export type MajorReadiness =
  | { kind: "scheduled"; scheduledStart: SimDate; champs: ChampionInfo[] }
  | { kind: "awaiting_regions"; missingRegions: ProRegion[] }
  | { kind: "awaiting_3v3_major" };

/** Whether a major group is ready to form yet, and if so when, purely for UI display before the instance
 *  itself exists (once it exists, its own `startDate` is authoritative). 3v3 majors are the real event,
 *  scheduled MAJOR_DELAY_DAYS after its regions crown their champions. 1v1 is a side bracket at the same
 *  event weekend, real RLCS majors run both disciplines together, so a 1v1 major only forms once its
 *  parent 3v3 major (same group) has actually concluded, and starts that same day. Only THIS RLCS
 *  season's regionals count towards readiness (see championForSeason) — an old completed regional left
 *  over from a previous season's schedule can never retroactively satisfy a new major out of nowhere. */
export function getMajorReadiness(table: InstanceTable, discipline: RlcsDiscipline, group: (typeof MAJOR_GROUPS)[number], currentDate: SimDate): MajorReadiness {
  const regions = groupRegionsForDiscipline(group, discipline);
  if (discipline === "3v3") {
    const { seasonNumber } = rlcsSeasonForDate(currentDate);
    const champs = regions.map((region) => championForSeason(table, discipline, region, seasonNumber));
    if (champs.some((c) => c === null)) return { kind: "awaiting_regions", missingRegions: regions.filter((_, i) => champs[i] === null) };
    const readyChamps = champs as ChampionInfo[];
    const readinessDate = latestDate(readyChamps.map((c) => c.completionDate));
    return { kind: "scheduled", scheduledStart: addDays(readinessDate, MAJOR_DELAY_DAYS), champs: readyChamps };
  }
  const parent = findParent3v3Major(table, group);
  if (!parent) return { kind: "awaiting_3v3_major" };
  // Match the 1v1 regionals to whichever RLCS season actually fed the parent 3v3 major, not the current
  // date's season — a major can finish shortly after a year rolls over, and by then "this season" would
  // otherwise point at next year's (still empty) regionals instead of the ones that crowned these champs.
  const { seasonNumber } = rlcsSeasonForDate(parent.startDate);
  const champs = regions.map((region) => championForSeason(table, discipline, region, seasonNumber));
  if (champs.some((c) => c === null)) return { kind: "awaiting_regions", missingRegions: regions.filter((_, i) => champs[i] === null) };
  return { kind: "scheduled", scheduledStart: parent.stageStartDate, champs: champs as ChampionInfo[] };
}

export type EarlyEraWorldsReadiness =
  | { kind: "scheduled"; scheduledStart: SimDate; champs: ChampionInfo[] }
  | { kind: "awaiting_regions"; missingRegions: ProRegion[] };

/** Early era (2015-2019, see `rlcsStructureEra`) had no Major concept at all: a season's World
 *  Championship field is built directly from every region's regional champion (5 for 3v3, 7 for 1v1) once
 *  ALL of them exist for the season, there's no two-major-group intermediate step to wait on first. */
export function getEarlyEraWorldsReadiness(table: InstanceTable, discipline: RlcsDiscipline, currentDate: SimDate): EarlyEraWorldsReadiness {
  const { seasonNumber } = rlcsSeasonForDate(currentDate);
  const regions = discipline === "1v1" ? RLCS_1V1_REGIONS : RLCS_REGIONS;
  const champs = regions.map((region) => championForSeason(table, discipline, region, seasonNumber));
  if (champs.some((c) => c === null)) return { kind: "awaiting_regions", missingRegions: regions.filter((_, i) => champs[i] === null) };
  const readyChamps = champs as ChampionInfo[];
  const readinessDate = latestDate(readyChamps.map((c) => c.completionDate));
  return { kind: "scheduled", scheduledStart: addDays(readinessDate, WORLDS_DELAY_DAYS), champs: readyChamps };
}

export interface ProjectedScheduleEntry {
  id: string;
  label: string;
  date: SimDate;
  /** false for regionals/Rival Series (buildSeasonSchedule already fixes their exact date). true for
   *  Majors/Worlds — a projection from fixed delay constants assuming everything runs on schedule, not
   *  authoritative once the real instance actually exists (see getMajorReadiness/getEarlyEraWorldsReadiness
   *  for the live version, which reacts to actual completion instead of assuming it). */
  estimated: boolean;
}

function totalStageDays(stages: StageConfig[]): number {
  return stages.reduce((sum, stage) => sum + stage.days, 0);
}

/** A full RLCS season's worth of event dates, computed up front from fixed constants alone — unlike the
 *  reactive Major/Worlds creation elsewhere in this file (which only actually forms an instance once its
 *  prerequisite regionals/majors are DONE), this assumes every stage takes exactly as long as scheduled and
 *  projects where every event lands regardless of live completion state. Good for showing the player "here's
 *  roughly when this season's events happen" months in advance, same as real RLCS publishes its whole-season
 *  calendar up front — not meant to be authoritative once an event's real instance actually exists (that's
 *  what `getMajorReadiness`/`getEarlyEraWorldsReadiness` are for). 1v1 Majors/Worlds always land on the
 *  exact same date as their 3v3 counterpart (real RLCS runs both disciplines at the same event weekend, see
 *  getMajorReadiness's own doc comment), so they're just relabeled copies of the 3v3 entries rather than a
 *  separate calculation from 1v1 regionals. */
export function projectedSeasonSchedule(seasonNumber: number, seasonStartDate: SimDate): ProjectedScheduleEntry[] {
  // `seasonStartDate` is expected to already be the fully-shifted anchor from `effectiveRlcsSeason` (first-
  // season on-ramp/dev restart both folded in there) — this function just builds the schedule from it like
  // any other date, no separate gating needed here.
  const scheduled = buildSeasonSchedule(seasonNumber, seasonStartDate);
  const entries: ProjectedScheduleEntry[] = scheduled
    .filter((sc) => sc.kind === "rlcs_regional" || sc.kind === "rlcs_1v1_regional" || sc.kind === "rlrs_regional")
    .map((sc) => ({ id: sc.id, label: sc.label, date: sc.startDate, estimated: false }));

  const regionals3v3 = scheduled.filter((sc) => sc.kind === "rlcs_regional");
  const oneVOneUnlocked = seasonNumber >= RLCS_1V1_INTRODUCED_SEASON;

  if (rlcsStructureEra(seasonNumber) === "early") {
    // No Major concept at all — Worlds forms straight from every region's regional champion.
    const lastRegionalEnd = latestDate(regionals3v3.map((sc) => addDays(sc.startDate, totalStageDays(sc.stages))));
    const worldsStart = addDays(lastRegionalEnd, WORLDS_DELAY_DAYS);
    entries.push({ id: `worlds_3v3_projected_s${seasonNumber}`, label: `World Championship Season ${seasonNumber} (3v3)`, date: worldsStart, estimated: true });
    return entries.sort((a, b) => daysBetween(a.date, b.date));
  }

  const majorStarts: SimDate[] = [];
  for (const group of MAJOR_GROUPS) {
    const groupRegionals = regionals3v3.filter((sc) => group.regions.includes(sc.region!));
    const lastRegionalEnd = latestDate(groupRegionals.map((sc) => addDays(sc.startDate, totalStageDays(sc.stages))));
    const majorStart = addDays(lastRegionalEnd, MAJOR_DELAY_DAYS);
    majorStarts.push(majorStart);
    entries.push({ id: `major_3v3_${group.id}_projected_s${seasonNumber}`, label: `${group.location} Major Season ${seasonNumber} (3v3)`, date: majorStart, estimated: true });
    if (oneVOneUnlocked) {
      entries.push({ id: `major_1v1_${group.id}_projected_s${seasonNumber}`, label: `${group.location} Major Season ${seasonNumber} (1v1)`, date: majorStart, estimated: true });
    }
  }
  const lastMajorEnd = addDays(latestDate(majorStarts), totalStageDays(MAJOR_STAGES));
  const worldsStart = addDays(lastMajorEnd, WORLDS_DELAY_DAYS);
  entries.push({ id: `worlds_3v3_projected_s${seasonNumber}`, label: `World Championship Season ${seasonNumber} (3v3)`, date: worldsStart, estimated: true });
  if (oneVOneUnlocked) {
    entries.push({ id: `worlds_1v1_projected_s${seasonNumber}`, label: `World Championship Season ${seasonNumber} (1v1)`, date: worldsStart, estimated: true });
  }
  return entries.sort((a, b) => daysBetween(a.date, b.date));
}

/** Majors and Worlds aren't calendar-scheduled like everything else. Each major group only ever has one
 *  active (non-completed) instance at a time, a new one can't form again until the current one finishes
 *  and its regions produce fresh champions. Runs once per discipline (1v1 and 3v3 each get their own
 *  independent Majors/Worlds line, 3v3 being real RLCS's actual competitive format, and 1v1's major
 *  riding along on the same event weekend, see getMajorReadiness). If the champion entrant for a region
 *  was the player's own run, the new major/Worlds instance is wired up as player-driven from the start
 *  (same shape `registerPlayer` produces), so they actually get to play it rather than watching it
 *  auto-simulate. Mutates `table` in place, returns whether anything changed. */
function ensureMajorsAndWorldsForDiscipline(table: InstanceTable, currentDate: SimDate, discipline: RlcsDiscipline): boolean {
  let changed = false;
  const majorIdPrefix = `major_${discipline}_`;
  const { seasonNumber } = rlcsSeasonForDate(currentDate);
  // Early era (2015-2019) had no Major concept at all, a regional champion went straight to Worlds — skip
  // major creation entirely and let the Worlds section below source its field directly from regional
  // champions instead of from two completed majors.
  const noMajorsThisSeason = rlcsStructureEra(seasonNumber) === "early";

  if (!noMajorsThisSeason) {
    for (const group of MAJOR_GROUPS) {
      const activeId = Object.keys(table).find((id) => table[id].kind === "rlcs_major" && id.startsWith(`${majorIdPrefix}${group.id}_`) && !table[id].completed);
      if (activeId) {
        const advanced = advanceInstance(table[activeId], currentDate);
        if (advanced !== table[activeId]) {
          table[activeId] = advanced;
          changed = true;
        }
        continue; // one major per group at a time, don't try to spin up a second while this one is live
      }

      const readiness = getMajorReadiness(table, discipline, group, currentDate);
      if (readiness.kind !== "scheduled") continue;
      if (daysBetween(readiness.scheduledStart, currentDate) < 0) continue; // not time yet

      const champs = readiness.champs;
      const readinessDate = latestDate(champs.map((c) => c.completionDate));
      const id = `${majorIdPrefix}${group.id}_${dateKey(readinessDate)}`;
      if (table[id]) continue; // this exact cycle's major already ran

      const startDate = readiness.scheduledStart;
      const playerChamp = champs.find((c) => c.isPlayerChampion) ?? null;
      table[id] = ensureStageBracketBuilt({
        id,
        kind: "rlcs_major",
        label: `RLCS ${startDate.year} ${group.location} Major${discipline === "1v1" ? " (1v1)" : ""}`,
        region: null,
        startDate,
        stages: MAJOR_STAGES,
        stageIndex: 0,
        stageStartDate: startDate,
        currentTeams: champs.map((c) => c.team),
        lastStandings: [],
        completed: false,
        championName: null,
        playerTeamId: playerChamp?.team.id ?? null,
        playerBracket: playerChamp ? { teamId: playerChamp.team.id, wins: 0, losses: 0, eliminated: false } : null,
        pendingMatch: null,
        playerFinalPlacement: null,
        stageBrackets: {},
      });
      changed = true;
    }
  }

  const worldsIdPrefix = `worlds_${discipline}_`;
  const activeWorldsId = Object.keys(table).find((id) => table[id].kind === "rlcs_worlds" && id.startsWith(worldsIdPrefix) && !table[id].completed);
  if (activeWorldsId) {
    const advanced = advanceInstance(table[activeWorldsId], currentDate);
    if (advanced !== table[activeWorldsId]) {
      table[activeWorldsId] = advanced;
      changed = true;
    }
    return changed;
  }

  let startDate: SimDate;
  let worldsId: string;
  let entrants: ChampionInfo[];

  if (noMajorsThisSeason) {
    const readiness = getEarlyEraWorldsReadiness(table, discipline, currentDate);
    if (readiness.kind !== "scheduled") return changed;
    if (daysBetween(readiness.scheduledStart, currentDate) < 0) return changed;
    const readinessDate = latestDate(readiness.champs.map((c) => c.completionDate));
    worldsId = `${worldsIdPrefix}${dateKey(readinessDate)}`;
    if (table[worldsId]) return changed; // this exact cycle's Worlds already ran
    startDate = readiness.scheduledStart;
    entrants = readiness.champs;
  } else {
    const completedMajors = MAJOR_GROUPS.map((group) => {
      let best: TournamentInstance | null = null;
      for (const inst of Object.values(table)) {
        if (inst.kind !== "rlcs_major" || !inst.id.startsWith(`${majorIdPrefix}${group.id}_`) || !inst.completed || !inst.championName) continue;
        if (!best || daysBetween(best.stageStartDate, inst.stageStartDate) > 0) best = inst;
      }
      return best;
    });
    if (completedMajors.some((m) => m === null)) return changed; // both majors have to be played first

    const [major1, major2] = completedMajors as TournamentInstance[];
    const readinessDate = latestDate([major1.stageStartDate, major2.stageStartDate]);
    worldsId = `${worldsIdPrefix}${dateKey(readinessDate)}`;
    if (table[worldsId]) return changed; // this exact cycle's Worlds already ran

    startDate = addDays(readinessDate, WORLDS_DELAY_DAYS);
    if (daysBetween(startDate, currentDate) < 0) return changed;

    const entry1 = major1.lastStandings.find((s) => s.placement === 1);
    const entry2 = major2.lastStandings.find((s) => s.placement === 1);
    if (!entry1 || !entry2) return changed;
    entrants = [
      { team: entry1.team, completionDate: major1.stageStartDate, isPlayerChampion: major1.playerTeamId === entry1.team.id && major1.playerFinalPlacement === 1 },
      { team: entry2.team, completionDate: major2.stageStartDate, isPlayerChampion: major2.playerTeamId === entry2.team.id && major2.playerFinalPlacement === 1 },
    ];
  }

  const playerChamp = entrants.find((c) => c.isPlayerChampion) ?? null;
  table[worldsId] = ensureStageBracketBuilt({
    id: worldsId,
    kind: "rlcs_worlds",
    label: `RLCS ${startDate.year} World Championship${discipline === "1v1" ? " (1v1)" : ""}`,
    region: null,
    startDate,
    stages: WORLDS_STAGES,
    stageIndex: 0,
    stageStartDate: startDate,
    currentTeams: entrants.map((c) => c.team),
    lastStandings: [],
    completed: false,
    championName: null,
    playerTeamId: playerChamp?.team.id ?? null,
    playerBracket: playerChamp ? { teamId: playerChamp.team.id, wins: 0, losses: 0, eliminated: false } : null,
    pendingMatch: null,
    playerFinalPlacement: null,
    stageBrackets: {},
  });
  return true;
}

function ensureMajorsAndWorlds(table: InstanceTable, currentDate: SimDate): boolean {
  // 3v3 must run first: 1v1's major readiness (getMajorReadiness) looks up the parent 3v3 major in the
  // SAME table, so it needs 3v3's pass to have already landed this cycle's major before 1v1 checks it.
  const b = ensureMajorsAndWorldsForDiscipline(table, currentDate, "3v3");
  const a = ensureMajorsAndWorldsForDiscipline(table, currentDate, "1v1");
  return a || b;
}

interface TournamentStoreState {
  instances: InstanceTable;
  /** Creates any scheduled tournament whose start date has arrived and isn't tracked yet, then advances
   *  every non-completed instance based on elapsed in-game days. Safe to call repeatedly, no-op unless
   *  something has actually changed. */
  /** `saveStartYear` gates the very first RLCS season a fresh save reaches — see RLCS_FIRST_SEASON_DELAY_DAYS,
   *  every later season is unaffected. `teamsResetSeed` (see SaveData.rlcsTeamsResetSeed) feeds real team
   *  roster generation (see data/tournaments.ts's generateTeamsForRegion), bumped by the dev "Reset Teams"
   *  tool to force a fresh deterministic roster shuffle. `rankedSeasonStartDate` is the player's own ranked-
   *  ladder season anchor (useSaveStore's `seasonStartDate`) — deliberately NOT the RLCS schedule's own
   *  season start date, see createInstance's doc comment for why the two must never be conflated. */
  ensureProgress: (currentDate: SimDate, currentYear: number, saveStartYear: number, teamsResetSeed: number, rankedSeasonStartDate: SimDate) => void;
  /** Registers the player into an open instance, replacing a generic filler entrant with their own. */
  /** Registers the player into an open instance. `teammateNames` (org-signed 3v3 only) fills out the rest
   *  of the roster with the player's real org teammates instead of a lone entrant, replacing a same-size
   *  filler team's whole roster. */
  registerPlayer: (instanceId: string, playerName: string, playerRegion: ProRegion, playerPower: number, teammateNames?: string[]) => void;
  /** If the player is registered, alive, the stage has actually started, and they don't already have a
   *  pending match, picks their next live opponent for this round. No-op otherwise. Call from a
   *  `useEffect`, not render-time (same rule as `ensureProgress`). */
  queuePlayerMatch: (instanceId: string, currentDate: SimDate) => void;
  /** Applies the result of the player's just-finished live series. For `swiss`/`gsl_group` stages: updates
   *  their win/loss count, and once their run through the stage is decided (advanced or eliminated),
   *  resolves the rest of the stage's field and merges the player back into the standings (unchanged from
   *  before the bracket rework). For `double_elim`/`single_elim` stages: writes the real per-game result
   *  (`gameLog`, from useMatchStore's seriesGameLog) into the player's own bracket node and follows the
   *  real winners/losers routing — no separate win/loss counter, the tree topology itself decides whether
   *  the player advances, drops to the losers bracket, or is eliminated. */
  resolvePlayerMatch: (instanceId: string, wonSeries: boolean, currentDate: SimDate, gameLog?: { won: boolean; mapId: string | null }[]) => void;
  /** Switches this store over to a different save's tournament progress, called from AppRoot right
   *  alongside `useSaveStore`'s `initFromSave` whenever a save is loaded or switched to. */
  loadForSave: (saveId: string) => void;
  /** Dev-only: wipes every tracked instance for the current save so the next `ensureProgress` call
   *  regenerates a completely fresh RLCS season from scratch (a brand-new regional field, no player
   *  registration carried over), see SettingsScreen's Developer Tools. Also anchors a fresh
   *  RLCS_RESTART_DELAY_DAYS on-ramp from `currentDate` (see `seasonRestartAnchor`) so the restarted
   *  season's regions reopen on a real delay instead of instantly recreating whatever was already
   *  scheduled (and likely already stale) for the current real calendar date. */
  resetAllInstances: (currentDate: SimDate) => void;
  /** Dev-only, more aggressive than `resetAllInstances`: hard-deletes the save's tournament localStorage
   *  blob outright (via `clearTournamentDataForSave`, the same path `deleteSave` uses) instead of just
   *  overwriting it with an empty object, so a save that got itself into a bad state predating this reset
   *  path (a instance shape an older build wrote that the current one can't make sense of, corrupted JSON,
   *  etc.) can't come back from a stale on-disk copy. Otherwise identical to `resetAllInstances` — same
   *  fresh RLCS_RESTART_DELAY_DAYS on-ramp. */
  fullResetInstances: (currentDate: SimDate) => void;
}

export const useTournamentStore = create<TournamentStoreState>((set, get) => ({
  instances: loadStored(),

  ensureProgress: (currentDate, currentYear, saveStartYear, teamsResetSeed, rankedSeasonStartDate) => {
    const state = get();
    // effectiveRlcsSeason folds in both the fresh-save first-season on-ramp and a dev restart's on-ramp by
    // shifting the WHOLE anchor buildSeasonSchedule staggers regions from (see its own doc comment) — so
    // no separate gate check is needed here, `item.startDate` already reflects whichever delay applies.
    const { seasonNumber, seasonStartDate } = effectiveRlcsSeason(currentDate, saveStartYear);
    const scheduled = buildSeasonSchedule(seasonNumber, seasonStartDate);
    let changed = false;
    const next: InstanceTable = { ...state.instances };

    for (const item of scheduled) {
      // Fields open up to REGISTRATION_WINDOW_DAYS before the scheduled start so the player can see and
      // register ahead of time, the stage itself still won't actually resolve until the real start date
      // (daysBetween(stageStartDate, currentDate) stays negative until then, see advanceInstance).
      if (daysBetween(item.startDate, currentDate) < -REGISTRATION_WINDOW_DAYS) continue;
      if (!next[item.id]) {
        next[item.id] = createInstance(item, currentYear, seasonNumber, teamsResetSeed, currentDate, rankedSeasonStartDate);
        changed = true;
        continue;
      }
      if (!next[item.id].completed) {
        const advanced = advanceInstance(next[item.id], currentDate);
        if (advanced !== next[item.id]) {
          next[item.id] = advanced;
          changed = true;
        }
      }
    }

    if (ensureMajorsAndWorlds(next, currentDate)) changed = true;

    if (changed) {
      set({ instances: next });
      persist(next);
    }
  },

  registerPlayer: (instanceId, playerName, playerRegion, playerPower, teammateNames) => {
    const state = get();
    const instance = state.instances[instanceId];
    if (!instance || instance.playerTeamId || instance.stageIndex > 0 || instance.completed) return;

    const roster = teammateNames && teammateNames.length > 0 ? [playerName, ...teammateNames] : [playerName];
    const playerTeam: TournamentTeam = {
      id: `${instanceId}_player`,
      name: playerName,
      region: playerRegion,
      power: playerPower,
      players: roster,
    };
    // Bump a generic filler entrant of the SAME roster size, never a named real pro (a filler entrant's
    // team name and its solo player also happen to match, same as a real pro's does, so checking the
    // actual roster is the only reliable way to tell them apart). If the field is somehow all real pros,
    // just add the player's team on top rather than displace one.
    const fillerIdx = instance.currentTeams.findIndex((t) => t.players.length === roster.length && !PRO_PLAYERS.some((p) => p.name === t.name));
    const nextTeams =
      fillerIdx >= 0
        ? instance.currentTeams.map((t, i) => (i === fillerIdx ? playerTeam : t))
        : [...instance.currentTeams, playerTeam];

    let nextInstance: TournamentInstance = {
      ...instance,
      currentTeams: nextTeams,
      playerTeamId: playerTeam.id,
      playerBracket: { teamId: playerTeam.id, wins: 0, losses: 0, eliminated: false },
      pendingMatch: null,
    };
    // Nothing's resolved yet at stageIndex 0 (registerPlayer only ever fires there), so it's always safe to
    // rebuild the tree fresh from the updated roster — the player gets seeded by their real power like any
    // other team, rather than inheriting whatever seed the filler entrant they replaced would have had.
    const stage = nextInstance.stages[nextInstance.stageIndex];
    if (stage.format === "double_elim" || stage.format === "single_elim") {
      const tree = stage.format === "double_elim" ? buildDoubleElimBracket(nextTeams, stage.advanceCount) : buildSingleElimBracket(nextTeams);
      nextInstance = { ...nextInstance, stageBrackets: { ...nextInstance.stageBrackets, [nextInstance.stageIndex]: tree } };
    }
    const nextTable = { ...state.instances, [instanceId]: nextInstance };
    set({ instances: nextTable });
    persist(nextTable);
  },

  queuePlayerMatch: (instanceId, currentDate) => {
    const state = get();
    const instance = state.instances[instanceId];
    if (!instance || !instance.playerBracket || instance.playerBracket.eliminated || instance.pendingMatch) return;
    // The tournament itself is over (win or lose), there's no next stage to queue anything for, even
    // though a won-it-all playerBracket resets to non-eliminated the same way advancing a stage does.
    if (instance.completed || instance.stageIndex >= instance.stages.length) return;
    if (daysBetween(instance.stageStartDate, currentDate) < 0) return; // stage hasn't actually started yet

    const stage = instance.stages[instance.stageIndex];

    if (stage.format === "double_elim" || stage.format === "single_elim") {
      // Normally already built the moment the stage became current (instance creation, advanceInstance,
      // resolvePlayerMatch) — but advanceInstance skips a live-player instance entirely, so a save from
      // before this bracket system existed (already mid-registration in a bracket-shaped stage) would
      // otherwise never get one built at all. Building it here too, on demand, means the player's match
      // always works regardless of which code path they arrived from.
      const builtInstance = ensureStageBracketBuilt(instance);
      const tree = builtInstance.stageBrackets[instance.stageIndex];
      if (!tree) return; // genuinely no teams to build from (shouldn't happen)
      const playerNode = findNodeForTeam(tree, instance.playerTeamId!);
      if (!playerNode || playerNode.resolved) return; // no match currently waiting on the player
      const isPlayerA = playerNode.slotA?.teamId === instance.playerTeamId;
      const opponentSlot = isPlayerA ? playerNode.slotB : playerNode.slotA;
      const bestOf = bestOfForFormat(stage.format);
      if (!opponentSlot) {
        // Lazily resolve ONLY the specific feeder match blocking the opponent slot (never the player's own
        // node) so the player's opponent is a real bracket dependency, not a random pick.
        const feeder = feederFor(allNodes(tree), playerNode.id, isPlayerA ? "B" : "A");
        if (feeder) resolveNodeAndAncestors(tree, feeder, currentDate, bestOf);
      }
      const resolvedOpponentId = (isPlayerA ? playerNode.slotB : playerNode.slotA)?.teamId;
      if (!resolvedOpponentId) return; // genuinely nothing to resolve yet (shouldn't happen in practice)
      const opponent = tree.teams[resolvedOpponentId];
      const nextInstance: TournamentInstance = {
        ...instance,
        stageBrackets: { ...instance.stageBrackets, [instance.stageIndex]: tree },
        pendingMatch: { opponentId: opponent.id, opponentName: opponent.name, seriesFormat: bestOf },
      };
      const nextTable = { ...state.instances, [instanceId]: nextInstance };
      set({ instances: nextTable });
      persist(nextTable);
      return;
    }

    // swiss/gsl_group: unchanged, no bracket tree exists for these formats — a plain random pick from
    // whoever's still alive in the stage, matching the always-fair, format-agnostic player experience.
    const opponents = instance.currentTeams.filter((t) => t.id !== instance.playerTeamId);
    if (opponents.length === 0) return;
    const opponent = opponents[Math.floor(Math.random() * opponents.length)];

    const nextInstance: TournamentInstance = {
      ...instance,
      pendingMatch: { opponentId: opponent.id, opponentName: opponent.name, seriesFormat: 3 },
    };
    const nextTable = { ...state.instances, [instanceId]: nextInstance };
    set({ instances: nextTable });
    persist(nextTable);
  },

  resolvePlayerMatch: (instanceId, wonSeries, currentDate, gameLog) => {
    const state = get();
    const instance = state.instances[instanceId];
    if (!instance || !instance.playerBracket || !instance.pendingMatch) return;

    const stage = instance.stages[instance.stageIndex];
    const opponentId = instance.pendingMatch.opponentId;

    if (stage.format === "double_elim" || stage.format === "single_elim") {
      const tree = instance.stageBrackets[instance.stageIndex];
      const playerNode = tree ? findNodeForTeam(tree, instance.playerTeamId!) : null;
      if (!tree || !playerNode) return;

      const winnerId = wonSeries ? instance.playerTeamId! : opponentId;
      const loserId = wonSeries ? opponentId : instance.playerTeamId!;
      const games = (gameLog ?? []).map((g, i) => ({ gameNumber: i + 1, winnerId: g.won ? instance.playerTeamId! : opponentId, mapId: g.mapId ?? "" }));
      resolvePlayerNode(tree, playerNode, winnerId, loserId, games.length > 0 ? games : [{ gameNumber: 1, winnerId, mapId: "" }]);

      // Real bracket topology decides the outcome, no separate win/loss counter: a loss with nowhere to
      // drop (already in the losers bracket, or single-elim which has no losers bracket at all) is
      // eliminated; a loss in the winners bracket with a real losers-bracket target just continues there.
      const eliminated = !wonSeries && (playerNode.bracket !== "winners" || !playerNode.loserDropsTo);
      const nextNode = eliminated ? null : findNodeForTeam(tree, instance.playerTeamId!);

      if (!eliminated && nextNode) {
        // Still alive with another match to play in this same stage (either the next round, or — after a
        // winners-bracket loss — their new losers-bracket match).
        const nextInstance: TournamentInstance = {
          ...instance,
          stageBrackets: { ...instance.stageBrackets, [instance.stageIndex]: tree },
          playerBracket: { ...instance.playerBracket, wins: instance.playerBracket.wins + (wonSeries ? 1 : 0), losses: instance.playerBracket.losses + (wonSeries ? 0 : 1) },
          pendingMatch: null,
        };
        const nextTable = { ...state.instances, [instanceId]: nextInstance };
        set({ instances: nextTable });
        persist(nextTable);
        return;
      }

      // The player's run through this stage is decided (eliminated, or nothing further to play — a
      // survivor/champion). Resolve whatever's left of the SAME tree the player was just a node in, then
      // read final standings straight off it — the player's own result already lives in those nodes, no
      // separate merge logic needed the way the old flat counter system required.
      const bestOf = bestOfForFormat(stage.format);
      resolveRemainingBracket(tree, currentDate, bestOf);
      const result = bracketStageResult(tree, stage.advanceCount);
      const isLastStage = instance.stageIndex + 1 >= instance.stages.length;
      const playerAdvanced = result.advanced.some((t) => t.id === instance.playerTeamId);
      const playerEntry = result.standings.find((s) => s.team.id === instance.playerTeamId);

      const nextStageBrackets = { ...instance.stageBrackets };
      if (!isLastStage) delete nextStageBrackets[instance.stageIndex]; // superseded, outcome now lives in lastStandings

      let nextInstance: TournamentInstance = {
        ...instance,
        stageIndex: instance.stageIndex + 1,
        stageStartDate: currentDate,
        currentTeams: result.advanced,
        lastStandings: result.standings,
        completed: isLastStage,
        championName: isLastStage ? result.standings.find((s) => s.placement === 1)?.team.name ?? null : null,
        playerBracket: playerAdvanced ? { teamId: instance.playerTeamId!, wins: 0, losses: 0, eliminated: false } : { ...instance.playerBracket, eliminated: true },
        pendingMatch: null,
        playerFinalPlacement: playerAdvanced ? (isLastStage ? 1 : null) : (playerEntry?.placement ?? null),
        stageBrackets: nextStageBrackets,
      };
      // The player is still alive going into a new stage — advanceInstance won't touch this instance again
      // while that's true, so the new stage's tree has to be built here instead of waiting for the next
      // calendar tick, otherwise the player would have nothing to browse/queue a match against.
      if (!isLastStage && playerAdvanced) nextInstance = ensureStageBracketBuilt(nextInstance);
      const nextTable = { ...state.instances, [instanceId]: nextInstance };
      set({ instances: nextTable });
      persist(nextTable);
      return;
    }

    // swiss/gsl_group: unchanged from before the bracket rework — a plain win/loss counter with a uniform
    // "2 losses always ends your run" rule regardless of the stage's real format, no bracket tree involved.
    const wins = instance.playerBracket.wins + (wonSeries ? 1 : 0);
    const losses = instance.playerBracket.losses + (wonSeries ? 0 : 1);
    const winsNeeded = stageWinsNeeded(stage, instance.currentTeams.length);
    const eliminated = losses >= PLAYER_LOSSES_ALLOWED;
    const advanced = wins >= winsNeeded;

    // Beaten opponents are simply removed from the remaining field, they're done for this stage too.
    const remainingField = wonSeries ? instance.currentTeams.filter((t) => t.id !== opponentId) : instance.currentTeams;

    if (!eliminated && !advanced) {
      const nextInstance: TournamentInstance = {
        ...instance,
        currentTeams: remainingField,
        playerBracket: { ...instance.playerBracket, wins, losses },
        pendingMatch: null,
      };
      const nextTable = { ...state.instances, [instanceId]: nextInstance };
      set({ instances: nextTable });
      persist(nextTable);
      return;
    }

    // The player's own run through this stage is decided, resolve everyone else and merge them back in.
    const playerTeam = instance.currentTeams.find((t) => t.id === instance.playerTeamId)!;
    const aiField = remainingField.filter((t) => t.id !== instance.playerTeamId);
    // When the player takes one of the stage's advancing slots, the AI-only sub-bracket is resolved for
    // one fewer spot, so every placement it hands out for teams below that cutoff needs to shift down by
    // one to account for the player occupying a slot above them.
    const aiAdvanceCount = advanced ? Math.max(0, stage.advanceCount - 1) : stage.advanceCount;
    const result = stage.format === "swiss" ? runSwissStage(aiField, aiAdvanceCount) : runGslGroupStage(aiField, aiAdvanceCount);
    const aiStandings = advanced
      ? result.standings.map((entry) => ({ ...entry, placement: entry.placement === null ? null : entry.placement + 1 }))
      : result.standings;

    const isLastStage = instance.stageIndex + 1 >= instance.stages.length;
    const playerPlacement = advanced ? (isLastStage ? 1 : null) : stage.advanceCount + 1;
    const mergedAdvanced = advanced ? [playerTeam, ...result.advanced] : result.advanced;
    const mergedStandings: StandingEntry[] = advanced
      ? [{ team: playerTeam, wins, losses, placement: playerPlacement }, ...aiStandings]
      : [...aiStandings, { team: playerTeam, wins, losses, placement: playerPlacement }];

    const nextInstance: TournamentInstance = {
      ...instance,
      stageIndex: instance.stageIndex + 1,
      stageStartDate: currentDate,
      currentTeams: mergedAdvanced,
      lastStandings: mergedStandings,
      completed: isLastStage && advanced ? true : isLastStage,
      championName: isLastStage && advanced ? playerTeam.name : isLastStage ? aiStandings.find((s) => s.placement === 1)?.team.name ?? null : null,
      playerBracket: advanced ? { teamId: playerTeam.id, wins: 0, losses: 0, eliminated: false } : { ...instance.playerBracket, wins, losses, eliminated: true },
      pendingMatch: null,
      playerFinalPlacement: advanced ? (isLastStage ? 1 : null) : stage.advanceCount + 1,
    };
    const nextTable = { ...state.instances, [instanceId]: nextInstance };
    set({ instances: nextTable });
    persist(nextTable);
  },

  loadForSave: (saveId) => {
    activeSaveId = saveId;
    seasonRestartAnchor = loadRestartAnchor();
    set({ instances: loadStored() });
  },

  resetAllInstances: (currentDate) => {
    seasonRestartAnchor = currentDate;
    persistRestartAnchor(currentDate);
    set({ instances: {} });
    persist({});
  },

  fullResetInstances: (currentDate) => {
    if (activeSaveId) clearTournamentDataForSave(activeSaveId);
    seasonRestartAnchor = currentDate;
    persistRestartAnchor(currentDate);
    set({ instances: {} });
  },
}));

/** Every real RLCS title a given name has actually earned across completed tournament history (not the
 *  fictional past-season titles `pickAiTitle` generates), used to let AI/pro opponents in regular ranked
 *  matches show a real, chronologically-accurate title once RLCS has genuinely produced one for them.
 *  A fresh save starting mid-timeline (e.g. season 12) has no completed tournament instances of its own
 *  yet to scan, even though a veteran real pro would realistically already have past RLCS results by
 *  then, so this falls back to `pickFictionalPastRlcsTitle` for real named pros only when the actual scan
 *  comes up empty, matching the "for the top players ofc" scope of the request. `currentYear` is the
 *  current RLCS season year (`rlcsSeasonForDate(currentDate).seasonNumber`), needed to bound how far back
 *  a fictional past result could plausibly be. */
export function findRealRlcsTitlesForPlayer(playerName: string, currentYear?: number): TitleEntry[] {
  const instances = useTournamentStore.getState().instances;
  const titles: TitleEntry[] = [];
  for (const inst of Object.values(instances)) {
    if (!inst.completed) continue;
    // Never credit a result dated the current year (or later) — a title is only ever a genuinely PAST
    // achievement, this season's own outcome isn't "history" yet even if this instance happens to have
    // already resolved. Guards against a title reading as "from the future"/"not even over yet" no matter
    // what drove the mismatch (a stale instance, a caller passing the wrong year, a scheduling edge case).
    if (currentYear !== undefined && inst.startDate.year >= currentYear) continue;
    // Team-based formats (2v2/3v3) name the team after its ORG, not any one player — matching only
    // `team.name` meant an individual pro who genuinely won a 3v3 regional/major/Worlds in THIS save's own
    // completed history was never credited for it here, only 1v1's solo-entrant teams (named after the
    // player themselves) ever matched. Checking the roster too is what actually makes a past win traceable
    // back to the real players who earned it.
    const entry = inst.lastStandings.find((e) => e.team.name === playerName || e.team.players.includes(playerName));
    if (!entry || entry.placement === null) continue;
    const majorLocation = inst.kind === "rlcs_major" ? MAJOR_GROUPS.find((g) => inst.id.includes(`_${g.id}_`))?.location ?? null : null;
    const discipline: "1v1" | "3v3" = inst.currentTeams[0]?.players.length === 1 ? "1v1" : "3v3";
    titles.push(...titlesEarnedForKind(inst.kind, inst.startDate.year, entry.placement, majorLocation, discipline));
  }
  if (titles.length === 0 && currentYear !== undefined) {
    const pro = PRO_PLAYERS.find((p) => p.name === playerName);
    if (pro) return pickFictionalPastRlcsTitle(pro, currentYear);
  }
  return titles;
}
