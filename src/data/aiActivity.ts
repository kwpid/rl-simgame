// Deterministic online/offline model for named GC+/SSL AI (real pros and the regional grinder pool, see
// regionalGrinders.ts). Kept free of any store/React dependency so both matchmaking (pickName) and the
// queue-time estimate (computeQueueDurationMs) can call it without importing each other.

import { hashString, type ProRegion } from "./proPlayers";
import type { SimDate } from "./dateUtils";
import type { QueueMode } from "./mockSave";

/** A rough per-region "when does this scene's crowd actually play" offset, applied to the player's own
 *  clock hour before checking an identity's activity window — not real timezone math, just enough flavor
 *  that "queueing at 3am NA" and "queueing at 3am EU" don't behave identically. */
export const REGION_HOUR_OFFSET: Record<ProRegion, number> = {
  NA: 0,
  EU: 6,
  OCE: 16,
  SAM: 2,
  MENA: 8,
  APAC: 13,
  SSA: 7,
};

export interface ActivityProfile {
  /** 0-1: how many days out of a stretch this identity logs in at all. A low value is the "goes dark for
   *  a few days at a time" grinder from the spec, a high value is "on all the time". */
  dayActiveRate: number;
  /** Hour (0-23, region-local) their play session clusters around. */
  peakHour: number;
  /** How wide their online window is around peakHour, in hours either side. */
  sessionSpreadHours: number;
}

// Real ranked activity isn't flat across the clock — it clusters hard in the midday-through-evening stretch
// (region-local). EVERY identity's peak hour lands somewhere in this window, no exceptions (no 8am peak
// hours) — sessionSpreadHours below still lets an individual identity's actual online window extend earlier/
// later than their peak, real sessions aren't a single instant, but the CENTER of that session always sits
// in this range.
const PEAK_HOUR_WINDOW_START = 12; // noon
const PEAK_HOUR_WINDOW_END = 21; // 9pm

function pickPeakHour(name: string, region: ProRegion): number {
  const span = PEAK_HOUR_WINDOW_END - PEAK_HOUR_WINDOW_START;
  return PEAK_HOUR_WINDOW_START + (hashString(name + region + "#peak") % (span + 1));
}

/** Deterministic per name+region so the same identity always has the same habits match to match and
 *  session to session, same "hash the name for a consistent flavor" pattern already used throughout this
 *  codebase (see matchSim.ts's effectivePlaystyle, orgTagForOpponent). */
export function activityProfileFor(name: string, region: ProRegion): ActivityProfile {
  const dayActiveRate = 0.35 + (hashString(name + region + "#day") % 100) / 100 * 0.6;
  const peakHour = pickPeakHour(name, region);
  const sessionSpreadHours = 1.5 + (hashString(name + region + "#spread") % 100) / 100 * 5;
  return { dayActiveRate, peakHour, sessionSpreadHours };
}

const QUEUE_FOCUS_BLOCK_HOURS = 3;
const ALL_QUEUES: QueueMode[] = ["1v1", "2v2", "3v3"];

/** Real ranked grinders don't queue all three playlists at once, they settle into one for a stretch (a
 *  few hours of Doubles, then maybe switch to Duel) before moving on — this picks which queue a given
 *  identity is "currently" grinding, changing every few in-game hours. */
function focusQueueFor(name: string, region: ProRegion, currentDate: SimDate, hourOfDay: number): QueueMode {
  const block = Math.floor(hourOfDay / QUEUE_FOCUS_BLOCK_HOURS);
  const seed = hashString(`${name}${region}${currentDate.year}-${currentDate.month}-${currentDate.day}-${block}#focus`);
  return ALL_QUEUES[seed % ALL_QUEUES.length];
}

/** `hourOfDay` should already be region-shifted by the caller (see REGION_HOUR_OFFSET) before being passed
 *  in here. `currentDate` only decides whether this identity is active TODAY at all (stable within one day,
 *  varies day to day) — the actual online/offline check within an active day is purely hour-of-day based.
 *  Deterministic (no live randomness) so the same call always agrees with itself within one search — the
 *  matchmaking pool and the queue-availability check must never disagree about who's actually online right
 *  now. Passing `queue` additionally checks whether this is the identity's CURRENT focus queue (see
 *  focusQueueFor) — still possible but notably less likely if they're grinding a different mode right now. */
export function isOnlineNow(name: string, region: ProRegion, currentDate: SimDate, hourOfDay: number, queue?: QueueMode): boolean {
  const profile = activityProfileFor(name, region);
  const dayKey = hashString(`${name}${region}${currentDate.year}-${currentDate.month}-${currentDate.day}`) % 100;
  if (dayKey >= profile.dayActiveRate * 100) return false;

  const rawDelta = Math.abs(hourOfDay - profile.peakHour);
  const hourDelta = Math.min(rawDelta, 24 - rawDelta);
  if (hourDelta > profile.sessionSpreadHours) return false;

  // Even inside their usual window, not a hard on/off toggle right at the edge — but deterministic, not a
  // live coinflip, so this always agrees with itself for the same (name, region, date, hour).
  const edgeRoll = hashString(`${name}${region}${currentDate.year}-${currentDate.month}-${currentDate.day}-${hourOfDay}#online`) % 100;
  if (edgeRoll >= 90) return false;

  if (queue && focusQueueFor(name, region, currentDate, hourOfDay) !== queue) {
    const altRoll = hashString(`${name}${region}${currentDate.year}-${currentDate.month}-${currentDate.day}-${hourOfDay}#altqueue`) % 100;
    return altRoll < 35;
  }
  return true;
}

// "Online" only means this identity is playing ranked SOMEWHERE right now — it doesn't mean they're
// sitting in queue at this exact instant. A real grinder spends most of their time actually IN a match or
// in the post-game menu, and only a slice of that loop actually searching. This cycles on real wall-clock
// time (not in-game date/hour) since it's meant to simulate moment-to-moment queue availability across a
// live search session, layered on top of isOnlineNow's coarser in-game-hour gate.
const QUEUE_CYCLE_MS = 5 * 60 * 1000; // one rough game+menu loop
const QUEUEING_FRACTION = 0.3; // only about this slice of the loop is spent actually sitting in queue

/** Given that `name` is already online (see isOnlineNow), whether they're actually sitting in queue RIGHT
 *  NOW as opposed to mid-match or between games. Cycles over real time, so a search that keeps rechecking
 *  every few seconds can catch someone the moment they requeue rather than everyone online being available
 *  every single tick. */
export function isActivelyQueueing(name: string, region: ProRegion): boolean {
  const phase = hashString(name + region + "#cyclephase") % QUEUE_CYCLE_MS;
  const t = (Date.now() + phase) % QUEUE_CYCLE_MS;
  return t < QUEUE_CYCLE_MS * QUEUEING_FRACTION;
}
