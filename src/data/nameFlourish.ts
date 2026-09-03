// A rare, purely cosmetic flourish appended to some procedurally-generated AI names — either a genuine
// special character drawn from an assorted mix of scripts/symbols, or just a plain trailing period. Real
// pro handles (proPlayers.ts) are actual esports names and are never touched by this, only the sim's own
// generated identity pools (regional grinders, leaderboard filler regulars) are.
//
// Deterministic per name/seed so it's baked into the identity PERMANENTLY at generation time — that
// suffixed name then becomes the literal canonical name used everywhere else in the sim (friend records,
// MMR tables, matchmaking, org rosters) — this is not a live display-only swap the way data/altNames.ts's
// alt names are.

import { hashString } from "./proPlayers";

const FLOURISH_CHANCE = 0.05; // rare
const PERIOD_SHARE = 0.5; // of the identities that get one, how many just get a plain "."
const SPECIAL_CHARS = ["ح", "ø", "Σ", "ジ", "尊", "٭", "率", "Ω", "契", "★", "٩", "べ"];

export function withNameFlourish(name: string, seedKey: string): string {
  if (hashString(seedKey + "#flourish") % 1000 >= FLOURISH_CHANCE * 1000) return name;
  const usePeriod = hashString(seedKey + "#flourish_kind") % 100 < PERIOD_SHARE * 100;
  if (usePeriod) return `${name}.`;
  return `${name}${SPECIAL_CHARS[hashString(seedKey + "#flourish_char") % SPECIAL_CHARS.length]}`;
}
