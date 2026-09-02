// The "ranked grinder" identity pool: real named GC+/SSL opponents who AREN'T signed pros (see
// proPlayers.ts), filling out the Low/Mid density bands of each region's roster (see useRegionalRosterStore.ts
// for their persistent MMR/stats, aiActivity.ts for their online/offline schedule). Wholly synthetic and
// disjoint from LB_NAMES (the old generic ranked-filler pool) so a grinder identity never collides with a
// name that pool might still produce for below-GC matches.

import { hashString, activeProPlayers, type ProRegion } from "./proPlayers";

export type RosterBand = "low" | "mid" | "high" | "super_high";

export interface GrinderIdentity {
  name: string;
  region: ProRegion;
  /** Fixed at generation, never reseeded — this is a target-MMR bucket, not a live rank. */
  band: RosterBand;
}

// Deliberately disjoint in flavor from LB_NAMES's cosmetic gamertags and from PRO_PLAYERS's real handles.
const GRINDER_PREFIXES = [
  "Nova", "Zen", "Volt", "Rift", "Echo", "Static", "Drift", "Halo", "Vex", "Prism",
  "Ember", "Frost", "Glide", "Hex", "Kilo", "Lumen", "Onyx", "Pulse", "Quartz", "Rogue",
  "Solar", "Tidal", "Umbra", "Vertex", "Wisp", "Zephyr", "Axiom", "Blitz", "Cobalt", "Dune",
];
const GRINDER_SUFFIXES = [
  "shot", "flip", "reader", "wave", "boost", "dash", "clip", "line", "ghost", "byte",
  "core", "flux", "pace", "reset", "sync", "drive", "loop", "wing", "surge", "trail",
];

function grinderName(index: number, seed: number): string {
  const prefix = GRINDER_PREFIXES[Math.abs(seed) % GRINDER_PREFIXES.length];
  const suffix = GRINDER_SUFFIXES[Math.abs(seed >> 4) % GRINDER_SUFFIXES.length];
  const tag = Math.abs(seed >> 8) % 100;
  return `${prefix}${suffix}${index}${tag < 15 ? tag : ""}`;
}

const MIN_GRINDERS_PER_REGION = 20;
const MAX_GRINDERS_PER_REGION = 65;
// Combined pro + grinder total per region should land near the middle of the "50-75 unique AI" target.
const TARGET_ROSTER_SIZE = 65;

const LOW_BAND_SHARE = 0.65; // rest rolls "mid" — this pool never rolls high/super_high directly.

/** How many synthetic grinder identities a region needs this year to round its roster out to roughly
 *  TARGET_ROSTER_SIZE once real pros (which vary a lot in count by region) are added on top. */
function grinderCountForRegion(region: ProRegion, currentYear: number): number {
  const proCount = activeProPlayers(currentYear).filter((p) => p.region === region).length;
  return Math.max(MIN_GRINDERS_PER_REGION, Math.min(MAX_GRINDERS_PER_REGION, TARGET_ROSTER_SIZE - proCount));
}

/** Deterministic, module-pure: same region always returns the same roster (same names, same bands), never
 *  regenerated/reshuffled — this is what "not randomized after generation" means at the data layer. Sized
 *  per the current year so a region's grinder count adapts as its real pro scene grows over the save. */
export function regionalGrinderRoster(region: ProRegion, currentYear: number): GrinderIdentity[] {
  const count = grinderCountForRegion(region, currentYear);
  const roster: GrinderIdentity[] = [];
  for (let i = 0; i < count; i++) {
    const seed = hashString(`${region}#grinder#${i}`);
    const name = grinderName(i, seed);
    const band: RosterBand = (seed % 100) < LOW_BAND_SHARE * 100 ? "low" : "mid";
    roster.push({ name, region, band });
  }
  return roster;
}
