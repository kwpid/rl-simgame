// Cosmetic, LIVE-fluctuating ping display for match participants (see RankedScreen.tsx's region multi-
// select and MatchScreen.tsx's roster rows) — lets a player notice "this opponent isn't actually in my
// region" without an explicit label, the same way a real cross-region lobby's ping numbers would tip you
// off. No gameplay effect whatsoever, purely a readout.

import { hashString, type ProRegion } from "./proPlayers";

// Rough geographic/undersea-cable proximity, NOT a full distance matrix — just enough to have a believable
// middle ping tier between "same region" and "genuine region gap".
const REGION_NEARBY: Partial<Record<ProRegion, ProRegion[]>> = {
  NA: ["SAM"],
  SAM: ["NA"],
  EU: ["MENA", "SSA"],
  MENA: ["EU", "SSA", "APAC"],
  SSA: ["EU", "MENA"],
  OCE: ["APAC"],
  APAC: ["OCE", "MENA"],
};

function isNearbyRegion(a: ProRegion, b: ProRegion): boolean {
  return REGION_NEARBY[a]?.includes(b) ?? false;
}

/** A believable ping reading for `otherRegion` as seen from `selfRegion`: same region reads low (15-30ms),
 *  a geographically nearby region reads moderate (45-75ms), a genuine region gap reads high (100-180ms).
 *  `otherRegion` undefined (an untracked generic name) reads as local — there's no real region data to
 *  suggest otherwise. Wobbles smoothly second to second (driven by the live match clock) rather than
 *  sitting dead flat, same as a real connection would. */
export function livePingMs(selfRegion: ProRegion, otherRegion: ProRegion | undefined, name: string, matchClockSeconds: number): number {
  const region = otherRegion ?? selfRegion;
  const [lo, hi]: [number, number] = region === selfRegion ? [15, 30] : isNearbyRegion(selfRegion, region) ? [45, 75] : [100, 180];
  const mid = (lo + hi) / 2;
  const spread = (hi - lo) / 2;
  const seed = hashString(name) % 1000;
  const wobble = Math.sin(matchClockSeconds / 3 + seed) * spread * 0.6 + Math.sin(matchClockSeconds / 7 + seed * 1.3) * spread * 0.4;
  return Math.max(8, Math.round(mid + wobble));
}
