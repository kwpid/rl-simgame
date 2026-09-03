// Generic, reusable bracket formats. RLCS's actual format (Stage 1 double-elim -> Swiss -> GSL groups ->
// playoffs) is just four of these chained together with different entrant/advance counts, see
// data/tournaments.ts for the stage list itself. None of this simulates individual matches point-by-
// point (that's the live match-sim engine, reserved for matches the human player is actually in), it
// resolves each GAME of a series probabilistically from each team's aggregate `power` rating, real RL's
// actual RLCS brackets involve hundreds of teams, simulating every single game tick-by-tick isn't
// feasible or meaningful for teams the player never sees play. `double_elim`/`single_elim` DO get a real,
// seeded winners(+losers) bracket tree with a real per-game score and map for every match (see
// buildDoubleElimBracket/buildSingleElimBracket below) — `swiss`/`gsl_group` stay a plain probabilistic
// round simulation with no bracket tree, matching how real RLCS broadcasts show those as standings tables
// too, not bracket diagrams.

import type { SimDate } from "./dateUtils";
import { mapsForSeries } from "./maps";
import { seedTeams } from "./bracketSeeding";
import { allNodes, type MatchNode, type DoubleElimBracket, type SingleElimBracket, type BracketTree, type GameResult } from "./bracketTypes";

export type BracketFormat = "double_elim" | "swiss" | "gsl_group" | "single_elim";

export interface StageConfig {
  format: BracketFormat;
  label: string;
  entrants: number;
  advanceCount: number;
  days: number;
}

export interface TournamentTeam {
  id: string;
  name: string;
  region: string;
  power: number;
  players: string[];
}

export interface StandingEntry {
  team: TournamentTeam;
  wins: number;
  losses: number;
  placement: number | null; // filled in once eliminated/finished, 1 = champion
}

export interface StageResult {
  advanced: TournamentTeam[];
  standings: StandingEntry[]; // every team that entered the stage, with wins/losses/placement
}

// A RELATIVE spread, not an absolute point count — team `power` (see tournaments.ts's rlcsPowerFromStats)
// is built from the same uncapped Game Sense/Mechanical Consistency/MMR-derived numbers every AI stat in
// this sim uses, which keep growing over a long save (a veteran pro's stats are on a totally different
// absolute scale than a fresh rookie's, even though both are "real pro caliber"). A FIXED absolute spread
// (this used to be a flat `260`) drifts out of calibration as that scale grows: the exact same genuinely
// decisive skill gap reads as a coin-flip once both teams' raw power numbers are big enough, which is
// exactly why a legitimately dominant, #1-power-rated org could still fail to reliably win real brackets
// (and, in turn, never actually earn the recent championship-tier titles their roster deserves) — the gap
// was real, it just stopped being big enough RELATIVE to a spread constant that no longer matched the
// numbers' own scale. Using the gap as a FRACTION of the two teams' average power instead keeps the model
// correctly calibrated at any scale: the same relative skill edge is always worth the same thing.
const RELATIVE_POWER_SPREAD = 0.1;

/** Win probability for team A in a single game, logistic on the RELATIVE power gap (see
 *  RELATIVE_POWER_SPREAD above), same shape as the live match sim's statProbability, tuned so even a
 *  genuinely dominant team stays a LITTLE competitive over a single game (nobody's a 100% lock), while a
 *  real skill edge actually shows up as a real edge in outcomes rather than washing out to a coin flip. */
function gameWinProbability(powerA: number, powerB: number): number {
  const avgPower = Math.max(1, (powerA + powerB) / 2);
  const relativeDiff = (powerA - powerB) / avgPower;
  return 1 / (1 + Math.pow(10, -relativeDiff / RELATIVE_POWER_SPREAD));
}

