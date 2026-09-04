import { useEffect, useRef, useState } from "react";
import { Card } from "@/ui/components/Card";
import { SectionShell } from "@/ui/components/LockedSection";
import { Icon } from "@/ui/components/Icon";
import { useSaveStore } from "@/store/useSaveStore";
import { extractSaveData } from "@/store/persistBootstrap";
import { REGION_LABELS, type QueueMode } from "@/data/mockSave";
import { setActiveSaveId, importSaveFile, getActiveSaveId, exportSaveBundle, type SaveSummary } from "@/data/saveManager";
import { QUEUES, QUEUE_LABELS } from "@/data/queues";
import { TIER_LABELS, eraForDate, type RankTierId } from "@/data/rankSystem";
import { MECHANICS, FOUNDATION_LABELS, type FoundationCategory } from "@/data/mechanics";
import { QUEUE_CONCEPTS } from "@/data/queueConcepts";
import { useProLeaderboardStore } from "@/store/useProLeaderboardStore";
import { useLeaderboardFillerStore } from "@/store/useLeaderboardFillerStore";
import { useTournamentStore } from "@/store/useTournamentStore";
import { useRegionalRosterStore } from "@/store/useRegionalRosterStore";
import { rlcsSeasonForDate } from "@/data/tournaments";
import { seasonTitleFor } from "@/data/seasons";
import { activeProPlayers, type ProRegion } from "@/data/proPlayers";
import { usePfpStore } from "@/store/usePfpStore";
import { PFP_POOL, hasPfpPool } from "@/data/pfps";
import { Avatar } from "@/ui/components/Avatar";

const DEV_MODE_KEY = "rl-sim:dev-mode";
const REWARD_TIER_OPTIONS: RankTierId[] = [
  "unranked", "bronze", "silver", "gold", "platinum", "diamond", "champion", "grand_champion", "ssl",
];

