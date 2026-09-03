// Tournament definitions: RLCS is the recurring, region-locked backbone (a separate regional qualifier
// per region, each its own self-contained bracket, all belonging to one numbered RLCS season), plus a
// couple of smaller one-off/globally-open events (EWC, ELEAGUE) that happen at their own fixed point in
// the calendar year, not tied to the RLCS season cadence. 3v3 is real RLCS's actual format and the only
// one built here for now, see the design chat: 2v2 isn't introduced as an RLCS discipline until 2023, 1v1
// stays ranked-only.

import type { StageConfig, TournamentTeam } from "./tournamentFormats";
import { activeProPlayers, experienceGrowth, isGenerationalTalent, hashString, type ProRegion } from "./proPlayers";
import { regionalGrinderRoster } from "./regionalGrinders";
import { LB_NAMES, type Region } from "./mockSave";
import type { TitleEntry, TitleGlow } from "./seasons";
import type { SimDate } from "./dateUtils";
import { addDays } from "./dateUtils";
import type { RankEra } from "./rankSystem";
import { useProLeaderboardStore } from "@/store/useProLeaderboardStore";
import { useRegionalRosterStore } from "@/store/useRegionalRosterStore";
import { estimateGameSenseForMmr, computeOverallRating } from "./matchSim";
import { meetsOrgRankRequirement } from "./orgs";
import { FOUNDATION_LABELS, type FoundationCategory } from "./mechanics";

export type TournamentKind = "rlcs_regional" | "ewc" | "eleague" | "rlcs_1v1_regional" | "rlcs_major" | "rlcs_worlds" | "rlrs_regional";

/** Majors/Worlds are LAN events from this RLCS season onward, online before it — regionals/Rival Series/1v1
 *  regionals are always online, real RLCS never runs those as LAN. A simple year cutoff rather than
 *  modeling the COVID-era online gap real RLCS actually had, matching "some point it becomes a real, in-
 *  person LAN, and stays that way." */
export const RLCS_LAN_CUTOFF_SEASON = 2020;

export function isLanEvent(kind: TournamentKind, seasonNumber: number): boolean {
  if (kind !== "rlcs_major" && kind !== "rlcs_worlds") return false;
  return seasonNumber >= RLCS_LAN_CUTOFF_SEASON;
}

/** RLCS's real-life structure changed shape over the years, not just its production value: 2015-2019 had
 *  no "Major" concept at all (a regional's champion went straight to one LAN World Championship), plus a
 *  real lower-tier developmental league (Rival Series) beneath the main bracket; 2020-2022 (RLCS X) is the
 *  Regional -> Major -> Worlds shape this sim already models; 2023+ carries the same shape forward (2v2
 *  becoming a real RLCS discipline that year is a separate, still-unbuilt follow-up, not part of this). */
export type RlcsStructureEra = "early" | "mid" | "modern";
export function rlcsStructureEra(year: number): RlcsStructureEra {
  if (year < 2020) return "early";
  if (year <= 2022) return "mid";
  return "modern";
}

/** 1v1 doesn't exist as its own RLCS discipline before this season (real RLCS added 1v1 in 2025) — 3v3 is
 *  the only RLCS discipline until then. Real 2v2 wasn't added until later still (2026+) and isn't built at
 *  all yet — a separate future addition. */
export const RLCS_1V1_INTRODUCED_SEASON = 2025;

export const RLCS_REGIONS: ProRegion[] = ["NA", "EU", "SAM", "OCE", "MENA"];

export const REGION_LABELS: Record<ProRegion, string> = {
  NA: "North America",
  EU: "Europe",
  OCE: "Oceania",
  SAM: "South America",
  MENA: "MENA",
  APAC: "APAC",
  SSA: "SSA",
};

/** Maps the player's own save region (mockSave.ts's `Region`, used for their profile) to the tournament
 *  system's `ProRegion`, so we can tell whether a given RLCS regional qualifier is the one they're
 *  eligible to enter. */
export function saveRegionToProRegion(region: Region): ProRegion {
  const map: Record<Region, ProRegion> = {
    north_america: "NA",
    europe: "EU",
    oceania: "OCE",
    south_america: "SAM",
    mena: "MENA",
    asia_pacific: "APAC",
  };
  return map[region];
}

// Org names/tags moved to their own file (orgNames.ts) to avoid a circular import — see that file's header
// comment. Re-exported here so every existing consumer importing them from "@/data/tournaments" is unaffected.
export { ORG_NAMES, ORG_ABBREVIATIONS, orgTagForOrgName } from "./orgNames";
import { ORG_NAMES } from "./orgNames";

/** Deterministic-ish filler org name pool for teams that couldn't be filled with real pros (mostly early
 *  years before enough pros have debuted, or amateur open-bracket teams). */
const FILLER_ORG_SUFFIXES = ["Esports", "Gaming", "Academy", ".gg", "Athletics", "Collective"];

