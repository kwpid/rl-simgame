// 1v1 exhibition showmatches, hosted by streamers with their own audience level and typical opponent
// caliber. Doesn't touch ranked MMR at all, purely fame/recognition and experience, same spirit as real
// RL showmatches: a way to get looks from orgs/fans without it being "real" competitive placement.

import { tierMinMmr, type RankEra } from "./rankSystem";
import { activeProPlayers } from "./proPlayers";
import { fillerLeaderboardNames } from "@/store/useLeaderboardFillerStore";

export type StreamerId = "shadow" | "feer" | "johnboi";

export interface Streamer {
  id: StreamerId;
  name: string;
  description: string;
  /** How much Fame a showmatch with this streamer is worth, win vs loss (a loss still gets you seen). */
  fameReward: { win: number; loss: number };
  /** Real cash paid for winning a showmatch against this streamer, picked randomly from this range. Losing
   *  pays nothing - winner-take-all, matching how real prize-money exhibitions usually work. */
  cashReward: { win: [number, number] };
  /** Best-of length the showmatch series is actually played at - showmatches are real Bo5/Bo7 affairs, not
   *  a quick single game. */
  seriesFormat: number;
  /** Rough chance, each time the invitation check runs and the player's 1v1 level fits this streamer's
   *  band, that an invite actually fires. Real streamers don't book a showmatch with you every week. */
  inviteChance: number;
}

export const STREAMERS: Streamer[] = [
  {
    id: "shadow",
    name: "Shadow",
    description: "Grand Champion-to-low SSL 1v1 showmatches. Good to get your foot in the door, but not much reach.",
    fameReward: { win: 6, loss: 2 },
    cashReward: { win: [100, 150] },
    seriesFormat: 5,
    inviteChance: 0.35,
  },
  {
    id: "feer",
    name: "Feer",
    description: "Top-100 SSL 1v1s, a mix of upcoming and current pros. Solid recognition either way.",
    fameReward: { win: 14, loss: 5 },
    cashReward: { win: [150, 250] },
    seriesFormat: 5,
    inviteChance: 0.22,
  },
  {
    id: "johnboi",
    name: "JohnnyBoi",
    description: "High-level 1v1s against top pros. The biggest stage 1v1 showmatches get.",
    fameReward: { win: 30, loss: 10 },
    cashReward: { win: [250, 350] },
    seriesFormat: 7,
    inviteChance: 0.1,
  },
];

/** Which streamers would plausibly book a showmatch with a player at this 1v1 MMR right now. Bands are
 *  anchored off the queue's own SSL floor rather than fixed numbers, so this scales correctly across eras.
 *  Pre-2020 (legacy era, no SSL yet), JohnnyBoi is the only one of the three actually on the scene —
 *  Shadow and Feer only show up once the modern era starts in Sept 2020.
 *
 *  Two extra OR-paths on top of the base 1v1-MMR gate, since a streamer would book someone for reasons
 *  besides their CURRENT 1v1 rank: a top-tier 2v2 player unlocks Shadow/Feer even if their 1v1 hasn't
 *  caught up yet (`rankTier2v2`/`mmr2v2`), and anyone holding a real RLCS title unlocks JohnnyBoi's stage
 *  regardless of current MMR — a genuine "top RLCS player" doesn't stop being a draw just because their
 *  ranked MMR dipped (`hasRealRlcsTitle`, see `findRealRlcsTitlesForPlayer` in useTournamentStore.ts). */
export function eligibleStreamers(
  mmr1v1: number,
  rankTier: string,
  era: RankEra,
  mmr2v2: number = 0,
  rankTier2v2: string = "unranked",
  hasRealRlcsTitle: boolean = false
): Streamer[] {
  const isGcOrAbove = rankTier === "grand_champion" || rankTier === "ssl";
  const isGcOrAbove2v2 = rankTier2v2 === "grand_champion" || rankTier2v2 === "ssl";
  if (!isGcOrAbove && !isGcOrAbove2v2 && !hasRealRlcsTitle) return [];

  if (era !== "modern") {
    return [STREAMERS.find((s) => s.id === "johnboi")!];
  }

  const sslFloor = tierMinMmr("ssl", era, "1v1");
  const sslFloor2v2 = tierMinMmr("ssl", era, "2v2");
  const eligible: Streamer[] = [];
  if (rankTier === "grand_champion" || mmr1v1 < sslFloor + 100 || rankTier2v2 === "grand_champion" || mmr2v2 < sslFloor2v2 + 100) {
    eligible.push(STREAMERS[0]); // Shadow
  }
  if (
    (rankTier === "ssl" && mmr1v1 >= sslFloor + 100 && mmr1v1 < sslFloor + 400) ||
    (rankTier2v2 === "ssl" && mmr2v2 >= sslFloor2v2 + 100 && mmr2v2 < sslFloor2v2 + 400)
  ) {
    eligible.push(STREAMERS[1]); // Feer
  }
  if ((rankTier === "ssl" && mmr1v1 >= sslFloor + 400) || (rankTier2v2 === "ssl" && mmr2v2 >= sslFloor2v2 + 400) || hasRealRlcsTitle) {
    eligible.push(STREAMERS[2]); // JohnnyBoi
  }
  return eligible;
}

/** Picks a believable 1v1 opponent for a showmatch: JohnnyBoi's stage skews heavily toward real, named
 *  pros (that's the whole draw), Feer is a genuine mix, Shadow leans toward up-and-coming/filler names
 *  with the occasional pro dropping in. */
export function pickShowmatchOpponent(streamerId: StreamerId, currentYear: number): string {
  const pros = activeProPlayers(currentYear);
  const fillers = fillerLeaderboardNames();
  const randomPro = () => pros[Math.floor(Math.random() * pros.length)]?.name;
  const randomFiller = () => fillers[Math.floor(Math.random() * Math.min(30, fillers.length))];

  if (streamerId === "johnboi") return randomPro() ?? randomFiller() ?? "TBD";
  if (streamerId === "feer") return (Math.random() < 0.55 ? randomPro() : randomFiller()) ?? randomFiller() ?? "TBD";
  return (Math.random() < 0.2 ? randomPro() : randomFiller()) ?? randomFiller() ?? "TBD";
}
