// Write-through persistence: whenever the save store changes, debounce a write back to IndexedDB under
// whichever save is currently active. Imported once for its side effect (see main.tsx). Not active until
// an active save id actually exists (during Save Select/Create there's nothing to write yet).

import { useSaveStore } from "./useSaveStore";
import { writeSave, getActiveSaveId } from "@/data/saveManager";
import type { SaveData } from "@/data/mockSave";

const DEBOUNCE_MS = 800;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

// Strips every action function off the store, generically, so a new action added later (dev tools,
// training, whatever) can never sneak an unserializable function into an IndexedDB write again, this bit
// us once already when a new action was added here without being added to a manual exclusion list.
// Exported so SettingsScreen's export-to-file feature can grab the exact same plain-data snapshot IndexedDB
// itself would have written, without duplicating the stripping logic.
export function extractSaveData(state: ReturnType<typeof useSaveStore.getState>): SaveData {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    if (typeof value !== "function") data[key] = value;
  }
  return data as SaveData;
}

useSaveStore.subscribe((state) => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    const activeId = await getActiveSaveId();
    if (!activeId) return;
    await writeSave(activeId, extractSaveData(state));
  }, DEBOUNCE_MS);
});
