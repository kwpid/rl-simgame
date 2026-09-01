import { create } from "zustand";
import type { IconName } from "@/ui/components/Icon";

export type ScreenId =
  | "home"
  | "stats"
  | "training"
  | "ranked"
  | "tournaments"
  | "org"
  | "social"
  | "locker"
  | "settings";

export interface NavItem {
  id: ScreenId;
  label: string;
  icon: IconName;
}

export const NAV_ITEMS: NavItem[] = [
  { id: "home", label: "Home", icon: "home" },
  { id: "stats", label: "Stats", icon: "stats" },
  { id: "training", label: "Training", icon: "training" },
  { id: "ranked", label: "Ranked", icon: "ranked" },
  { id: "tournaments", label: "Tourneys", icon: "tournaments" },
  { id: "org", label: "Org", icon: "org" },
  { id: "social", label: "Social", icon: "social" },
  { id: "locker", label: "Locker", icon: "locker" },
];

interface AppState {
  screen: ScreenId;
  setScreen: (screen: ScreenId) => void;
}

export const useAppStore = create<AppState>((set) => ({
  screen: "home",
  setScreen: (screen) => set({ screen }),
}));
