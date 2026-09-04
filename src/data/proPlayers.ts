// A loose real-esports-history roster used to populate the top of the ladder (leaderboards, GC/SSL-tier
// AI opponents) with recognizable names instead of purely generic ones. `debutYear` is the year a player
// should start showing up in the sim as an established top-level threat, not their literal real-world
// pro debut, some names are intentionally held back a year or two if they were still "promising rookie"
// rather than "elite" at that point. A player who debuts in year N is available in every year >= N, same
// as real careers (a 2018 pro is still around in 2022), this list is never used before its debut year.

import { tierMinMmr, experienceGrowth, mmrEraInflation, realisticOneVOneMmr, type RankEra } from "./rankSystem";
export { experienceGrowth };
import type { QueueMode } from "./mockSave";

export type ProRegion = "NA" | "EU" | "OCE" | "SAM" | "MENA" | "APAC" | "SSA";

export interface ProPlayer {
  name: string;
  region: ProRegion;
  debutYear: number;
}

export const PRO_PLAYERS: ProPlayer[] = [
  // 2017 - early modern RLCS era
  { name: "GarrettG", region: "NA", debutYear: 2017 },
  { name: "jstn.", region: "NA", debutYear: 2017 },
  { name: "SquishyMuffinz", region: "NA", debutYear: 2017 },
  { name: "Torment", region: "NA", debutYear: 2017 },
  { name: "Gimmick", region: "NA", debutYear: 2017 },
  { name: "Kronovi", region: "NA", debutYear: 2017 },
  { name: "Rizzo", region: "NA", debutYear: 2017 },
  { name: "JKnaps", region: "NA", debutYear: 2017 },
  { name: "Fireburner", region: "NA", debutYear: 2017 },
  { name: "Jacob", region: "NA", debutYear: 2017 },
  { name: "Lethamyr", region: "NA", debutYear: 2017 },
  { name: "Chicago", region: "NA", debutYear: 2017 },

  { name: "Kaydop", region: "EU", debutYear: 2017 },
  { name: "Turbopolsa", region: "EU", debutYear: 2017 },
  { name: "ViolentPanda", region: "EU", debutYear: 2017 },
  { name: "Fairy Peak!", region: "EU", debutYear: 2017 },
  { name: "Kuxir97", region: "EU", debutYear: 2017 },
  { name: "Miztik", region: "EU", debutYear: 2017 },
  { name: "Paschy90", region: "EU", debutYear: 2017 },
  { name: "Deevo", region: "EU", debutYear: 2017 },
  { name: "Bluey", region: "EU", debutYear: 2017 },
  { name: "Remkoe", region: "EU", debutYear: 2017 },
  { name: "al0t", region: "EU", debutYear: 2017 },
  { name: "Yukeo", region: "EU", debutYear: 2017 },

  { name: "Torsos", region: "OCE", debutYear: 2017 },
  { name: "Drippay", region: "OCE", debutYear: 2017 },
  { name: "CJCJ", region: "OCE", debutYear: 2017 },
  { name: "Kamii", region: "OCE", debutYear: 2017 },
  { name: "Turtle", region: "OCE", debutYear: 2017 },
  { name: "Jake", region: "OCE", debutYear: 2017 },

  // 2018
  { name: "Arsenal", region: "NA", debutYear: 2018 },
  { name: "Sypical", region: "NA", debutYear: 2018 },
  { name: "Mist", region: "NA", debutYear: 2018 },
  { name: "Ayjacks", region: "NA", debutYear: 2018 },
  { name: "AyyJayy", region: "NA", debutYear: 2018 },
  { name: "Wonder", region: "NA", debutYear: 2018 },

  { name: "Alpha54", region: "EU", debutYear: 2018 },
  { name: "AztraL", region: "EU", debutYear: 2018 },
  { name: "Scrub Killa", region: "EU", debutYear: 2018 },
  { name: "Metsa", region: "EU", debutYear: 2018 },
  { name: "Kassio", region: "EU", debutYear: 2018 },
  { name: "Speed", region: "EU", debutYear: 2018 },
  { name: "FlamE", region: "EU", debutYear: 2018 },

  { name: "Fever", region: "OCE", debutYear: 2018 },
  { name: "Siki", region: "OCE", debutYear: 2018 },
  { name: "Julz", region: "OCE", debutYear: 2018 },
  { name: "Express", region: "OCE", debutYear: 2018 },

  { name: "caard", region: "SAM", debutYear: 2018 },
  { name: "caioTG1", region: "SAM", debutYear: 2018 },
  { name: "Math", region: "SAM", debutYear: 2018 },

  // 2019
  { name: "Firstkiller", region: "NA", debutYear: 2019 },
  { name: "Atomic", region: "NA", debutYear: 2019 },
  { name: "Shock", region: "NA", debutYear: 2019 },
  { name: "Percy", region: "NA", debutYear: 2019 },
  { name: "Memory", region: "NA", debutYear: 2019 },

  { name: "Monkey Moon", region: "EU", debutYear: 2019 },
  { name: "Extra", region: "EU", debutYear: 2019 },
  { name: "Marc_by_8", region: "EU", debutYear: 2019 },
  { name: "Archie", region: "EU", debutYear: 2019 },
  { name: "Joreuz", region: "EU", debutYear: 2019 },
  { name: "ApparentlyJack", region: "EU", debutYear: 2019 },
  { name: "Kash", region: "EU", debutYear: 2019 },

  { name: "Brad", region: "SAM", debutYear: 2019 },
  { name: "Aztromic", region: "SAM", debutYear: 2019 },
  { name: "Sadddy", region: "SAM", debutYear: 2019 },

  { name: "Amphis", region: "OCE", debutYear: 2019 },
  { name: "Decka", region: "OCE", debutYear: 2019 },
  { name: "Shad", region: "OCE", debutYear: 2019 },

  // 2020 - mechanical explosion
  { name: "BeastMode", region: "NA", debutYear: 2020 },
  { name: "Chronic", region: "NA", debutYear: 2020 },
  { name: "Lj", region: "NA", debutYear: 2020 },
  { name: "Retals", region: "NA", debutYear: 2020 },
  { name: "Dreaz", region: "NA", debutYear: 2020 },
  { name: "Aqua", region: "NA", debutYear: 2020 },
  { name: "Comm", region: "NA", debutYear: 2020 },
  { name: "MaJicBear", region: "NA", debutYear: 2020 },

  { name: "Seikoo", region: "EU", debutYear: 2020 },
  { name: "Rise", region: "EU", debutYear: 2020 },
  { name: "Vatira", region: "EU", debutYear: 2020 },
  { name: "Atow", region: "EU", debutYear: 2020 },
  { name: "Joyo", region: "EU", debutYear: 2020 },
  { name: "Noly", region: "EU", debutYear: 2020 },
  { name: "Itachi", region: "EU", debutYear: 2020 },
  { name: "ExoTiiK", region: "EU", debutYear: 2020 },
  { name: "Stake", region: "EU", debutYear: 2020 },

  { name: "Ahmad", region: "MENA", debutYear: 2020 },
  { name: "oKhaliD", region: "MENA", debutYear: 2020 },
  { name: "TRK511", region: "MENA", debutYear: 2020 },
  { name: "Nwpo", region: "MENA", debutYear: 2020 },
  { name: "Rw9", region: "MENA", debutYear: 2020 },
  { name: "Kiileerrz", region: "MENA", debutYear: 2020 },
  { name: "Fahad", region: "MENA", debutYear: 2020 },
  { name: "Senzo", region: "MENA", debutYear: 2020 },
  { name: "Venom", region: "MENA", debutYear: 2022 },
  { name: "Sigms", region: "MENA", debutYear: 2022 },
  { name: "Furlashh", region: "MENA", debutYear: 2022 },

  // 2021 - global expansion generation
  { name: "Daniel", region: "NA", debutYear: 2021 },
  { name: "2Piece", region: "NA", debutYear: 2021 },
  { name: "Wahvey", region: "NA", debutYear: 2021 },

  { name: "Juicy", region: "EU", debutYear: 2021 },
  { name: "Oski", region: "EU", debutYear: 2021 },
  { name: "crr", region: "EU", debutYear: 2021 },

  { name: "yanxnz", region: "SAM", debutYear: 2021 },
  { name: "Lostt", region: "SAM", debutYear: 2021 },
  { name: "kv1", region: "SAM", debutYear: 2021 },
  { name: "DRUFINHO", region: "SAM", debutYear: 2021 },
  { name: "nxghtt", region: "SAM", debutYear: 2021 },

  { name: "Superlachie", region: "OCE", debutYear: 2021 },
  { name: "bananahead", region: "OCE", debutYear: 2021 },
  { name: "Freakii", region: "OCE", debutYear: 2020 },

  { name: "Realize", region: "APAC", debutYear: 2021 },
  { name: "Misty", region: "APAC", debutYear: 2021 },
  { name: "Maxeew", region: "APAC", debutYear: 2021 },
  { name: "LCT", region: "APAC", debutYear: 2021 },
  { name: "Mango", region: "APAC", debutYear: 2021 },
  { name: "Bambii", region: "APAC", debutYear: 2021 },
  { name: "ballerrees", region: "APAC", debutYear: 2022 },
  { name: "OLPiX", region: "APAC", debutYear: 2022 },
  { name: "Burn", region: "APAC", debutYear: 2022 },
  { name: "mikan", region: "APAC", debutYear: 2022 },

  { name: "2Die4", region: "SSA", debutYear: 2021 },
  { name: "Snowyy", region: "SSA", debutYear: 2021 },
  { name: "African", region: "SSA", debutYear: 2021 },
  { name: "Rage", region: "SSA", debutYear: 2021 },
  { name: "Tox", region: "SSA", debutYear: 2021 },
  { name: "Lachlan", region: "SSA", debutYear: 2021 },
  { name: "Beeyu", region: "SSA", debutYear: 2022 },
  { name: "Nitrous", region: "SSA", debutYear: 2022 },
  { name: "Skillz", region: "SSA", debutYear: 2022 },
  { name: "Darth", region: "SSA", debutYear: 2023 },

  // 2022 - new superstar era
  { name: "Acronik", region: "EU", debutYear: 2022 },
  { name: "Radosin", region: "EU", debutYear: 2022 },
  { name: "Saizen", region: "EU", debutYear: 2022 },
  { name: "Nass", region: "EU", debutYear: 2022 },
  { name: "Dralii", region: "EU", debutYear: 2022 },

  { name: "swiftt", region: "SAM", debutYear: 2022 },

  // 2023 - Zen era
  { name: "Zen", region: "EU", debutYear: 2023 },
  { name: "Reveal", region: "NA", debutYear: 2023 },
  { name: "Scrzbbles", region: "NA", debutYear: 2023 },

  // 2024
  { name: "Growlii", region: "EU", debutYear: 2024 },
  { name: "Rezears", region: "EU", debutYear: 2024 },
  { name: "Stizzy", region: "EU", debutYear: 2024 },
  { name: "Tehqoz", region: "EU", debutYear: 2024 },
  { name: "Zach", region: "NA", debutYear: 2024 },
  { name: "Diaz", region: "SAM", debutYear: 2024 },
  { name: "Laucha", region: "SAM", debutYear: 2023 },
  { name: "Kaka", region: "OCE", debutYear: 2024 },
  { name: "gus", region: "OCE", debutYear: 2024 },
  { name: "Fiberr", region: "OCE", debutYear: 2023 },

  // 2025+
  { name: "Abdullah", region: "MENA", debutYear: 2025 },
  { name: "Ghaazi", region: "MENA", debutYear: 2025 },
  { name: "Twiz", region: "MENA", debutYear: 2026 },
  { name: "Faisal", region: "MENA", debutYear: 2023 },
  { name: "oVaMPiERz", region: "MENA", debutYear: 2023 },
];