export function SettingsScreen() {
  const s = useSaveStore();
  const setDisplayName = useSaveStore((store) => store.setDisplayName);
  const [confirming, setConfirming] = useState(false);
  const [devMode, setDevMode] = useState(() => localStorage.getItem(DEV_MODE_KEY) === "1");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(s.displayName);
  const [importError, setImportError] = useState<string | null>(null);
  const [importedSave, setImportedSave] = useState<SaveSummary | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const setPlayerPfp = useSaveStore((store) => store.setPlayerPfp);
  const [pfpPickerOpen, setPfpPickerOpen] = useState(false);
  const [pfpError, setPfpError] = useState<string | null>(null);
  const [pfpResetMessage, setPfpResetMessage] = useState<string | null>(null);
  const pfpFileInputRef = useRef<HTMLInputElement>(null);
  const pfpResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    localStorage.setItem(DEV_MODE_KEY, devMode ? "1" : "0");
  }, [devMode]);

  useEffect(() => {
    return () => {
      if (pfpResetTimerRef.current) clearTimeout(pfpResetTimerRef.current);
    };
  }, []);

  async function handleSignOut() {
    await setActiveSaveId(null);
    window.location.reload();
  }

  function handleSaveName() {
    setDisplayName(nameDraft);
    setEditingName(false);
  }

  async function handleExport() {
    const state = useSaveStore.getState();
    const era = eraForDate(state.currentDate);
    const currentYear = state.currentDate.year;
    // Org team composition (data/tournaments.ts's generateTeamsForRegion, via eligibleRealPlayersForRegion)
    // is only as stable as the pro/regional-roster MMR cache it sorts by — an entry that was never actually
    // looked up during casual play simply isn't in the exported blob yet, so the OTHER device would freshly
    // reseed/simulate it with fresh randomness the moment it's needed, silently reshuffling who lands on
    // which team and breaking "am I still on my signed org's roster" (applyPlayerOrgOverride) and "is this
    // AI still one of my teammates" (realOrgTagForPlayer) after the move. Force every real pro and every
    // regional grinder's 2v2 entry (the queue org eligibility always checks) to be concretely cached before
    // snapshotting, so nothing gets freshly rerolled on the receiving device.
    const ALL_PRO_REGIONS: ProRegion[] = ["NA", "EU", "OCE", "SAM", "MENA", "APAC", "SSA"];
    useProLeaderboardStore.getState().ensureSeeded(activeProPlayers(currentYear).map((p) => p.name), "2v2", era, currentYear, state.currentDate, state.seasonStartDate);
    ALL_PRO_REGIONS.forEach((region) => useRegionalRosterStore.getState().ensureSeeded(region, "2v2", era, currentYear, state.currentDate, state.seasonStartDate));

    const data = extractSaveData(useSaveStore.getState());
    // Bundles in the RLCS history/regional-roster/title-choice/leaderboard state that lives in its own
    // localStorage blobs rather than on `data` itself — without this, a save moved to another device would
    // silently lose all of that (see saveManager.ts's exportSaveBundle doc comment).
    const activeId = await getActiveSaveId();
    const bundle = exportSaveBundle(activeId ?? "unsaved", data);
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rl-sim-${s.username}-${s.currentDate.year}${String(s.currentDate.month).padStart(2, "0")}${String(s.currentDate.day).padStart(2, "0")}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function handleImportFile(file: File) {
    setImportError(null);
    setImportedSave(null);
    try {
      const text = await file.text();
      const raw = JSON.parse(text);
      const summary = await importSaveFile(raw);
      setImportedSave(summary);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Couldn't import that file.");
    }
  }

  const PFP_MAX_BYTES = 1_500_000; // ~1.5MB — this gets stored as a base64 data URL in localStorage, keep it modest

  function handlePfpFile(file: File) {
    setPfpError(null);
    if (!file.type.startsWith("image/")) {
      setPfpError("That's not an image file.");
      return;
    }
    if (file.size > PFP_MAX_BYTES) {
      setPfpError("That image is too large — pick something under 1.5MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setPlayerPfp(reader.result);
    };
    reader.onerror = () => setPfpError("Couldn't read that file.");
    reader.readAsDataURL(file);
  }

  function handleResetPfps() {
    usePfpStore.getState().resetAll();
    setPfpResetMessage("Done — every AI (and friend) will reassign from the current picture pool.");
    if (pfpResetTimerRef.current) clearTimeout(pfpResetTimerRef.current);
    pfpResetTimerRef.current = setTimeout(() => setPfpResetMessage(null), 4000);
  }

  async function handleSwitchToImported() {
    if (!importedSave) return;
    await setActiveSaveId(importedSave.id);
    window.location.reload();
  }

  return (
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      <header style={{ marginBottom: "var(--space-4)" }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 650 }}>Settings</h1>
      </header>

      <SectionShell title="Save Profile">
        <Card>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: "var(--text-secondary)" }}>Display Name</span>
              {editingName ? (
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    className="settings-name-input"
                    value={nameDraft}
                    maxLength={24}
                    onChange={(e) => setNameDraft(e.target.value)}
                    autoFocus
                  />
                  <button className="settings-name-btn" onClick={handleSaveName}>Save</button>
                  <button
                    className="settings-name-btn settings-name-btn-secondary"
                    onClick={() => {
                      setNameDraft(s.displayName);
                      setEditingName(false);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontWeight: 600 }}>{s.displayName}</span>
                  <button className="settings-name-btn" onClick={() => setEditingName(true)}>Change</button>
                </span>
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-secondary)" }}>Username</span>
              <span style={{ fontWeight: 600 }} title="Your fixed account ID, shown to no one, can't be changed">
                {s.username}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-secondary)" }}>Real name</span>
              <span>{s.realName}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-secondary)" }}>Region</span>
              <span>{REGION_LABELS[s.region]}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-secondary)" }}>Started</span>
              <span>{s.startDate.year}</span>
            </div>
          </div>
        </Card>
      </SectionShell>

      <SectionShell title="Backup">
        <Card>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              Export this save to a file you can move to another device (a phone, another browser) and
              import it back in there.
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="settings-name-btn" onClick={handleExport}>
                Export Save
              </button>
              <button className="settings-name-btn" onClick={() => fileInputRef.current?.click()}>
                Import Save
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImportFile(file);
                  e.target.value = "";
                }}
              />
            </div>
            {importError && <div style={{ fontSize: 12, color: "var(--danger)" }}>{importError}</div>}
            {importedSave && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  Imported "{importedSave.displayName}" as a new save.
                </span>
                <button className="settings-name-btn" onClick={handleSwitchToImported}>
                  Switch to it now
                </button>
              </div>
            )}
          </div>
        </Card>
      </SectionShell>

      <SectionShell title="Profile Picture">
        <Card>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Avatar name={s.displayName} currentDate={s.currentDate} size={56} overrideUrl={s.playerPfp} notable />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="settings-name-btn" onClick={() => pfpFileInputRef.current?.click()}>
                  Upload Image
                </button>
                <button className="settings-name-btn" onClick={() => setPfpPickerOpen((v) => !v)} disabled={!hasPfpPool()}>
                  Choose from Pool
                </button>
                {s.playerPfp && (
                  <button className="settings-name-btn settings-name-btn-secondary" onClick={() => setPlayerPfp(null)}>
                    Clear
                  </button>
                )}
                <input
                  ref={pfpFileInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handlePfpFile(file);
                    e.target.value = "";
                  }}
                />
              </div>
            </div>
            {pfpError && <div style={{ fontSize: 12, color: "var(--danger)" }}>{pfpError}</div>}
            {pfpPickerOpen && (
              <div className="pfp-pool-grid">
                {PFP_POOL.map((url) => (
                  <button
                    key={url}
                    type="button"
                    className="pfp-pool-item"
                    onClick={() => {
                      setPlayerPfp(url);
                      setPfpPickerOpen(false);
                    }}
                  >
                    <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 6 }} />
                  </button>
                ))}
              </div>
            )}
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              Every tracked AI (and friend) gets a picture assigned automatically from{" "}
              <code>src/assets/pfps/</code> too — drop image files in there and, if you add or remove any,
              reset below so everyone reassigns against the current set right away instead of only whenever
              they'd naturally change.
              {!hasPfpPool() && " No pictures found in that folder yet — everyone shows the default avatar instead."}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <button className="settings-name-btn" onClick={handleResetPfps}>
                Reset AI Profile Pictures
              </button>
              {pfpResetMessage && (
                <span style={{ fontSize: 12, color: "var(--success)" }}>{pfpResetMessage}</span>
              )}
            </div>
          </div>
        </Card>
      </SectionShell>

      <SectionShell title="Account">
        <Card>
          {!confirming ? (
            <button className="signout-btn" onClick={() => setConfirming(true)}>
              <Icon name="logout" size={16} />
              Sign Out
            </button>
          ) : (
            <div className="signout-confirm">
              <span>Sign out of {s.displayName}? Your progress is already saved, you can pick this save again later.</span>
              <div className="signout-confirm-actions">
                <button className="signout-btn signout-btn-danger" onClick={handleSignOut}>
                  Sign Out
                </button>
                <button className="signout-btn signout-btn-secondary" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </Card>
      </SectionShell>

      <SectionShell title="Developer Mode">
        <Card>
          <label className="dev-toggle-row">
            <input type="checkbox" checked={devMode} onChange={(e) => setDevMode(e.target.checked)} />
            <span>Enable developer testing tools</span>
          </label>
        </Card>
      </SectionShell>

      {devMode && <DeveloperToolsSection />}

      <style>{`
        .settings-name-input {
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-sm);
          color: var(--text-primary);
          font-size: 13px;
          padding: 5px 8px;
          width: 140px;
        }
        .settings-name-input:focus {
          outline: none;
          border-color: var(--accent);
        }
        .settings-name-btn {
          background: var(--bg-surface-raised);
          border: 1px solid var(--border-subtle);
          color: var(--text-primary);
          border-radius: var(--radius-sm);
          font-size: 12px;
          font-weight: 600;
          padding: 5px 10px;
          cursor: pointer;
        }
        .settings-name-btn:hover {
          border-color: var(--accent);
          color: var(--accent);
        }
        .settings-name-btn-secondary {
          background: none;
        }
        .pfp-pool-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(48px, 1fr));
          gap: 8px;
          max-height: 220px;
          overflow-y: auto;
          padding: 8px;
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
        }
        .pfp-pool-item {
          width: 48px;
          height: 48px;
          padding: 0;
          background: none;
          border: 1px solid transparent;
          border-radius: 8px;
          cursor: pointer;
        }
        .pfp-pool-item:hover {
          border-color: var(--accent);
        }
        .dev-toggle-row {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 13px;
          color: var(--text-primary);
          cursor: pointer;
        }
        .signout-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: var(--bg-surface-raised);
          border: 1px solid var(--border-strong);
          color: var(--text-primary);
          border-radius: var(--radius-md);
          font-size: 13px;
          font-weight: 600;
          padding: 10px 16px;
          cursor: pointer;
        }
        .signout-btn:hover {
          border-color: var(--danger);
          color: var(--danger);
        }
        .signout-confirm {
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
          font-size: 13px;
          color: var(--text-secondary);
        }
        .signout-confirm-actions {
          display: flex;
          gap: var(--space-2);
        }
        .signout-btn-danger {
          background: rgba(217,100,91,0.16);
          color: var(--danger);
          border-color: transparent;
        }
        .signout-btn-secondary {
          background: none;
        }
      `}</style>
    </div>
  );
}

