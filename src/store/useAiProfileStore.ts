// Tiny piece of global state driving the AI Profile overlay (see AiProfileModal.tsx) — which named
// opponent (if any) the player just clicked from a Recent Matches row. Session-only, not persisted.

import { create } from "zustand";

interface AiProfileState {
  viewingName: string | null;
  open: (name: string) => void;
  close: () => void;
}

export const useAiProfileStore = create<AiProfileState>((set) => ({
  viewingName: null,
  open: (name) => set({ viewingName: name }),
  close: () => set({ viewingName: null }),
}));
