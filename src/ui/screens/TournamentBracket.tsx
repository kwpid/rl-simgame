// Real esports-style bracket view for double_elim/single_elim stages (see data/bracketTypes.ts /
// data/tournamentFormats.ts's buildDoubleElimBracket/buildSingleElimBracket). swiss/gsl_group stages never
// reach this component — they keep TourneysScreen.tsx's existing StandingsCard table, matching how real
// RLCS broadcasts show Swiss/GSL as standings tables too, not bracket diagrams.
import { useState } from "react";
import type { BracketTree, MatchNode, GameResult } from "@/data/bracketTypes";
import type { TournamentTeam } from "@/data/tournamentFormats";
import { ARENA_MAPS } from "@/data/maps";

function mapNameFor(mapId: string): string {
  return ARENA_MAPS.find((m) => m.id === mapId)?.name ?? "Unknown Map";
}

function gameScore(match: MatchNode): { aWins: number; bWins: number } {
  const aId = match.slotA?.teamId;
  const bId = match.slotB?.teamId;
  let aWins = 0;
  let bWins = 0;
  for (const g of match.games) {
    if (g.winnerId === aId) aWins++;
    else if (g.winnerId === bId) bWins++;
  }
  return { aWins, bWins };
}

function GamesBreakdown({ games, teams, aId, bId }: { games: GameResult[]; teams: Record<string, TournamentTeam>; aId?: string; bId?: string }) {
  if (games.length === 0) return <div className="bracket-games-empty">Not played yet.</div>;
  return (
    <div className="bracket-games-breakdown">
      {games.map((g) => (
        <div key={g.gameNumber} className="bracket-game-row">
          <span className="bracket-game-num">G{g.gameNumber}</span>
          <span className="bracket-game-map">{g.mapId ? mapNameFor(g.mapId) : "—"}</span>
          <span className="bracket-game-winner">{teams[g.winnerId]?.name ?? (g.winnerId === aId ? teams[aId!]?.name : g.winnerId === bId ? teams[bId!]?.name : g.winnerId)}</span>
        </div>
      ))}
    </div>
  );
}

function TeamRow({ team, wins, isWinner, isPlayer, isBye }: { team: TournamentTeam | null; wins: number; isWinner: boolean; isPlayer: boolean; isBye: boolean }) {
  return (
    <div className={"bracket-team-row" + (isWinner ? " bracket-team-winner" : "") + (isPlayer ? " bracket-team-mine" : "")}>
      <span className="bracket-team-name">{team ? team.name : isBye ? "BYE" : "TBD"}</span>
      <span className="bracket-team-score">{team ? wins : ""}</span>
    </div>
  );
}

