// Arena/map system: purely cosmetic (the background shown behind a match), no gameplay effect. Real
// Rocket League arenas, unlocking over the course of a save on the same real-world dates they actually
// shipped on, so an early save's pool is small and it grows the same way the real game's did.
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
  /** null = available from the very first day of any save, regardless of era — the five original launch
   *  arenas. Otherwise the real date this arena actually shipped in Rocket League, so a save's available
   *  pool only ever contains maps that "exist yet" as of its current in-game date. */
  addedDate: SimDate | null;
}

export const ARENA_MAPS: ArenaMap[] = [
  // Launch arenas — available from day one of any save, no date gate.
  { id: "dfh-stadium", name: "DFH Stadium", image: "dfh-stadium.png", addedDate: null },
  { id: "mannfield", name: "Mannfield", image: "mannfield.png", addedDate: null },
  { id: "beckwith-park", name: "Beckwith Park", image: "beckwith-park.png", addedDate: null },
  { id: "beckwith-park-stormy", name: "Beckwith Park (Stormy)", image: "beckwith-park-stormy.png", addedDate: null },
  { id: "beckwith-park-midnight", name: "Beckwith Park (Midnight)", image: "beckwith-park-midnight.png", addedDate: null },
  { id: "urban-central", name: "Urban Central", image: "urban-central.png", addedDate: null },
  { id: "utopia-coliseum", name: "Utopia Coliseum", image: "utopia-coliseum.png", addedDate: null },

  // Legacy-era additions (pre-F2P).
  { id: "neo-tokyo", name: "Neo Tokyo", image: "neo-tokyo.png", addedDate: { year: 2016, month: 6, day: 20 } },
  { id: "aquadome", name: "AquaDome", image: "aquadome.png", addedDate: { year: 2016, month: 10, day: 4 } },
  { id: "starbase-arc", name: "Starbase ARC", image: "starbase-arc.png", addedDate: { year: 2016, month: 12, day: 1 } },
  { id: "champions-field", name: "Champions Field", image: "champions-field.png", addedDate: { year: 2017, month: 7, day: 1 } },
  { id: "farmstead", name: "Farmstead", image: "farmstead.png", addedDate: { year: 2017, month: 9, day: 28 } },
  { id: "salty-shores", name: "Salty Shores", image: "salty-shores.png", addedDate: { year: 2018, month: 5, day: 29 } },
  { id: "forbidden-temple", name: "Forbidden Temple", image: "forbidden-temple.png", addedDate: { year: 2020, month: 1, day: 20 } },

  // Post-F2P additions (Season 1 onward, Sept 23 2020).
  { id: "neon-fields", name: "Neon Fields", image: "neon-fields.png", addedDate: { year: 2020, month: 12, day: 1 } },
  { id: "dfh-stadium-circuit", name: "DFH Stadium (Circuit)", image: "dfh-stadium-circuit.png", addedDate: { year: 2021, month: 1, day: 1 } },
  { id: "deadeye-canyon", name: "Deadeye Canyon", image: "deadeye-canyon.png", addedDate: { year: 2021, month: 4, day: 1 } },
  { id: "starbase-arc-aftermath", name: "Starbase ARC (Aftermath)", image: "starbase-arc-aftermath.png", addedDate: { year: 2021, month: 8, day: 1 } },
  { id: "neo-tokyo-comic", name: "Neo Tokyo (Comic)", image: "neo-tokyo-comic.png", addedDate: { year: 2022, month: 1, day: 1 } },
  { id: "utopia-coliseum-gilded", name: "Utopia Coliseum (Gilded)", image: "utopia-coliseum-gilded.png", addedDate: { year: 2022, month: 4, day: 1 } },
  { id: "sovereign-heights", name: "Sovereign Heights", image: "sovereign-heights.png", addedDate: { year: 2022, month: 9, day: 1 } },
  { id: "forbidden-temple-fire-ice", name: "Forbidden Temple (Fire & Ice)", image: "forbidden-temple-fire-ice.png", addedDate: { year: 2022, month: 12, day: 1 } },
  { id: "deadeye-canyon-oasis", name: "Deadeye Canyon (Oasis)", image: "deadeye-canyon-oasis.png", addedDate: { year: 2023, month: 3, day: 1 } },
  { id: "estadio-vida", name: "Estadio Vida", image: "estadio-vida.png", addedDate: { year: 2023, month: 6, day: 1 } },
  { id: "neo-tokyo-hacked", name: "Neo Tokyo (Hacked)", image: "neo-tokyo-hacked.png", addedDate: { year: 2023, month: 9, day: 1 } },
  { id: "mannfield-dusk", name: "Mannfield (Dusk)", image: "mannfield-dusk.png", addedDate: { year: 2023, month: 12, day: 1 } },
  { id: "farmstead-pitched", name: "Farmstead (Pitched)", image: "farmstead-pitched.png", addedDate: { year: 2023, month: 12, day: 1 } },
  { id: "wasteland-pitched", name: "Wasteland (Pitched)", image: "wasteland-pitched.png", addedDate: { year: 2023, month: 12, day: 1 } },
  { id: "aquadome-salty-shallows", name: "AquaDome (Salty Shallows)", image: "aquadome-salty-shallows.png", addedDate: { year: 2024, month: 3, day: 1 } },
  { id: "salty-shores-salty-fest", name: "Salty Shores (Salty Fest)", image: "salty-shores-salty-fest.png", addedDate: { year: 2024, month: 6, day: 1 } },
  { id: "drift-woods", name: "Drift Woods", image: "drift-woods.png", addedDate: { year: 2024, month: 9, day: 1 } },
  { id: "neo-tokyo-arcade", name: "Neo Tokyo (Arcade)", image: "neo-tokyo-arcade.png", addedDate: { year: 2024, month: 12, day: 1 } },
  { id: "futura-garden", name: "Futura Garden", image: "futura-garden.png", addedDate: { year: 2025, month: 3, day: 1 } },
  { id: "dfh-stadium-anniversary", name: "DFH Stadium (10th Anniversary)", image: "dfh-stadium-anniversary.png", addedDate: { year: 2025, month: 6, day: 1 } },
  { id: "boostfield-mall", name: "Boostfield Mall", image: "boostfield-mall.png", addedDate: { year: 2025, month: 9, day: 1 } },
  { id: "parc-de-paris", name: "Parc de Paris", image: "parc-de-paris.png", addedDate: { year: 2025, month: 12, day: 1 } },
];

function isMapUnlocked(map: ArenaMap, currentDate: SimDate): boolean {
  return !map.addedDate || daysBetween(map.addedDate, currentDate) >= 0;
}

/** Every arena that "exists yet" as of `currentDate` — always at least the 7 launch arenas. */
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