function DeveloperToolsSection() {
  const s = useSaveStore();
  const devAddGameSense = useSaveStore((store) => store.devAddGameSense);
  const devAddMechanicalConsistency = useSaveStore((store) => store.devAddMechanicalConsistency);
  const devSetGameSense = useSaveStore((store) => store.devSetGameSense);
  const devSetMechanicalConsistency = useSaveStore((store) => store.devSetMechanicalConsistency);
  const devMaxFoundationStats = useSaveStore((store) => store.devMaxFoundationStats);
  const devMaxMechanics = useSaveStore((store) => store.devMaxMechanics);
  const devMaxQueueConcepts = useSaveStore((store) => store.devMaxQueueConcepts);
  const devSetMechanic = useSaveStore((store) => store.devSetMechanic);
  const devRandomizeMechanics = useSaveStore((store) => store.devRandomizeMechanics);
  const devSetQueueConcept = useSaveStore((store) => store.devSetQueueConcept);
  const devRandomizeQueueConcepts = useSaveStore((store) => store.devRandomizeQueueConcepts);
  const devSetFoundationStat = useSaveStore((store) => store.devSetFoundationStat);
  const devAddSkillPoints = useSaveStore((store) => store.devAddSkillPoints);
  const devSetMmr = useSaveStore((store) => store.devSetMmr);
  const devSetRewardLevel = useSaveStore((store) => store.devSetRewardLevel);
  const devSetCareerStats = useSaveStore((store) => store.devSetCareerStats);
  const devSetSeasonNumber = useSaveStore((store) => store.devSetSeasonNumber);
  const devSetLevel = useSaveStore((store) => store.devSetLevel);
  const resetProLeaderboard = useProLeaderboardStore((store) => store.resetAll);
  const resetFillerLeaderboard = useLeaderboardFillerStore((store) => store.resetAll);
  const resetRegionalRoster = useRegionalRosterStore((store) => store.resetAll);
  const resetAllInstances = useTournamentStore((store) => store.resetAllInstances);
  const resetRlcsTeams = useSaveStore((store) => store.resetRlcsTeams);
  const fullResetRlcsAndTournaments = useSaveStore((store) => store.fullResetRlcsAndTournaments);
  const forceOrgInvite = useSaveStore((store) => store.forceOrgInvite);
  const releaseOrgContract = useSaveStore((store) => store.releaseOrgContract);
  const recordOrgTryoutScrim = useSaveStore((store) => store.recordOrgTryoutScrim);
  const recordOrgScrimResult = useSaveStore((store) => store.recordOrgScrimResult);
  const addTitle = useSaveStore((store) => store.addTitle);

  const [mmrQueue, setMmrQueue] = useState<QueueMode>("2v2");
  const [mmrValue, setMmrValue] = useState(String(s.rankedProfiles["2v2"].mmr));
  const [statsQueue, setStatsQueue] = useState<QueueMode>("2v2");
  const [gameSenseValue, setGameSenseValue] = useState(String(s.player.gameSense["2v2"]));
  const [mechConsistencyValue, setMechConsistencyValue] = useState(String(s.player.mechanicalConsistency["2v2"]));
  const [rewardTier, setRewardTier] = useState<RankTierId>(s.rewardTierUnlocked);
  const [rewardWins, setRewardWins] = useState("0");
  const [seasonNumberValue, setSeasonNumberValue] = useState(String(s.seasonNumber));
  const [levelValue, setLevelValue] = useState(String(s.level));
  const [titleSeasonValue, setTitleSeasonValue] = useState(String(s.seasonNumber));
  const [titleTier, setTitleTier] = useState<"grand_champion" | "ssl">("ssl");
  const [careerStatsQueue, setCareerStatsQueue] = useState<QueueMode>("2v2");
  const [careerWinsValue, setCareerWinsValue] = useState(String(s.careerStats["2v2"].wins));
  const [careerLossesValue, setCareerLossesValue] = useState(String(s.careerStats["2v2"].losses));
  const [seasonMatchesValue, setSeasonMatchesValue] = useState(String(s.rankedProfiles["2v2"].seasonMatchesPlayed));

  const [mechanicId, setMechanicId] = useState(MECHANICS[0].id);
  const [mechanicValue, setMechanicValue] = useState("1000");
  const [mechanicRandomMin, setMechanicRandomMin] = useState("500");
  const [mechanicRandomMax, setMechanicRandomMax] = useState("2000");
  const [conceptRandomMin, setConceptRandomMin] = useState("500");
  const [conceptRandomMax, setConceptRandomMax] = useState("2000");
  const [conceptId, setConceptId] = useState(QUEUE_CONCEPTS[0].id);
  const [conceptValue, setConceptValue] = useState("1000");
  const [foundationCategory, setFoundationCategory] = useState<FoundationCategory>("carControl");
  const [foundationValue, setFoundationValue] = useState("1000");

  return (
    <SectionShell title="Developer Tools">
      <Card>
        <div className="dev-tools">
          <div className="dev-tools-group">
            <span className="dev-tools-label">Stats</span>
            <div className="dev-tools-row">
              <button className="dev-btn" onClick={() => QUEUES.forEach((q) => devAddGameSense(q, 1000))}>+1,000 Game Sense (all queues)</button>
              <button className="dev-btn" onClick={() => QUEUES.forEach((q) => devAddGameSense(q, 10000))}>+10,000 Game Sense (all queues)</button>
              <button className="dev-btn" onClick={() => QUEUES.forEach((q) => devAddMechanicalConsistency(q, 1000))}>+1,000 Mech. Consistency (all queues)</button>
              <button className="dev-btn" onClick={() => QUEUES.forEach((q) => devAddMechanicalConsistency(q, 10000))}>+10,000 Mech. Consistency (all queues)</button>
            </div>
            <div className="dev-tools-row">
              <button className="dev-btn" onClick={devMaxFoundationStats}>Max Foundation Stats</button>
              <button className="dev-btn" onClick={devMaxMechanics}>Max All Mechanics</button>
              <button className="dev-btn" onClick={devMaxQueueConcepts}>Max All Playlist Concepts</button>
            </div>
          </div>

          <div className="dev-tools-group">
            <span className="dev-tools-label">Set Game Sense / Mech. Consistency (per queue)</span>
            <div className="dev-tools-row">
              <select className="dev-select" value={statsQueue} onChange={(e) => setStatsQueue(e.target.value as QueueMode)}>
                {QUEUES.map((q) => (
                  <option key={q} value={q}>{QUEUE_LABELS[q]}</option>
                ))}
              </select>
              <input
                className="dev-input"
                type="number"
                value={gameSenseValue}
                onChange={(e) => setGameSenseValue(e.target.value)}
                placeholder="Game Sense"
              />
              <button className="dev-btn" onClick={() => devSetGameSense(statsQueue, Number(gameSenseValue) || 0)}>Set Game Sense</button>
            </div>
            <div className="dev-tools-row">
              <input
                className="dev-input"
                type="number"
                value={mechConsistencyValue}
                onChange={(e) => setMechConsistencyValue(e.target.value)}
                placeholder="Mech. Consistency"
              />
              <button className="dev-btn" onClick={() => devSetMechanicalConsistency(statsQueue, Number(mechConsistencyValue) || 0)}>
                Set Mech. Consistency
              </button>
            </div>
          </div>

          <div className="dev-tools-group">
            <span className="dev-tools-label">Set a Specific Foundation Stat</span>
            <div className="dev-tools-row">
              <select
                className="dev-select"
                value={foundationCategory}
                onChange={(e) => setFoundationCategory(e.target.value as FoundationCategory)}
              >
                {(Object.keys(FOUNDATION_LABELS) as FoundationCategory[]).map((cat) => (
                  <option key={cat} value={cat}>{FOUNDATION_LABELS[cat]}</option>
                ))}
              </select>
              <input
                className="dev-input"
                type="number"
                value={foundationValue}
                onChange={(e) => setFoundationValue(e.target.value)}
              />
              <button className="dev-btn" onClick={() => devSetFoundationStat(foundationCategory, Number(foundationValue) || 0)}>Set</button>
            </div>
          </div>

          <div className="dev-tools-group">
            <span className="dev-tools-label">Set a Specific Mechanic</span>
            <div className="dev-tools-row">
              <select className="dev-select dev-select-wide" value={mechanicId} onChange={(e) => setMechanicId(e.target.value)}>
                {MECHANICS.map((m) => (
                  <option key={m.id} value={m.id}>{m.branch} — {m.label}</option>
                ))}
              </select>
              <input
                className="dev-input"
                type="number"
                value={mechanicValue}
                onChange={(e) => setMechanicValue(e.target.value)}
              />
              <button className="dev-btn" onClick={() => devSetMechanic(mechanicId, Number(mechanicValue) || 0)}>Set</button>
            </div>
          </div>

          <div className="dev-tools-group">
            <span className="dev-tools-label">Randomize All Mechanics (min-max)</span>
            <div className="dev-tools-row">
              <input
                className="dev-input"
                type="number"
                value={mechanicRandomMin}
                onChange={(e) => setMechanicRandomMin(e.target.value)}
                placeholder="Min"
              />
              <input
                className="dev-input"
                type="number"
                value={mechanicRandomMax}
                onChange={(e) => setMechanicRandomMax(e.target.value)}
                placeholder="Max"
              />
              <button
                className="dev-btn"
                onClick={() => devRandomizeMechanics(Number(mechanicRandomMin) || 0, Number(mechanicRandomMax) || 0)}
              >
                Randomize
              </button>
            </div>
          </div>

          <div className="dev-tools-group">
            <span className="dev-tools-label">Set a Specific Playlist Concept</span>
            <div className="dev-tools-row">
              <select className="dev-select dev-select-wide" value={conceptId} onChange={(e) => setConceptId(e.target.value)}>
                {QUEUE_CONCEPTS.map((c) => (
                  <option key={c.id} value={c.id}>{c.queue} — {c.label}</option>
                ))}
              </select>
              <input
                className="dev-input"
                type="number"
                value={conceptValue}
                onChange={(e) => setConceptValue(e.target.value)}
              />
              <button className="dev-btn" onClick={() => devSetQueueConcept(conceptId, Number(conceptValue) || 0)}>Set</button>
            </div>
          </div>

          <div className="dev-tools-group">
            <span className="dev-tools-label">Randomize All Playlist Concepts (min-max)</span>
            <div className="dev-tools-row">
              <input
                className="dev-input"
                type="number"
                value={conceptRandomMin}
                onChange={(e) => setConceptRandomMin(e.target.value)}
                placeholder="Min"
              />
              <input
                className="dev-input"
                type="number"
                value={conceptRandomMax}
                onChange={(e) => setConceptRandomMax(e.target.value)}
                placeholder="Max"
              />
              <button
                className="dev-btn"
                onClick={() => devRandomizeQueueConcepts(Number(conceptRandomMin) || 0, Number(conceptRandomMax) || 0)}
              >
                Randomize
              </button>
            </div>
          </div>

          <div className="dev-tools-group">
            <span className="dev-tools-label">Skill Points</span>
            <div className="dev-tools-row">
              <button className="dev-btn" onClick={() => devAddSkillPoints(5)}>+5 SP</button>
              <button className="dev-btn" onClick={() => devAddSkillPoints(20)}>+20 SP</button>
            </div>
          </div>

          <div className="dev-tools-group">
            <span className="dev-tools-label">Set MMR / Rank</span>
            <div className="dev-tools-row">
              <select className="dev-select" value={mmrQueue} onChange={(e) => setMmrQueue(e.target.value as QueueMode)}>
                {QUEUES.map((q) => (
                  <option key={q} value={q}>{QUEUE_LABELS[q]}</option>
                ))}
              </select>
              <input
                className="dev-input"
                type="number"
                value={mmrValue}
                onChange={(e) => setMmrValue(e.target.value)}
              />
              <button className="dev-btn" onClick={() => devSetMmr(mmrQueue, Number(mmrValue) || 0)}>Set MMR</button>
            </div>
          </div>

          <div className="dev-tools-group">
            <span className="dev-tools-label">Leaderboard</span>
            <div className="dev-tools-row">
              <button
                className="dev-btn"
                onClick={() => {
                  const era = eraForDate(s.currentDate);
                  resetProLeaderboard(era, s.currentDate.year, s.seasonStartDate);
                  resetFillerLeaderboard(era, s.currentDate.year, s.seasonStartDate);
                  resetRegionalRoster(era, s.currentDate.year, s.seasonStartDate);
                }}
              >
                Reset AI (regenerates every pro/grinder/filler from scratch with the latest formulas, no new save needed)
              </button>
            </div>
          </div>

          <div className="dev-tools-group">
            <span className="dev-tools-label">RLCS</span>
            <div className="dev-tools-row">
              <button
                className="dev-btn"
                onClick={() => {
                  resetAllInstances(s.currentDate);
                }}
              >
                Restart RLCS Season (fresh regionals in ~7d, re-signs org if under contract)
              </button>
            </div>
            <div className="dev-tools-row">
              <button
                className="dev-btn"
                onClick={() => {
                  resetRlcsTeams();
                }}
              >
                Reset Teams (regenerates every region's real rosters, also resets RLCS season)
              </button>
            </div>
            <div className="dev-tools-row">
              <button
                className="dev-btn"
                onClick={() => {
                  fullResetRlcsAndTournaments();
                }}
              >
                Full Reset RLCS &amp; Tournaments (hard-deletes all saved tournament data, use if RLCS is stuck/broken)
              </button>
            </div>
          </div>

          <div className="dev-tools-group">
            <span className="dev-tools-label">Org</span>
            <div className="dev-tools-row">
              <button
                className="dev-btn"
                onClick={() => {
                  forceOrgInvite(s.currentDate, eraForDate(s.currentDate), s.currentDate.year);
                }}
              >
                Force Org Invite / Tryout (skips phase, rank, and chance gates)
              </button>
              <button
                className="dev-btn"
                disabled={!s.pendingOrgTryout && !s.orgContract}
                onClick={() => {
                  if (s.pendingOrgTryout) {
                    recordOrgTryoutScrim(true, s.currentDate, rlcsSeasonForDate(s.currentDate).seasonNumber);
                  } else if (s.orgContract) {
                    recordOrgScrimResult(true, s.currentDate);
                  }
                }}
              >
                Force Win Scrim (tryout or signed contract)
              </button>
              <button
                className="dev-btn"
                onClick={() => {
                  releaseOrgContract(s.currentDate);
                }}
              >
                Release Current Org Contract
              </button>
            </div>
          </div>

          <div className="dev-tools-group">
            <span className="dev-tools-label">Set Reward Level (account-wide)</span>
            <div className="dev-tools-row">
              <select className="dev-select" value={rewardTier} onChange={(e) => setRewardTier(e.target.value as RankTierId)}>
                {REWARD_TIER_OPTIONS.map((t) => (
                  <option key={t} value={t}>{TIER_LABELS[t]}</option>
                ))}
              </select>
              <input
                className="dev-input"
                type="number"
                value={rewardWins}
                onChange={(e) => setRewardWins(e.target.value)}
                title="Wins progress toward the next tier, 0-10"
              />
              <button className="dev-btn" onClick={() => devSetRewardLevel(rewardTier, Number(rewardWins) || 0)}>Set</button>
            </div>
          </div>

          <div className="dev-tools-group">
            <span className="dev-tools-label">Set Ranked Season</span>
            <div className="dev-tools-row">
              <input
                className="dev-input"
                type="number"
                min={1}
                value={seasonNumberValue}
                onChange={(e) => setSeasonNumberValue(e.target.value)}
                title="Current season number, 1+"
              />
              <button className="dev-btn" onClick={() => devSetSeasonNumber(Number(seasonNumberValue) || 1)}>
                Set (AI titles from earlier seasons show up automatically)
              </button>
            </div>
          </div>

          <div className="dev-tools-group">
            <span className="dev-tools-label">Set Player Level</span>
            <div className="dev-tools-row">
              <input
                className="dev-input"
                type="number"
                min={1}
                value={levelValue}
                onChange={(e) => setLevelValue(e.target.value)}
                title="Player level, 1+"
              />
              <button className="dev-btn" onClick={() => devSetLevel(Number(levelValue) || 1)}>
                Set (grants every level title you'd have earned by then)
              </button>
            </div>
          </div>

          <div className="dev-tools-group">
            <span className="dev-tools-label">Give Yourself a Title</span>
            <div className="dev-tools-row">
              <input
                className="dev-input"
                type="number"
                min={1}
                value={titleSeasonValue}
                onChange={(e) => setTitleSeasonValue(e.target.value)}
                title="Which season number this title is for"
              />
              <select className="dev-select" value={titleTier} onChange={(e) => setTitleTier(e.target.value as "grand_champion" | "ssl")}>
                <option value="grand_champion">Grand Champion</option>
                <option value="ssl">Supersonic Legend</option>
              </select>
              <button
                className="dev-btn"
                onClick={() => {
                  const seasonNum = Math.max(1, Math.round(Number(titleSeasonValue) || 1));
                  const era = eraForDate(s.currentDate);
                  // Legacy has no SSL, granting one there just falls back to the legacy GC title instead of
                  // silently producing a title that couldn't have existed yet.
                  const tier = era === "legacy" ? "grand_champion" : titleTier;
                  const title = seasonTitleFor(seasonNum, era, tier);
                  if (title) addTitle(title);
                }}
              >
                Grant Season Title
              </button>
            </div>
          </div>

          <div className="dev-tools-group">
            <span className="dev-tools-label">Set Career Stats (per queue)</span>
            <div className="dev-tools-row">
              <select className="dev-select" value={careerStatsQueue} onChange={(e) => setCareerStatsQueue(e.target.value as QueueMode)}>
                {QUEUES.map((q) => (
                  <option key={q} value={q}>{QUEUE_LABELS[q]}</option>
                ))}
              </select>
              <input
                className="dev-input"
                type="number"
                value={careerWinsValue}
                onChange={(e) => setCareerWinsValue(e.target.value)}
                placeholder="Wins"
                title="Lifetime career wins in this queue"
              />
              <input
                className="dev-input"
                type="number"
                value={careerLossesValue}
                onChange={(e) => setCareerLossesValue(e.target.value)}
                placeholder="Losses"
                title="Lifetime career losses in this queue"
              />
              <input
                className="dev-input"
                type="number"
                value={seasonMatchesValue}
                onChange={(e) => setSeasonMatchesValue(e.target.value)}
                placeholder="Season games"
                title="Games played this ranked season in this queue"
              />
              <button
                className="dev-btn"
                onClick={() => devSetCareerStats(careerStatsQueue, Number(careerWinsValue) || 0, Number(careerLossesValue) || 0, Number(seasonMatchesValue) || 0)}
              >
                Set
              </button>
            </div>
          </div>
        </div>
      </Card>

      <style>{`
        .dev-tools {
          display: flex;
          flex-direction: column;
          gap: var(--space-4);
        }
        .dev-tools-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .dev-tools-label {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          color: var(--text-tertiary);
        }
        .dev-tools-row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .dev-btn {
          background: var(--bg-surface-raised);
          border: 1px solid var(--border-subtle);
          color: var(--text-primary);
          border-radius: var(--radius-sm);
          font-size: 12px;
          font-weight: 600;
          padding: 7px 12px;
          cursor: pointer;
        }
        .dev-btn:hover {
          border-color: var(--accent);
          color: var(--accent);
        }
        .dev-select, .dev-input {
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          color: var(--text-primary);
          border-radius: var(--radius-sm);
          font-size: 12px;
          padding: 7px 10px;
        }
        .dev-input {
          width: 100px;
        }
        .dev-select-wide {
          max-width: 260px;
        }
      `}</style>
    </SectionShell>
  );
}