/** Simulates one best-of-N series between two teams, returns the winner/loser and the game score. */
function simulateSeries(a: TournamentTeam, b: TournamentTeam, bestOf: number): { winner: TournamentTeam; loser: TournamentTeam; winnerGames: number; loserGames: number } {
  const gamesToWin = Math.ceil(bestOf / 2);
  const pA = gameWinProbability(a.power, b.power);
  let gamesA = 0;
  let gamesB = 0;
  while (gamesA < gamesToWin && gamesB < gamesToWin) {
    if (Math.random() < pA) gamesA++;
    else gamesB++;
  }
  return gamesA > gamesB
    ? { winner: a, loser: b, winnerGames: gamesA, loserGames: gamesB }
    : { winner: b, loser: a, winnerGames: gamesB, loserGames: gamesA };
}

/** Same probabilistic game-win model as `simulateSeries`, but resolves one game at a time and records a
 *  real per-game result (who won it, which map it was on) instead of collapsing straight to a final score.
 *  Maps are drawn from `mapsForSeries` up front (the max possible games for this `bestOf`) so a series never
 *  repeats a map until the pool runs out — the exact rule the player's own live tournament series already
 *  follows (see useMatchStore.ts's startTournamentSeries) — any unused trailing maps (a series that ends
 *  early) are simply never assigned to a game. */
function simulateSeriesWithGames(
  a: TournamentTeam,
  b: TournamentTeam,
  bestOf: number,
  currentDate: SimDate
): { winner: TournamentTeam; loser: TournamentTeam; winnerGames: number; loserGames: number; games: GameResult[] } {
  const gamesToWin = Math.ceil(bestOf / 2);
  const pA = gameWinProbability(a.power, b.power);
  const maps = mapsForSeries(currentDate, bestOf);
  const games: GameResult[] = [];
  let gamesA = 0;
  let gamesB = 0;
  while (gamesA < gamesToWin && gamesB < gamesToWin) {
    const aWon = Math.random() < pA;
    if (aWon) gamesA++;
    else gamesB++;
    games.push({ gameNumber: games.length + 1, winnerId: (aWon ? a : b).id, mapId: maps[games.length].id });
  }
  return gamesA > gamesB
    ? { winner: a, loser: b, winnerGames: gamesA, loserGames: gamesB, games }
    : { winner: b, loser: a, winnerGames: gamesB, loserGames: gamesA, games };
}

function shuffled<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function makeEmptyNode(id: string, round: number, bracket: MatchNode["bracket"]): MatchNode {
  return { id, round, bracket, slotA: null, slotB: null, winnerAdvancesTo: null, loserDropsTo: null, resolved: false, winnerId: null, games: [] };
}

/** Every node whose `winnerAdvancesTo`/`loserDropsTo` points at `(targetId, slot)` — a node's ONE feeder,
 *  used to walk backward from a not-yet-playable match to whatever needs to resolve first. Bracket sizes
 *  here (at most a few hundred nodes) make a linear scan plenty fast for the handful of lookups this
 *  actually needs (bounded by the bracket's depth, O(log N)). */
export function feederFor(nodes: MatchNode[], targetId: string, slot: "A" | "B"): MatchNode | null {
  return (
    nodes.find((n) => n.winnerAdvancesTo?.matchId === targetId && n.winnerAdvancesTo.slot === slot) ??
    nodes.find((n) => n.loserDropsTo?.matchId === targetId && n.loserDropsTo.slot === slot) ??
    null
  );
}

function advanceWinner(nodesById: Map<string, MatchNode>, node: MatchNode, winnerId: string) {
  node.winnerId = winnerId;
  node.resolved = true;
  if (node.winnerAdvancesTo) {
    const target = nodesById.get(node.winnerAdvancesTo.matchId);
    if (target) {
      if (node.winnerAdvancesTo.slot === "A") target.slotA = { teamId: winnerId };
      else target.slotB = { teamId: winnerId };
    }
  }
}

function dropLoser(nodesById: Map<string, MatchNode>, node: MatchNode, loserId: string) {
  if (node.loserDropsTo) {
    const target = nodesById.get(node.loserDropsTo.matchId);
    if (target) {
      if (node.loserDropsTo.slot === "A") target.slotA = { teamId: loserId };
      else target.slotB = { teamId: loserId };
    }
  }
}

