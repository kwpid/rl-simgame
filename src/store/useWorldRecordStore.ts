// Permanent, per-save "world record" of the single highest MMR ever recorded while sitting #1 on the Top
// 100 leaderboard, one per queue (1v1/2v2/3v3) — who holds it, and which season it happened. Deliberately a
// separate table from any one entity's own peakMmr (which "Reset AI" or a fresh roster reseed can wipe out
// from under them): once a name sets the record here, it's a permanent fact of this save's own history,
// never overwritten by anything except a genuinely higher #1 later on. Checked opportunistically whenever
// RankedScreen already assembles the full global leaderboard for display (see its own effect) rather than
// via a continuous background sweep — the expensive "gather every pro/grinder" work is already happening
// there for the UI, this just piggybacks on it.

import { create } from "zustand";
import type { QueueMode } from "@/data/mockSave";

const STORAGE_KEY_PREFIX = "rl-sim:world-records-v1";

let activeSaveId: string | null = null;

function storageKeyFor(saveId: string | null): string {
  return `${STORAGE_KEY_PREFIX}:${saveId ?? "unsaved"}`;
}

export interface WorldRecordEntry {
  mmr: number;
  holderName: string;
  seasonNumber: number;
  /** Calendar year it happened, for display alongside the season number. */
  year: number;
}

type WorldRecordTable = Partial<Record<QueueMode, WorldRecordEntry>>;

function loadStored(): WorldRecordTable {
  try {
    const raw = localStorage.getItem(storageKeyFor(activeSaveId));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function persist(table: WorldRecordTable) {
  try {
    localStorage.setItem(storageKeyFor(activeSaveId), JSON.stringify(table));
  } catch {
    // Storage full/unavailable, the record just won't persist across reloads this session.
  }
}

/** Raw (already-JSON-string) world-record blob for one save, read verbatim — same "lives outside SaveData
 *  entirely" reasoning as useRegionalRosterStore.ts's exportRegionalRosterDataForSave, so a save export/
 *  import doesn't silently leave the record behind. */
export function exportWorldRecordDataForSave(saveId: string): string | null {
  return localStorage.getItem(storageKeyFor(saveId));
}

export function importWorldRecordDataForSave(saveId: string, data: string | null | undefined): void {
  try {
    if (data) localStorage.setItem(storageKeyFor(saveId), data);
  } catch {
    // Storage full/unavailable, the imported record just won't carry over this session.
  }
}

interface WorldRecordStoreState {
  records: WorldRecordTable;
  /** Reports a candidate #1 for a queue - updates the record only if this genuinely beats whatever's
   *  already stored (never decreases, never gets overwritten by a lower or equal value). */
  reportLeader: (queue: QueueMode, mmr: number, holderName: string, seasonNumber: number, year: number) => void;
  loadForSave: (saveId: string) => void;
}

export const useWorldRecordStore = create<WorldRecordStoreState>((set, get) => ({
  records: {},

  reportLeader: (queue, mmr, holderName, seasonNumber, year) => {
    const state = get();
    const existing = state.records[queue];
    if (existing && existing.mmr >= mmr) return; // not a new record, leave the standing one alone
    const nextRecords: WorldRecordTable = { ...state.records, [queue]: { mmr, holderName, seasonNumber, year } };
    set({ records: nextRecords });
    persist(nextRecords);
  },

  loadForSave: (saveId) => {
    activeSaveId = saveId;
    set({ records: loadStored() });
  },
}));
