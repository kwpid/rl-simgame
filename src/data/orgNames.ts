// Real-esports-flavor org names/tags, split out of tournaments.ts into their own file specifically so
// matchSim.ts (which needs orgTagForOrgName for the [TAG] shown on a signed AI opponent, see
// orgTagForOpponent) can import them WITHOUT importing the rest of tournaments.ts — tournaments.ts itself
// needs to read live ranked MMR from useProLeaderboardStore/useRegionalRosterStore (for real, skill-sorted
// RLCS team rosters), and those stores import matchSim.ts, so tournaments.ts -> matchSim.ts -> tournaments.ts
// would otherwise be a real circular import. tournaments.ts re-exports everything here for every other
// existing consumer, this split is invisible to them.

import type { ProRegion } from "./proPlayers";

// Real, recognizable-flavor org names per region, used to name generated teams, purely cosmetic. Each name
// is unique across every region — a real org is one global brand, never fielded as if it were two separate
// regional franchises (see the note on Team Falcons: MENA-based, competes globally, only listed once).
export const ORG_NAMES: Record<ProRegion, string[]> = {
  NA: [
    "NRG", "G2 Esports", "Complexity", "Spacestation Gaming", "Version1", "The Aquarium", "Shopify Rebellion",
    "FaZe Clan", "Dignitas", "Envy", "Rogue", "OpTic Gaming", "eUnited",
  ],
  EU: [
    "Karmine Corp", "Team Vitality", "BDS", "Moist Esports", "Solary", "Team Queso", "Ninjas in Pyjamas",
    "Guild Esports", "Team Liquid", "Endpoint", "Excelerate Gaming", "Nordavind",
  ],
  SAM: ["FURIA", "paiN Gaming", "Isurus", "Six Karma", "Case Esports", "Vivo Keyd", "9z Team", "Coyotes Gamers Club"],
  OCE: ["Mindfreak", "Rooster", "Fugitives Gaming", "Ground Zero Gaming", "Renegades", "Dire Wolves", "Avant Gaming"],
  MENA: ["Team Falcons", "Quadrant", "5Levels", "Anubis Gaming", "Twisted Minds", "Nasr eSports", "Wolves Esports"],
  APAC: ["Talon Esports", "Bleed Esports", "ORDER", "Grayhound Gaming", "Chiefs Esports Club"],
  SSA: ["Nashi Esports", "Cape Esports", "Sahara Esports"],
};

/** Real orgs go by a short tag in-game, not their full name (see the [TAG] shown next to a signed player's
 *  name in ranked/matches, OrgTag.tsx). 2-4 characters each, matching the real-world brand where there is
 *  one. Every entry in ORG_NAMES has one; anything not listed here (shouldn't happen, but stay safe) falls
 *  back to a truncated slice of the name itself, see orgTagForOrgName below. */
export const ORG_ABBREVIATIONS: Record<string, string> = {
  NRG: "NRG",
  "G2 Esports": "G2",
  Complexity: "COL",
  "Spacestation Gaming": "SSG",
  Version1: "V1",
  "The Aquarium": "AQUA",
  "Shopify Rebellion": "SR",
  "FaZe Clan": "FAZE",
  "Karmine Corp": "KC",
  "Team Vitality": "VIT",
  BDS: "BDS",
  "Moist Esports": "MST",
  Solary: "SOLA",
  "Team Queso": "TQ",
  "Ninjas in Pyjamas": "NIP",
  "Guild Esports": "GLD",
  FURIA: "FUR",
  "paiN Gaming": "PAIN",
  Isurus: "ISU",
  "Six Karma": "SIX",
  "Case Esports": "CASE",
  Mindfreak: "MF",
  Rooster: "ROOS",
  "Fugitives Gaming": "FUGI",
  "Ground Zero Gaming": "GZG",
  "Team Falcons": "FLCN",
  Quadrant: "QUAD",
  "5Levels": "5LVL",
  "Anubis Gaming": "ANU",
  "Talon Esports": "TLN",
  "Bleed Esports": "BLD",
  ORDER: "ORD",
  "Nashi Esports": "NSH",
  Dignitas: "DIG",
  Envy: "NV",
  Rogue: "RGE",
  "OpTic Gaming": "OPTC",
  eUnited: "EUNI",
  "Team Liquid": "TL",
  Endpoint: "EP",
  "Excelerate Gaming": "EXCL",
  Nordavind: "NOR",
  "Vivo Keyd": "KEYD",
  "9z Team": "9Z",
  "Coyotes Gamers Club": "COYO",
  Renegades: "REN",
  "Dire Wolves": "DW",
  "Avant Gaming": "AVNT",
  "Twisted Minds": "TM",
  "Nasr eSports": "NASR",
  "Wolves Esports": "WOLV",
  "Grayhound Gaming": "GH",
  "Chiefs Esports Club": "CHFS",
  "Cape Esports": "CAPE",
  "Sahara Esports": "SAHA",
};

export function orgTagForOrgName(orgName: string): string {
  return ORG_ABBREVIATIONS[orgName] ?? orgName.replace(/\s+/g, "").slice(0, 4).toUpperCase();
}
