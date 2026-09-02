// Shared "who's actually a plausible, currently-online opponent" gathering logic for GC+/SSL matchmaking —
// used by BOTH pickName (useMatchStore.ts, to actually pick an opponent) and computeQueueDurationMs (to
// estimate how long a search should take), so the two can never drift out of sync with each other.

import { activeProPlayers, type ProRegion } from "./proPlayers";
import type { RankEra, RankQueue } from "./rankSystem";
import type { QueueMode } from "./mockSave";
import type { SimDate } from "./dateUtils";
import { regionalGrinderRoster, type RosterBand } from "./regionalGrinders";
import { isOnlineNow, isActivelyQueueing, REGION_HOUR_OFFSET } from "./aiActivity";
import { useProLeaderboardStore } from "@/store/useProLeaderboardStore";
import { useRegionalRosterStore, bandForMmr } from "@/store/useRegionalRosterStore";

// How far above/below the player's own MMR a leaderboard-tracked opponent's live MMR (in THIS queue) can be
// and still be a believable match. 1v1 gets a wider "below" band: most pros treat it as a secondary queue,
// so their duel MMR sits further below their primary-queue level than a dedicated 1v1 player's would.
export const LEADERBOARD_MATCH_BAND_BELOW: Record<QueueMode, number> = { "1v1": 550, "2v2": 300, "3v3": 300 };
export const LEADERBOARD_MATCH_BAND_ABOVE = 500;

export interface EligibleCandidate {
  name: string;
  region: ProRegion;
  mmr: number;
  band: RosterBand;
  isPro: boolean;
}

/** Every real pro or regional grinder, across the given regions, who is (a) not already placed elsewhere in
 *  this roster, (b) within a believable MMR band of the player, and (c) actually online right now (their
 *  own region-shifted hour, see aiActivity.ts). This is the full realistic candidate pool for a GC+/SSL
 *  match — both an actual opponent pick and the queue-time estimate read from the same list. */
export function gatherEligibleOpponents(
  regions: ProRegion[],
  queue: QueueMode,
  playerMmr: number,
  era: RankEra,
  currentYear: number,
  currentDate: SimDate,
  seasonStartDate: SimDate,
  hourOfDay: number,
  used: Set<string>,
  /** >1 widens the MMR band (a real queue widens its search net the longer it waits for a match) — 1 is the
   *  normal/starting band, see useMatchStore.ts's top-tier search loop. */
  bandMultiplier = 1
): EligibleCandidate[] {
  const rankQueue = queue as RankQueue;
  const inBand = (mmr: number) =>
    mmr >= playerMmr - LEADERBOARD_MATCH_BAND_BELOW[queue] * bandMultiplier && mmr <= playerMmr + LEADERBOARD_MATCH_BAND_ABOVE * bandMultiplier;
  const online = (name: string, region: ProRegion) =>
    isOnlineNow(name, region, currentDate, (hourOfDay + REGION_HOUR_OFFSET[region]) % 24, queue) && isActivelyQueueing(name, region);

  const candidates: EligibleCandidate[] = [];

  for (const region of regions) {
    for (const pro of activeProPlayers(currentYear).filter((p) => p.region === region)) {
      if (used.has(pro.name)) continue;
      const mmr = useProLeaderboardStore.getState().getMmr(pro.name, queue, era, currentYear, currentDate, seasonStartDate);
      if (!inBand(mmr) || !online(pro.name, region)) continue;
      candidates.push({ name: pro.name, region, mmr, band: bandForMmr(mmr, era, rankQueue), isPro: true });
    }
    for (const grinder of regionalGrinderRoster(region, currentYear)) {
      if (used.has(grinder.name)) continue;
      const mmr = useRegionalRosterStore.getState().getMmr(grinder.name, region, queue, era, currentYear, currentDate, seasonStartDate);
      if (!inBand(mmr) || !online(grinder.name, region)) continue;
      candidates.push({ name: grinder.name, region, mmr, band: grinder.band, isPro: false });
    }
  }

  return candidates;
}
