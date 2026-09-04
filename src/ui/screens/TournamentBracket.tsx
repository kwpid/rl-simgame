// Real esports-style bracket view for double_elim/single_elim stages (see data/bracketTypes.ts /
// data/tournamentFormats.ts's buildDoubleElimBracket/buildSingleElimBracket). swiss/gsl_group stages never
// reach this component — they keep TourneysScreen.tsx's existing StandingsCard table, matching how real
// RLCS broadcasts show Swiss/GSL as standings tables too, not bracket diagrams.
import { useEffect, useState } from "react";
import type { BracketTree, MatchNode, GameResult } from "@/data/bracketTypes";
import type { TournamentTeam } from "@/data/tournamentFormats";
import { ARENA_MAPS } from "@/data/maps";

const NARROW_BREAKPOINT = "(max-width: 640px)";

/** The two-sided, converges-on-a-center-Final bracket layout only reads correctly at real bracket width -
 *  on a narrow/mobile viewport it's mostly horizontal scrolling past tiny, hard-to-read columns, which is
 *  worse than just not having a bracket diagram at all. Below this breakpoint every bracket falls back to
 *  a plain round-by-round vertical list instead (see SplitOrPlainBracket's canSplit override). */
function useIsNarrowViewport(): boolean {
  const [isNarrow, setIsNarrow] = useState(() => (typeof window !== "undefined" ? window.matchMedia(NARROW_BREAKPOINT).matches : false));
  useEffect(() => {
    const mql = window.matchMedia(NARROW_BREAKPOINT);
    const onChange = () => setIsNarrow(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return isNarrow;
}

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

/** A binary elimination tree (every round exactly halves the previous one down to a single final match)
 *  renders as a real two-sided bracket, March-Madness style: the field's two symmetric halves (which never
 *  meet each other until the very last match — a direct consequence of how buildSingleElimBracket pairs
 *  each round from the previous one) run outward from a center Final column, left side reading left-to-
 *  right, right side mirrored so its own final-adjacent round sits next to the center. Falls back to a
 *  plain left-to-right column list when the last round has more than one match (double-elim cut short at
 *  a multi-team survivor field instead of a single champion — no single center to converge on). */
function SplitOrPlainBracket({ rounds, teams, playerTeamId, roundPrefix, centerLabel, isNarrow }: { rounds: MatchNode[][]; teams: Record<string, TournamentTeam>; playerTeamId: string | null; roundPrefix: string; centerLabel: string; isNarrow: boolean }) {
  const finalRound = rounds[rounds.length - 1];
  const canSplit = !isNarrow && rounds.length > 1 && finalRound.length === 1;
  if (!canSplit) {
    return (
      <div className="bracket-scroll-row">
        {rounds.map((round, i) => (
          <RoundColumn key={i} title={roundLabel(roundPrefix, i, rounds.length)} matches={round} teams={teams} playerTeamId={playerTeamId} />
        ))}
      </div>
    );
  }
  const preRounds = rounds.slice(0, rounds.length - 1);
  const leftRounds = preRounds.map((round) => round.slice(0, round.length / 2));
  const rightRounds = preRounds.map((round) => round.slice(round.length / 2));
  return (
    <div className="bracket-scroll-row bracket-two-sided">
      <div className="bracket-side">
        {leftRounds.map((round, i) => (
          <RoundColumn key={`l${i}`} title={roundLabel(roundPrefix, i, rounds.length)} matches={round} teams={teams} playerTeamId={playerTeamId} />
        ))}
      </div>
      <RoundColumn title={centerLabel} matches={finalRound} teams={teams} playerTeamId={playerTeamId} />
      <div className="bracket-side bracket-side-right">
        {[...rightRounds].reverse().map((round, revIdx) => {
          const roundIdx = rightRounds.length - 1 - revIdx;
          return <RoundColumn key={`r${roundIdx}`} title={roundLabel(roundPrefix, roundIdx, rounds.length)} matches={round} teams={teams} playerTeamId={playerTeamId} />;
        })}
      </div>
    </div>
  );
}

export function TournamentBracket({ bracket, playerTeamId }: { bracket: BracketTree; playerTeamId: string | null }) {
  const isNarrow = useIsNarrowViewport();
  if (bracket.format === "single_elim") {
    return (
      <div className="bracket-view">
        <SplitOrPlainBracket rounds={bracket.rounds} teams={bracket.teams} playerTeamId={playerTeamId} roundPrefix="" centerLabel="Final" isNarrow={isNarrow} />
        <style>{BRACKET_STYLES}</style>
      </div>
    );
  }

  const hasLosers = bracket.losersRounds.length > 0;
  return (
    <div className="bracket-view">
      <div className="bracket-section-label">{hasLosers ? "Winners Bracket" : ""}</div>
      <SplitOrPlainBracket rounds={bracket.winnersRounds} teams={bracket.teams} playerTeamId={playerTeamId} roundPrefix="Winners" centerLabel="Winners Final" isNarrow={isNarrow} />
      {bracket.grandFinal && (
        <div className="bracket-scroll-row" style={{ justifyContent: "center" }}>
          <RoundColumn title="Grand Final" matches={[bracket.grandFinal]} teams={bracket.teams} playerTeamId={playerTeamId} />
        </div>
      )}
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
  .bracket-two-sided {
    align-items: center;
    justify-content: center;
  }
  .bracket-side {
    display: flex;
    gap: var(--space-4);
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

  @media (max-width: 640px) {
    .bracket-scroll-row {
      flex-direction: column;
      overflow-x: visible;
      gap: var(--space-4);
    }
    .bracket-round-column {
      min-width: 0;
      width: 100%;
    }
    .bracket-team-row {
      font-size: 13px;
      padding: 8px 12px;
    }
  }
`;
