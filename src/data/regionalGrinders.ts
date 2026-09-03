// The "ranked grinder" identity pool: real named GC+/SSL opponents who AREN'T signed pros (see
// proPlayers.ts), filling out the Low/Mid density bands of each region's roster (see useRegionalRosterStore.ts
// for their persistent MMR/stats, aiActivity.ts for their online/offline schedule). Names are wholly
// fictional but styled per-region to read like real ranked tags from that scene, and deliberately avoid two
// failure modes: looking like the same handful of names/templates repeated (a big, genuinely varied word
// pool per region, not one template stamped out with an incrementing suffix) and looking machine-generated
// (no id-like trailing numbers as the default pattern — real gamertags overwhelmingly don't end in a
// number, so this pool follows that same rule, with only a rare hand-placed exception here and there).
// Every name here is also checked against proPlayers.ts to guarantee it never collides with a real pro.

import { hashString, activeProPlayers, type ProRegion } from "./proPlayers";
import { withNameFlourish } from "./nameFlourish";

export type RosterBand = "low" | "mid" | "high" | "super_high";

export interface GrinderIdentity {
  name: string;
  region: ProRegion;
  /** Fixed at generation, never reseeded — this is a target-MMR bucket, not a live rank. */
  band: RosterBand;
}

// NA/EU compound their tag from two word-fragments (a very common real convention, e.g. "Frostbyte",
// "Nightfall") — combined with a standalone list so the pool doesn't read as one template repeated.
const NA_PART1 = ["Night", "Iron", "Dust", "Rogue", "Wild", "Lone", "Ghost", "Silver", "Steel", "Storm", "Rusty", "Hollow", "North", "Backroad", "Diesel", "Coyote", "Copper", "Dead", "Bone", "Ash"];
const NA_PART2 = ["fall", "wolf", "runner", "hawk", "rider", "smoke", "trail", "creek", "yard", "town", "wood", "field", "line", "stone", "road", "light", "fire", "howl", "drift", "reach"];
const NA_STANDALONE = [
  "Voltaic", "Nitro", "Blazeon", "Rampage", "Kodiak", "Maverick", "Jetstream", "Ignite", "Ranger",
  "Wolfpack", "Highnoon", "Lonestar", "Roughneck", "Ironclad", "Redline", "Overdrive", "Suncoast",
  "Cascade", "Renegade", "Palomino", "Driftwood", "Tumbleweed", "Backfire", "Grindhouse", "Highkey7",
];

const EU_PART1 = ["Frost", "Winter", "Iron", "Silver", "Grey", "Pale", "North", "Storm", "Moon", "Star", "Blue", "Dark", "White", "Ash", "Wolf", "Snow", "Steel", "Black"];
const EU_PART2 = ["wave", "light", "bane", "fang", "shade", "frost", "born", "heart", "wing", "ridge", "vale", "spire", "reach", "crest", "mere", "holt", "drift", "fell"];
const EU_STANDALONE = [
  "Vantage", "Nebula", "Solace", "Cinder", "Halcyon", "Quartz", "Obscur", "Lumire", "Zephyra", "Rivale",
  "Auren", "Skyline", "Nocturne", "Velvex", "Ashfall", "Duskrunner", "Emberlyn", "Fenwick", "Corvid",
  "Thistledown", "Wrenfield", "Marrow",
];

const SAM_WORDS = [
  "Furacao", "Malandro", "Trovao", "Correnteza", "Tuffz", "Estrela", "Vulcanzz", "Relampz", "Xoque",
  "Carioca", "Fervo", "Braziux", "Sambaxx", "Nortezz", "Ferozz", "Trombaxx", "Marotoo", "Cangaco",
  "Bravatx", "Selvagemz", "Trapaceiro", "Ligeirinho", "Aventureiro", "Destemido", "Zoeirinho",
  "Guerreirox", "Pistoleiro", "Ousadia", "Ferozx", "Trovejante", "Encrenca", "Malvadeza", "Alucinado",
  "Sertanejo", "Molecada", "Zangado", "Retinto", "Bicudo", "Sapeca", "Cabuloso", "Danado", "Sinistroo",
  "Levado", "Arretado", "Cascudo", "Fominha", "Trombudo",
];

const MENA_WORDS = [
  "Zaeem", "Malik", "Sahaba", "Qasim", "Faris", "Tariq", "Bilal", "Hamzah", "Anwar", "Rashed", "Khalidi",
  "Jaser", "Mansour", "Adnan", "Zayed", "Omarii", "Rayyan", "Sultani", "Nabeel", "Waleed", "Fahim",
  "Ghaith", "Yazan7", "Suhail", "Naser", "Karim", "Amjad", "Firas", "Nidal", "Shadi", "Marwani", "Louai",
  "Hatim", "Zuhair", "Rakan", "Bandari", "Fadel", "Idris", "Osamah", "Wisam", "Thamer", "Majed", "Saif",
  "Hazim", "Yasser", "Munir",
];

