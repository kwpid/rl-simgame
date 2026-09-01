// Generic, reusable bracket formats. RLCS's actual format (Stage 1 double-elim -> Swiss -> GSL groups ->
// playoffs) is just four of these chained together with different entrant/advance counts, see
// data/tournaments.ts for the stage list itself. None of this simulates individual matches point-by-
// point (that's the live match-sim engine, reserved for matches the human player is actually in), it
// resolves a best-of-N series probabilistically from each team's aggregate `power` rating, real RL's
// actual RLCS brackets involve hundreds of teams, simulating every single game tick-by-tick isn't
// feasible or meaningful for teams the player never sees play.

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

/** Win probability for team A in a single game, logistic on the power gap, same shape as the live match
 *  sim's statProbability, tuned so even a big gap stays somewhat competitive over a single game. */
function gameWinProbability(powerA: number, powerB: number, spread = 260): number {
  const diff = powerA - powerB;
  return 1 / (1 + Math.pow(10, -diff / spread));
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

function shuffled<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Loss-count elimination: teams are paired at random each round among everyone still alive, two losses
 *  eliminates a team (matching real RLCS Stage 1 rules), continues until only `advanceCount` teams
 *  remain with fewer than 2 losses. Eliminated teams are placed in the order they dropped, latest first. */
export function runDoubleElimStage(teams: TournamentTeam[], advanceCount: number, bestOf = 3): StageResult {
  if (teams.length === 0) return { advanced: [], standings: [] };
  const losses = new Map<string, number>(teams.map((t) => [t.id, 0]));
  const eliminated: TournamentTeam[] = [];
  let alive = [...teams];

  let guard = 0;
  while (alive.length > advanceCount && guard < 30) {
    guard++;
    const pairs = shuffled(alive);
    const nextAlive: TournamentTeam[] = [];
    for (let i = 0; i + 1 < pairs.length; i += 2) {
      const { winner, loser } = simulateSeries(pairs[i], pairs[i + 1], bestOf);
      nextAlive.push(winner);
      const l = (losses.get(loser.id) ?? 0) + 1;
      losses.set(loser.id, l);
      if (l >= 2) eliminated.push(loser);
      else nextAlive.push(loser);
    }
    if (pairs.length % 2 === 1) nextAlive.push(pairs[pairs.length - 1]); // odd one out gets a bye
    alive = nextAlive;
  }

  const standings: StandingEntry[] = [
    ...alive.map((team) => ({ team, wins: 0, losses: losses.get(team.id) ?? 0, placement: null })),
    ...eliminated
      .slice()
      .reverse()
      .map((team, i) => ({ team, wins: 0, losses: losses.get(team.id) ?? 2, placement: advanceCount + i + 1 })),
  ];
  return { advanced: alive.slice(0, advanceCount), standings };
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

/** Standard single-elimination bracket, produces a full placement order (1st down through the whole
 *  field), used for the final playoff stage that actually crowns a champion. */
export function runSingleElimStage(teams: TournamentTeam[], bestOf = 5): StageResult {
  if (teams.length === 0) return { advanced: [], standings: [] };
  let alive = shuffled(teams);
  const eliminationOrder: TournamentTeam[] = [];

  while (alive.length > 1) {
    const nextAlive: TournamentTeam[] = [];
    for (let i = 0; i + 1 < alive.length; i += 2) {
      const { winner, loser } = simulateSeries(alive[i], alive[i + 1], bestOf);
      nextAlive.push(winner);
      eliminationOrder.push(loser);
    }
    if (alive.length % 2 === 1) nextAlive.push(alive[alive.length - 1]);
    alive = nextAlive;
  }

  const champion = alive[0];
  const placementsDescending = [champion, ...eliminationOrder.slice().reverse()];
  const standings: StandingEntry[] = placementsDescending.map((team, i) => ({
    team,
    wins: 0,
    losses: 0,
    placement: i + 1,
  }));
  return { advanced: champion ? [champion] : [], standings };
}
