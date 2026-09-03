import { useEffect, useState } from "react";
import { useSaveStore } from "@/store/useSaveStore";
import { useTournamentStore, REGISTRATION_WINDOW_DAYS, getMajorReadiness, getEarlyEraWorldsReadiness, projectedSeasonSchedule, effectiveRlcsSeason, type TournamentInstance, type RlcsDiscipline, type MajorReadiness, type EarlyEraWorldsReadiness } from "@/store/useTournamentStore";
import { useMatchStore, type SelfStats } from "@/store/useMatchStore";
import { TournamentBracket } from "./TournamentBracket";
import {
  REGION_LABELS,
  MAJOR_GROUPS,
  buildSeasonSchedule,
  rlcsStructureEra,
  saveRegionToProRegion,
  regionalTitleFor,
  majorTitleFor,
  worldsTitleFor,
  regionalTitlesEarned,
  majorTitlesEarned,
  worldsTitlesEarned,
  rivalSeriesTitleFor,
  rivalSeriesTitlesEarned,
  RLCS_1V1_INTRODUCED_SEASON,
  isLanEvent,
} from "@/data/tournaments";
import type { TitleEntry } from "@/data/seasons";
import { eraForDate } from "@/data/rankSystem";
import { daysBetween, formatSimDate, type SimDate } from "@/data/dateUtils";
import { flattenProgress } from "@/data/matchSim";
import { orgTagForOrgName, type TournamentKind } from "@/data/tournaments";

type Mode = "3v3" | "1v1";

function isRegistrationOpen(instance: TournamentInstance | undefined): boolean {
  if (!instance) return false;
  if (instance.playerTeamId) return false;
  if (instance.stageIndex > 0 || instance.completed) return false;
  return true;
}

/** Plain-text status for a scheduled-but-maybe-not-yet-created regional/Rival Series instance, for the
 *  Season Overview — same wording as each region's own tile, minus the player-specific "You're in!"
 *  branch, since the overview is read-only for regions the player has no stake in. */
function regionalOverviewStatus(instance: TournamentInstance | undefined, startDate: SimDate, currentDate: SimDate): string {
  if (!instance) {
    const daysUntil = daysBetween(currentDate, startDate);
    return daysUntil > 0 ? `Starts in ${daysUntil}d` : "Starting...";
  }
  if (instance.completed) return `Champion: ${instance.championName}`;
  return `${instance.stages[instance.stageIndex].label} · ${instance.currentTeams.length} left`;
}

/** Same idea as `regionalOverviewStatus` but for a Major/Worlds group, which isn't calendar-scheduled —
 *  it only has a real `startDate` once its prerequisites are actually done (see `MajorReadiness`/
 *  `EarlyEraWorldsReadiness`), otherwise it shows what it's still waiting on. */
function majorOverviewStatus(instance: TournamentInstance | undefined, readiness: MajorReadiness | EarlyEraWorldsReadiness, currentDate: SimDate): string {
  if (instance) {
    if (instance.completed) return `Champion: ${instance.championName}`;
    return `${instance.stages[instance.stageIndex].label} · ${instance.currentTeams.length} left`;
  }
  if (readiness.kind === "scheduled") {
    const daysAway = daysBetween(currentDate, readiness.scheduledStart);
    return daysAway > 0 ? `Starts in ${daysAway}d` : "Starting soon";
  }
  if (readiness.kind === "awaiting_3v3_major") return "Awaiting the 3v3 Major to conclude";
  return `Awaiting: ${readiness.missingRegions.map((r) => REGION_LABELS[r]).join(", ")}`;
}

/** The bracket tree to show for this instance's currently-relevant stage, if it has one at all (swiss/
 *  gsl_group stages never get a tree — falls back to null so the caller keeps showing StandingsCard). A
 *  completed instance only ever retains its FINAL stage's tree (see TournamentInstance's stageBrackets doc
 *  comment in useTournamentStore.ts), which sits at `stages.length - 1`, not the current (past-the-end)
 *  stageIndex. */
function bracketForInstance(instance: TournamentInstance) {
  const key = instance.completed ? instance.stages.length - 1 : instance.stageIndex;
  return instance.stageBrackets[key] ?? null;
}

/** Team roster size is a reliable, kind-agnostic way to tell which discipline an instance is (majors/
 *  worlds ids are shared across both), 1 player per team means 1v1, everything else (3v3, and Rival Series
 *  which is 3v3-only) is 3. */
function disciplineForInstance(instance: TournamentInstance): "1v1" | "3v3" {
  return instance.currentTeams[0]?.players.length === 1 ? "1v1" : "3v3";
}

