// Arena/map system: purely cosmetic (the background shown behind a match), no gameplay effect. Real
// Rocket League arenas, restricted to the real Active Duty competitive map pool (no casual-only variants/
// reskins), unlocking over the course of a save on the same real-world dates they actually joined that
// pool, so an early save's pool is small and it grows the same way the real game's did.
//
// Ranked picks one random map from whatever's currently unlocked for each individual match (see
// randomMapForDate). RLCS (and any other best-of series) instead gets a fixed map per game, picked without
// repeats until the pool is exhausted, same as real RLCS's per-series map rotation (see mapsForSeries).
//
// Image files live in public/maps/ — see public/maps/README.md for the exact expected filenames. A map
// with no file dropped in yet just renders without a background image, nothing breaks.
import type { SimDate } from "./dateUtils";
import { daysBetween } from "./dateUtils";

export interface ArenaMap {
  id: string;
  name: string;
  /** Filename under public/maps/. */
  image: string;
  /** null = available from the very first day of any save, regardless of era — the original Active Duty
   *  arenas. Otherwise the real date this arena actually joined the competitive pool, so a save's
   *  available pool only ever contains maps that "exist yet" as of its current in-game date. */
  addedDate: SimDate | null;
}

/** The real Active Duty competitive map pool — every map ranked/RLCS ever actually draws from. Casual-only
 *  event reskins (Beckwith Park Stormy/Midnight, DFH Stadium Circuit, Neo Tokyo Comic, etc.) are
 *  deliberately excluded, this is the base competitive list only. */
export const ARENA_MAPS: ArenaMap[] = [
  // Original Active Duty arenas — available from day one of any save, no date gate.
  { id: "mannfield", name: "Mannfield", image: "mannfield.png", addedDate: null },
  { id: "dfh-stadium", name: "DFH Stadium", image: "dfh-stadium.png", addedDate: null },
  { id: "utopia-coliseum", name: "Utopia Coliseum", image: "utopia-coliseum.png", addedDate: null },
  { id: "beckwith-park", name: "Beckwith Park", image: "beckwith-park.png", addedDate: null },
  { id: "urban-central", name: "Urban Central", image: "urban-central.png", addedDate: null },
  { id: "wasteland", name: "Wasteland", image: "wasteland.png", addedDate: null },

  // Legacy-era additions (pre-F2P).
  { id: "neo-tokyo", name: "Neo Tokyo", image: "neo-tokyo.png", addedDate: { year: 2016, month: 6, day: 20 } },
  { id: "aquadome", name: "AquaDome", image: "aquadome.png", addedDate: { year: 2016, month: 10, day: 4 } },
  { id: "starbase-arc", name: "Starbase ARC", image: "starbase-arc.png", addedDate: { year: 2016, month: 12, day: 1 } },
  { id: "champions-field", name: "Champions Field", image: "champions-field.png", addedDate: { year: 2017, month: 7, day: 1 } },
  { id: "farmstead", name: "Farmstead", image: "farmstead.png", addedDate: { year: 2017, month: 9, day: 28 } },
  { id: "salty-shores", name: "Salty Shores", image: "salty-shores.png", addedDate: { year: 2018, month: 5, day: 29 } },
  { id: "forbidden-temple", name: "Forbidden Temple", image: "forbidden-temple.png", addedDate: { year: 2020, month: 1, day: 20 } },
  { id: "rivals-arena", name: "Rivals Arena", image: "rivals-arena.png", addedDate: { year: 2020, month: 3, day: 10 } },

  // Post-F2P additions (Season 1 onward, Sept 23 2020).
  { id: "neon-fields", name: "Neon Fields", image: "neon-fields.png", addedDate: { year: 2020, month: 12, day: 1 } },
  { id: "deadeye-canyon", name: "Deadeye Canyon", image: "deadeye-canyon.png", addedDate: { year: 2021, month: 4, day: 1 } },
  { id: "sovereign-heights", name: "Sovereign Heights", image: "sovereign-heights.png", addedDate: { year: 2022, month: 9, day: 1 } },
  { id: "estadio-vida", name: "Estadio Vida", image: "estadio-vida.png", addedDate: { year: 2023, month: 6, day: 1 } },
  { id: "drift-woods", name: "Drift Woods", image: "drift-woods.png", addedDate: { year: 2024, month: 9, day: 1 } },
  { id: "futura-garden", name: "Futura Garden", image: "futura-garden.png", addedDate: { year: 2025, month: 3, day: 1 } },
  { id: "boostfield-mall", name: "Boostfield Mall", image: "boostfield-mall.png", addedDate: { year: 2025, month: 9, day: 1 } },
  { id: "parc-de-paris", name: "Parc de Paris", image: "parc-de-paris.png", addedDate: { year: 2025, month: 12, day: 1 } },
];

function isMapUnlocked(map: ArenaMap, currentDate: SimDate): boolean {
  return !map.addedDate || daysBetween(map.addedDate, currentDate) >= 0;
}

/** Every arena that "exists yet" as of `currentDate` — always at least the 6 original Active Duty arenas. */
export function availableMaps(currentDate: SimDate): ArenaMap[] {
  return ARENA_MAPS.filter((m) => isMapUnlocked(m, currentDate));
}

/** One random currently-unlocked map, for an ordinary ranked match (a fresh independent roll every time,
 *  purely cosmetic so there's no need for it to be deterministic/seeded). */
export function randomMapForDate(currentDate: SimDate): ArenaMap {
  const pool = availableMaps(currentDate);
  return pool[Math.floor(Math.random() * pool.length)];
}

/** A fixed map per game for a best-of-N series (RLCS and other tournament play): shuffles the currently-
 *  unlocked pool and takes the first `gameCount` without repeats, same as real RLCS avoiding a map repeat
 *  within one series. Wraps around (allowing repeats) only if the series somehow runs longer than the
 *  entire unlocked pool — never happens in practice once more than a couple of real arenas exist. */
export function mapsForSeries(currentDate: SimDate, gameCount: number): ArenaMap[] {
  const pool = availableMaps(currentDate);
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const maps: ArenaMap[] = [];
  for (let i = 0; i < gameCount; i++) maps.push(shuffled[i % shuffled.length]);
  return maps;
}

export function mapImagePath(map: ArenaMap | null | undefined): string | null {
  return map ? `/maps/${map.image}` : null;
}
