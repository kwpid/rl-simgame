// Real bracket-tree data shapes shared by the double-elim and single-elim builders in
// tournamentFormats.ts. Kept in their own file (rather than tournamentFormats.ts itself) since both the
// store (useTournamentStore.ts) and the UI (TournamentBracket.tsx) need these types without pulling in the
// simulation functions themselves.
import type { TournamentTeam } from "./tournamentFormats";

export interface GameResult {
  gameNumber: number;
  winnerId: string;
  mapId: string;
}

export interface MatchNode {
  id: string;
  round: number;
  bracket: "winners" | "losers" | "grand_final";
  slotA: { teamId: string } | null;
  slotB: { teamId: string } | null;
  /** Where the winner goes next. null only for the very last match of a bracket (the final). */
  winnerAdvancesTo: { matchId: string; slot: "A" | "B" } | null;
  /** Where the loser drops to. Always null in the losers bracket and the grand final — double-elim only. */
  loserDropsTo: { matchId: string; slot: "A" | "B" } | null;
  resolved: boolean;
  winnerId: string | null;
  games: GameResult[];
}

export interface DoubleElimBracket {
  format: "double_elim";
  winnersRounds: MatchNode[][];
  losersRounds: MatchNode[][];
  /** Only ever populated when this double-elim bracket is run all the way to a single champion
   *  (advanceCount === 1) rather than cut short at a top-N field — none of today's stages do that, but the
   *  same builder supports it. */
  grandFinal: MatchNode | null;
  teams: Record<string, TournamentTeam>;
}

export interface SingleElimBracket {
  format: "single_elim";
  rounds: MatchNode[][];
  teams: Record<string, TournamentTeam>;
}

export type BracketTree = DoubleElimBracket | SingleElimBracket;

export function allNodes(tree: BracketTree): MatchNode[] {
  if (tree.format === "double_elim") {
    return [...tree.winnersRounds.flat(), ...tree.losersRounds.flat(), ...(tree.grandFinal ? [tree.grandFinal] : [])];
  }
  return tree.rounds.flat();
}

export function findNodeById(tree: BracketTree, matchId: string): MatchNode | null {
  return allNodes(tree).find((n) => n.id === matchId) ?? null;
}

/** The node a given team is currently waiting to play (their earliest unresolved node that already has
 *  both slots filled, or — if neither slot is filled yet — the earliest node they appear in at all). Used
 *  to find the player's own current match without the caller needing to know the bracket's internal shape. */
export function findNodeForTeam(tree: BracketTree, teamId: string): MatchNode | null {
  const nodes = allNodes(tree).filter((n) => n.slotA?.teamId === teamId || n.slotB?.teamId === teamId);
  return nodes.find((n) => !n.resolved) ?? null;
}
