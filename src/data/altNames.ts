// A small, rare "goes by something shorter for a stretch of the day" quirk for a handful of tracked AI —
// purely a LIVE DISPLAY substitution (match roster panel, in-match log), never the real underlying
// identity. Stats, friend records, and recent-match history always stay keyed by the real name, so match
// history correctly shows who you actually played even if they were showing an alt name live, including
// someone you partied with.

import { hashString } from "./proPlayers";
import type { SimDate } from "./dateUtils";

const ALT_NAME_CHANCE = 0.08; // rare — most tracked AI never do this at all
const ALT_SYMBOL_POOL = [".", "!", "-", "~", "*"];
const ALT_WINDOW_HOURS = 3; // active for a 3-hour block each day, not the whole day

/** Whether this identity is the "type" to ever go by an alt name at all — deterministic, fixed forever
 *  once decided (never re-rolled), same pattern as every other "is this name the type to..." check in
 *  this sim (see aiParties.ts's isPartyType). */
export function hasAltName(name: string): boolean {
  return hashString(name + "#altname") % 1000 / 1000 < ALT_NAME_CHANCE;
}

/** The alt name itself — either a single symbol, or just their real name's first letter (e.g. "Rw9" -> "R"),
 *  fixed per identity. Only meaningful for a name `hasAltName` says yes to. */
export function altNameFor(name: string): string {
  const useSymbol = hashString(name + "#altnamekind") % 100 < 40;
  if (useSymbol) return ALT_SYMBOL_POOL[hashString(name + "#altnamesymbol") % ALT_SYMBOL_POOL.length];
  const firstLetter = name.trim().charAt(0).toUpperCase();
  return firstLetter || name;
}

/** A stable daily window (start hour, deterministic per name+date), not the same hours every single day —
 *  real "goes by something else for a bit" reads as an occasional quirk, not a fixed daily schedule. */
function altWindowStartHour(name: string, currentDate: SimDate): number {
  return hashString(`${name}#altwindow#${currentDate.year}-${currentDate.month}-${currentDate.day}`) % 24;
}

export function isAltNameActiveNow(name: string, currentDate: SimDate, hourOfDay: number): boolean {
  if (!hasAltName(name)) return false;
  const start = altWindowStartHour(name, currentDate);
  const end = (start + ALT_WINDOW_HOURS) % 24;
  if (start <= end) return hourOfDay >= start && hourOfDay < end;
  return hourOfDay >= start || hourOfDay < end; // window wraps past midnight
}

/** The name to actually SHOW right now — real name unless this identity currently has an active alt-name
 *  window. Live display only (match roster/log) — never use this for recent matches, friend records, or
 *  any stats lookup, those must always stay keyed by the real name. */
export function displayNameFor(name: string, currentDate: SimDate, hourOfDay: number): string {
  return isAltNameActiveNow(name, currentDate, hourOfDay) ? altNameFor(name) : name;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Substitutes every real name in `text` with its currently-active alt name (if any), word-boundary safe
 *  so a short alt name (a single letter/symbol) can't accidentally clobber part of an unrelated word.
 *  `names` is the finite set of real names actually in this match — never runs this against arbitrary text. */
export function applyAltNameDisplay(text: string, names: string[], currentDate: SimDate, hourOfDay: number): string {
  let result = text;
  for (const name of names) {
    if (!isAltNameActiveNow(name, currentDate, hourOfDay)) continue;
    const alt = altNameFor(name);
    result = result.replace(new RegExp(`\\b${escapeRegExp(name)}\\b`, "g"), alt);
  }
  return result;
}
