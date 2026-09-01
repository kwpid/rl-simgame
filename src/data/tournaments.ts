// Tournament definitions: RLCS is the recurring, region-locked backbone (a separate regional qualifier
// per region, each its own self-contained bracket, all belonging to one numbered RLCS season), plus a
// couple of smaller one-off/globally-open events (EWC, ELEAGUE) that happen at their own fixed point in
// the calendar year, not tied to the RLCS season cadence. 3v3 is real RLCS's actual format and the only
// one built here for now, see the design chat: 2v2 isn't introduced as an RLCS discipline until 2023, 1v1
// stays ranked-only.

import type { StageConfig, TournamentTeam } from "./tournamentFormats";
import { activeProPlayers, experienceGrowth, isGenerationalTalent, type ProRegion } from "./proPlayers";
import { LB_NAMES, type Region } from "./mockSave";
import type { TitleEntry, TitleGlow } from "./seasons";
import type { SimDate } from "./dateUtils";
import { addDays } from "./dateUtils";

export type TournamentKind = "rlcs_regional" | "ewc" | "eleague" | "rlcs_1v1_regional" | "rlcs_major" | "rlcs_worlds" | "rlrs_regional";

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

// Real, recognizable-flavor org names per region, used to name generated teams, purely cosmetic.
export const ORG_NAMES: Record<ProRegion, string[]> = {
  NA: ["NRG", "G2 Esports", "Complexity", "Spacestation Gaming", "Version1", "The Aquarium", "Shopify Rebellion", "FaZe Clan"],
  EU: ["Karmine Corp", "Team Vitality", "BDS", "Moist Esports", "Solary", "Team Queso", "Ninjas in Pyjamas", "Team Falcons EU"],
  SAM: ["FURIA", "paiN Gaming", "Isurus", "Six Karma", "Case Esports"],
  OCE: ["Mindfreak", "Rooster", "Fugitives Gaming", "Ground Zero Gaming"],
  MENA: ["Team Falcons", "Quadrant", "5Levels", "Anubis Gaming"],
  APAC: ["Talon Esports", "Bleed Esports", "ORDER"],
  SSA: ["Nashi Esports"],
};

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

function buildTeamsFromPros(pros: { name: string; debutYear: number }[], region: ProRegion, currentYear: number, orgNames: string[], idPrefix: string): TournamentTeam[] {
  const teams: TournamentTeam[] = [];
  const names = [...orgNames];
  let proIdx = 0;
  let teamIdx = 0;
  while (proIdx + 3 <= pros.length && names.length > 0) {
    const roster = pros.slice(proIdx, proIdx + 3);
    proIdx += 3;
    const orgName = names.shift()!;
    const experienceYears = Math.max(...roster.map((p) => Math.max(0, currentYear - p.debutYear)));
    const talentCount = roster.filter((p) => isGenerationalTalent(p.name)).length;
    const power = PRO_TEAM_POWER_BASE + experienceGrowth(experienceYears, 40, 5000) + talentCount * 120;
    teams.push({
      id: `${idPrefix}_${teamIdx}`,
      name: orgName,
      region,
      power: Math.round(power * (0.95 + Math.random() * 0.1)),
      players: roster.map((p) => p.name),
    });
    teamIdx++;
  }
  return teams;
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

/** Builds a regional field of teams for an RLCS qualifier: real active pros from that region (grouped
 *  into teams of 3, named after real-flavor orgs) fill in first, everything else is a generic filler/
 *  amateur team with a lower power rating, so an early-game field (few pros debuted yet) still fills out
 *  realistically. */
export function generateTeamsForRegion(region: ProRegion, currentYear: number, fieldSize: number, idPrefix: string): TournamentTeam[] {
  const pros = shuffle(activeProPlayers(currentYear).filter((p) => p.region === region));
  const teams = buildTeamsFromPros(pros, region, currentYear, [...(ORG_NAMES[region] ?? [])], idPrefix);
  return fillWithAmateurTeams(teams, region, fieldSize, idPrefix);
}

/** Builds a globally-open field (EWC, ELEAGUE): pulls active pros from every region rather than one, for
 *  events that aren't region-locked the way an RLCS qualifier is. */
export function generateGlobalTeams(currentYear: number, fieldSize: number, idPrefix: string): TournamentTeam[] {
  const pros = shuffle(activeProPlayers(currentYear));
  const allOrgNames = shuffle(Object.values(ORG_NAMES).flat());
  const teams = buildTeamsFromPros(pros, "NA", currentYear, allOrgNames, idPrefix);
  return fillWithAmateurTeams(teams, "NA", fieldSize, idPrefix);
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

/** Smaller, lower-stakes events than RLCS: one compact bracket, no multi-day Swiss/groups grind. */
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

/** Fallback for a real named pro's RLCS title history when a fresh save starts mid-timeline (e.g. season
 *  12) and so has zero actually-completed tournament instances to scan for real past placements. A
 *  veteran pro with an early enough debut year would realistically already have competed in, and plausibly
 *  won, RLCS years the save itself never simulated. Only ever called for a real PRO_PLAYERS entry (never
 *  filler names), and follows the same "not guaranteed, just plausible" pattern as `pickAiTitle`: a roll
 *  for whether anything shows at all, then a roll for how big that past result was, both weighted toward
 *  more experienced/generational-talent pros getting better results more often. */
export function pickFictionalPastRlcsTitle(pro: { name: string; debutYear: number }, currentRlcsYear: number): TitleEntry[] {
  const pastYearsAvailable = currentRlcsYear - pro.debutYear;
  if (pastYearsAvailable < 1) return [];

  const talentBonus = isGenerationalTalent(pro.name) ? 0.25 : 0;
  const showChance = 0.35 + talentBonus;
  if (Math.random() > showChance) return [];

  const pastYear = pro.debutYear + Math.floor(Math.random() * pastYearsAvailable);
  const roll = Math.random();
  if (roll < 0.05 + talentBonus * 0.1) return worldsTitlesEarned(pastYear, 1);
  if (roll < 0.15 + talentBonus * 0.15) return worldsTitlesEarned(pastYear, 4);
  if (roll < 0.3 + talentBonus * 0.15) {
    const group = MAJOR_GROUPS[Math.floor(Math.random() * MAJOR_GROUPS.length)];
    return majorTitlesEarned(pastYear, 1, group.location);
  }
  if (roll < 0.55) return regionalTitlesEarned(pastYear, 1);
  return regionalTitlesEarned(pastYear, 8);
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

  // 1v1 regionals run alongside the 3v3 ones, staggered the same way across all 7 (larger) region list.
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

  // EWC and ELEAGUE run once a year at a fixed point in the calendar, independent of the RLCS season
  // cadence, one instance per year is enough to check for overlap with this season's date window.
  const year = seasonStartDate.year;
  schedule.push({
    id: `ewc_${year}`,
    kind: "ewc",
    label: `Rocket League EWC ${year}`,
    region: null,
    startDate: { year, month: 7, day: 1 },
    stages: EWC_STAGES,
    fieldSize: EWC_FIELD_SIZE,
  });
  schedule.push({
    id: `eleague_${year}`,
    kind: "eleague",
    label: `ELEAGUE Cup ${year}`,
    region: null,
    startDate: { year, month: 11, day: 1 },
    stages: ELEAGUE_STAGES,
    fieldSize: ELEAGUE_FIELD_SIZE,
  });

  return schedule;
}
