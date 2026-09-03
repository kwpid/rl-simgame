// Standard tournament bracket seeding: given N teams sorted by strength, produces the round-1 pairing
// order real bracket software uses (1v8, 4v5, 2v7, 3v6 for a field of 8) so the top seeds are maximally
// separated and can't meet before the final, instead of a coinflip shuffle.
import type { TournamentTeam } from "./tournamentFormats";

function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** The recursive-doubling seed order: seedOrder(1) = [1]; seedOrder(2k) interleaves seedOrder(k) with
 *  (2k+1 - seedOrder(k)). Returns an array of 1-based seed numbers in bracket (not seed-rank) order —
 *  index 0 plays index 1, index 2 plays index 3, etc. in round 1. */
function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    const mirrored = order.map((s) => n + 1 - s);
    const next: number[] = [];
    for (let i = 0; i < order.length; i++) {
      next.push(order[i], mirrored[i]);
    }
    order = next;
  }
  return order;
}

export interface SeededSlot {
  seed: number; // 1-based, 1 = strongest
  team: TournamentTeam | null; // null = a bye (only possible when the field isn't a power of 2)
}

/** Sorts by `power` descending to assign seed 1..N, then arranges into the standard bracket draw order.
 *  A field that isn't a power of 2 (no current stage in tournaments.ts actually does this — 128/64/32/16/
 *  8/2 are all already powers of 2) rounds up and gives the top seeds byes, which show up here as a `team:
 *  null` slot the caller should treat as an automatic round-1 win for whichever real seed it's paired with. */
export function seedTeams(teams: TournamentTeam[]): SeededSlot[] {
  const sorted = [...teams].sort((a, b) => b.power - a.power);
  const size = nextPowerOfTwo(sorted.length);
  // Seeds 1..sorted.length are real teams in strength order; any remaining seeds (only when the field
  // isn't already a power of 2) are byes.
  const bySeed = new Map<number, TournamentTeam | null>();
  sorted.forEach((team, i) => bySeed.set(i + 1, team));
  for (let seed = sorted.length + 1; seed <= size; seed++) bySeed.set(seed, null);

  const order = seedOrder(size);
  return order.map((seed) => ({ seed, team: bySeed.get(seed) ?? null }));
}
