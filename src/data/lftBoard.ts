// Looking-For-Team board: a rotating handful of real, high-rank free agents (pros/mid-band grinders not
// currently on a real org roster, see tournaments.ts's realTeamsForRegion) posting that they're looking for
// a queue partner or an org to join. Deterministic per (name, week) so the same handful of listings holds
// for a while rather than reshuffling every render — a real LFT post doesn't disappear the instant you
// refresh the page, it sits there for a stretch.

import { hashString, activeProPlayers, type ProRegion } from "./proPlayers";
import { regionalGrinderRoster } from "./regionalGrinders";
import { realTeamsForRegion } from "./tournaments";
import type { QueueMode } from "./mockSave";
import type { SimDate } from "./dateUtils";
import type { RankEra } from "./rankSystem";

const ALL_PRO_REGIONS: ProRegion[] = ["NA", "EU", "OCE", "SAM", "MENA", "APAC", "SSA"];
const LISTING_COUNT = 10;
const REFRESH_INTERVAL_DAYS = 7;

const BLURB_TEMPLATES = [
  "Looking for a {queue} partner, flexible role.",
  "Free agent, open to org tryouts.",
  "Grinding solo, want someone to duo with.",
  "Between orgs, looking for a new roster.",
  "Want to build real chemistry with a regular partner.",
  "Open to scrims, LFT.",
  "Main {queue}, looking for a consistent duo.",
];

export interface LftListing {
  name: string;
  region: ProRegion;
  queue: QueueMode;
  blurb: string;
  isPro: boolean;
}

/** A stable "week index" from the sim date, so the board only reshuffles roughly weekly rather than
 *  every single day. */
function weekKey(date: SimDate): number {
  return Math.floor((date.year * 400 + date.month * 31 + date.day) / REFRESH_INTERVAL_DAYS);
}

/** This week's LFT board: real pros/mid-band grinders across every region who aren't currently on a real
 *  org roster, picked deterministically per week. `resetSeed`/`seasonNumber`/`seasonStartDate` are the same
 *  RLCS-season inputs every other `realTeamsForRegion` caller threads through, needed here purely to check
 *  who's already signed. */
export function lftListings(
  currentDate: SimDate,
  currentYear: number,
  era: RankEra,
  seasonNumber: number,
  resetSeed: number,
  seasonStartDate: SimDate
): LftListing[] {
  const week = weekKey(currentDate);
  const candidates: { name: string; region: ProRegion; isPro: boolean }[] = [];
  for (const region of ALL_PRO_REGIONS) {
    const signed = new Set(
      realTeamsForRegion(region, currentYear, seasonNumber, resetSeed, "lftcheck", era, currentDate, seasonStartDate).flatMap((t) => t.players)
    );
    for (const pro of activeProPlayers(currentYear).filter((p) => p.region === region)) {
      if (!signed.has(pro.name)) candidates.push({ name: pro.name, region, isPro: true });
    }
    for (const grinder of regionalGrinderRoster(region, currentYear).filter((g) => g.band === "mid")) {
      if (!signed.has(grinder.name)) candidates.push({ name: grinder.name, region, isPro: false });
    }
  }
  if (candidates.length === 0) return [];

  const ranked = [...candidates].sort(
    (a, b) => (hashString(a.name + "#lft" + week) % 1000) - (hashString(b.name + "#lft" + week) % 1000)
  );
  const picks = ranked.slice(0, Math.min(LISTING_COUNT, ranked.length));
  const queues: QueueMode[] = ["1v1", "2v2", "3v3"];

  return picks.map((c) => {
    const queue = queues[hashString(c.name + "#lft_queue") % queues.length];
    const template = BLURB_TEMPLATES[hashString(c.name + "#lft_blurb" + week) % BLURB_TEMPLATES.length];
    return { name: c.name, region: c.region, queue, blurb: template.replace("{queue}", queue.toUpperCase()), isPro: c.isPro };
  });
}