/** Resolves exactly one match: a bye (only one slot ever filled) auto-advances with no games; otherwise
 *  simulates the series and routes the winner/loser onward. No-ops if already resolved, or if a slot is
 *  still empty (caller's job to have resolved its feeder first). */
function resolveOneMatch(tree: BracketTree, nodesById: Map<string, MatchNode>, node: MatchNode, currentDate: SimDate, bestOf: number) {
  if (node.resolved) return;
  if (node.slotA && !node.slotB) { advanceWinner(nodesById, node, node.slotA.teamId); return; }
  if (node.slotB && !node.slotA) { advanceWinner(nodesById, node, node.slotB.teamId); return; }
  if (!node.slotA || !node.slotB) return;
  const teamA = tree.teams[node.slotA.teamId];
  const teamB = tree.teams[node.slotB.teamId];
  const result = simulateSeriesWithGames(teamA, teamB, bestOf, currentDate);
  node.games = result.games;
  advanceWinner(nodesById, node, result.winner.id);
  if (node.bracket === "winners") dropLoser(nodesById, node, result.loser.id);
}

/** Writes the REAL result of the player's own just-played live match-sim series into their bracket node —
 *  no simulation happens here, `games` comes from what actually happened in useMatchStore's live series
 *  (see useMatchStore.ts's seriesGameLog), same as an AI match's `games` comes from simulateSeriesWithGames.
 *  This is the one place a node gets resolved by something other than resolveOneMatch. */
export function resolvePlayerNode(tree: BracketTree, node: MatchNode, winnerId: string, loserId: string, games: GameResult[]): void {
  const nodesById = new Map(allNodes(tree).map((n) => [n.id, n]));
  node.games = games;
  advanceWinner(nodesById, node, winnerId);
  if (node.bracket === "winners") dropLoser(nodesById, node, loserId);
}

/** Resolves `targetNode`, first recursively resolving whichever specific feeder match(es) are still
 *  blocking its two slots (not the whole stage) — used to find the player's own next opponent without
 *  bulk-simulating the entire field around them. Bounded by the bracket's depth (O(log N) matches). */
export function resolveNodeAndAncestors(tree: BracketTree, targetNode: MatchNode, currentDate: SimDate, bestOf: number): string | null {
  const nodes = allNodes(tree);
  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  function ensure(node: MatchNode) {
    if (node.resolved) return;
    if (!node.slotA) {
      const feeder = feederFor(nodes, node.id, "A");
      if (feeder) ensure(feeder);
    }
    if (!node.slotB) {
      const feeder = feederFor(nodes, node.id, "B");
      if (feeder) ensure(feeder);
    }
    resolveOneMatch(tree, nodesById, node, currentDate, bestOf);
  }
  ensure(targetNode);
  return targetNode.winnerId;
}

/** Bulk-fills every still-unresolved match in the tree, in dependency order (each round only after
 *  whatever feeds it), so final standings/placements can be computed once the player's own run through the
 *  stage is decided and the rest of the field just needs to play out. */
export function resolveRemainingBracket(tree: BracketTree, currentDate: SimDate, bestOf: number): void {
  const nodes = allNodes(tree);
  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const order: MatchNode[] = [];
  if (tree.format === "single_elim") {
    order.push(...tree.rounds.flat());
  } else {
    for (let i = 0; i < tree.winnersRounds.length; i++) {
      order.push(...tree.winnersRounds[i]);
      if (tree.losersRounds[i]) order.push(...tree.losersRounds[i]);
    }
    if (tree.grandFinal) order.push(tree.grandFinal);
  }
  for (const node of order) resolveOneMatch(tree, nodesById, node, currentDate, bestOf);
}

/** Builds a real seeded single-elimination bracket: round 1 pairs teams via the standard bracket seed
 *  order (seedTeams), every later round's slots start empty and get filled by the prior round's
 *  `winnerAdvancesTo` once that match actually resolves (see resolveNodeAndAncestors/resolveRemainingBracket
 *  — building the tree does NOT simulate anything by itself). */
