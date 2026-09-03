import { useEffect, useRef } from "react";
import { Icon } from "@/ui/components/Icon";
import { useMatchStore, GAME_DURATION_SECONDS, type MatchPlayer } from "@/store/useMatchStore";
import { useSaveStore, PLACEMENT_MMR_AMPLIFIER } from "@/store/useSaveStore";
import { QUEUE_LABELS, QUEUE_ICONS } from "@/data/queues";
import { FOUNDATION_LABELS, type FoundationCategory } from "@/data/mechanics";
import { glowColor } from "@/data/seasons";
import { eraForDate } from "@/data/rankSystem";
import { PRO_PLAYERS, type ProRegion } from "@/data/proPlayers";
import { useProLeaderboardStore } from "@/store/useProLeaderboardStore";
import { useLeaderboardFillerStore, fillerLeaderboardNames } from "@/store/useLeaderboardFillerStore";
import { useRegionalRosterStore } from "@/store/useRegionalRosterStore";
import { regionalGrinderRoster } from "@/data/regionalGrinders";
import { computeMmrDelta, computeOverallRating } from "@/data/matchSim";
import { OrgTag } from "@/ui/components/OrgTag";
import { ARENA_MAPS, mapImagePath } from "@/data/maps";
import { livePingMs } from "@/data/pingModel";

const ALL_MATCHMAKING_REGIONS: ProRegion[] = ["NA", "EU", "OCE", "SAM", "MENA", "APAC", "SSA"];

/** Scans every region's grinder roster for a name — used to route a post-match result to the right
 *  region's persistent MMR/stats (see useRegionalRosterStore.ts). */
function findGrinderRegion(name: string, currentYear: number): ProRegion | undefined {
  for (const region of ALL_MATCHMAKING_REGIONS) {
    if (regionalGrinderRoster(region, currentYear).some((g) => g.name === name)) return region;
  }
  return undefined;
}

const MATCHUP_STATS: { key: FoundationCategory | "gameSense" | "mechanicalConsistency"; label: string }[] = [
  { key: "gameSense", label: "Game Sense" },
  { key: "mechanicalConsistency", label: "Mechanical Consistency" },
  { key: "carControl", label: FOUNDATION_LABELS.carControl },
  { key: "aerialControl", label: FOUNDATION_LABELS.aerialControl },
  { key: "boostManagement", label: FOUNDATION_LABELS.boostManagement },
  { key: "offense", label: FOUNDATION_LABELS.offense },
  { key: "defense", label: FOUNDATION_LABELS.defense },
  { key: "passing", label: FOUNDATION_LABELS.passing },
];

function statValue(p: MatchPlayer, key: (typeof MATCHUP_STATS)[number]["key"]): number {
  if (key === "gameSense") return p.gameSense;
  if (key === "mechanicalConsistency") return p.mechanicalConsistency;
  return p.foundationStats[key];
}

function PartyIcon() {
  return (
    <span className="party-icon" title="Queued as a party">
      <Icon name="duos" size={12} />
    </span>
  );
}

export function MatchScreen() {
  const phase = useMatchStore((m) => m.phase);
  const queue = useMatchStore((m) => m.queue);

  if (phase === "found") {
    return <MatchFoundOverlay />;
  }

  return <LiveMatch queue={queue} />;
}

