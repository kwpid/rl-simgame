// The "ranked grinder" identity pool: real named GC+/SSL opponents who AREN'T signed pros (see
// proPlayers.ts), filling out the Low/Mid density bands of each region's roster (see useRegionalRosterStore.ts
// for their persistent MMR/stats, aiActivity.ts for their online/offline schedule). Names are wholly
// fictional but styled per-region to read like real ranked tags from that scene (NA leans clean/meme with
// dots and numbers, EU stylish with creative zero-spellings, SAM aggressive Portuguese-flavored x/z endings,
// MENA short and numeric with Arabic-transliterated roots, OCE casual Aussie/Kiwi energy, APAC an English/
// East-Asian mix, SSA simple and still-emerging) — deliberately disjoint from every real name in
// proPlayers.ts and from LB_NAMES (the old generic ranked-filler pool) so nothing here ever collides with
// an already-tracked identity.

import { hashString, activeProPlayers, type ProRegion } from "./proPlayers";

export type RosterBand = "low" | "mid" | "high" | "super_high";

export interface GrinderIdentity {
  name: string;
  region: ProRegion;
  /** Fixed at generation, never reseeded — this is a target-MMR bucket, not a live rank. */
  band: RosterBand;
}

interface RegionNameStyle {
  words: string[];
  /** Must return a distinct string for every distinct `variant` applied to the same `word` — this is what
   *  guarantees every generated name in a region is unique without needing a runtime collision check. */
  decorate: (word: string, variant: number) => string;
}

const NA_NUMBERS = [1, 2, 7, 9, 97, 21, 44, 88, 11, 23, 3, 12];
const MENA_NUMBERS = [9, 7, 511, 21, 44, 90, 17, 13];

const REGION_NAME_STYLES: Record<ProRegion, RegionNameStyle> = {
  NA: {
    words: [
      "Voltaic", "Nitro", "Blazeon", "Rampage", "Kodiak", "Maverick", "Jetstream", "Ignite", "Ranger",
      "Wolfpack", "Highnoon", "Lonestar", "Roughneck", "Ironclad", "Redline", "Overdrive", "Suncoast", "Highkey",
    ],
    decorate: (word, variant) => {
      if (variant === 0) return word;
      if (variant === 1) return `${word}.`;
      return `${word}${NA_NUMBERS[(variant - 2) % NA_NUMBERS.length]}`;
    },
  },
  EU: {
    words: [
      "Vantage", "Nebula", "Frostbyte", "Solace", "Cinder", "Halcyon", "Quartz", "Obscur", "Lumire",
      "Zephyra", "Rivale", "Auren", "Skyline", "Nocturne", "Velvex", "Ashfall",
    ],
    decorate: (word, variant) => {
      if (variant === 0) return word;
      if (variant === 1) return word.replace(/o/gi, "0");
      if (variant === 2) return `${word}.`;
      return `${word}_${variant}`;
    },
  },
  SAM: {
    words: [
      "Furacao", "Malandro", "Trovao", "Fenix", "Samba", "Correnteza", "Tuff", "Estrela", "Vulcan",
      "Relamp", "Xoque", "Carioca", "Fervo", "Braziux",
    ],
    decorate: (word, variant) => {
      if (variant === 0) return `${word}x`;
      if (variant === 1) return `${word}z`;
      if (variant === 2) return `${word}zz`;
      return `${word}${variant}`;
    },
  },
  MENA: {
    words: [
      "Zaeem", "Malik", "Amiro", "Sahaba", "Qasim", "Faris", "Tariq", "Bilal", "Hamzah", "Anwar",
      "Rashed", "Khalidi", "Jaser", "Mansour",
    ],
    decorate: (word, variant) => {
      if (variant === 0) return word;
      if (variant === 1) return `${word}.`;
      return `${word}${MENA_NUMBERS[(variant - 2) % MENA_NUMBERS.length]}`;
    },
  },
  OCE: {
    words: [
      "Dingo", "Bushfire", "Larrikin", "Stoked", "Wombat", "Outback", "Rowdy", "Coastal", "Barra",
      "Reckless", "Sunburnt", "Cobber",
    ],
    decorate: (word, variant) => (variant === 0 ? word : `${word}${variant}`),
  },
  APAC: {
    words: [
      "Kamiyo", "Ronin", "Tenrai", "Sable", "Zenpo", "Sundial", "Kirin", "Yomei", "Aurorae", "Ondori", "Tsukimi", "Skyfarer",
    ],
    decorate: (word, variant) => {
      if (variant === 0) return word;
      if (variant === 1) return `${word}.`;
      return `${word}${variant}`;
    },
  },
  SSA: {
    words: ["Baraka", "Simba", "Jengo", "Nairobi", "Zolan", "Tundu", "Amara", "Kwame", "Zawadi"],
    decorate: (word, variant) => (variant === 0 ? word : `${word}${variant}`),
  },
};

function grinderNameForRegion(region: ProRegion, index: number): string {
  const style = REGION_NAME_STYLES[region];
  const wordIndex = index % style.words.length;
  const variant = Math.floor(index / style.words.length);
  return style.decorate(style.words[wordIndex], variant);
}

const MIN_GRINDERS_PER_REGION = 20;
const MAX_GRINDERS_PER_REGION = 65;
// Combined pro + grinder total per region should land near the middle of the "50-75 unique AI" target.
const TARGET_ROSTER_SIZE = 65;

const LOW_BAND_SHARE = 0.65; // rest rolls "mid" — this pool never rolls high/super_high directly.

/** How many synthetic grinder identities a region needs this year to round its roster out to roughly
 *  TARGET_ROSTER_SIZE once real pros (which vary a lot in count by region) are added on top. */
function grinderCountForRegion(region: ProRegion, currentYear: number): number {
  const proCount = activeProPlayers(currentYear).filter((p) => p.region === region).length;
  return Math.max(MIN_GRINDERS_PER_REGION, Math.min(MAX_GRINDERS_PER_REGION, TARGET_ROSTER_SIZE - proCount));
}

/** Deterministic, module-pure: same region always returns the same roster (same names, same bands), never
 *  regenerated/reshuffled — this is what "not randomized after generation" means at the data layer. Sized
 *  per the current year so a region's grinder count adapts as its real pro scene grows over the save. */
export function regionalGrinderRoster(region: ProRegion, currentYear: number): GrinderIdentity[] {
  const count = grinderCountForRegion(region, currentYear);
  const roster: GrinderIdentity[] = [];
  for (let i = 0; i < count; i++) {
    const seed = hashString(`${region}#grinder#${i}`);
    const name = grinderNameForRegion(region, i);
    const band: RosterBand = (seed % 100) < LOW_BAND_SHARE * 100 ? "low" : "mid";
    roster.push({ name, region, band });
  }
  return roster;
}