function titleForInstance(instance: TournamentInstance, placement: number | null): TitleEntry | null {
  if (placement === null) return null;
  const year = instance.startDate.year;
  const discipline = disciplineForInstance(instance);
  if (instance.kind === "rlcs_regional" || instance.kind === "rlcs_1v1_regional") return regionalTitleFor(year, placement, discipline);
  if (instance.kind === "rlcs_major") {
    const groupId = instance.id.split("_")[2];
    const group = MAJOR_GROUPS.find((g) => g.id === groupId);
    return majorTitleFor(year, placement, group?.location ?? "Major", discipline);
  }
  if (instance.kind === "rlcs_worlds") return worldsTitleFor(year, placement, discipline);
  if (instance.kind === "rlrs_regional") return rivalSeriesTitleFor(year, placement);
  return null;
}

/** Every title cascade a given placement in this instance actually earned (a champion keeps Contender/
 *  Challenger too, they passed through those tiers on the way), used to grant the player's real title
 *  collection once their run in a tournament ends, not just compute one display label. */
function titlesEarnedForInstance(instance: TournamentInstance, placement: number): TitleEntry[] {
  const year = instance.startDate.year;
  const discipline = disciplineForInstance(instance);
  if (instance.kind === "rlcs_regional" || instance.kind === "rlcs_1v1_regional") return regionalTitlesEarned(year, placement, discipline);
  if (instance.kind === "rlcs_major") {
    const groupId = instance.id.split("_")[2];
    const group = MAJOR_GROUPS.find((g) => g.id === groupId);
    return majorTitlesEarned(year, placement, group?.location ?? "Major", discipline);
  }
  if (instance.kind === "rlcs_worlds") return worldsTitlesEarned(year, placement, discipline);
  if (instance.kind === "rlrs_regional") return rivalSeriesTitlesEarned(year, placement);
  return [];
}