export function buildSingleElimBracket(teams: TournamentTeam[]): SingleElimBracket {
  const teamLookup: Record<string, TournamentTeam> = {};
  teams.forEach((t) => (teamLookup[t.id] = t));
  const seeded = seedTeams(teams);

  const rounds: MatchNode[][] = [];
  let prevRound: MatchNode[] = [];
  for (let i = 0; i < seeded.length; i += 2) {
    const node = makeEmptyNode(`se_r1_m${i / 2}`, 1, "winners");
    node.slotA = seeded[i].team ? { teamId: seeded[i].team!.id } : null;
    node.slotB = seeded[i + 1]?.team ? { teamId: seeded[i + 1].team!.id } : null;
    prevRound.push(node);
  }
  rounds.push(prevRound);

  let roundNum = 2;
  while (prevRound.length > 1) {
    const nextRound: MatchNode[] = [];
    for (let i = 0; i < prevRound.length; i += 2) {
      nextRound.push(makeEmptyNode(`se_r${roundNum}_m${i / 2}`, roundNum, "winners"));
    }
    prevRound.forEach((m, i) => {
      const target = nextRound[Math.floor(i / 2)];
      m.winnerAdvancesTo = { matchId: target.id, slot: i % 2 === 0 ? "A" : "B" };
    });
    rounds.push(nextRound);
    prevRound = nextRound;
    roundNum++;
  }

  return { format: "single_elim", rounds, teams: teamLookup };
}

function singleElimStandings(tree: SingleElimBracket): StandingEntry[] {
  const standings: StandingEntry[] = [];
  const totalRounds = tree.rounds.length;
  const finalMatch = tree.rounds[totalRounds - 1]?.[0];
  if (finalMatch?.resolved && finalMatch.winnerId) {
    standings.push({ team: tree.teams[finalMatch.winnerId], wins: 0, losses: 0, placement: 1 });
  }
  let nextPlacement = 2;
  for (let r = totalRounds; r >= 1; r--) {
    const round = tree.rounds[r - 1];
    const losersThisRound: TournamentTeam[] = [];
    for (const m of round) {
      if (!m.resolved || !m.winnerId) continue;
      const loserId = m.slotA?.teamId === m.winnerId ? m.slotB?.teamId : m.slotA?.teamId;
      if (loserId) losersThisRound.push(tree.teams[loserId]);
    }
    for (const team of losersThisRound) standings.push({ team, wins: 0, losses: 1, placement: nextPlacement });
    if (losersThisRound.length > 0) nextPlacement += losersThisRound.length;
  }
  return standings;
}

/** Builds a real seeded double-elimination bracket, cut short at the top `advanceCount` survivors instead
 *  of running to a single champion (none of today's stages need a single champion out of this format — see
 *  tournaments.ts's RLCS_OPEN_STAGES etc., Stage 1 always cuts to a multi-team field). Round SIZES (how
 *  many matches each winners/losers round has) are fully determined by the team count alone — every match
 *  eliminates exactly one team regardless of who wins — so the whole round structure is built up front here,
 *  before any match is actually simulated; only the winner slots stay empty until resolved.
 *
 *  Losers-bracket routing is a deliberate simplification of the official RLCS/Liquipedia double-elim
 *  bracket shape: instead of the official alternating "survivors play down, then merge with new drops"
 *  pattern, every losers round simply pools ALL currently-alive losers-side teams (carried-over survivors
 *  plus this round's fresh winners-bracket drops) and pairs them off left-to-right. This keeps the exactly-
 *  2-losses elimination rule and real per-match routing (each loss drops to one SPECIFIC match built here,
 *  never a random pick at resolve time) without needing to replicate the official merge-round algorithm
 *  exactly — visually it reads as a steadily-shrinking losers bracket rather than official RLCS's uneven
 *  round heights. */
