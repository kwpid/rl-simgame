// Persistent "which title is this AI actually wearing right now" state. Season/RLCS titles themselves are
// recomputed deterministically every time (seasons.ts's pickFictionalSeasonTitles, useTournamentStore.ts's
// findRealRlcsTitlesForPlayer) — a stable INVENTORY, not literally stored item-by-item here. What genuinely
// needs its own bit of state is the DISPLAYED choice: an AI should usually keep wearing the same (their
// single best) title match to match rather than reroll from their whole inventory every time it's asked,
// switch immediately the moment they've actually earned something better, and only occasionally wear a
// different title from their own inventory for a few days for flavor. Scoped per-save (mirrors
// useRegionalRosterStore.ts's storage-key pattern) since part of the inventory this reads from (real RLCS
// history) is itself per-save.

import { create } from "zustand";
import { titleImpressiveness, type TitleEntry } from "@/data/seasons";
import { addDays, type SimDate } from "@/data/dateUtils";

const STORAGE_KEY_PREFIX = "rl-sim:ai-title-choice-v1";

let activeSaveId: string | null = null;

function storageKeyFor(saveId: string | null): string {
  return `${STORAGE_KEY_PREFIX}:${saveId ?? "unsaved"}`;
}

/** Raw (already-JSON-string) title-choice state for one save, read verbatim — see
 *  useTournamentStore.ts's `exportTournamentDataForSave` for why this exists: this store's per-save blob
 *  lives outside the SaveData object entirely. */
export function exportAiTitleDataForSave(saveId: string): string | null {
  return localStorage.getItem(storageKeyFor(saveId));
}

/** Writes a previously-exported blob into storage under a NEW save id — the normal `loadForSave` call that
 *  happens whenever a save is actually opened picks it up from here. */
export function importAiTitleDataForSave(saveId: string, data: string | null | undefined): void {
  try {
    if (data) localStorage.setItem(storageKeyFor(saveId), data);
  } catch {
    // Storage full/unavailable, the imported title choices just won't carry over this session.
  }
}

function dateKey(d: SimDate): string {
  return `${d.year}-${d.month}-${d.day}`;
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

interface AiTitleChoice {
  /** id of whichever title was "best" the last time this name was checked — comparing against the CURRENT
   *  best is what detects "they earned something new/better" and forces an immediate switch. */
  lastBestTitleId: string | null;
  /** id of a temporary different title from the inventory being worn "for a bit" instead of the best one,
   *  or null when there's no active override. */
  overrideTitleId: string | null;
  /** Date key (see `dateKey`) after which the override reverts — null alongside `overrideTitleId`. */
  overrideUntilKey: string | null;
  /** Date key of the last time we rolled for a possible new override, so the daily roll only ever happens
   *  once per in-game day regardless of how many times a name is looked up that day. */
  lastCheckedKey: string;
}

type AiTitleTable = Record<string, AiTitleChoice>;

function loadStored(): AiTitleTable {
  try {
    const raw = localStorage.getItem(storageKeyFor(activeSaveId));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function persist(table: AiTitleTable) {
  try {
    localStorage.setItem(storageKeyFor(activeSaveId), JSON.stringify(table));
  } catch {
    // Storage full/unavailable, title choices just won't persist across reloads this session.
  }
}

// "Occasionally" wearing something else, not "usually" — this is flavor variety, the equipped title should
// read as stable the overwhelming majority of the time.
const OVERRIDE_DAILY_CHANCE = 0.015;
const OVERRIDE_MIN_DAYS = 3;
const OVERRIDE_MAX_DAYS = 9;

interface AiTitleState {
  choices: AiTitleTable;
  /** Picks which of `titles` this identity should actually be shown wearing right now. Returns null if
   *  they have no titles at all. Safe to call every time a match/opponent is generated — the daily
   *  override roll is internally gated to once per in-game day, everything else is cheap comparisons. */
  getEquippedTitle: (name: string, titles: TitleEntry[], currentDate: SimDate) => TitleEntry | null;
  /** Switches this store over to a different save's title-choice history, mirrors useTournamentStore.ts/
   *  useRegionalRosterStore.ts. */
  loadForSave: (saveId: string) => void;
}

export const useAiTitleStore = create<AiTitleState>((set, get) => ({
  choices: loadStored(),

  getEquippedTitle: (name, titles, currentDate) => {
    if (titles.length === 0) return null;
    let best = titles[0];
    for (const t of titles) {
      if (titleImpressiveness(t) > titleImpressiveness(best)) best = t;
    }

    const state = get();
    const today = dateKey(currentDate);
    const existing = state.choices[name];
    let entry: AiTitleChoice;
    let changed = false;

    if (!existing || existing.lastBestTitleId !== best.id) {
      // Either never seen before, or their real best title has genuinely changed (earned something new/
      // better) — equip it immediately, drop whatever temporary override was showing.
      entry = { lastBestTitleId: best.id, overrideTitleId: null, overrideUntilKey: null, lastCheckedKey: today };
      changed = true;
    } else {
      entry = existing;
      if (entry.overrideUntilKey && entry.overrideUntilKey < today) {
        entry = { ...entry, overrideTitleId: null, overrideUntilKey: null };
        changed = true;
      }
      if (entry.lastCheckedKey !== today) {
        if (!entry.overrideTitleId && titles.length > 1) {
          const showRoll = (hashString(`${name}#title_override_roll#${today}`) % 10000) / 10000;
          if (showRoll < OVERRIDE_DAILY_CHANCE) {
            const others = titles.filter((t) => t.id !== best.id);
            const pick = others[hashString(`${name}#title_override_pick#${today}`) % others.length];
            const days = OVERRIDE_MIN_DAYS + (hashString(`${name}#title_override_days#${today}`) % (OVERRIDE_MAX_DAYS - OVERRIDE_MIN_DAYS + 1));
            entry = { ...entry, overrideTitleId: pick.id, overrideUntilKey: dateKey(addDays(currentDate, days)) };
          }
        }
        entry = { ...entry, lastCheckedKey: today };
        changed = true;
      }
    }

    if (changed) {
      const nextTable = { ...state.choices, [name]: entry };
      set({ choices: nextTable });
      persist(nextTable);
    }

    if (entry.overrideTitleId) {
      const overrideTitle = titles.find((t) => t.id === entry.overrideTitleId);
      if (overrideTitle) return overrideTitle;
    }
    return best;
  },

  loadForSave: (saveId) => {
    activeSaveId = saveId;
    set({ choices: loadStored() });
  },
}));
