import { useEffect, useState } from "react";
import App from "./App";
import { SaveSelectScreen } from "@/ui/screens/SaveSelectScreen";
import { SaveCreateScreen } from "@/ui/screens/SaveCreateScreen";
import { useSaveStore } from "@/store/useSaveStore";
import { useTournamentStore } from "@/store/useTournamentStore";
import { useRegionalRosterStore } from "@/store/useRegionalRosterStore";
import { useAiTitleStore } from "@/store/useAiTitleStore";
import {
  listSaves,
  loadSave,
  deleteSave,
  getActiveSaveId,
  setActiveSaveId,
  seedDemoSave,
  type SaveSummary,
} from "@/data/saveManager";

type BootPhase = "loading" | "select" | "create" | "ready";

export default function AppRoot() {
  const [phase, setPhase] = useState<BootPhase>("loading");
  const [saves, setSaves] = useState<SaveSummary[]>([]);

  useEffect(() => {
    (async () => {
      let list = await listSaves();
      if (list.length === 0) {
        const demo = await seedDemoSave();
        list = [demo];
      }

      const activeId = await getActiveSaveId();
      if (activeId) {
        const data = await loadSave(activeId);
        if (data) {
          useSaveStore.getState().initFromSave(data);
          useTournamentStore.getState().loadForSave(activeId);
          useRegionalRosterStore.getState().loadForSave(activeId);
          useAiTitleStore.getState().loadForSave(activeId);
          setPhase("ready");
          return;
        }
      }
      setSaves(list);
      setPhase("select");
    })();
  }, []);

  async function refreshSaves() {
    setSaves(await listSaves());
  }

  async function handleSelect(id: string) {
    const data = await loadSave(id);
    if (!data) return;
    useSaveStore.getState().initFromSave(data);
    useTournamentStore.getState().loadForSave(id);
    useRegionalRosterStore.getState().loadForSave(id);
    useAiTitleStore.getState().loadForSave(id);
    await setActiveSaveId(id);
    setPhase("ready");
  }

  async function handleDelete(id: string) {
    await deleteSave(id);
    await refreshSaves();
  }

  async function handleCreated(summary: SaveSummary) {
    await handleSelect(summary.id);
  }

  async function handleImported(summary: SaveSummary) {
    await handleSelect(summary.id);
  }

  if (phase === "loading") {
    return <div style={{ minHeight: "100vh", background: "var(--bg-app)" }} />;
  }

  if (phase === "select") {
    return (
      <SaveSelectScreen
        saves={saves}
        onSelect={handleSelect}
        onDelete={handleDelete}
        onCreateNew={() => setPhase("create")}
        onImported={handleImported}
      />
    );
  }

  if (phase === "create") {
    return <SaveCreateScreen onCreated={handleCreated} onCancel={saves.length > 0 ? () => setPhase("select") : null} />;
  }

  return <App />;
}
