// AI-AI duo parties: two named identities (real pros or regional grinders) who queue 2v2 together for a
// stretch, same region or a geographically compatible one (an NA player realistically never duos with a
// MENA player) — mirrors the real "ran a session with a friend for a while" behavior rather than every
// match's teammate pairing being an independent coinflip.

import { hashString, activeProPlayers, type ProRegion } from "./proPlayers";
import { regionalGrinderRoster } from "./regionalGrinders";
import { isNearbyRegion } from "./pingModel";
import type { SimDate } from "./dateUtils";

const PARTY_TYPE_CHANCE = 0.45; // fraction of identities who ever duo queue at all, rest always solo-queue
const PARTY_SESSION_BLOCK_HOURS = 6; // how long a party tends to stick together before possibly splitting
const PARTY_SESSION_ACTIVE_CHANCE = 0.7; // of the identities capable of partying, how often they're actually partied up (vs. soloing) during a given session block
// Real org teammates duo up to build chemistry together somewhat often, but not every session — elevated
// odds over a purely random regional peer, not a guarantee.
const ORG_TEAMMATE_PARTNER_CHANCE = 0.55;

export interface RegionalPeer {
  name: string;
  region: ProRegion;
}

/** Every real pro/grinder from `region` and any region close enough to realistically duo with it —
 *  the pool `partyPartnerFor` draws a stable partner from. */
export function regionCompatiblePeers(region: ProRegion, currentYear: number): RegionalPeer[] {
  const regions: ProRegion[] = [region, ...(REGION_NEARBY_LOOKUP(region))];
  const peers: RegionalPeer[] = [];
  for (const r of regions) {
    for (const pro of activeProPlayers(currentYear).filter((p) => p.region === r)) peers.push({ name: pro.name, region: r });
    for (const grinder of regionalGrinderRoster(r, currentYear)) peers.push({ name: grinder.name, region: r });
  }
  return peers;
}

function REGION_NEARBY_LOOKUP(region: ProRegion): ProRegion[] {
  const all: ProRegion[] = ["NA", "EU", "OCE", "SAM", "MENA", "APAC", "SSA"];
  return all.filter((r) => r !== region && isNearbyRegion(region, r));
}

/** Whether `name` is the "type" to ever duo queue at all — deterministic per identity, some grinders/pros
 *  are just solo queuers. */
function isPartyType(name: string, region: ProRegion): boolean {
  return (hashString(name + region + "#partytype") % 100) < PARTY_TYPE_CHANCE * 100;
}

/** `name`'s stable duo partner, if they have one at all — drawn once from the region-compatible peer pool
 *  and fixed from then on (a real relationship, not re-rolled every match). Null if this identity never
 *  duo-queues, or has nobody compatible to pair with. `orgTeammateNames` (this season's real org roster,
 *  see data/tournaments.ts's realTeamsForRegion), when given, gets a real elevated chance of being the
 *  pick over a purely random regional peer — real teammates duo up to build chemistry somewhat often, not
 *  every time. */
export function partyPartnerFor(name: string, region: ProRegion, peers: RegionalPeer[], orgTeammateNames: string[] = []): RegionalPeer | null {
  if (!isPartyType(name, region)) return null;
  const others = peers.filter((p) => p.name !== name);
  if (others.length === 0) return null;
  const eligibleTeammates = others.filter((p) => orgTeammateNames.includes(p.name));
  if (eligibleTeammates.length > 0 && hashString(name + region + "#orgpartnerroll") % 100 < ORG_TEAMMATE_PARTNER_CHANCE * 100) {
    const idx = hashString(name + region + "#orgpartnerpick") % eligibleTeammates.length;
    return eligibleTeammates[idx];
  }
  const idx = hashString(name + region + "#partner") % others.length;
  return others[idx];
}

/** Given `name` DOES have a fixed partner, whether they're actually queueing together THIS session block —
 *  a party sticks together for a stretch (see PARTY_SESSION_BLOCK_HOURS) but isn't permanent, "one takes a
 *  break" reads as this rolling false for a given block. */
export function isCurrentlyPartied(name: string, region: ProRegion, currentDate: SimDate, hourOfDay: number): boolean {
  const block = Math.floor(hourOfDay / PARTY_SESSION_BLOCK_HOURS);
  const roll = hashString(`${name}${region}${currentDate.year}-${currentDate.month}-${currentDate.day}-${block}#partysession`) % 100;
  return roll < PARTY_SESSION_ACTIVE_CHANCE * 100;
}