const OCE_WORDS = [
  "Dingo", "Bushfire", "Larrikin", "Stoked", "Wombat", "Outback", "Rowdy", "Coastal", "Barra", "Reckless",
  "Sunburnt", "Cobber", "Rugged", "Scrappy", "Husky", "Bogan", "Yeeter", "Ridgey", "Choppa", "Snapper",
  "Rippa", "Yakka", "Grommet", "Sparko", "Muso", "Straya", "Bindi", "Drover", "Bluetongue", "Redback",
  "Saltbush", "Tussock", "Brolga", "Kelpie", "Stubby", "Galah", "Boofhead", "Chinwag", "Esky",
];

const APAC_WORDS = [
  "Kamiyo", "Ronin", "Tenrai", "Zenpo", "Sundial", "Kirin", "Yomei", "Aurorae", "Ondori", "Tsukimi",
  "Skyfarer", "Kagerou", "Yozora", "Hibiki", "Tenko", "Ginkai", "Rindo", "Kurogane", "Shirogane",
  "Hanabira", "Suzumushi", "Kotori", "Amanora", "Yoake", "Ryusei", "Hotaru", "Akatsuki", "Fubuki",
  "Sakuya", "Enkou", "Mizuki", "Toranosuke", "Ginrei",
];

const SSA_WORDS = [
  "Baraka", "Simba", "Jengo", "Nairobi", "Zolan", "Tundu", "Amara", "Kwame", "Zawadi", "Bomani",
  "Jabari", "Kito", "Sefu", "Tafari", "Zuberi", "Adisa", "Chike", "Femi", "Obie", "Sekani", "Kagiso",
  "Tendai", "Themba", "Sipho", "Lindiwe", "Katlego", "Onyeka", "Ayanda", "Mandla", "Bongani",
];

function seededShuffle<T>(items: T[], seedKey: string): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = hashString(`${seedKey}#${i}`) % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function comboPool(part1: string[], part2: string[], seedKey: string): string[] {
  const combos: string[] = [];
  for (const a of part1) for (const b of part2) combos.push(a + b);
  return seededShuffle(combos, seedKey);
}

/** Per-region name pool: a hand-authored standalone list up front (guarantees the "clean single word" tags
 *  every region should have some of), followed by a large deterministically-shuffled combo pool for NA/EU
 *  (which round out easily via natural word compounding) — never randomized again after this module loads,
 *  same list every time. */
const NAME_POOL: Record<ProRegion, string[]> = {
  NA: [...NA_STANDALONE, ...comboPool(NA_PART1, NA_PART2, "NA_combo")],
  EU: [...EU_STANDALONE, ...comboPool(EU_PART1, EU_PART2, "EU_combo")],
  SAM: SAM_WORDS,
  MENA: MENA_WORDS,
  OCE: OCE_WORDS,
  APAC: APAC_WORDS,
  SSA: SSA_WORDS,
};

const MIN_GRINDERS_PER_REGION = 20;
const MAX_GRINDERS_PER_REGION = 65;
// Combined pro + grinder total per region should land near the middle of the "50-75 unique AI" target.
const TARGET_ROSTER_SIZE = 65;

const LOW_BAND_SHARE = 0.65; // rest rolls "mid" — this pool never rolls high/super_high directly.

/** How many synthetic grinder identities a region needs this year to round its roster out to roughly
 *  TARGET_ROSTER_SIZE once real pros (which vary a lot in count by region) are added on top. Never exceeds
 *  the region's actual name pool size, so a smaller hand-authored pool just yields a somewhat smaller
 *  roster rather than ever repeating a name. */
function grinderCountForRegion(region: ProRegion, currentYear: number): number {
  const proCount = activeProPlayers(currentYear).filter((p) => p.region === region).length;
  const target = Math.max(MIN_GRINDERS_PER_REGION, Math.min(MAX_GRINDERS_PER_REGION, TARGET_ROSTER_SIZE - proCount));
  return Math.min(target, NAME_POOL[region].length);
}

/** Deterministic, module-pure: same region always returns the same roster (same names, same bands), never
 *  regenerated/reshuffled — this is what "not randomized after generation" means at the data layer. Sized
 *  per the current year so a region's grinder count adapts as its real pro scene grows over the save. */
export function regionalGrinderRoster(region: ProRegion, currentYear: number): GrinderIdentity[] {
  const count = grinderCountForRegion(region, currentYear);
  const pool = NAME_POOL[region];
  const roster: GrinderIdentity[] = [];
  for (let i = 0; i < count; i++) {
    const seedKey = `${region}#grinder#${i}`;
    const seed = hashString(seedKey);
    const band: RosterBand = (seed % 100) < LOW_BAND_SHARE * 100 ? "low" : "mid";
    roster.push({ name: withNameFlourish(pool[i], seedKey), region, band });
  }
  return roster;
}