function MatchFoundOverlay() {
  const queue = useMatchStore((m) => m.queue);
  if (!queue) return null;

  return (
    <div className="found-overlay">
      <div className="found-icon">
        <Icon name={QUEUE_ICONS[queue]} size={48} />
      </div>
      <div className="found-title">MATCH FOUND</div>
      <div className="found-subtitle">{QUEUE_LABELS[queue]}</div>

      <style>{`
        .found-overlay {
          position: fixed;
          inset: 0;
          background: var(--bg-app);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: var(--space-3);
          z-index: 100;
        }
        .found-icon {
          color: var(--accent);
          animation: found-pop 500ms ease;
        }
        .found-title {
          font-size: 32px;
          font-weight: 800;
          letter-spacing: 1.5px;
          color: var(--text-primary);
          animation: found-pop 500ms ease 80ms both;
        }
        .found-subtitle {
          font-size: 14px;
          color: var(--text-tertiary);
          text-transform: uppercase;
          letter-spacing: 1px;
          animation: found-fade 500ms ease 200ms both;
        }
        @keyframes found-pop {
          0% { opacity: 0; transform: scale(0.7); }
          60% { opacity: 1; transform: scale(1.08); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes found-fade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function LiveMatch({ queue }: { queue: import("@/data/mockSave").QueueMode | null }) {
  const phase = useMatchStore((m) => m.phase);
  const clockSeconds = useMatchStore((m) => m.clockSeconds);
  const overtime = useMatchStore((m) => m.overtime);
  const otSeconds = useMatchStore((m) => m.otSeconds);
  const players = useMatchStore((m) => m.players);
  const scoreBlue = useMatchStore((m) => m.scoreBlue);
  const scoreOrange = useMatchStore((m) => m.scoreOrange);
  const log = useMatchStore((m) => m.log);
  const resultWin = useMatchStore((m) => m.resultWin);
  const selfGoals = useMatchStore((m) => m.selfGoals);
  const selfSaves = useMatchStore((m) => m.selfSaves);
  const returnToMenu = useMatchStore((m) => m.returnToMenu);
  const seriesFormat = useMatchStore((m) => m.seriesFormat);
  const seriesWinsSelf = useMatchStore((m) => m.seriesWinsSelf);
  const seriesWinsOpp = useMatchStore((m) => m.seriesWinsOpp);
  const seriesGameNumber = useMatchStore((m) => m.seriesGameNumber);
  const continueSeries = useMatchStore((m) => m.continueSeries);
  const queueDurationMs = useMatchStore((m) => m.queueDurationMs);
  const autoQueueModes = useMatchStore((m) => m.autoQueueModes);
  const mapId = useMatchStore((m) => m.mapId);
  const map = ARENA_MAPS.find((m) => m.id === mapId) ?? null;
  const mapImage = mapImagePath(map);
  const matchVenue = useMatchStore((m) => m.matchVenue);
  const isSeriesMatch = seriesFormat > 1;
  const seriesDecided = isSeriesMatch && (seriesWinsSelf >= Math.ceil(seriesFormat / 2) || seriesWinsOpp >= Math.ceil(seriesFormat / 2));
  const recordMatchResult = useSaveStore((s) => s.recordMatchResult);
  const advanceMinutes = useSaveStore((s) => s.advanceMinutes);
  const currentDate = useSaveStore((s) => s.currentDate);
  const seasonStartDate = useSaveStore((s) => s.seasonStartDate);
  const inPlacements = useSaveStore((s) => (queue ? s.rankedProfiles[queue].placementMatchesRemaining > 0 : false));
  const friends = useSaveStore((s) => s.friends);
  const recordFriendMatch = useSaveStore((s) => s.recordFriendMatch);
  const applyFriendMatchStats = useSaveStore((s) => s.applyFriendMatchStats);
  const recordRecentlyPlayedWith = useSaveStore((s) => s.recordRecentlyPlayedWith);

  // Scrolls only the log's own container to its bottom, not the whole page — scrollIntoView would
  // otherwise drag the entire screen down every time a new line comes in, making the matchup stats below
  // it (and everything else) jump around while you're trying to read them.
  const logContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = logContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log.length]);

  const blueTeam = players.filter((p) => p.team === "blue");
  const orangeTeam = players.filter((p) => p.team === "orange");
  const selfRegion = players.find((p) => p.isSelf)?.region;
  const clockLabel = overtime
    ? `OT ${Math.floor(otSeconds / 60)}:${(otSeconds % 60).toString().padStart(2, "0")}`
    : `${Math.floor(clockSeconds / 60)}:${(clockSeconds % 60).toString().padStart(2, "0")}`;
  const self = players.find((p) => p.isSelf);
  const opponents = players.filter((p) => !p.isSelf && p.team !== self?.team);

  // Real RL's MMR system moves everyone based on their team's average MMR relative to the other team's,
  // narrow band (mostly 5-11) regardless of how lopsided the gap is, not classical Elo. Teammates share
  // the same delta, the losing side's delta is the mirror of the winning side's.
  const blueAvgMmr = blueTeam.length > 0 ? blueTeam.reduce((sum, p) => sum + p.mmr, 0) / blueTeam.length : 0;
  const orangeAvgMmr = orangeTeam.length > 0 ? orangeTeam.reduce((sum, p) => sum + p.mmr, 0) / orangeTeam.length : 0;
  const blueWon = scoreBlue > scoreOrange;
  const blueDelta = computeMmrDelta(blueAvgMmr, orangeAvgMmr, blueWon);
  const orangeDelta = computeMmrDelta(orangeAvgMmr, blueAvgMmr, !blueWon);
  const mmrDelta = self ? (self.team === "blue" ? blueDelta : orangeDelta) : 0;
  // Placement matches swing harder (see PLACEMENT_MMR_AMPLIFIER in useSaveStore), the displayed number
  // has to reflect that same multiplier or it reads as a measly few points when a much bigger change is
  // actually about to be applied to the player's real MMR.
  const displayMmrDelta = inPlacements ? Math.round(mmrDelta * PLACEMENT_MMR_AMPLIFIER) : mmrDelta;
  function deltaForPlayer(p: MatchPlayer, teamDelta: number): number {
    return p.isSelf && inPlacements ? Math.round(teamDelta * PLACEMENT_MMR_AMPLIFIER) : teamDelta;
  }

  function handleContinue() {
    if (queue && resultWin !== null && self) {
      const scoreSelf = self.team === "blue" ? scoreBlue : scoreOrange;
      const scoreOpp = self.team === "blue" ? scoreOrange : scoreBlue;
      const lastEmphasis = [...log].reverse().find((l) => l.emphasis);
      const note = lastEmphasis?.text ?? (resultWin ? "Solid win overall." : "Tough loss, close throughout.");
      recordMatchResult({
        queue,
        win: resultWin,
        mmrDelta,
        scoreSelf,
        scoreOpp,
        selfGoals,
        selfSaves,
        note,
        opponentNames: players.filter((p) => !p.isSelf).map((p) => p.name),
      });

      // The match actually matters to any real pro or leaderboard regular who was in it: their queue MMR
      // moves the same way a real ranked result would, teammates share the player's result, opponents get
      // the inverse — this is what keeps the board consistent with who you actually play. Skipped during
      // the player's own placements, those matches are too noisy/amplified to feed into a persistent rank.
      if (!inPlacements) {
        const era = eraForDate(currentDate);
        const fillerNames = new Set(fillerLeaderboardNames());
        players.forEach((p) => {
          if (p.isSelf) return;
          const delta = p.team === "blue" ? blueDelta : orangeDelta;
          const pro = PRO_PLAYERS.find((pp) => pp.name === p.name);
          const grinderRegion = pro ? undefined : findGrinderRegion(p.name, currentDate.year);
          if (pro) {
            useProLeaderboardStore.getState().applyResult(pro.name, queue, delta, era, currentDate.year, seasonStartDate);
          } else if (grinderRegion) {
            useRegionalRosterStore.getState().applyResult(p.name, grinderRegion, queue, delta, era, currentDate.year, seasonStartDate);
          } else if (fillerNames.has(p.name)) {
            useLeaderboardFillerStore.getState().applyResult(p.name, queue, delta, era, currentDate.year, seasonStartDate);
          } else if (friends[p.name]) {
            // A "plain" friend (not a real pro or filler-leaderboard regular) has nowhere else tracking
            // them, this is the only place their persisted MMR/stats ever update.
            applyFriendMatchStats(p.name, queue, delta);
          }
        });
      }

      // Rivalry record: anyone in the match who's a friend gets tracked, "against" if they were on the
      // other side, "with" if they were a partied-up teammate.
      players.forEach((p) => {
        if (p.isSelf || !friends[p.name]) return;
        const relation = p.team === self.team ? "with" : "against";
        recordFriendMatch(p.name, relation, resultWin, note);
      });
      recordRecentlyPlayedWith(players.filter((p) => !p.isSelf).map((p) => p.name));
    }
    // Real queue wait (per the rank/population/time-of-day model) plus the match itself, 5:00 regulation
    // plus however long sudden-death overtime actually ran, in-game minutes rather than a flat hour.
    const queueMinutes = queueDurationMs / 60000;
    const matchMinutes = (GAME_DURATION_SECONDS + otSeconds) / 60;
    advanceMinutes(Math.max(1, Math.round(queueMinutes + matchMinutes)));
    returnToMenu();
  }

  // Auto-queue means genuinely hands-off: with it on, the post-match "Continue" click happens on its own
  // after a short beat (long enough to actually see the result), instead of making the player click through
  // every single game. Never fires for a series match (tournament/org/showmatch), those always need a
  // deliberate Continue/Next Game click regardless of auto-queue.
  useEffect(() => {
    if (phase !== "post_match" || isSeriesMatch || !autoQueueModes || autoQueueModes.length === 0) return;
    const timer = setTimeout(() => handleContinue(), 1800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, isSeriesMatch, autoQueueModes]);

  return (
    <div className="live-match fade-in">
      {mapImage && <div className="match-bg" style={{ backgroundImage: `url(${mapImage})` }} />}
      {map && (
        <div className="match-map-label">
          {map.name} · {matchVenue === "lan" ? "LAN Event" : "Online Match"}
        </div>
      )}
      {phase === "post_match" && isSeriesMatch && (
        <div className={"result-banner" + (resultWin ? " result-win" : " result-loss")}>
          <span>
            {resultWin ? `GAME ${seriesGameNumber} WON` : `GAME ${seriesGameNumber} LOST`}
            <span className="result-mmr">
              Series {seriesWinsSelf}-{seriesWinsOpp}
              {seriesDecided ? (seriesWinsSelf > seriesWinsOpp ? " · SERIES WON" : " · SERIES LOST") : ""}
            </span>
          </span>
          <button className="continue-btn" onClick={continueSeries}>
            {seriesDecided ? "Continue" : "Next Game"}
          </button>
        </div>
      )}

      {phase === "post_match" && !isSeriesMatch && (
        <div className={"result-banner" + (resultWin ? " result-win" : " result-loss")}>
          <span>
            {resultWin ? "VICTORY" : "DEFEAT"}
            <span className="result-mmr">
              {displayMmrDelta > 0 ? `+${displayMmrDelta}` : displayMmrDelta} MMR{inPlacements ? " (placement)" : ""}
            </span>
          </span>
          <button className="continue-btn" onClick={handleContinue}>
            Continue
          </button>
        </div>
      )}

      <div className="match-header">
        <div className="match-clock">{phase === "post_match" ? "FINAL" : clockLabel}</div>
        <div className="match-queue">
          {queue ? QUEUE_LABELS[queue] : ""}
          {isSeriesMatch && ` · Bo${seriesFormat} · Game ${seriesGameNumber} · Series ${seriesWinsSelf}-${seriesWinsOpp}`}
        </div>
      </div>

      <div className="scoreboard">
        <div className="score-team score-blue">{scoreBlue}</div>
        <div className="score-sep">:</div>
        <div className="score-team score-orange">{scoreOrange}</div>
      </div>

      <div className="roster">
        <div className="roster-col">
          {blueTeam.map((p) => (
            <div key={p.name} className={"roster-row roster-blue" + (p.isSelf ? " roster-self" : "")}>
              <div className="roster-identity">
                <span>
                  {p.partyId && <PartyIcon />}
                  {!isSeriesMatch && <span className="roster-mmr">[{p.mmr}]</span>} <OrgTag tag={p.orgTag} />
                  {p.name}
                </span>
                {p.title && (
                  <span
                    className="roster-title"
                    style={{ color: glowColor(p.title.glow) }}
                  >
                    {p.title.label}
                  </span>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {!isSeriesMatch && !p.isSelf && selfRegion && (
                  <span className="roster-ping">{livePingMs(selfRegion, p.region, p.name, clockSeconds)}ms</span>
                )}
                {phase === "post_match" && !isSeriesMatch ? (
                  <span className={"roster-mmr-delta" + (deltaForPlayer(p, blueDelta) > 0 ? " mmr-delta-up" : " mmr-delta-down")}>
                    {deltaForPlayer(p, blueDelta) > 0 ? `+${deltaForPlayer(p, blueDelta)}` : deltaForPlayer(p, blueDelta)}
                  </span>
                ) : (
                  <span className="roster-points">{p.points}</span>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="roster-col">
          {orangeTeam.map((p) => (
            <div key={p.name} className={"roster-row roster-orange" + (p.isSelf ? " roster-self" : "")}>
              <div className="roster-identity">
                <span>
                  {p.partyId && <PartyIcon />}
                  {!isSeriesMatch && <span className="roster-mmr">[{p.mmr}]</span>} <OrgTag tag={p.orgTag} />
                  {p.name}
                </span>
                {p.title && (
                  <span
                    className="roster-title"
                    style={{ color: glowColor(p.title.glow) }}
                  >
                    {p.title.label}
                  </span>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {!isSeriesMatch && !p.isSelf && selfRegion && (
                  <span className="roster-ping">{livePingMs(selfRegion, p.region, p.name, clockSeconds)}ms</span>
                )}
                {phase === "post_match" && !isSeriesMatch ? (
                  <span className={"roster-mmr-delta" + (deltaForPlayer(p, orangeDelta) > 0 ? " mmr-delta-up" : " mmr-delta-down")}>
                    {deltaForPlayer(p, orangeDelta) > 0 ? `+${deltaForPlayer(p, orangeDelta)}` : deltaForPlayer(p, orangeDelta)}
                  </span>
                ) : (
                  <span className="roster-points">{p.points}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="match-log" ref={logContainerRef}>
        {log.map((line) => (
          <div key={line.id} className={"match-log-line" + (line.emphasis ? " match-log-emphasis" : "")}>
            <span className="match-log-time">{line.clockLabel}</span>
            <span>{line.text}</span>
          </div>
        ))}
      </div>

      {self && opponents.length > 0 && (
        <div className="matchup">
          <h2 className="matchup-title">Matchup</h2>
          <div className="matchup-table-wrap">
            <table className="matchup-table">
              <thead>
                <tr>
                  <th className="matchup-corner" />
                  <th className="matchup-team-header matchup-team-blue" colSpan={blueTeam.length}>
                    Blue Team
                  </th>
                  <th className="matchup-team-header matchup-team-orange" colSpan={orangeTeam.length}>
                    Orange Team
                  </th>
                </tr>
                <tr>
                  <th className="matchup-corner" />
                  {[...blueTeam, ...orangeTeam].map((p) => (
                    <th key={p.name} className={"matchup-player-header" + (p.isSelf ? " matchup-col-self" : "")}>
                      {p.partyId && <PartyIcon />}
                      <OrgTag tag={p.orgTag} />
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="matchup-overall-row">
                  <td className="matchup-row-label">Overall Rating</td>
                  {[...blueTeam, ...orangeTeam].map((p) => (
                    <td key={p.name} className={"matchup-cell matchup-overall-cell" + (p.isSelf ? " matchup-col-self" : "")}>
                      {computeOverallRating(p.gameSense, p.mechanicalConsistency, p.foundationStats).toLocaleString()}
                    </td>
                  ))}
                </tr>
                {MATCHUP_STATS.map(({ key, label }) => (
                  <tr key={key}>
                    <td className="matchup-row-label">{label}</td>
                    {[...blueTeam, ...orangeTeam].map((p) => (
                      <td key={p.name} className={"matchup-cell" + (p.isSelf ? " matchup-col-self" : "")}>
                        {statValue(p, key).toLocaleString()}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <style>{`
        .live-match {
          position: relative;
          max-width: 720px;
          margin: 0 auto;
          padding: var(--space-5) var(--space-4);
          min-height: 100vh;
          box-sizing: border-box;
        }
        .match-bg {
          position: absolute;
          inset: 0;
          background-size: cover;
          background-position: center;
          background-repeat: no-repeat;
          opacity: 0.22;
          pointer-events: none;
        }
        .match-map-label {
          position: relative;
          text-align: center;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.6px;
          text-transform: uppercase;
          color: var(--text-tertiary);
          margin-bottom: var(--space-2);
        }
        .result-banner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-radius: var(--radius-lg);
          padding: var(--space-4);
          margin-bottom: var(--space-4);
          font-size: 20px;
          font-weight: 800;
          letter-spacing: 1px;
        }
        .result-mmr {
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0;
          margin-left: var(--space-3);
          opacity: 0.85;
        }
        .result-win {
          background: rgba(107,181,131,0.16);
          color: var(--success);
        }
        .result-loss {
          background: rgba(217,100,91,0.16);
          color: var(--danger);
        }
        .continue-btn {
          background: var(--accent);
          color: #17181c;
          border: none;
          border-radius: var(--radius-md);
          font-size: 13px;
          font-weight: 700;
          padding: 10px 18px;
          cursor: pointer;
        }
        .match-header {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          margin-bottom: var(--space-3);
        }
        .match-clock {
          font-size: 22px;
          font-weight: 700;
          color: var(--text-primary);
        }
        .match-queue {
          font-size: 12px;
          color: var(--text-tertiary);
          text-transform: uppercase;
          letter-spacing: 0.6px;
        }
        .scoreboard {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: var(--space-4);
          margin-bottom: var(--space-5);
        }
        .score-team {
          font-size: 48px;
          font-weight: 800;
        }
        .score-blue { color: var(--team-blue); }
        .score-orange { color: var(--team-orange); }
        .score-sep {
          font-size: 32px;
          color: var(--text-tertiary);
        }
        .roster {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: var(--space-3);
          margin-bottom: var(--space-4);
        }
        .roster-col {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .roster-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 13px;
          padding: 6px 10px;
          border-radius: var(--radius-sm);
          background: var(--bg-surface);
          border-left: 3px solid transparent;
        }
        .roster-identity {
          display: flex;
          flex-direction: column;
          gap: 1px;
          min-width: 0;
        }
        .roster-title {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.3px;
          text-transform: uppercase;
        }
        .roster-blue { border-left-color: var(--team-blue); }
        .roster-orange { border-left-color: var(--team-orange); }
        .roster-self { font-weight: 700; color: var(--text-primary); }
        .roster-points { color: var(--text-tertiary); }
        .roster-ping {
          font-size: 11px;
          color: var(--text-tertiary);
          font-variant-numeric: tabular-nums;
        }
        .roster-mmr {
          color: var(--text-tertiary);
          font-variant-numeric: tabular-nums;
          font-weight: 500;
        }
        .roster-mmr-delta {
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          font-size: 13px;
        }
        .mmr-delta-up { color: var(--success); }
        .mmr-delta-down { color: var(--danger); }
        .match-log {
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          padding: var(--space-3) var(--space-4);
          max-height: 260px;
          overflow-y: auto;
          font-size: 13px;
        }
        .match-log-line {
          display: flex;
          gap: var(--space-2);
          padding: 4px 0;
          color: var(--text-secondary);
          border-bottom: 1px solid var(--border-subtle);
        }
        .match-log-line:last-child {
          border-bottom: none;
        }
        .match-log-emphasis {
          color: var(--text-primary);
          font-weight: 700;
        }
        .match-log-time {
          color: var(--text-tertiary);
          font-variant-numeric: tabular-nums;
          flex-shrink: 0;
        }

        .matchup {
          margin-top: var(--space-4);
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          padding: var(--space-4);
        }
        .matchup-title {
          margin: 0 0 var(--space-3);
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          color: var(--text-tertiary);
        }
        .matchup-table-wrap {
          overflow-x: auto;
        }
        .matchup-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
          font-variant-numeric: tabular-nums;
        }
        .matchup-team-header {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          text-align: center;
          padding: 4px 8px;
        }
        .matchup-team-blue { color: var(--team-blue); }
        .matchup-team-orange { color: var(--team-orange); }
        .matchup-player-header {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-secondary);
          text-align: center;
          padding: 4px 8px;
          white-space: nowrap;
          border-bottom: 1px solid var(--border-subtle);
        }
        .matchup-row-label {
          color: var(--text-secondary);
          padding: 6px 8px 6px 0;
          white-space: nowrap;
        }
        .matchup-cell {
          text-align: center;
          padding: 6px 8px;
          border-bottom: 1px solid var(--border-subtle);
        }
        tr:last-child .matchup-cell {
          border-bottom: none;
        }
        .matchup-col-self {
          color: var(--text-primary);
          font-weight: 700;
          background: color-mix(in srgb, var(--accent) 8%, transparent);
        }
        .matchup-overall-row .matchup-row-label {
          color: var(--text-primary);
          font-weight: 700;
        }
        .matchup-overall-cell {
          font-weight: 800;
          font-size: 13px;
          border-bottom: 2px solid var(--border-strong);
        }
        .party-icon {
          display: inline-flex;
          color: var(--success);
          margin-right: 4px;
          vertical-align: middle;
        }
      `}</style>
    </div>
  );
}