export function buildDoubleElimBracket(teams: TournamentTeam[], advanceCount: number): DoubleElimBracket {
  const teamLookup: Record<string, TournamentTeam> = {};
  teams.forEach((t) => (teamLookup[t.id] = t));
  const seeded = seedTeams(teams);

  const winnersRounds: MatchNode[][] = [];
  const losersRounds: MatchNode[][] = [];

  let round1: MatchNode[] = [];
  for (let i = 0; i < seeded.length; i += 2) {
    const node = makeEmptyNode(`de_wb1_m${i / 2}`, 1, "winners");
    node.slotA = seeded[i].team ? { teamId: seeded[i].team!.id } : null;
    node.slotB = seeded[i + 1]?.team ? { teamId: seeded[i + 1].team!.id } : null;
    round1.push(node);
  }
  winnersRounds.push(round1);

  let prevWbRound = round1;
  let currentWbSize = seeded.length;
  let lbPoolSize = 0;
  let wbRoundIdx = 1;

  while (true) {
    const nextWbSize = Math.floor(currentWbSize / 2);
    lbPoolSize += prevWbRound.length; // one loser per WB match just played

    const lbRoundSize = Math.max(1, Math.ceil(lbPoolSize / 2));
    const lbRound: MatchNode[] = [];
    for (let i = 0; i < lbRoundSize; i++) lbRound.push(makeEmptyNode(`de_lb${wbRoundIdx}_m${i}`, wbRoundIdx, "losers"));
    losersRounds.push(lbRound);

    let lbSlotCursor = 0;
    const nextLbSlot = () => {
      const node = lbRound[Math.floor(lbSlotCursor / 2)];
      const slot: "A" | "B" = lbSlotCursor % 2 === 0 ? "A" : "B";
      lbSlotCursor++;
      return { node, slot };
    };
    if (losersRounds.length > 1) {
      for (const m of losersRounds[losersRounds.length - 2]) {
        const { node, slot } = nextLbSlot();
        m.winnerAdvancesTo = { matchId: node.id, slot };
      }
    }
    for (const m of prevWbRound) {
      const { node, slot } = nextLbSlot();
      m.loserDropsTo = { matchId: node.id, slot };
    }

    lbPoolSize = lbRoundSize;
    const survivorCount = nextWbSize + lbPoolSize;
    const isLastRound = survivorCount <= advanceCount || nextWbSize <= 1;

    if (!isLastRound) {
      const nextWbRound: MatchNode[] = [];
      for (let i = 0; i < nextWbSize; i++) nextWbRound.push(makeEmptyNode(`de_wb${wbRoundIdx + 1}_m${i}`, wbRoundIdx + 1, "winners"));
      prevWbRound.forEach((m, i) => {
        const target = nextWbRound[Math.floor(i / 2)];
        m.winnerAdvancesTo = { matchId: target.id, slot: i % 2 === 0 ? "A" : "B" };
      });
      winnersRounds.push(nextWbRound);
      prevWbRound = nextWbRound;
      currentWbSize = nextWbSize;
    }

    wbRoundIdx++;
    if (isLastRound) break;
  }

  return { format: "double_elim", winnersRounds, losersRounds, grandFinal: null, teams: teamLookup };
}

function doubleElimStandings(tree: DoubleElimBracket, advanceCount: number): { advanced: TournamentTeam[]; standings: StandingEntry[] } {
  const lastWbRound = tree.winnersRounds[tree.winnersRounds.length - 1];
  const lastLbRound = tree.losersRounds[tree.losersRounds.length - 1];
  const survivors: TournamentTeam[] = [];
  for (const m of lastWbRound) if (m.resolved && m.winnerId) survivors.push(tree.teams[m.winnerId]);
  for (const m of lastLbRound) if (m.resolved && m.winnerId) survivors.push(tree.teams[m.winnerId]);

  const standings: StandingEntry[] = survivors.map((team) => ({ team, wins: 0, losses: 0, placement: null }));
  let placement = advanceCount + 1;
  for (let i = tree.losersRounds.length - 1; i >= 0; i--) {
    const round = tree.losersRounds[i];
    const eliminatedHere: TournamentTeam[] = [];
    for (const m of round) {
      if (!m.resolved || !m.winnerId) continue;
      const loserId = m.slotA?.teamId === m.winnerId ? m.slotB?.teamId : m.slotA?.teamId;
      if (loserId) eliminatedHere.push(tree.teams[loserId]);
    }
    for (const team of eliminatedHere) standings.push({ team, wins: 0, losses: 2, placement });
    if (eliminatedHere.length > 0) placement += eliminatedHere.length;
  }
  return { advanced: survivors.slice(0, advanceCount), standings };
}

