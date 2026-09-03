// Persistent, global (shared-world, like useLeaderboardFillerStore — not save-scoped) profile-picture
// assignment for every named identity in the sim. Assignment is a stable, name-seeded random pick from
// whatever's currently in src/assets/pfps/ (see data/pfps.ts), with a small monthly-checked chance to swap
// to a different pool pick — mirrors this sim's other "mostly stable, rarely changes" AI flavor mechanics
// (see data/altNames.ts).
//
// The curated pool (PFP_CURATED_POOL) and the default pool (PFP_DEFAULT_POOL — the three files named
// fullblack/defaultpfp/questionmark, see data/pfps.ts) work differently: every curated picture goes to
// exactly one identity by default — no repeats — with only a rare chance (DOUBLE_USE_CHANCE) of a genuine
// second identity once the never-used curated pool runs out, and never a third. A generic/non-notable
// identity (see isNotableIdentity) never touches the curated pool at all, it always draws straight from the
// default pool instead — and once the curated pool is fully exhausted, even a NOTABLE identity spills over
// onto that same default pool. The default pool has no cap and rotates across its few pictures rather than
// repeating one single image everywhere.

import { create } from "zustand";
import { hashString, PRO_PLAYERS, type ProRegion } from "@/data/proPlayers";
import { regionalGrinderRoster } from "@/data/regionalGrinders";
import { PFP_POOL, PFP_CURATED_POOL, PFP_DEFAULT_POOL } from "@/data/pfps";
import type { SimDate } from "@/data/dateUtils";

// Bumped to v4 for the curated/default pool split — v3 data was assigned against a single flat pool and
// would no longer reflect which files are actually meant to be the unlimited-use defaults.
const STORAGE_KEY = "rl-sim:pfp-assignments-v4";

// Per month-check, how often an already-assigned identity swaps to a different pool pick.
const PFP_CHANGE_CHANCE = 0.08;
// Once every curated picture has already gone to one identity, how often a name rolls a genuine second
// identity for that picture instead of immediately spilling over onto the default pool — deliberately rare,
// a picture going to a second person should read as an occasional coincidence, not the norm.
const DOUBLE_USE_CHANCE = 0.12;

const ALL_PRO_REGIONS: ProRegion[] = ["NA", "EU", "OCE", "SAM", "MENA", "APAC", "SSA"];

/** Whether `name` is someone recognizable enough to deserve one of the curated pool pictures — a real pro
 *  or a tracked regional grinder — as opposed to a generic filler/rando name (leaderboard filler regulars,
 *  amateur bracket filler, a random match opponent nobody's heard of) who shows a default pfp instead.
 *  Keeps the curated pool (which the player has to hand-supply files for, see data/pfps.ts) from getting
 *  diluted across every single name the sim ever generates. A caller can override this via `getPfp`'s
 *  `forceNotable` (SocialScreen does, for friends — the player chose to add them, that's recognizable
 *  enough regardless of what this check would otherwise say). */
function isNotableIdentity(name: string, currentYear: number): boolean {
  if (PRO_PLAYERS.some((p) => p.name === name)) return true;
  return ALL_PRO_REGIONS.some((region) => regionalGrinderRoster(region, currentYear).some((g) => g.name === name));
}

interface PfpEntry {
  file: string;
  lastCheckedMonthKey: string;
}

type PfpTable = Record<string, PfpEntry>;
type UsageTable = Record<string, number>;

function monthKey(date: SimDate): string {
  return `${date.year}-${date.month}`;
}

/** A deterministic pick from the unlimited-use default pool. Never called unless the pool is non-empty. */
function pickDefaultFile(name: string, salt: string): string {
  return PFP_DEFAULT_POOL[hashString(name + salt) % PFP_DEFAULT_POOL.length];
}

/** Picks a CURATED file for a notable identity: a never-before-used picture if any are left, otherwise a
 *  rare roll (see DOUBLE_USE_CHANCE) at a picture that's only been used once so far, otherwise the default
 *  pool. Never hands a curated picture out a third time — once a picture has 2 uses it's excluded from both
 *  branches above. Deterministic GIVEN `usage`, but `usage` itself depends on assignment order (whoever got
 *  looked up first claims a slot), so this isn't stable across a full reassignment sequence the way a pure
 *  hash pick would be. That's fine: each name is only ever actually picked ONCE (or on a rare monthly
 *  reroll) and the result is persisted immediately, see `getPfp`. */
function pickCuratedFile(name: string, salt: string, usage: UsageTable): string {
  const unused = PFP_CURATED_POOL.filter((f) => (usage[f] ?? 0) === 0);
  if (unused.length > 0) return unused[hashString(name + salt) % unused.length];

  const rollsDouble = hashString(name + salt + "#double") % 100 < DOUBLE_USE_CHANCE * 100;
  if (rollsDouble) {
    const onceUsed = PFP_CURATED_POOL.filter((f) => (usage[f] ?? 0) === 1);
    if (onceUsed.length > 0) return onceUsed[hashString(name + salt) % onceUsed.length];
  }

  if (PFP_DEFAULT_POOL.length > 0) return pickDefaultFile(name, salt);
  // Extreme edge case (no default pool AND the curated pool is fully saturated) — reuse a curated picture
  // a 3rd+ time rather than returning nothing.
  return PFP_CURATED_POOL[hashString(name + salt) % PFP_CURATED_POOL.length] ?? "";
}