function MatchCard({ match, teams, playerTeamId }: { match: MatchNode; teams: Record<string, TournamentTeam>; playerTeamId: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const teamA = match.slotA ? teams[match.slotA.teamId] : null;
  const teamB = match.slotB ? teams[match.slotB.teamId] : null;
  const { aWins, bWins } = gameScore(match);
  const isBye = match.resolved && ((!!match.slotA) !== (!!match.slotB));
  const canExpand = match.resolved && match.games.length > 0;
  return (
    <div
      className={"bracket-match-card" + (canExpand ? " bracket-match-clickable" : "")}
      onClick={() => canExpand && setExpanded((e) => !e)}
    >
      <TeamRow team={teamA} wins={aWins} isWinner={match.resolved && match.winnerId === teamA?.id} isPlayer={teamA?.id === playerTeamId} isBye={isBye} />
      <TeamRow team={teamB} wins={bWins} isWinner={match.resolved && match.winnerId === teamB?.id} isPlayer={teamB?.id === playerTeamId} isBye={isBye} />
      {expanded && <GamesBreakdown games={match.games} teams={teams} aId={teamA?.id} bId={teamB?.id} />}
    </div>
  );
}

function RoundColumn({ title, matches, teams, playerTeamId }: { title: string; matches: MatchNode[]; teams: Record<string, TournamentTeam>; playerTeamId: string | null }) {
  return (
    <div className="bracket-round-column">
      <div className="bracket-round-title">{title}</div>
      <div className="bracket-round-matches">
        {matches.map((m) => (
          <MatchCard key={m.id} match={m} teams={teams} playerTeamId={playerTeamId} />
        ))}
      </div>
    </div>
  );
}

function roundLabel(prefix: string, roundIndex: number, totalRounds: number): string {
  const remaining = totalRounds - roundIndex;
  if (prefix === "Winners" || prefix === "") {
    if (remaining === 1) return prefix ? `${prefix} Final` : "Final";
    if (remaining === 2) return `${prefix} Semifinals`.trim();
    if (remaining === 3) return `${prefix} Quarterfinals`.trim();
  }
  return `${prefix} Round ${roundIndex + 1}`.trim();
}

export function TournamentBracket({ bracket, playerTeamId }: { bracket: BracketTree; playerTeamId: string | null }) {
  if (bracket.format === "single_elim") {
    return (
      <div className="bracket-view">
        <div className="bracket-scroll-row">
          {bracket.rounds.map((round, i) => (
            <RoundColumn key={i} title={roundLabel("", i, bracket.rounds.length)} matches={round} teams={bracket.teams} playerTeamId={playerTeamId} />
          ))}
        </div>
        <style>{BRACKET_STYLES}</style>
      </div>
    );
  }

  const hasLosers = bracket.losersRounds.length > 0;
  return (
    <div className="bracket-view">
      <div className="bracket-section-label">{hasLosers ? "Winners Bracket" : ""}</div>
      <div className="bracket-scroll-row">
        {bracket.winnersRounds.map((round, i) => (
          <RoundColumn key={`w${i}`} title={roundLabel("Winners", i, bracket.winnersRounds.length)} matches={round} teams={bracket.teams} playerTeamId={playerTeamId} />
        ))}
        {bracket.grandFinal && <RoundColumn title="Grand Final" matches={[bracket.grandFinal]} teams={bracket.teams} playerTeamId={playerTeamId} />}
      </div>
      {hasLosers && (
        <>
          <div className="bracket-section-label" style={{ marginTop: "var(--space-4)" }}>Losers Bracket</div>
          <div className="bracket-scroll-row">
            {bracket.losersRounds.map((round, i) => (
              <RoundColumn key={`l${i}`} title={`Losers Round ${i + 1}`} matches={round} teams={bracket.teams} playerTeamId={playerTeamId} />
            ))}
          </div>
        </>
      )}
      <style>{BRACKET_STYLES}</style>
    </div>
  );
}

const BRACKET_STYLES = `
  .bracket-view {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .bracket-section-label {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-tertiary);
  }
  .bracket-scroll-row {
    display: flex;
    gap: var(--space-4);
    overflow-x: auto;
    padding-bottom: var(--space-2);
  }
  .bracket-round-column {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 180px;
    flex: 0 0 auto;
  }
  .bracket-round-title {
    font-size: 11px;
    font-weight: 650;
    color: var(--text-tertiary);
    text-align: center;
  }
  .bracket-round-matches {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    justify-content: space-around;
    flex: 1;
  }
  .bracket-match-card {
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    background: var(--bg-surface-raised);
    overflow: hidden;
  }
  .bracket-match-clickable {
    cursor: pointer;
  }
  .bracket-team-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    font-size: 12px;
    color: var(--text-secondary);
    border-bottom: 1px solid var(--border-subtle, var(--border-strong));
  }
  .bracket-team-row:last-of-type {
    border-bottom: none;
  }
  .bracket-team-winner {
    font-weight: 700;
    color: var(--text-primary);
  }
  .bracket-team-mine {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }
  .bracket-team-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .bracket-team-score {
    font-weight: 700;
    margin-left: var(--space-2);
  }
  .bracket-games-breakdown {
    padding: 6px 10px;
    border-top: 1px solid var(--border-strong);
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .bracket-games-empty {
    padding: 6px 10px;
    font-size: 11px;
    color: var(--text-tertiary);
  }
  .bracket-game-row {
    display: flex;
    gap: 6px;
    font-size: 11px;
    color: var(--text-tertiary);
  }
  .bracket-game-num {
    font-weight: 650;
    flex: 0 0 auto;
  }
  .bracket-game-map {
    flex: 1;
  }
  .bracket-game-winner {
    font-weight: 600;
    color: var(--text-secondary);
  }
`;