function hashPick<T>(arr: T[], seed: number): T {
  return arr[Math.abs(seed) % arr.length];
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Pro vs. amateur power needs a real gap, not just a nudge: RLCS qualifiers are a pro-dominated event,
// real orgs should reliably steamroll amateur filler teams round after round rather than a coinflip, so
// the field that survives into later stages is actually pro-heavy, not still a random mix.
const PRO_TEAM_POWER_BASE = 1500;
const AMATEUR_TEAM_POWER_MIN = 500;
const AMATEUR_TEAM_POWER_SPREAD = 200;

interface EligibleRealPlayer {
  name: string;
  power: number;
}

// Orgs scout off the SAME queue the player's own org track uses: 2v2, real esports orgs treat it as the
// baseline read on a prospect, 3v3 team results follow from individual quality more than the reverse (see
// data/orgs.ts's own doc comment — "the org track only ever cares about 2v2"). A player's real, persisted
// stats (Game Sense/Mechanical Consistency, blended into one Overall Rating the same way the Stats screen
// does) are the main scouting signal, with their current 2v2 MMR folded in as a smaller supporting factor —
// mirrors the player's own two-stage org-eligibility system (a hard MMR floor gate, then a stats-driven
// score) closely enough that the exact same floor (`meetsOrgRankRequirement`) applies here too: an AI who
// wouldn't themselves qualify for org scouting doesn't qualify for a real RLCS roster spot either.
const RLCS_ELIGIBILITY_RATING_WEIGHT = 0.7;
const RLCS_ELIGIBILITY_MMR_WEIGHT = 0.3;

function rlcsPowerFromStats(mmr2v2: number, gameSense2v2: number, mechanicalConsistency2v2: number, era: RankEra, currentYear: number): number {
  const uniformFoundation = Object.fromEntries(
    (Object.keys(FOUNDATION_LABELS) as FoundationCategory[]).map((cat) => [cat, gameSense2v2])
  ) as Record<FoundationCategory, number>;
  const overallRating = computeOverallRating(gameSense2v2, mechanicalConsistency2v2, uniformFoundation);
  // Expresses MMR on the SAME rating scale as Game Sense/Mechanical Consistency (the exact curve the
  // leaderboard stores themselves use to derive target stats from MMR), so blending the two actually
  // means something instead of one term drowning out the other.
  const mmrAsRating = estimateGameSenseForMmr(mmr2v2, era, "2v2", currentYear);
  return overallRating * RLCS_ELIGIBILITY_RATING_WEIGHT + mmrAsRating * RLCS_ELIGIBILITY_MMR_WEIGHT;
}

/** Every player legitimately good enough to be on a real RLCS team this year: active pros from the region,
 *  plus that region's `mid`-band ranked grinders (never `low` band — those read as ranked-ladder regulars,
 *  not remotely pro-caliber) — never a generic filler name, and gated by the same 2v2 MMR floor the
 *  player's own org track requires. This is the entire "no filler teams" fix: a thin region (APAC/SSA) just
 *  fields fewer, entirely real teams instead of padding the field out. */
function eligibleRealPlayersForRegion(region: ProRegion, currentYear: number, era: RankEra, currentDate: SimDate, seasonStartDate: SimDate): EligibleRealPlayer[] {
  const candidates = [
    ...activeProPlayers(currentYear).filter((p) => p.region === region).map((p) => p.name),
    ...regionalGrinderRoster(region, currentYear).filter((g) => g.band === "mid").map((g) => g.name),
  ];
  const eligible: EligibleRealPlayer[] = [];
  for (const name of candidates) {
    const pro = activeProPlayers(currentYear).find((p) => p.name === name);
    const mmr2v2 = pro
      ? useProLeaderboardStore.getState().getMmr(name, "2v2", era, currentYear, currentDate, seasonStartDate)
      : useRegionalRosterStore.getState().getMmr(name, region, "2v2", era, currentYear, currentDate, seasonStartDate);
    if (!meetsOrgRankRequirement(era, mmr2v2)) continue;
    const stats = pro
      ? useProLeaderboardStore.getState().getStats(name, "2v2", era, currentYear, currentDate, seasonStartDate)
      : useRegionalRosterStore.getState().getStats(name, region, "2v2", era, currentYear, currentDate, seasonStartDate);
    eligible.push({ name, power: rlcsPowerFromStats(mmr2v2, stats.gameSense, stats.mechanicalConsistency, era, currentYear) });
  }
  return eligible;
}

/** Nudges a power-sorted list without fully scrambling it: each adjacent pair has a deterministic chance to
 *  swap, so the overall best-to-worst order mostly holds (the actual top players typically end up on the
 *  actual top team) without every season producing a razor-exact ranking. A second, longer-range pass gives
 *  a real (but minority) chance that one of the region's actual top 3 gets pulled further down the order
 *  entirely — the "already under contract elsewhere" case — rather than the top 3 clustering onto one team
 *  every single season. */
function jitterRankOrder<T>(sortedDesc: T[], seedKey: string): T[] {
  const arr = [...sortedDesc];
  for (let i = 0; i < arr.length - 1; i++) {
    const roll = hashString(`${seedKey}#jitter#${i}`) % 100;
    if (roll < 30) [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
  }
  const topSwapRange = Math.min(4, arr.length - 1);
  for (let i = 0; i < 3 && i < arr.length - 1; i++) {
    const roll = hashString(`${seedKey}#topjitter#${i}`) % 100;
    if (roll < 18) {
      const offset = 2 + (hashString(`${seedKey}#topjitter_dist#${i}`) % (topSwapRange - 1 || 1));
      const j = Math.min(i + offset, arr.length - 1);
      if (j > i) [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }
  return arr;
}

function fillWithAmateurTeams(teams: TournamentTeam[], region: ProRegion, fieldSize: number, idPrefix: string): TournamentTeam[] {
  let teamIdx = teams.length;
  while (teams.length < fieldSize) {
    const seed = teamIdx * 7919 + idPrefix.length;
    const namePick = LB_NAMES[Math.abs(seed) % LB_NAMES.length];
    const suffix = hashPick(FILLER_ORG_SUFFIXES, seed);
    teams.push({
      id: `${idPrefix}_${teamIdx}`,
      name: `${namePick} ${suffix}`,
      region,
      power: Math.round(AMATEUR_TEAM_POWER_MIN + Math.random() * AMATEUR_TEAM_POWER_SPREAD),
      players: [`${namePick}1`, `${namePick}2`, `${namePick}3`],
    });
    teamIdx++;
  }
  return teams;
}

const ALL_PRO_REGIONS: ProRegion[] = ["NA", "EU", "OCE", "SAM", "MENA", "APAC", "SSA"];

/** Builds a region's real, season-locked RLCS field: every team is real active pros and/or mid-band ranked
 *  grinders from that region, grouped into teams of 3 and named after real-flavor orgs (`ORG_NAMES`) — no
 *  amateur/filler padding at all, a thin region just fields fewer teams. Deterministic per
 *  `(region, seasonNumber, resetSeed)` (see `seededShuffle`) — call this again for the same three inputs
 *  any time this season and the SAME roster comes back, which is what "locked for the season" means at the
 *  data layer: nothing has to actively enforce the lock, there's just nothing that would change it. */
export function generateTeamsForRegion(region: ProRegion, currentYear: number, seasonNumber: number, resetSeed: number, idPrefix: string, era: RankEra, currentDate: SimDate, seasonStartDate: SimDate): TournamentTeam[] {
  const byPower = eligibleRealPlayersForRegion(region, currentYear, era, currentDate, seasonStartDate).sort((a, b) => b.power - a.power);
  const eligible = jitterRankOrder(byPower, `${region}-${seasonNumber}-${resetSeed}`);
  // Org names are used in their listed order (not shuffled) — ORG_NAMES already lists each region's most
  // recognizable org first, so team 0 (which gets the top of the power-sorted roster) is consistently that
  // region's real premier org, exactly the "top AI typically land on the top team" realism this is for.
  const orgNames = ORG_NAMES[region] ?? [];
  const teamCount = Math.min(Math.floor(eligible.length / 3), orgNames.length);
  const teams: TournamentTeam[] = [];
  for (let i = 0; i < teamCount; i++) {
    const roster = eligible.slice(i * 3, i * 3 + 3);
    const power = Math.round(roster.reduce((sum, p) => sum + p.power, 0) / roster.length);
    teams.push({ id: `${idPrefix}_${i}`, name: orgNames[i], region, power, players: roster.map((p) => p.name) });
  }
  return teams;
}

/** Reconciles a generated team list with the player's own signed org, if any: `generateTeamsForRegion`/
 *  `generateGlobalTeams` have no notion of the player at all, so the org the player actually signed with
 *  still lists its original 3 real AI names verbatim — including whichever one the player's own tryout
 *  replaced (see useSaveStore.ts's pickRealOrgTeam, which excludes exactly one of the 3 to make room for
 *  the player). Called wherever those generated rosters are DISPLAYED (never inside the generators
 *  themselves, which must stay pure/deterministic) so the player's org always reads as
 *  [player, teammate, teammate] instead of the stale pre-signing trio. Matches by org name plus "does this
 *  team contain both contract teammates" rather than by id, since the generated ids aren't stable across
 *  separate calls/instances the way the roster contents are. */
export function applyPlayerOrgOverride<T extends TournamentTeam>(
  teams: T[],
  orgContract: { orgName: string; teammates: [string, string] } | null,
  playerName: string
): T[] {
  if (!orgContract) return teams;
  return teams.map((team) => {
    if (team.name !== orgContract.orgName) return team;
    if (!orgContract.teammates.every((tm) => team.players.includes(tm))) return team;
    return { ...team, players: [playerName, ...orgContract.teammates] };
  });
}

/** WORK IN PROGRESS, currently unreachable — EWC/ELEAGUE aren't scheduled at all right now (see
 *  buildSeasonSchedule's doc comment), so nothing calls this. Kept for when they're rebuilt around their
 *  real structure (a per-region squad, not club orgs) rather than deleted outright; whatever replaces it
 *  should NOT reuse this "org-vs-org global bracket" shape at all.
 *  Builds a globally-open real field (EWC, ELEAGUE): every region's own ALREADY-real, season-locked teams
 *  (the exact same team objects that region's regional bracket uses, see `generateTeamsForRegion`) enter
 *  as themselves — never reshuffled into a fresh cross-region "best XI", real orgs bring their own existing
 *  roster to a global event, they don't dissolve into a brand-new dream team. Interleaved one rank at a
 *  time across regions (every region's own #1 team first, then every region's #2, ...) so the field is a
 *  genuine mix of top teams from everywhere rather than skewed toward whichever region has the deepest
 *  player pool. */
export function generateGlobalTeams(currentYear: number, seasonNumber: number, resetSeed: number, idPrefix: string, era: RankEra, currentDate: SimDate, seasonStartDate: SimDate): TournamentTeam[] {
  const perRegionTeams = ALL_PRO_REGIONS.map((r) => generateTeamsForRegion(r, currentYear, seasonNumber, resetSeed, `${idPrefix}_src_${r}`, era, currentDate, seasonStartDate));
  const maxTeamsInAnyRegion = Math.max(0, ...perRegionTeams.map((t) => t.length));
  const teams: TournamentTeam[] = [];
  for (let rank = 0; rank < maxTeamsInAnyRegion; rank++) {
    for (const regionTeams of perRegionTeams) {
      const team = regionTeams[rank];
      if (team) teams.push({ ...team, id: `${idPrefix}_${teams.length}` });
    }
  }
  return teams;
}

// --- 1v1 individual-entrant RLCS: players register solo, not as a 3-person org. Reuses the exact same
// bracket-format engine (a "team" of one is just... one player), only the entrant generation differs. ---

export const RLCS_1V1_REGIONS: ProRegion[] = ["NA", "EU", "SAM", "OCE", "MENA", "APAC", "SSA"];

/** Builds a regional field of solo entrants: real active pros from that region fill in first (one per
 *  slot, no grouping), everything else is a generic filler player at amateur strength. */
export function generateSoloEntrantsForRegion(region: ProRegion, currentYear: number, fieldSize: number, idPrefix: string): TournamentTeam[] {
  const pros = shuffle(activeProPlayers(currentYear).filter((p) => p.region === region));
  const teams: TournamentTeam[] = pros.slice(0, fieldSize).map((pro, i) => {
    const experienceYears = Math.max(0, currentYear - pro.debutYear);
    const talentBonus = isGenerationalTalent(pro.name) ? 120 : 0;
    const power = PRO_TEAM_POWER_BASE + experienceGrowth(experienceYears, 40, 5000) + talentBonus;
    return {
      id: `${idPrefix}_${i}`,
      name: pro.name,
      region,
      power: Math.round(power * (0.95 + Math.random() * 0.1)),
      players: [pro.name],
    };
  });
  let i = teams.length;
  while (teams.length < fieldSize) {
    const seed = i * 7919 + idPrefix.length;
    const namePick = `${LB_NAMES[Math.abs(seed) % LB_NAMES.length]}${i}`;
    teams.push({
      id: `${idPrefix}_${i}`,
      name: namePick,
      region,
      power: Math.round(AMATEUR_TEAM_POWER_MIN + Math.random() * AMATEUR_TEAM_POWER_SPREAD),
      players: [namePick],
    });
    i++;
  }
  return teams;
}

export const RLCS_1V1_REGIONAL_STAGES: StageConfig[] = [
  { format: "double_elim", label: "Regional Open", entrants: 64, advanceCount: 16, days: 2 },
  { format: "swiss", label: "Swiss Stage", entrants: 16, advanceCount: 8, days: 1 },
  { format: "single_elim", label: "Regional Playoffs", entrants: 8, advanceCount: 1, days: 1 },
];
export const RLCS_1V1_REGIONAL_FIELD_SIZE = 64;

// --- Rival Series (2015-2019 only): the real developmental league beneath RLCS proper, a lower-stakes
// on-ramp for teams that aren't ready for the main regional field yet. Deliberately amateur-only (no named
// pros), a smaller/quicker bracket than the main RLCS_OPEN_STAGES grind, and its champion is the one who
// earns a real promotion (a guaranteed slot in next season's actual regional, see useTournamentStore.ts). ---

export const RIVAL_SERIES_STAGES: StageConfig[] = [
  { format: "double_elim", label: "Rival Series Stage 1", entrants: 64, advanceCount: 16, days: 2 },
  { format: "single_elim", label: "Rival Series Playoffs", entrants: 16, advanceCount: 1, days: 1 },
];
export const RIVAL_SERIES_FIELD_SIZE = 64;

/** Builds a Rival Series field: entirely amateur/generic teams, no named real pros — this is the
 *  developmental tier, not a lesser showing from the same pro pool the main regional draws from. */
export function generateRivalSeriesTeamsForRegion(region: ProRegion, fieldSize: number, idPrefix: string): TournamentTeam[] {
  return fillWithAmateurTeams([], region, fieldSize, idPrefix);
}

interface MajorGroup {
  id: "major1" | "major2";
  location: string;
  regions: ProRegion[];
}

/** Major 1 runs in Europe with EU/SAM/APAC's regional champions, Major 2 runs in the US with NA/MENA/
 *  OCE/SSA's, matching the two-major structure described in the design chat. */
export const MAJOR_GROUPS: MajorGroup[] = [
  { id: "major1", location: "London", regions: ["EU", "SAM", "APAC"] },
  { id: "major2", location: "Las Vegas", regions: ["NA", "MENA", "OCE", "SSA"] },
];

export const MAJOR_STAGES: StageConfig[] = [{ format: "single_elim", label: "Major Bracket", entrants: 8, advanceCount: 1, days: 3 }];
export const WORLDS_STAGES: StageConfig[] = [{ format: "single_elim", label: "World Championship Final", entrants: 2, advanceCount: 1, days: 1 }];

/** Builds a small bracket directly from a fixed list of named entrants (major/worlds fields are built
 *  from regional/major champions rather than generated fresh, so this skips the pro-roster generation
 *  entirely and just wraps names into TournamentTeam records with a flat competitive power). */
export function entrantsFromNames(names: { name: string; region: ProRegion }[], idPrefix: string): TournamentTeam[] {
  return names.map((n, i) => ({
    id: `${idPrefix}_${i}`,
    name: n.name,
    region: n.region,
    power: Math.round(1400 + Math.random() * 300),
    players: [n.name],
  }));
}

// Every real competitive-tournament title (regionals, majors, worlds) glows aqua, distinct from the
// gold/red/white season-reward titles that come from ranked peak rank instead.
const RLCS_GLOW: TitleGlow = "aqua";

/** Title for a 1v1/3v3 regional placement: 1st is Regional Champion, 2nd-16th are Contenders, everyone
 *  else who reached the regional gets Challenger. This is just the SINGLE title matching the exact
 *  placement, see `regionalTitlesEarned` for the full cascade (a Champion also earned Contender and
 *  Challenger along the way and keeps all three as separate collectible titles). Real RLCS uses the exact
 *  same label text regardless of discipline (an org's 1v1 and 3v3 Regional Champion banners read
 *  identically), `discipline` only ever affects the id, so winning the same placement in a different
 *  discipline the same year is tracked as its own real, separate title rather than silently deduped away. */
export function regionalTitleFor(year: number, placement: number, discipline: "1v1" | "3v3" = "3v3"): TitleEntry {
  if (placement === 1) return { id: `rlcs_${year}_${discipline}_regional_champ`, label: `RLCS ${year} REGIONAL CHAMPION`, glow: RLCS_GLOW };
  if (placement <= 16) return { id: `rlcs_${year}_${discipline}_regional_contender`, label: `RLCS ${year} CONTENDER`, glow: RLCS_GLOW };
  return { id: `rlcs_${year}_${discipline}_regional_challenger`, label: `RLCS ${year} CHALLENGER`, glow: RLCS_GLOW };
}

/** Every regional title a given placement actually earned along the way, a Champion collects all three
 *  (Champion + Contender + Challenger), a Contender collects two, a Challenger just the one. */
export function regionalTitlesEarned(year: number, placement: number, discipline: "1v1" | "3v3" = "3v3"): TitleEntry[] {
  const titles: TitleEntry[] = [{ id: `rlcs_${year}_${discipline}_regional_challenger`, label: `RLCS ${year} CHALLENGER`, glow: RLCS_GLOW }];
  if (placement <= 16) titles.push({ id: `rlcs_${year}_${discipline}_regional_contender`, label: `RLCS ${year} CONTENDER`, glow: RLCS_GLOW });
  if (placement === 1) titles.push({ id: `rlcs_${year}_${discipline}_regional_champ`, label: `RLCS ${year} REGIONAL CHAMPION`, glow: RLCS_GLOW });
  return titles;
}

export function majorTitleFor(year: number, placement: number, location: string, discipline: "1v1" | "3v3" = "3v3"): TitleEntry {
  if (placement === 1) return { id: `rlcs_${year}_${discipline}_major_${location}_champ`, label: `RLCS ${year} ${location.toUpperCase()} MAJOR CHAMPION`, glow: RLCS_GLOW };
  return { id: `rlcs_${year}_${discipline}_major_${location}_contender`, label: `RLCS ${year} ${location.toUpperCase()} MAJOR CONTENDER`, glow: RLCS_GLOW };
}

export function majorTitlesEarned(year: number, placement: number, location: string, discipline: "1v1" | "3v3" = "3v3"): TitleEntry[] {
  const titles: TitleEntry[] = [{ id: `rlcs_${year}_${discipline}_major_${location}_contender`, label: `RLCS ${year} ${location.toUpperCase()} MAJOR CONTENDER`, glow: RLCS_GLOW }];
  if (placement === 1) titles.push({ id: `rlcs_${year}_${discipline}_major_${location}_champ`, label: `RLCS ${year} ${location.toUpperCase()} MAJOR CHAMPION`, glow: RLCS_GLOW });
  return titles;
}

export function worldsTitleFor(year: number, placement: number, discipline: "1v1" | "3v3" = "3v3"): TitleEntry {
  if (placement === 1) return { id: `rlcs_${year}_${discipline}_worlds_champ`, label: `RLCS ${year} WORLD CHAMPION`, glow: RLCS_GLOW };
  if (placement <= 8) return { id: `rlcs_${year}_${discipline}_worlds_elite`, label: `RLCS ${year} WORLD CHAMPIONSHIP ELITE`, glow: RLCS_GLOW };
  return { id: `rlcs_${year}_${discipline}_worlds_contender`, label: `RLCS ${year} WORLD CHAMPIONSHIP CONTENDER`, glow: RLCS_GLOW };
}

export function worldsTitlesEarned(year: number, placement: number, discipline: "1v1" | "3v3" = "3v3"): TitleEntry[] {
  const titles: TitleEntry[] = [{ id: `rlcs_${year}_${discipline}_worlds_contender`, label: `RLCS ${year} WORLD CHAMPIONSHIP CONTENDER`, glow: RLCS_GLOW }];
  if (placement <= 8) titles.push({ id: `rlcs_${year}_${discipline}_worlds_elite`, label: `RLCS ${year} WORLD CHAMPIONSHIP ELITE`, glow: RLCS_GLOW });
  if (placement === 1) titles.push({ id: `rlcs_${year}_${discipline}_worlds_champ`, label: `RLCS ${year} WORLD CHAMPION`, glow: RLCS_GLOW });
  return titles;
}

/** Rival Series (2015-2019 only, see `rlcsStructureEra`): real title text from the actual developmental
 *  league, distinct wording from the main RLCS cascade above since it's genuinely a lesser tier, not a
 *  reskinned regional. Top-16 (the field that survives Stage 1 into the single-elim playoffs) is Contender,
 *  same cutoff logic as the main regional's. */
export function rivalSeriesTitleFor(year: number, placement: number): TitleEntry {
  if (placement === 1) return { id: `rlrs_${year}_champ`, label: `RIVAL SERIES ${year} CHAMPION`, glow: RLCS_GLOW };
  if (placement <= 16) return { id: `rlrs_${year}_contender`, label: `RIVAL SERIES ${year} CONTENDER`, glow: RLCS_GLOW };
  return { id: `rlrs_${year}_challenger`, label: `RIVAL SERIES ${year} CHALLENGER`, glow: RLCS_GLOW };
}

export function rivalSeriesTitlesEarned(year: number, placement: number): TitleEntry[] {
  const titles: TitleEntry[] = [{ id: `rlrs_${year}_challenger`, label: `RIVAL SERIES ${year} CHALLENGER`, glow: RLCS_GLOW }];
  if (placement <= 16) titles.push({ id: `rlrs_${year}_contender`, label: `RIVAL SERIES ${year} CONTENDER`, glow: RLCS_GLOW });
  if (placement === 1) titles.push({ id: `rlrs_${year}_champ`, label: `RIVAL SERIES ${year} CHAMPION`, glow: RLCS_GLOW });
  return titles;
}

/** Dispatches to the right cascade by tournament kind, given only primitive fields (not the full
 *  TournamentInstance type, which lives in the store, to avoid a store->data circular import). Used both
 *  for granting the player's own title collection and for querying an AI/pro's real earned history. */
export function titlesEarnedForKind(
  kind: TournamentKind,
  year: number,
  placement: number,
  majorLocation: string | null,
  discipline: "1v1" | "3v3" = "3v3"
): TitleEntry[] {
  if (kind === "rlcs_regional" || kind === "rlcs_1v1_regional") return regionalTitlesEarned(year, placement, discipline);
  if (kind === "rlcs_major") return majorTitlesEarned(year, placement, majorLocation ?? "Major", discipline);
  if (kind === "rlcs_worlds") return worldsTitlesEarned(year, placement, discipline);
  if (kind === "rlrs_regional") return rivalSeriesTitlesEarned(year, placement);
  return [];
}

/** Real RLCS Open structure: a large Stage 1 field gets cut down by loss-count elimination, then Swiss,
 *  then GSL groups, then a playoff bracket that crowns the regional champion and sets final placements. */
export const RLCS_OPEN_STAGES: StageConfig[] = [
  { format: "double_elim", label: "Stage 1", entrants: 128, advanceCount: 32, days: 2 },
  { format: "swiss", label: "Swiss Stage", entrants: 32, advanceCount: 16, days: 1 },
  { format: "gsl_group", label: "Group Stage", entrants: 16, advanceCount: 8, days: 1 },
  { format: "single_elim", label: "Playoffs", entrants: 8, advanceCount: 1, days: 2 },
];
export const RLCS_OPEN_FIELD_SIZE = 128;

/** WORK IN PROGRESS, currently unused — see buildSeasonSchedule's doc comment. Kept in place for when
 *  EWC/ELEAGUE get their real data model (a per-region squad + a qualifier bracket for a spot on it,
 *  rather than club orgs playing each other) instead of being deleted outright. */
export const EWC_STAGES: StageConfig[] = [{ format: "single_elim", label: "Bracket", entrants: 32, advanceCount: 1, days: 3 }];
export const EWC_FIELD_SIZE = 32;
export const ELEAGUE_STAGES: StageConfig[] = [{ format: "single_elim", label: "Bracket", entrants: 16, advanceCount: 1, days: 2 }];
export const ELEAGUE_FIELD_SIZE = 16;

export interface ScheduledTournament {
  id: string;
  kind: TournamentKind;
  label: string;
  region: ProRegion | null; // null = globally open, not region-locked
  startDate: SimDate;
  stages: StageConfig[];
  fieldSize: number;
}

/** RLCS regionals are staggered across the season so only one region's qualifier is "live" (in its
 *  Stage 1 entry window) at a time, each qualifier's stages take about a week, staggering by 14 days
 *  leaves a gap between regions. */
const RLCS_REGION_STAGGER_DAYS = 10;

/** RLCS runs on its own year-long competitive calendar, entirely separate from the player's ranked
 *  ladder season (which can reset on its own unrelated cadence). One RLCS season = one calendar year,
 *  starting January 1st, so the schedule below is stable and never gets regenerated mid-cycle just
 *  because the player's ranked season happened to roll over. */
export function rlcsSeasonForDate(date: SimDate): { seasonNumber: number; seasonStartDate: SimDate } {
  return { seasonNumber: date.year, seasonStartDate: { year: date.year, month: 1, day: 1 } };
}

export type RlcsSeasonPhase = "in_season" | "off_season";

/** Regionals kick off in January and Worlds typically wraps up by around August (staggered regionals +
 *  reactive major/Worlds delays, see useTournamentStore.ts, land somewhere in that window in practice) —
 *  September through December reads as the RLCS off-season, when rosters shuffle and orgs go shopping for
 *  new talent (see orgs.ts's scouting chance) rather than mid-split roster moves being the norm. Deliberately
 *  a simple fixed calendar split rather than tied to actual instance completion, this only needs to be
 *  "typically" right, not track the exact live bracket state. */
export function rlcsSeasonPhase(date: SimDate): RlcsSeasonPhase {
  return date.month >= 1 && date.month <= 8 ? "in_season" : "off_season";
}

/** Fallback for a real named pro's RLCS title history when a fresh save starts mid-timeline (e.g. season
 *  12) and so has zero actually-completed tournament instances to scan for real past placements. A
 *  veteran pro with an early enough debut year would realistically already have competed in, and plausibly
 *  won, RLCS years the save itself never simulated. Only ever called for a real PRO_PLAYERS entry (never
 *  filler names), and follows the same "not guaranteed, just plausible" pattern as `pickAiTitle`: a roll
 *  for whether anything shows at all, then a roll for how big that past result was, both weighted toward
 *  more experienced/generational-talent pros getting better results more often.
 *
 *  Fully deterministic (seeded off the pro's own name, never `Math.random()`) — this is meant to BE that
 *  pro's real career history for every purpose that reads it (their shown title, and the MMR bonus in
 *  `useProLeaderboardStore.ts`'s `reseedEntry` that makes a genuine past champion's ranked MMR actually
 *  reflect that), so it has to come back identical every time it's asked, not re-roll a different past
 *  for the same name from one query to the next. */
export function pickFictionalPastRlcsTitle(pro: { name: string; debutYear: number }, currentRlcsYear: number): TitleEntry[] {
  const pastYearsAvailable = currentRlcsYear - pro.debutYear;
  if (pastYearsAvailable < 1) return [];

  const isTalent = isGenerationalTalent(pro.name);
  const talentBonus = isTalent ? 0.25 : 0;
  const showChance = 0.35 + talentBonus;
  if (hashString(pro.name + "#history_show") % 1000 / 1000 > showChance) return [];

  const pastYear = pro.debutYear + (hashString(pro.name + "#history_year") % pastYearsAvailable);
  const roll = hashString(pro.name + "#history_roll") % 1000 / 1000;

  // Caps how big a result this pro could plausibly have had AT THAT POINT in their career — the exact
  // same experience/talent signal `seedProMmr` uses to seed their actual MMR (just without that function's
  // own randomized jitter), so a title can never claim a result their career stage couldn't support (a
  // debut-year rookie with no generational-talent flag simply can't roll a Worlds Championship result here,
  // no matter what the tier roll below says) — this is what makes a shown title track the same skill a
  // pro's MMR reflects, instead of an unrelated per-name coin flip that could hand a nobody a legendary run.
  const yearsExperienceThen = Math.max(0, pastYear - pro.debutYear);
  const skillScore = experienceGrowth(yearsExperienceThen, 20, 6000) + (isTalent ? 100 : 0);

  if (skillScore >= 140 && roll < 0.05 + talentBonus * 0.1) return worldsTitlesEarned(pastYear, 1);
  if (skillScore >= 100 && roll < 0.15 + talentBonus * 0.15) return worldsTitlesEarned(pastYear, 4);
  if (skillScore >= 70 && roll < 0.3 + talentBonus * 0.15) {
    const group = MAJOR_GROUPS[hashString(pro.name + "#history_major") % MAJOR_GROUPS.length];
    return majorTitlesEarned(pastYear, 1, group.location);
  }
  if (skillScore >= 40 && roll < 0.55) return regionalTitlesEarned(pastYear, 1);
  return regionalTitlesEarned(pastYear, 8);
}

/** Numeric weight of a title cascade for feeding a real MMR bonus — highest tier actually earned wins,
 *  nothing stacks (a Worlds champion's cascade also contains lesser Contender entries from the same run,
 *  those shouldn't add on top of the champion bonus itself). Used by `useProLeaderboardStore.ts`'s
 *  `reseedEntry` to make a pro's 3v3 MMR (their real competitive queue, unlike the 1v1/2v2 ranked grind
 *  the rest of `seedProMmr` models) actually track whether they've genuinely won anything, instead of
 *  a title being pure cosmetic flavor completely disconnected from how "good" their ranked numbers look. */
export function rlcsTitleMmrBonus(titles: TitleEntry[]): number {
  let best = 0;
  for (const t of titles) {
    if (t.id.includes("_worlds_champ")) best = Math.max(best, 260);
    else if (t.id.includes("_major_") && t.id.endsWith("_champ")) best = Math.max(best, 170);
    else if (t.id.includes("_worlds_elite")) best = Math.max(best, 110);
    else if (t.id.includes("_regional_champ")) best = Math.max(best, 90);
    else if (t.id.includes("_regional_contender") || (t.id.includes("_major_") && t.id.endsWith("_contender"))) best = Math.max(best, 40);
  }
  return best;
}

/** Builds the full schedule of tournaments for one RLCS season: a qualifier per region staggered across
 *  the season, plus this season's EWC/ELEAGUE if their yearly date falls within it. Called once per
 *  render/effect tick, cheap and pure, no state, the store decides what to actually instantiate. */
export function buildSeasonSchedule(seasonNumber: number, seasonStartDate: SimDate): ScheduledTournament[] {
  const schedule: ScheduledTournament[] = RLCS_REGIONS.map((region, i) => ({
    id: `rlcs_s${seasonNumber}_${region}`,
    kind: "rlcs_regional" as const,
    label: `RLCS Season ${seasonNumber} Regional — ${REGION_LABELS[region]}`,
    region,
    startDate: addDays(seasonStartDate, i * RLCS_REGION_STAGGER_DAYS),
    stages: RLCS_OPEN_STAGES,
    fieldSize: RLCS_OPEN_FIELD_SIZE,
  }));

  // 1v1 RLCS doesn't exist yet as its own discipline before RLCS_1V1_INTRODUCED_SEASON — 3v3 is the only
  // RLCS discipline for the sim's early years (real 2v2 wasn't added until later still and isn't built at
  // all yet, a separate future addition). Once 1v1 does exist, it's a genuinely separate, parallel track —
  // its own Opens/Majors/Worlds path, entirely independent of the 3v3 regional flow, not sequenced before
  // or after it — so it staggers across its own (larger, 7-region) list from the same season start date
  // 3v3 does, same as any other independent discipline.
  if (seasonNumber >= RLCS_1V1_INTRODUCED_SEASON) {
    RLCS_1V1_REGIONS.forEach((region, i) => {
      schedule.push({
        id: `rlcs1v1_s${seasonNumber}_${region}`,
        kind: "rlcs_1v1_regional" as const,
        label: `1v1 Regional Season ${seasonNumber} — ${REGION_LABELS[region]}`,
        region,
        startDate: addDays(seasonStartDate, i * RLCS_REGION_STAGGER_DAYS),
        stages: RLCS_1V1_REGIONAL_STAGES,
        fieldSize: RLCS_1V1_REGIONAL_FIELD_SIZE,
      });
    });
  }

  // Rival Series only ever existed in the early era (2015-2019), a real developmental league beneath the
  // main 3v3 regional. Staggered the same way, offset slightly so it doesn't share the exact same start
  // date as its region's main regional.
  if (rlcsStructureEra(seasonStartDate.year) === "early") {
    RLCS_REGIONS.forEach((region, i) => {
      schedule.push({
        id: `rlrs_s${seasonNumber}_${region}`,
        kind: "rlrs_regional" as const,
        label: `Rival Series Season ${seasonNumber} — ${REGION_LABELS[region]}`,
        region,
        startDate: addDays(seasonStartDate, i * RLCS_REGION_STAGGER_DAYS + 3),
        stages: RIVAL_SERIES_STAGES,
        fieldSize: RIVAL_SERIES_FIELD_SIZE,
      });
    });
  }

  // *** WORK IN PROGRESS — EWC and ELEAGUE are deliberately NOT scheduled as real tournaments yet. ***
  // Both were originally modeled as ordinary org-vs-org brackets (generateGlobalTeams), which is wrong:
  // EWC (the real Esports World Cup) isn't club orgs competing at all — it's each REGION fielding a single
  // representative squad, and the real competition is a qualifier for a spot ON that region's 3-player
  // team, not a tournament between orgs. ELEAGUE's real intended structure hasn't been designed yet either.
  // Both need a genuinely different data model (a per-region squad + an individual qualifier bracket to
  // earn a roster spot on it) before they should actually run — until that's built, neither is added to the
  // schedule at all, so no instance for either kind is ever created. `EWC_STAGES`/`ELEAGUE_STAGES` and the
  // "ewc"/"eleague" TournamentKind values are left in place for that future work, just unused for now.

  return schedule;
}