/** Converts a (possibly still partially-unresolved) bracket tree into the same `StageResult` shape the
 *  rest of the store already understands (`advanced`/`standings`) — call `resolveRemainingBracket` first
 *  if anything in the tree still needs to be simulated. */
export function bracketStageResult(tree: BracketTree, advanceCount: number): StageResult {
  if (tree.format === "single_elim") {
    const standings = singleElimStandings(tree);
    const champion = standings.find((s) => s.placement === 1)?.team;
    return { advanced: champion ? [champion] : [], standings };
  }
  return doubleElimStandings(tree, advanceCount);
}

/** Swiss pairing: each round, sort by current wins and pair adjacent teams (standard Swiss simplification,
 *  no real bracket software involved), run until there have been enough rounds to separate the field,
 *  then cut to the top `advanceCount` by record. */
export function runSwissStage(teams: TournamentTeam[], advanceCount: number, bestOf = 3): StageResult {
  if (teams.length === 0) return { advanced: [], standings: [] };
  const record = new Map<string, { wins: number; losses: number }>(teams.map((t) => [t.id, { wins: 0, losses: 0 }]));
  const rounds = Math.ceil(Math.log2(teams.length)) + 1;

  for (let r = 0; r < rounds; r++) {
    const sorted = [...teams].sort((a, b) => (record.get(b.id)!.wins - record.get(b.id)!.losses) - (record.get(a.id)!.wins - record.get(a.id)!.losses));
    for (let i = 0; i + 1 < sorted.length; i += 2) {
      const { winner, loser } = simulateSeries(sorted[i], sorted[i + 1], bestOf);
      record.get(winner.id)!.wins++;
      record.get(loser.id)!.losses++;
    }
  }

  const standings: StandingEntry[] = teams
    .map((team) => ({ team, ...record.get(team.id)!, placement: null as number | null }))
    .sort((a, b) => b.wins - b.losses - (a.wins - a.losses));
  standings.forEach((s, i) => {
    if (i >= advanceCount) s.placement = advanceCount + i - advanceCount + 1;
  });
  return { advanced: standings.slice(0, advanceCount).map((s) => s.team), standings };
}

/** GSL-style groups: split the field into groups of 4, round-robin within each group (every team plays
 *  every other team once), top 2 per group advance (matching real RLCS GSL groups). `advanceCount` should
 *  be `groups * 2`. */
export function runGslGroupStage(teams: TournamentTeam[], advanceCount: number, bestOf = 3): StageResult {
  if (teams.length === 0) return { advanced: [], standings: [] };
  const perGroupAdvance = 2;
  const groupCount = Math.max(1, Math.round(advanceCount / perGroupAdvance));
  const shuffledTeams = shuffled(teams);
  const groups: TournamentTeam[][] = Array.from({ length: groupCount }, () => []);
  shuffledTeams.forEach((team, i) => groups[i % groupCount].push(team));

  const advanced: TournamentTeam[] = [];
  const standings: StandingEntry[] = [];

  groups.forEach((group) => {
    const record = new Map<string, { wins: number; losses: number }>(group.map((t) => [t.id, { wins: 0, losses: 0 }]));
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const { winner, loser } = simulateSeries(group[i], group[j], bestOf);
        record.get(winner.id)!.wins++;
        record.get(loser.id)!.losses++;
      }
    }
    const ranked = group
      .map((team) => ({ team, ...record.get(team.id)!, placement: null as number | null }))
      .sort((a, b) => b.wins - b.losses - (a.wins - a.losses));
    ranked.forEach((entry, i) => {
      if (i < perGroupAdvance) advanced.push(entry.team);
      else entry.placement = advanceCount + i - perGroupAdvance + 1;
      standings.push(entry);
    });
  });

  return { advanced, standings };
}