/** Every pro whose debut year has passed by `currentYear`, real careers only run forward. */
export function activeProPlayers(currentYear: number): ProPlayer[] {
  return PRO_PLAYERS.filter((p) => p.debutYear <= currentYear);
}

export function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Deterministic per name so it's stable across reloads without persisting it separately. Most pros
 *  grind Doubles as their main ranked ladder (closest practice to real competitive), a rare minority
 *  grind Duel instead, matching "some pros are better at 2v2, rarely the other way around". */
export function proPrimaryQueue(name: string): "1v1" | "2v2" {
  return hashString(name) % 100 < 15 ? "1v1" : "2v2";
}

/** A 2v2-main pro who ALSO grinds 1v1 seriously, real RL has plenty of these (duel doubles as their solo
 *  practice, not just an afterthought), so their "secondary" queue barely reads as secondary at all,
 *  matching "some pros balance 2v2 and 1v1, both at higher levels" rather than everyone but a rare 1v1-
 *  main having a clearly weaker duel. Deterministic per name, roughly a third of 2v2-mains qualify. */
export function isDualThreatPro(name: string): boolean {
  return hashString(name + "#dual") % 100 < 35;
}

function jitter(base: number, spread: number): number {
  return Math.round(base * (1 - spread + Math.random() * spread * 2));
}