export function TourneysScreen() {
  const [mode, setMode] = useState<Mode>("3v3");
  const s = useSaveStore();
  const currentDate = s.currentDate;
  const currentYear = currentDate.year;
  const rankedSeasonNumber = s.seasonNumber; // ranked ladder season, only used for AI opponents' flavor titles
  const { seasonNumber: rlcsSeasonNumber, seasonStartDate: rlcsSeasonStartDate } = effectiveRlcsSeason(currentDate, s.startDate.year);
  const playerProRegion = saveRegionToProRegion(s.region);
  const era = eraForDate(currentDate);

  const instances = useTournamentStore((st) => st.instances);
  const ensureProgress = useTournamentStore((st) => st.ensureProgress);
  const queuePlayerMatch = useTournamentStore((st) => st.queuePlayerMatch);
  const registerPlayer = useTournamentStore((st) => st.registerPlayer);
  const resolvePlayerMatch = useTournamentStore((st) => st.resolvePlayerMatch);
  const startTournamentSeries = useMatchStore((m) => m.startTournamentSeries);
  const matchPhase = useMatchStore((m) => m.phase);
  const addTitle = useSaveStore((st) => st.addTitle);

  useEffect(() => {
    ensureProgress(currentDate, currentYear, s.startDate.year, s.rlcsTeamsResetSeed, s.seasonStartDate);
    Object.keys(instances).forEach((id) => {
      if (instances[id].playerTeamId) queuePlayerMatch(id, currentDate);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDate.year, currentDate.month, currentDate.day]);

  // 1v1 RLCS doesn't exist before RLCS_1V1_INTRODUCED_SEASON — there's nothing to switch to yet, so the
  // discipline tab bar itself doesn't show at all until then (see the render below), just the 3v3 content.
  // This guard snaps `mode` back to "3v3" if the season ever regresses below that threshold with "1v1"
  // still selected (dev tools season jump), so the view never strands on a tab with nothing to show.
  const showModeTabs = rlcsSeasonNumber >= RLCS_1V1_INTRODUCED_SEASON;
  useEffect(() => {
    if (!showModeTabs && mode === "1v1") setMode("3v3");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showModeTabs]);

  // The org handles its own tournament logistics: once signed, the player is entered into their region's
  // 3v3 regional (and, in the early era, Rival Series) the moment the field opens, rather than waiting on a
  // manual click — "signed up in advance", matching OrgContract's own doc comment in mockSave.ts. Re-fires
  // harmlessly every date tick, isRegistrationOpen goes false the instant it actually registers.
  useEffect(() => {
    if (!s.orgContract) return;
    const orgPower = Math.round(700 + (s.player.gameSense["3v3"] + s.player.mechanicalConsistency["3v3"]) / 15);
    const orgSchedule = buildSeasonSchedule(rlcsSeasonNumber, rlcsSeasonStartDate).filter(
      (sc) => sc.region === playerProRegion && (sc.kind === "rlcs_regional" || sc.kind === "rlrs_regional")
    );
    for (const item of orgSchedule) {
      const instance = instances[item.id];
      if (isRegistrationOpen(instance)) {
        registerPlayer(item.id, s.displayName, playerProRegion, orgPower, s.orgContract.teammates);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDate.year, currentDate.month, currentDate.day, s.orgContract?.orgName, instances]);

  const schedule = buildSeasonSchedule(rlcsSeasonNumber, rlcsSeasonStartDate);
  const rlcsStructureEraNow = rlcsStructureEra(rlcsSeasonNumber);
  const rlcsKind: TournamentKind = mode === "3v3" ? "rlcs_regional" : "rlcs_1v1_regional";
  // Only the player's own region's regional shows up here — every other region's bracket is happening at
  // the same time, but it's not something the player has any stake in or needs to track, showing all of
  // them just crowds the screen with brackets the player will never touch.
  const rlcsSchedule = schedule.filter((sc) => sc.kind === rlcsKind && sc.region === playerProRegion);
  // Rival Series only exists in the early era (2015-2019), and only for 3v3 (its real historical shape).
  const rivalSeriesSchedule = schedule.filter((sc) => sc.kind === "rlrs_regional" && sc.region === playerProRegion);
  const otherSchedule = schedule.filter((sc) => sc.kind === "ewc" || sc.kind === "eleague");

  // Major/Worlds instance ids are keyed by when their prerequisites became ready, not by calendar year
  // (see useTournamentStore's ensureMajorsAndWorlds), so the UI has to look up the latest one per group
  // rather than construct an id directly.
  function latestInstanceId(predicate: (inst: TournamentInstance) => boolean): string | null {
    let bestId: string | null = null;
    let bestDate: { year: number; month: number; day: number } | null = null;
    for (const [id, inst] of Object.entries(instances)) {
      if (!predicate(inst)) continue;
      if (!bestDate || daysBetween(bestDate, inst.startDate) > 0) {
        bestId = id;
        bestDate = inst.startDate;
      }
    }
    return bestId;
  }
  const discipline: RlcsDiscipline = mode === "3v3" ? "3v3" : "1v1";
  const majorIds = MAJOR_GROUPS.map((g) => latestInstanceId((inst) => inst.kind === "rlcs_major" && inst.id.startsWith(`major_${discipline}_${g.id}_`)));
  const worldsId = latestInstanceId((inst) => inst.kind === "rlcs_worlds" && inst.id.startsWith(`worlds_${discipline}_`));
  const majorReadiness = MAJOR_GROUPS.map((g) => getMajorReadiness(instances, discipline, g, currentDate));
  // Early era (2015-2019) had no Major concept at all, Worlds forms straight from every region's regional
  // champion instead, see getEarlyEraWorldsReadiness's doc comment.
  const earlyEraWorldsReadiness = rlcsStructureEraNow === "early" ? getEarlyEraWorldsReadiness(instances, discipline, currentDate) : null;

  // The Season Overview always shows the 3v3 storyline specifically, regardless of which discipline tab
  // is currently selected — 3v3 is the main draw a lower-rank/uninvolved player would actually want a
  // read on, and computing it separately from the mode-dependent vars above means switching to the 1v1
  // tab doesn't change what the overview shows underneath it.
  const overviewMajorIds = MAJOR_GROUPS.map((g) => latestInstanceId((inst) => inst.kind === "rlcs_major" && inst.id.startsWith(`major_3v3_${g.id}_`)));
  const overviewWorldsId = latestInstanceId((inst) => inst.kind === "rlcs_worlds" && inst.id.startsWith("worlds_3v3_"));
  const overviewMajorReadiness = MAJOR_GROUPS.map((g) => getMajorReadiness(instances, "3v3", g, currentDate));
  const overviewEarlyEraWorldsReadiness = rlcsStructureEraNow === "early" ? getEarlyEraWorldsReadiness(instances, "3v3", currentDate) : null;

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? instances[selectedId] : null;
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  const pendingEntry = Object.entries(instances).find(([, inst]) => inst.playerTeamId && inst.pendingMatch);
  const pendingInstanceId = pendingEntry?.[0] ?? null;
  const pendingMatch = pendingEntry?.[1]?.pendingMatch ?? null;
  // The player's own trained mastery has to come from the discipline the PENDING match is actually in, not
  // whichever mode tab the screen happens to be showing right now (that's just a display toggle, it can
  // easily be on 3v3 while a 1v1 series is the one waiting to be played) — team size is a reliable, kind-
  // agnostic signal for this (1 player per team in 1v1, 3 in 3v3), unlike `kind` which majors/worlds share
  // across both disciplines.
  const pendingDiscipline: Mode = pendingEntry && (pendingEntry[1].currentTeams[0]?.players.length ?? 3) === 1 ? "1v1" : "3v3";

  function playerPower(): number {
    return Math.round(700 + (s.player.gameSense[mode] + s.player.mechanicalConsistency[mode]) / 15);
  }

  // 1v1 RLCS only — solo entry, open to anyone at any time (no org involved). 3v3 (regionals AND Rival
  // Series) is the org's territory entirely: the org signs itself up every season on its own (see the
  // auto-register effect above), there's no manual registration path for it at all — matching "you
  // yourself can't sign the org up, they will, always, regardless."
  function handleRegister(instanceId: string) {
    registerPlayer(instanceId, s.displayName, playerProRegion, playerPower(), undefined);
  }

  function handlePlayMatch() {
    if (!pendingInstanceId || !pendingMatch) return;
    const self: SelfStats = {
      name: s.displayName,
      gameSense: s.player.gameSense[pendingDiscipline],
      mechanicalConsistency: s.player.mechanicalConsistency[pendingDiscipline],
      foundationStats: s.foundationStats,
      title: s.titles.find((t) => t.id === s.equippedTitleId) ?? null,
      duelMastery: {
        mechanicMastery: flattenProgress(s.mechanicProgress),
        queueConceptMastery: flattenProgress(s.queueConceptProgress),
        playstyle: s.playstyleProfiles[pendingDiscipline],
      },
      orgTag: s.orgContract ? orgTagForOrgName(s.orgContract.orgName) : undefined,
      region: playerProRegion,
      teamChemistry: pendingDiscipline === "3v3" ? s.orgContract?.chemistry : undefined,
    };
    const instanceLabel = instances[pendingInstanceId]?.label ?? "the tournament";
    const pendingInstance = instances[pendingInstanceId];
    const stageProgress = pendingInstance ? pendingInstance.stageIndex / Math.max(1, pendingInstance.stages.length - 1) : 0;
    // Majors/Worlds are the only events that can ever be LAN (see isLanEvent); everything else the player
    // personally plays (regionals, Rival Series, 1v1 regionals) always stays online.
    const venue: "online" | "lan" = pendingInstance && isLanEvent(pendingInstance.kind, rlcsSeasonNumber) ? "lan" : "online";
    startTournamentSeries(self, [pendingMatch.opponentName], pendingMatch.seriesFormat, era, rankedSeasonNumber, currentYear, s.currentDate, s.seasonStartDate, (wonSeries) => {
      const before = useTournamentStore.getState().instances[pendingInstanceId];
      const stageLabelBefore = before?.stages[before.stageIndex]?.label;
      // The real per-game log (win/loss + map) from the live series just played, so the player's own
      // bracket match shows the same per-game fidelity as every AI-vs-AI match around it.
      const gameLog = useMatchStore.getState().seriesGameLog;
      resolvePlayerMatch(pendingInstanceId, wonSeries, currentDate, gameLog);
      const after = useTournamentStore.getState().instances[pendingInstanceId];
      if (!after) return;
      const wonItAll = after.completed && after.championName === s.displayName;
      const finalPlacement = wonItAll ? 1 : after.playerFinalPlacement;
      if (finalPlacement !== null) {
        // A Champion also earned Contender and Challenger along the way, they're all kept as separate
        // collectible titles, not just the one matching the exact placement.
        titlesEarnedForInstance(after, finalPlacement).forEach((title) => addTitle(title));
      }
      if (wonItAll) {
        setResultMessage(`You won ${instanceLabel}! You're the champion.`);
      } else if (after.playerFinalPlacement) {
        setResultMessage(`Eliminated from ${instanceLabel} — finished ${after.playerFinalPlacement}${after.playerFinalPlacement === 1 ? "st" : "th"}.`);
      } else if (after.stageIndex > before.stageIndex) {
        setResultMessage(`Won the series! Advancing to ${after.stages[after.stageIndex].label}.`);
      } else {
        setResultMessage(wonSeries ? `Series won (${stageLabelBefore}), more matches to come in this stage.` : "Series lost, but you're still alive in this stage.");
      }
    }, stageProgress, undefined, undefined, venue);
  }

  return (
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      <header style={{ marginBottom: "var(--space-4)" }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 650 }}>Tournaments</h1>
        <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>RLCS Season {rlcsSeasonNumber}</div>
      </header>

      <div className="schedule-panel">
        <button className="schedule-panel-toggle" onClick={() => setScheduleOpen((o) => !o)}>
          <span>Season {rlcsSeasonNumber} Schedule</span>
          <span>{scheduleOpen ? "▲" : "▼"}</span>
        </button>
        {scheduleOpen && (
          <div className="schedule-panel-body">
            <div className="schedule-panel-note">
              Regionals/Rival Series dates are locked in. Majors/Worlds dates are estimates — they land
              roughly here based on how long qualifiers and scrim windows take, but shift slightly with how
              regionals/majors actually finish.
            </div>
            {projectedSeasonSchedule(rlcsSeasonNumber, rlcsSeasonStartDate).map((entry) => (
              <div key={entry.id} className="schedule-panel-row">
                <span className="schedule-panel-date">{formatSimDate(entry.date)}</span>
                <span>
                  {entry.label}
                  {entry.estimated ? " (estimated)" : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="schedule-panel">
        <button className="schedule-panel-toggle" onClick={() => setOverviewOpen((o) => !o)}>
          <span>Season {rlcsSeasonNumber} Overview</span>
          <span>{overviewOpen ? "▲" : "▼"}</span>
        </button>
        {overviewOpen && (
          <div className="schedule-panel-body">
            <div className="schedule-panel-note">
              What's happening across every region's 3v3 RLCS right now — worth a look even if you're not
              personally competing (or eligible) this season.
            </div>
            {schedule
              .filter((sc) => sc.kind === "rlcs_regional")
              .map((sc) => (
                <div key={sc.id} className="schedule-panel-row">
                  <span className="schedule-panel-date">{REGION_LABELS[sc.region!]}</span>
                  <span>{regionalOverviewStatus(instances[sc.id], sc.startDate, currentDate)}</span>
                </div>
              ))}
            {rlcsStructureEraNow === "early"
              ? (
                <div className="schedule-panel-row">
                  <span className="schedule-panel-date">World Championship</span>
                  <span>{majorOverviewStatus(overviewWorldsId ? instances[overviewWorldsId] : undefined, overviewEarlyEraWorldsReadiness!, currentDate)}</span>
                </div>
              )
              : (
                <>
                  {MAJOR_GROUPS.map((g, i) => (
                    <div key={g.id} className="schedule-panel-row">
                      <span className="schedule-panel-date">{g.location} Major</span>
                      <span>{majorOverviewStatus(overviewMajorIds[i] ? instances[overviewMajorIds[i]!] : undefined, overviewMajorReadiness[i], currentDate)}</span>
                    </div>
                  ))}
                  <div className="schedule-panel-row">
                    <span className="schedule-panel-date">World Championship</span>
                    <span>
                      {overviewWorldsId && instances[overviewWorldsId]
                        ? majorOverviewStatus(instances[overviewWorldsId], overviewMajorReadiness[0], currentDate)
                        : "Awaiting both Major champions"}
                    </span>
                  </div>
                </>
              )}
          </div>
        )}
      </div>

      {pendingMatch && matchPhase === "idle" && (
        <div className="pending-match-banner">
          <div>
            <div className="pending-match-title">Your match is ready</div>
            <div className="pending-match-sub">
              vs {pendingMatch.opponentName} · Best of {pendingMatch.seriesFormat}
            </div>
          </div>
          <button className="pending-match-btn" onClick={handlePlayMatch}>
            Play Match
          </button>
        </div>
      )}

      {resultMessage && (
        <div className="result-message-banner">
          <span>{resultMessage}</span>
          <button className="result-message-dismiss" onClick={() => setResultMessage(null)}>
            Dismiss
          </button>
        </div>
      )}

      {showModeTabs && (
        <div className="mode-tabbar" role="tablist">
          {(["3v3", "1v1"] as Mode[]).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              className={"mode-tab" + (mode === m ? " mode-tab-active" : "")}
              onClick={() => setMode(m)}
            >
              {m}
            </button>
          ))}
        </div>
      )}

      <div className="tourney-section-label">RLCS Season {rlcsSeasonNumber} — {mode} Regional (Your Region)</div>
      <div className="tourney-grid">
        {rlcsSchedule.map((item) => {
          const instance = instances[item.id];
          const daysUntilStart = daysBetween(currentDate, item.startDate);
          // 1v1 stays open to anyone as a manual solo entry. 3v3 never shows a register button at all —
          // the org signs itself up automatically (see the auto-register effect above), the player never
          // has that choice to make.
          const canRegister = mode === "1v1" && isRegistrationOpen(instance) && daysUntilStart <= REGISTRATION_WINDOW_DAYS;
          return (
            <div
              key={item.id}
              className={"tourney-tile tourney-tile-mine" + (selectedId === item.id ? " tourney-tile-active" : "")}
              role="button"
              tabIndex={0}
              onClick={() => instance && setSelectedId(item.id)}
            >
              <div className="tourney-tile-region">{REGION_LABELS[item.region!]}</div>
              <div className="tourney-tile-status">
                {instance?.playerTeamId
                  ? instance.playerFinalPlacement
                    ? `You placed ${instance.playerFinalPlacement}${instance.playerFinalPlacement === 1 ? "st" : "th"}`
                    : `You're in! ${instance.stages[instance.stageIndex].label}`
                  : !instance
                    ? daysUntilStart > 0
                      ? `Starts in ${daysUntilStart}d`
                      : "Starting..."
                    : instance.completed
                      ? `Champion: ${instance.championName}`
                      : `${instance.stages[instance.stageIndex].label} · ${instance.currentTeams.length} left`}
              </div>
              {canRegister && (
                <button
                  className="tourney-register-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRegister(item.id);
                  }}
                >
                  Register
                </button>
              )}
            </div>
          );
        })}
      </div>

      {mode === "3v3" && rlcsStructureEraNow === "early" && rivalSeriesSchedule.length > 0 && (
        <>
          <div className="tourney-section-label" style={{ marginTop: "var(--space-5)" }}>
            Rival Series Season {rlcsSeasonNumber} — Your Region
          </div>
          <div className="tourney-grid">
            {rivalSeriesSchedule.map((item) => {
              const instance = instances[item.id];
              const daysUntilStart = daysBetween(currentDate, item.startDate);
              return (
                <div
                  key={item.id}
                  className={"tourney-tile tourney-tile-mine" + (selectedId === item.id ? " tourney-tile-active" : "")}
                  role="button"
                  tabIndex={0}
                  onClick={() => instance && setSelectedId(item.id)}
                >
                  <div className="tourney-tile-region">{REGION_LABELS[item.region!]}</div>
                  <div className="tourney-tile-status">
                    {instance?.playerTeamId
                      ? instance.playerFinalPlacement
                        ? `You placed ${instance.playerFinalPlacement}${instance.playerFinalPlacement === 1 ? "st" : "th"}`
                        : `You're in! ${instance.stages[instance.stageIndex].label}`
                      : !instance
                        ? daysUntilStart > 0
                          ? `Starts in ${daysUntilStart}d`
                          : "Starting..."
                        : instance.completed
                          ? `Champion: ${instance.championName}`
                          : `${instance.stages[instance.stageIndex].label} · ${instance.currentTeams.length} left`}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {rlcsStructureEraNow === "early" ? (
        <>
          <div className="tourney-section-label" style={{ marginTop: "var(--space-5)" }}>
            World Championship {mode === "1v1" ? "(1v1)" : "(3v3)"}
          </div>
          <div className="tourney-grid">
            <button
              className={"tourney-tile" + (worldsId && selectedId === worldsId ? " tourney-tile-active" : "")}
              onClick={() => worldsId && setSelectedId(worldsId)}
            >
              <div className="tourney-tile-region">
                World Championship{worldsId && instances[worldsId]?.playerTeamId ? " ★" : ""}
              </div>
              <div className="tourney-tile-status">
                {!worldsId || !instances[worldsId]
                  ? earlyEraWorldsReadiness?.kind === "scheduled"
                    ? (() => {
                        const daysAway = daysBetween(currentDate, earlyEraWorldsReadiness.scheduledStart);
                        return daysAway > 0 ? `Starts in ${daysAway}d` : "Starting soon";
                      })()
                    : earlyEraWorldsReadiness?.kind === "awaiting_regions"
                      ? `Awaiting: ${earlyEraWorldsReadiness.missingRegions.map((r) => REGION_LABELS[r]).join(", ")}`
                      : "Awaiting regional champions"
                  : instances[worldsId].completed
                    ? `World Champion: ${instances[worldsId].championName}`
                    : `${instances[worldsId].stages[instances[worldsId].stageIndex].label}`}
              </div>
              {worldsId && instances[worldsId]?.playerTeamId && !instances[worldsId].completed && (
                <div className="tourney-tile-qualified">This is Worlds — you're playing in it</div>
              )}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="tourney-section-label" style={{ marginTop: "var(--space-5)" }}>
            Majors &amp; World Championship {mode === "1v1" ? "(1v1)" : "(3v3)"}
          </div>
          <div className="tourney-grid">
            {MAJOR_GROUPS.map((group, i) => {
              const id = majorIds[i];
              const instance = id ? instances[id] : undefined;
              const readiness = majorReadiness[i];
              const playerQualified = !!instance?.playerTeamId;
              return (
                <button
                  key={group.id}
                  className={"tourney-tile" + (id && selectedId === id ? " tourney-tile-active" : "")}
                  onClick={() => id && instance && setSelectedId(id)}
                >
                  <div className="tourney-tile-region">
                    {group.location} Major{playerQualified ? " ★" : ""}
                  </div>
                  <div className="tourney-tile-status">
                    {instance
                      ? instance.completed
                        ? `Champion: ${instance.championName}`
                        : `${instance.stages[instance.stageIndex].label} · ${instance.currentTeams.length} left`
                      : readiness.kind === "scheduled"
                        ? (() => {
                            const daysAway = daysBetween(currentDate, readiness.scheduledStart);
                            return daysAway > 0 ? `Starts in ${daysAway}d` : "Starting soon";
                          })()
                        : readiness.kind === "awaiting_3v3_major"
                          ? "Awaiting the 3v3 Major to conclude"
                          : `Awaiting: ${readiness.missingRegions.map((r) => REGION_LABELS[r]).join(", ")}`}
                  </div>
                  {playerQualified && !instance?.completed && <div className="tourney-tile-qualified">This is the Major you're playing in</div>}
                </button>
              );
            })}
            <button
              className={"tourney-tile" + (worldsId && selectedId === worldsId ? " tourney-tile-active" : "")}
              onClick={() => worldsId && setSelectedId(worldsId)}
            >
              <div className="tourney-tile-region">
                World Championship{worldsId && instances[worldsId]?.playerTeamId ? " ★" : ""}
              </div>
              <div className="tourney-tile-status">
                {!worldsId || !instances[worldsId]
                  ? "Awaiting both Major champions"
                  : instances[worldsId].completed
                    ? `World Champion: ${instances[worldsId].championName}`
                    : `${instances[worldsId].stages[instances[worldsId].stageIndex].label}`}
              </div>
              {worldsId && instances[worldsId]?.playerTeamId && !instances[worldsId].completed && (
                <div className="tourney-tile-qualified">This is Worlds — you're playing in it</div>
              )}
            </button>
          </div>
        </>
      )}

      {otherSchedule.length > 0 && (
        <>
          <div className="tourney-section-label" style={{ marginTop: "var(--space-5)" }}>
            Other Events
          </div>
          <div className="tourney-grid">
            {otherSchedule.map((item) => {
              const instance = instances[item.id];
              const daysUntilStart = daysBetween(currentDate, item.startDate);
              return (
                <button
                  key={item.id}
                  className={"tourney-tile" + (selectedId === item.id ? " tourney-tile-active" : "")}
                  onClick={() => instance && setSelectedId(item.id)}
                >
                  <div className="tourney-tile-region">{item.label}</div>
                  <div className="tourney-tile-status">
                    {!instance
                      ? daysUntilStart > 0
                        ? `Starts in ${daysUntilStart}d`
                        : "Starting..."
                      : instance.completed
                        ? `Champion: ${instance.championName}`
                        : `${instance.stages[instance.stageIndex].label} · ${instance.currentTeams.length} left`}
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      {selected && (
        bracketForInstance(selected)
          ? <TournamentBracket bracket={bracketForInstance(selected)!} playerTeamId={selected.playerTeamId} />
          : <StandingsCard instance={selected} currentDate={currentDate} />
      )}

      <style>{`
        .schedule-panel {
          border: 1px solid var(--border-strong);
          border-radius: var(--radius-md);
          margin-bottom: var(--space-4);
          overflow: hidden;
        }
        .schedule-panel-toggle {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: var(--bg-surface-raised);
          border: none;
          padding: 10px 14px;
          font-size: 13px;
          font-weight: 650;
          color: var(--text-primary);
          cursor: pointer;
        }
        .schedule-panel-body {
          padding: 10px 14px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .schedule-panel-note {
          font-size: 12px;
          color: var(--text-tertiary);
          margin-bottom: 4px;
        }
        .schedule-panel-row {
          display: flex;
          gap: var(--space-3);
          font-size: 13px;
          color: var(--text-secondary);
        }
        .schedule-panel-date {
          flex: 0 0 auto;
          min-width: 72px;
          font-weight: 600;
          color: var(--text-primary);
        }
        .result-message-banner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-3);
          background: var(--bg-surface-raised);
          border: 1px solid var(--border-strong);
          border-radius: var(--radius-md);
          padding: 10px 14px;
          margin-bottom: var(--space-4);
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
        }
        .result-message-dismiss {
          background: none;
          border: none;
          color: var(--text-tertiary);
          font-size: 12px;
          cursor: pointer;
          white-space: nowrap;
        }
        .pending-match-banner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-3);
          background: color-mix(in srgb, var(--accent) 14%, var(--bg-surface));
          border: 1px solid var(--accent);
          border-radius: var(--radius-md);
          padding: 12px 16px;
          margin-bottom: var(--space-4);
        }
        .pending-match-title {
          font-size: 14px;
          font-weight: 700;
          color: var(--text-primary);
        }
        .pending-match-sub {
          font-size: 12px;
          color: var(--text-secondary);
          margin-top: 2px;
        }
        .pending-match-btn {
          background: var(--accent);
          color: #17181c;
          border: none;
          border-radius: var(--radius-md);
          font-size: 13px;
          font-weight: 700;
          padding: 10px 18px;
          cursor: pointer;
          white-space: nowrap;
        }
        .tourney-register-btn {
          margin-top: 8px;
          background: var(--accent);
          color: #17181c;
          border: none;
          border-radius: var(--radius-sm);
          font-size: 11px;
          font-weight: 700;
          padding: 6px 12px;
          cursor: pointer;
        }
        .mode-tabbar {
          display: flex;
          gap: 4px;
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 4px;
          margin-bottom: var(--space-4);
          width: fit-content;
        }
        .mode-tab {
          background: none;
          border: none;
          color: var(--text-secondary);
          font-size: 12px;
          font-weight: 700;
          padding: 6px 18px;
          border-radius: var(--radius-sm);
          cursor: pointer;
        }
        .mode-tab-active {
          background: var(--bg-surface-raised);
          color: var(--text-primary);
        }
        .tourney-section-label {
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--text-tertiary);
          margin-bottom: var(--space-2);
        }
        .tourney-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: var(--space-2);
          margin-bottom: var(--space-2);
        }
        .tourney-tile {
          text-align: left;
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 10px 12px;
          cursor: pointer;
        }
        .tourney-tile:hover {
          border-color: var(--border-strong);
        }
        .tourney-tile-active {
          border-color: var(--accent);
          background: color-mix(in srgb, var(--accent) 10%, var(--bg-surface));
        }
        .tourney-tile-mine {
          border-color: var(--accent);
        }
        .tourney-tile-region {
          font-size: 13px;
          font-weight: 700;
          color: var(--text-primary);
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
        }
        .tourney-tile-status {
          font-size: 11px;
          color: var(--text-tertiary);
          margin-top: 4px;
        }
        .tourney-tile-qualified {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.3px;
          color: var(--accent);
          margin-top: 6px;
        }
      `}</style>
    </div>
  );
}

function StandingsCard({ instance, currentDate }: { instance: TournamentInstance; currentDate: { year: number; month: number; day: number } }) {
  const stage = instance.completed ? null : instance.stages[instance.stageIndex];
  const daysIntoStage = daysBetween(instance.stageStartDate, currentDate);
  const daysLeftInStage = stage ? Math.max(0, stage.days - daysIntoStage) : 0;
  const rows = instance.lastStandings.length > 0 ? instance.lastStandings : instance.currentTeams.map((team) => ({ team, wins: 0, losses: 0, placement: null as number | null }));
  const isSolo = instance.currentTeams[0]?.players.length === 1;

  return (
    <div className="tourney-card">
      <div className="tourney-header">
        <div>
          <div className="tourney-title">{instance.label}</div>
          <div className="tourney-sub">{instance.currentTeams.length} {isSolo ? "players" : "teams"} remaining</div>
        </div>
        {instance.completed ? (
          <div className="tourney-status tourney-status-done">Champion: {instance.championName}</div>
        ) : (
          <div className="tourney-status">
            {stage!.label} · {daysLeftInStage}d left
          </div>
        )}
      </div>

      <div className="standings-table-wrap">
        <table className="standings-table">
          <thead>
            <tr>
              <th>#</th>
              <th>{isSolo ? "Player" : "Team"}</th>
              {!isSolo && <th>Players</th>}
              <th style={{ textAlign: "right" }}>Record</th>
              <th>Title Earned</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((entry, i) => {
              const title = titleForInstance(instance, entry.placement);
              return (
                <tr key={entry.team.id}>
                  <td>{entry.placement ?? i + 1}</td>
                  <td>{entry.team.name}</td>
                  {!isSolo && <td className="standings-players">{entry.team.players.join(", ")}</td>}
                  <td style={{ textAlign: "right" }}>
                    {entry.wins}-{entry.losses}
                  </td>
                  <td className="standings-title" style={title?.glow === "gold" ? { color: "#f0d68a", fontWeight: 700 } : undefined}>
                    {title?.label ?? ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <style>{`
        .tourney-card {
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          padding: var(--space-4);
          margin-top: var(--space-3);
        }
        .tourney-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: var(--space-3);
          margin-bottom: var(--space-3);
        }
        .tourney-title {
          font-size: 16px;
          font-weight: 700;
        }
        .tourney-sub {
          font-size: 12px;
          color: var(--text-tertiary);
          margin-top: 2px;
        }
        .tourney-status {
          font-size: 12px;
          font-weight: 600;
          color: var(--accent);
          white-space: nowrap;
        }
        .tourney-status-done {
          color: #e3c76f;
        }
        .standings-table-wrap {
          max-height: 420px;
          overflow-y: auto;
        }
        .standings-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }
        .standings-table thead th {
          position: sticky;
          top: 0;
          background: var(--bg-surface);
          text-align: left;
          color: var(--text-tertiary);
          font-weight: 500;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          padding: 6px 8px;
          border-bottom: 1px solid var(--border-subtle);
        }
        .standings-table td {
          padding: 6px 8px;
          border-bottom: 1px solid var(--border-subtle);
        }
        .standings-players {
          color: var(--text-tertiary);
          font-size: 11px;
        }
        .standings-title {
          font-size: 10px;
          color: var(--text-tertiary);
          text-transform: uppercase;
        }
      `}</style>
    </div>
  );
}
