// Duo/trio reputation: an established queue-buddy friendship (see FriendRecord.chemistry) that's been
// played out enough, at high enough chemistry, becomes a genuinely RECOGNIZED partnership — "the Volt.Kinetic
// + Nwpo duo" — rather than just a private stat on the Social screen. A famous partnership plays measurably
// better together (a real bump on top of their own chemistry, feeding the exact same teamChemistry mechanic
// org rosters and ordinary queue buddies already use — see matchSim.ts's simulateTeamChain), which is the
// concrete form "other AIs play differently against famous pairs" takes here: a recognized duo is a tougher
// out precisely because they're demonstrably tighter together, not a separate opponent-side stat.

import type { FriendRecord } from "./mockSave";

// How many games together it takes for reputation to fully credit experience (on top of raw chemistry) —
// a duo that's only queued a handful of times isn't "recognized" yet regardless of how well those went.
const REPUTATION_EXPERIENCE_GAMES = 30;
const FAMOUS_THRESHOLD = 70;
// A recognized partnership's chemistry reads a little higher than the raw number alone — the "everyone
// knows how well these two play together" effect, on top of (not instead of) their own real chemistry.
const FAMOUS_CHEMISTRY_BONUS = 15;

/** 0-100 — how "known" this partnership is, blending raw chemistry with how many games they've actually
 *  played together. Two friends with identical chemistry but very different game counts together read
 *  differently: reputation has to be earned over real time queued up, not just a high chemistry number
 *  reached quickly. */
export function partnershipReputation(friend: FriendRecord): number {
  const gamesWith = friend.winsWith + friend.lossesWith;
  const experienceFactor = Math.min(1, gamesWith / REPUTATION_EXPERIENCE_GAMES);
  return Math.round(friend.chemistry * 0.6 + experienceFactor * 40);
}

/** Whether this partnership has crossed into genuinely "recognized" territory. */
export function isPartnershipFamous(friend: FriendRecord): boolean {
  return partnershipReputation(friend) >= FAMOUS_THRESHOLD;
}

/** The recognized-partnership display label, e.g. "The Volt.Kinetic + Nwpo Duo" (or "Trio" for a 3-stack —
 *  pass every partied name, this always reads as "The A + B [+ C] {Duo|Trio}"). Only meaningful when at
 *  least one of the pairings involved is actually famous (see isPartnershipFamous) — callers should check
 *  that first, this just formats the string. */
export function partnershipLabel(names: string[]): string {
  const kind = names.length >= 3 ? "Trio" : "Duo";
  return `The ${names.join(" + ")} ${kind}`;
}

/** A partied friend's chemistry as it should actually feed into the match engine — boosted above their raw
 *  FriendRecord.chemistry once the partnership is famous enough to be "recognized", same idea as a real
 *  esports duo's reputation preceding them. Use this everywhere a partied friend's chemistry gets threaded
 *  into a match (see useMatchStore.ts's PartyFriendStats), never the raw `friend.chemistry` directly. */
export function effectivePartyChemistry(friend: FriendRecord): number {
  return isPartnershipFamous(friend) ? Math.min(100, friend.chemistry + FAMOUS_CHEMISTRY_BONUS) : friend.chemistry;
}