/** A rare handful of pros are generational talents (think Zen-style hype) whose ceiling runs well past
 *  the rest of the pack, on top of the normal experience curve. Deterministic per name. */
export function isGenerationalTalent(name: string): boolean {
  return hashString(name + "!") % 100 < 6;
}

/** Seeds a pro's starting MMR per queue: strong in their primary queue (scaling with experience, no hard
 *  ceiling, a rare "generational talent" roll pushes some outliers well past the pack), decent but
 *  clearly behind in their secondary queue, and deliberately unremarkable in 3v3, since real pros mostly
 *  don't grind ranked 3s, their team practice happens in private scrims instead. This is only the STARTING
 *  point, live MMR moves from there as matches (including against the human player) are played. */
export function seedProMmr(pro: ProPlayer, era: RankEra, currentYear: number): Record<QueueMode, number> {
  const topAnchor = era === "modern" ? "ssl" : "grand_champion";
  const experienceYears = Math.max(0, currentYear - pro.debutYear);
  const primary = proPrimaryQueue(pro.name);
  const secondary: "1v1" | "2v2" = primary === "2v2" ? "1v1" : "2v2";

  // MMR realistically self-limits (there's only so far above the pack anyone can climb before running
  // out of opponents), so this stays much tighter than the uncapped skill stats: a small talent bump,
  // not a second growth curve.
  const talentBonus = isGenerationalTalent(pro.name) ? 60 + Math.random() * 140 : 0;

  // The jump in real RL's actual MMR scale after the Sept 2020 relaunch was substantial (far bigger
  // playerbase, higher mechanical ceiling), legacy pros cluster not far above the era's top-tier floor
  // (~1700-1900 in 2s). Modern pros start a bit clear of it and keep climbing further clear of it every
  // year after that (mmrEraInflation), matching real RL's actual top-end MMR creep — a few years post-
  // relaunch, 2s top-50 typically runs 2300-2500+, not just barely above the SSL floor.
  const baseOffset = era === "modern" ? 300 + mmrEraInflation(currentYear, era) : 40;

  const primaryMmr = jitter(
    tierMinMmr(topAnchor, era, primary) + baseOffset + experienceGrowth(experienceYears, 20, 6000) + talentBonus,
    0.05
  );
  // The secondary-queue discount is smaller when 1v1 is the secondary: a pro who mains 2v2 still plays
  // duel plenty (most pros do, it's the closest thing to solo practice), just not as their main grind, so
  // their 1v1 shouldn't fall off nearly as hard as their neglected 3v3 does. A dual-threat pro barely
  // takes the discount at all, both queues sit at a genuinely high level for them.
  const secondaryDiscount = secondary === "1v1" ? (isDualThreatPro(pro.name) ? 30 : 150) : 250;
  const secondaryMmr = jitter(
    Math.max(0, tierMinMmr(topAnchor, era, secondary) - secondaryDiscount + experienceGrowth(experienceYears, 15, 6000)),
    0.08
  );
  const grindedThirdMmr = jitter(
    tierMinMmr("grand_champion", era, "3v3") + experienceGrowth(experienceYears, 10, 6000) + mmrEraInflation(currentYear, era) * 0.4,
    0.15
  );

  const result = {
    [primary]: primaryMmr,
    [secondary]: secondaryMmr,
    "3v3": grindedThirdMmr,
  } as Record<QueueMode, number>;

  // 1v1's real population is far smaller than 2s, so a pro who ISN'T taking duel seriously stays held
  // back near the floor — but a genuine 1v1 specialist (it's literally their primary queue) climbs the
  // exact same uncapped way a 2v2/3v3 primary already does above, nothing here should artificially flatten
  // them back down near the floor just for being good at 1v1. A 2v2-main "dual threat" (see
  // isDualThreatPro, real RL has plenty of these — duel doubles as serious secondary practice, not an
  // afterthought) sits in between: a real, meaningfully high 1v1 MMR that can clear the leaderboard floor
  // on its own, just not quite primary-level. Without this split, EVERY pro's 1v1 (including actual 1v1
  // mains) used to get capped at floor+200 regardless, which let "mid"-band ranked grinders (who have no
  // such queue-specific cap) casually out-rank literally every pro in 1v1, leaving the 1v1 leaderboard
  // almost entirely nameless grinders instead of recognizable pros.
  if (primary !== "1v1") {
    const dualThreat = isDualThreatPro(pro.name);
    const oneV1Ceiling = tierMinMmr(topAnchor, era, "1v1") + (dualThreat ? 550 + mmrEraInflation(currentYear, era) * 0.5 : 200);
    result["1v1"] = Math.min(result["1v1"], oneV1Ceiling);
  }
  // Real RL's actual highest-ever recorded 1v1 MMR is 1814 - applies regardless of whether 1v1 is this
  // pro's primary queue, see realisticOneVOneMmr's own doc comment.
  result["1v1"] = realisticOneVOneMmr(result["1v1"]);

  return result;
}