/** Whether `file` counts against the curated pool's usage cap — the default pool is deliberately uncapped,
 *  so a name assigned a default picture shouldn't consume/free a usage slot at all. */
function isCuratedFile(file: string): boolean {
  return PFP_CURATED_POOL.includes(file);
}

interface StoredShape {
  table: PfpTable;
  usage: UsageTable;
}

function loadStored(): StoredShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { table: {}, usage: {} };
    const parsed = JSON.parse(raw);
    return { table: parsed.table ?? {}, usage: parsed.usage ?? {} };
  } catch {
    return { table: {}, usage: {} };
  }
}

function persist(table: PfpTable, usage: UsageTable) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ table, usage }));
  } catch {
    // Storage full/unavailable, assignments just won't persist across reloads this session.
  }
}

interface PfpState {
  table: PfpTable;
  usage: UsageTable;
  /** Bumped on every `resetAll` — Avatar.tsx depends on this so an already-mounted avatar actually
   *  re-resolves after a reset, not just names looked up for the first time afterward. */
  version: number;
  /** This name's assigned pfp (a bundled URL), "" only if the ENTIRE pool (curated + default) is empty —
   *  Avatar.tsx shows a generated silhouette icon whenever this returns "", but that should be rare once
   *  even the three default files exist. Pass `forceNotable` to always draw from the curated pool
   *  regardless of `isNotableIdentity` (e.g. for a friend the player specifically added). Assigns on first
   *  lookup if missing, and re-checks (at most once per in-game month) whether this identity rolls a fresh
   *  pick. Safe to call from a render body the same way this sim's other leaderboard `getStats`/`getMmr`
   *  lookups are — see Avatar.tsx for the actual read pattern used everywhere this gets displayed. */
  getPfp: (name: string, currentDate: SimDate, forceNotable?: boolean) => string;
  /** Wipes every persisted assignment (and usage count) so the next lookup for each name reassigns fresh
   *  from whatever's currently in the pfp pool — use after adding/removing files from src/assets/pfps so
   *  stale assignments (pointing at a file that no longer exists, or ignoring a newly added one) get
   *  cleared out immediately instead of only for names that happen to roll a change naturally. */
  resetAll: () => void;
}

export const usePfpStore = create<PfpState>((set, get) => {
  const stored = loadStored();
  return {
    table: stored.table,
    usage: stored.usage,
    version: 0,

    getPfp: (name, currentDate, forceNotable) => {
      if (PFP_POOL.length === 0) return "";
      const notable = !!forceNotable || isNotableIdentity(name, currentDate.year);
      const state = get();
      const existing = state.table[name];
      const key = monthKey(currentDate);

      const pick = (salt: string, usage: UsageTable): string => {
        if (notable && PFP_CURATED_POOL.length > 0) return pickCuratedFile(name, salt, usage);
        if (PFP_DEFAULT_POOL.length > 0) return pickDefaultFile(name, salt);
        return pickCuratedFile(name, salt, usage);
      };

      if (!existing) {
        const file = pick("#pfp", state.usage);
        const entry: PfpEntry = { file, lastCheckedMonthKey: key };
        const nextTable = { ...state.table, [name]: entry };
        const nextUsage = isCuratedFile(file) ? { ...state.usage, [file]: (state.usage[file] ?? 0) + 1 } : state.usage;
        set({ table: nextTable, usage: nextUsage });
        persist(nextTable, nextUsage);
        return file;
      }

      if (existing.lastCheckedMonthKey === key) return existing.file;

      const changeRoll = hashString(name + "#pfp_change_" + key) % 100;
      if (changeRoll >= PFP_CHANGE_CHANCE * 100) {
        const entry: PfpEntry = { file: existing.file, lastCheckedMonthKey: key };
        const nextTable = { ...state.table, [name]: entry };
        set({ table: nextTable });
        persist(nextTable, state.usage);
        return existing.file;
      }

      // Rerolling: free up the old file's slot first (if it was a curated one) so it's correctly eligible
      // again for THIS pick — a name rerolling off a not-yet-full picture shouldn't count against its own
      // old slot.
      const freedUsage = isCuratedFile(existing.file)
        ? { ...state.usage, [existing.file]: Math.max(0, (state.usage[existing.file] ?? 0) - 1) }
        : state.usage;
      const nextFile = pick("#pfp_alt_" + key, freedUsage);
      const entry: PfpEntry = { file: nextFile, lastCheckedMonthKey: key };
      const nextTable = { ...state.table, [name]: entry };
      const nextUsage = isCuratedFile(nextFile) ? { ...freedUsage, [nextFile]: (freedUsage[nextFile] ?? 0) + 1 } : freedUsage;
      set({ table: nextTable, usage: nextUsage });
      persist(nextTable, nextUsage);
      return nextFile;
    },

    resetAll: () => {
      set((state) => ({ table: {}, usage: {}, version: state.version + 1 }));
      persist({}, {});
    },
  };
});
