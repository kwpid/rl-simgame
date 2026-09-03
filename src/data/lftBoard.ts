// Looking For Team: whether a given tracked AI identity (a real pro or regional grinder) is CURRENTLY
// posting that they're looking for a partner or org — shown as a grey [LFT] tag next to their name in
// matches (see ui/components/LftTag.tsx), same flavor as the player's own postingLft toggle on the Social
// screen's LFT tab. Deliberately not a browsable "board" of listings — the player isn't an org, there's
// nothing to scout here, just a rare "oh, this AI happens to be LFT right now" flavor note wherever their
// name already shows up. Whether they're eligible for this at all (signed to a real org or not) is checked
// by the caller (see useMatchStore.ts's buildOpponent, which already resolves orgTag), this only decides
// whether an ELIGIBLE identity is actively posting this stretch.

import { hashString } from "./proPlayers";
import type { SimDate } from "./dateUtils";

const LFT_ACTIVE_CHANCE = 0.35;
const REFRESH_INTERVAL_DAYS = 7;

/** A stable "week index" from the sim date, so a given identity's LFT status only changes roughly weekly
 *  rather than flickering every single day. */
function weekKey(date: SimDate): number {
  return Math.floor((date.year * 400 + date.month * 31 + date.day) / REFRESH_INTERVAL_DAYS);
}

export function isPostingLft(name: string, currentDate: SimDate): boolean {
  const week = weekKey(currentDate);
  return hashString(name + "#lft_active_" + week) % 100 < LFT_ACTIVE_CHANCE * 100;
}
