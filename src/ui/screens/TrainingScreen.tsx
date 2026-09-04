import { useState } from "react";
import { Card } from "@/ui/components/Card";
import { UncappedStat } from "@/ui/components/UncappedStat";
import { StatBar } from "@/ui/components/StatBar";
import { SectionShell, LockedSection } from "@/ui/components/LockedSection";
import { Icon, type IconName } from "@/ui/components/Icon";
import { useSaveStore } from "@/store/useSaveStore";
import {
  FOUNDATION_GROUPS,
  FOUNDATION_LABELS,
  MECHANICS,
  getMechanicAvailability,
  type FoundationCategory,
} from "@/data/mechanics";
import {
  QUEUE_CONCEPTS,
  CONCEPT_CATEGORY_LABELS,
  getConceptAvailability,
  type ConceptCategory,
} from "@/data/queueConcepts";
import { QUEUES, QUEUE_LABELS, QUEUE_ICONS } from "@/data/queues";
import type { QueueMode, PlaystyleProfile } from "@/data/mockSave";

type TrainingTab = "foundation" | "mechanics" | "playlist" | "playstyle";

const TABS: { id: TrainingTab; label: string }[] = [
  { id: "foundation", label: "Foundation" },
  { id: "mechanics", label: "Mechanics" },
  { id: "playlist", label: "Playlist" },
  { id: "playstyle", label: "Playstyle" },
];

// A training session is built by checking off any mix of foundation stats, mechanics, and queue concepts
// at once (see SessionBuilderBar) - the selection lives here, at the screen level, so it survives switching
// between tabs instead of resetting per tab.
type SessionEntryKind = "mechanic" | "concept" | "foundation";
type SessionSelection = Map<string, SessionEntryKind>;

function labelForEntry(id: string, kind: SessionEntryKind): string {
  if (kind === "mechanic") return MECHANICS.find((m) => m.id === id)?.label ?? id;
  if (kind === "concept") return QUEUE_CONCEPTS.find((c) => c.id === id)?.label ?? id;
  return FOUNDATION_LABELS[id as FoundationCategory] ?? id;
}

const FOUNDATION_META: Record<FoundationCategory, { icon: IconName; color: string }> = {
  carControl: { icon: "steering", color: "var(--team-blue)" },
  aerialControl: { icon: "aerial", color: "var(--team-blue)" },
  boostManagement: { icon: "bolt", color: "var(--team-blue)" },
  offense: { icon: "crosshair", color: "var(--warning)" },
  defense: { icon: "shield", color: "var(--warning)" },
  passing: { icon: "swap", color: "var(--warning)" },
};

const BRANCH_META: Record<string, { icon: IconName; color: string }> = {
  Movement: { icon: "steering", color: "#5b8def" },
  "Ground Control": { icon: "cycle", color: "#7fb3c9" },
  Flicks: { icon: "bolt", color: "#6bb583" },
  "Aerial Control": { icon: "aerial", color: "#8a5cd6" },
  Pinches: { icon: "crosshair", color: "#d9645b" },
  "Defensive Mechanics": { icon: "shield", color: "#d9b357" },
  Positioning: { icon: "eye", color: "#9fa3ab" },
  Kickoff: { icon: "flag", color: "#d97757" },
  Passing: { icon: "swap", color: "#4fb8a6" },
  "Boost Management": { icon: "bolt", color: "#e3c76f" },
};

type PlaystyleTrait = keyof PlaystyleProfile;

const PLAYSTYLE_TRAIT_META: Record<PlaystyleTrait, { label: string; icon: IconName; color: string; high: string; low: string }> = {
  aggression: {
    label: "Aggression",
    icon: "crosshair",
    color: "var(--danger)",
    high: "Takes the riskier challenge and the bolder look instead of the safe play.",
    low: "Plays it patient, waits for the safer read before committing.",
  },
  rotationDiscipline: {
    label: "Rotation Discipline",
    icon: "shield",
    color: "var(--team-blue)",
    high: "Sticks to structure and holds the net even under pressure.",
    low: "Ball-chases more, structure slips when the game gets scrappy.",
  },
  mechanicalFlair: {
    label: "Mechanical Flair",
    icon: "bolt",
    color: "#d9b357",
    high: "Shows off mastered mechanics with the flashier finish instead of the plain shot.",
    low: "Keeps it simple, takes the straightforward option over the showy one.",
  },
  consistency: {
    label: "Consistency",
    icon: "cycle",
    color: "var(--success)",
    high: "Tighter day-to-day form, rarely has a truly off game.",
    low: "Bigger boom-or-bust swings, can pop off or go cold either way.",
  },
};

const PLAYSTYLE_TRAITS: PlaystyleTrait[] = ["aggression", "rotationDiscipline", "mechanicalFlair", "consistency"];

const CONCEPT_CATEGORY_META: Record<ConceptCategory, { icon: IconName; color: string }> = {
  mindset: { icon: "brain", color: "#b56bd9" },
  rotation: { icon: "cycle", color: "var(--team-blue)" },
  boost: { icon: "bolt", color: "#7fb3c9" },
  pressure: { icon: "crosshair", color: "var(--danger)" },
  teamplay: { icon: "social", color: "var(--success)" },
};

function IconBadge({ icon, color, size = 40 }: { icon: IconName; color: string; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "var(--radius-md)",
        background: `color-mix(in srgb, ${color} 18%, transparent)`,
        color,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <Icon name={icon} size={size * 0.5} />
    </div>
  );
}

function efficiencyColors(efficiency: number): { bg: string; text: string } {
  if (efficiency >= 100) return { bg: "rgba(107,181,131,0.16)", text: "var(--success)" };
  if (efficiency >= 60) return { bg: "rgba(217,179,87,0.16)", text: "var(--warning)" };
  return { bg: "rgba(217,100,91,0.16)", text: "var(--danger)" };
}

export function TrainingScreen() {
  const [tab, setTab] = useState<TrainingTab>("foundation");
  const s = useSaveStore();
  const trainSession = useSaveStore((store) => store.trainSession);
  const [selected, setSelected] = useState<SessionSelection>(new Map());

  function toggleSelected(id: string, kind: SessionEntryKind) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, kind);
      return next;
    });
  }

  function handleTrain(hours: number) {
    const entries = Array.from(selected.entries()).map(([id, kind]) => {
      let efficiencyPct = 100;
      if (kind === "mechanic") {
        const def = MECHANICS.find((m) => m.id === id)!;
        efficiencyPct = getMechanicAvailability(def, s.currentDate, s.foundationStats, s.mechanicProgress).efficiency;
      } else if (kind === "concept") {
        const def = QUEUE_CONCEPTS.find((c) => c.id === id)!;
        efficiencyPct = getConceptAvailability(def, s.foundationStats, s.player.gameSense[def.queue], s.queueConceptProgress).efficiency;
      }
      return { kind, id, efficiencyPct };
    });
    const result = trainSession(entries, hours);
    setSelected(new Map());
    return result;
  }

  return (
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      <header style={{ marginBottom: "var(--space-4)" }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 650 }}>Training</h1>
        <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>Foundation stats, the mechanic fund, and playlist-specific skills - check off anything you want to work on and train it all in one session</div>
        <div
          className="skill-point-pill"
          style={{ marginTop: "var(--space-2)" }}
          title="Earned by playing ranked. Spent on Tactical stats and Playlist concepts."
        >
          {s.skillPoints} SP
        </div>
      </header>

      <div className="training-tabbar" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={"training-tab" + (tab === t.id ? " training-tab-active" : "")}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <SessionBuilderBar selected={selected} onRemove={(id) => setSelected((prev) => { const next = new Map(prev); next.delete(id); return next; })} labelFor={labelForEntry} onTrain={handleTrain} />

      <div key={tab} className="fade-in">
        {tab === "foundation" && <FoundationTab selected={selected} toggleSelected={toggleSelected} />}
        {tab === "mechanics" && <MechanicsTab selected={selected} toggleSelected={toggleSelected} />}
        {tab === "playlist" && <PlaylistTab selected={selected} toggleSelected={toggleSelected} />}
        {tab === "playstyle" && <PlaystyleTab />}
      </div>

      <style>{`
        .training-tabbar {
          display: flex;
          gap: 4px;
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 4px;
          margin-bottom: var(--space-4);
        }
        .training-tab {
          flex: 1;
          background: none;
          border: none;
          border-radius: calc(var(--radius-md) - 2px);
          color: var(--text-secondary);
          font-size: 13px;
          padding: 8px 0;
          cursor: pointer;
          transition: background 150ms ease, color 150ms ease;
        }
        .training-tab-active {
          background: var(--accent-muted);
          color: var(--accent);
          font-weight: 600;
        }
        .card-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: var(--space-3);
        }
        @media (min-width: 640px) {
          .card-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }
        .foundation-card {
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
        }
        .foundation-card-top {
          display: flex;
          align-items: center;
          gap: var(--space-3);
        }
        .foundation-card-label {
          font-size: 14px;
          font-weight: 650;
          color: var(--text-primary);
        }
        .foundation-card-value {
          font-size: 22px;
          font-weight: 700;
        }
        .foundation-card-footer {
          display: flex;
          align-items: center;
          justify-content: flex-end;
        }
        .branch-header {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          margin-bottom: var(--space-3);
        }
        .branch-header-label {
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          font-weight: 700;
        }
        .mechanic-card {
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
        }
        .mechanic-top {
          display: flex;
          align-items: flex-start;
          gap: var(--space-3);
        }
        .mechanic-label {
          font-size: 15px;
          font-weight: 650;
          color: var(--text-primary);
        }
        .mechanic-efficiency {
          font-size: 11px;
          font-weight: 700;
          padding: 2px 8px;
          border-radius: 999px;
          display: inline-block;
          margin-top: 4px;
        }
        .mechanic-desc {
          font-size: 13px;
          color: var(--text-tertiary);
          margin: 0;
        }
        .mechanic-breakdown {
          font-size: 12px;
          color: var(--text-tertiary);
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .mechanic-hint {
          font-size: 12px;
          color: var(--text-secondary);
          background: var(--bg-surface-raised);
          border-radius: var(--radius-sm);
          padding: 6px 10px;
          width: fit-content;
        }
        .mechanic-footer {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          margin-top: 2px;
        }
        .queue-tabbar {
          display: flex;
          gap: 4px;
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 4px;
          margin-bottom: var(--space-4);
          max-width: 320px;
        }
        .queue-tab {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          background: none;
          border: none;
          border-radius: calc(var(--radius-md) - 2px);
          color: var(--text-secondary);
          font-size: 13px;
          font-weight: 600;
          padding: 8px 0;
          cursor: pointer;
          transition: background 150ms ease, color 150ms ease;
        }
        .queue-tab-active {
          background: var(--accent-muted);
          color: var(--accent);
        }
        .skill-point-pill {
          flex-shrink: 0;
          background: var(--accent-muted);
          color: var(--accent);
          font-size: 12px;
          font-weight: 700;
          padding: 6px 12px;
          border-radius: 999px;
          white-space: nowrap;
        }
        .sp-cost-tag {
          font-size: 11px;
          color: var(--text-tertiary);
        }
        .sp-locked {
          font-size: 12px;
          color: var(--text-secondary);
          background: var(--bg-surface-raised);
          border-radius: var(--radius-sm);
          padding: 8px 10px;
          text-align: center;
        }
        .branch-picker {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-bottom: var(--space-4);
        }
        .branch-pill {
          display: flex;
          align-items: center;
          gap: 6px;
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: 999px;
          color: var(--text-secondary);
          font-size: 12px;
          font-weight: 600;
          padding: 7px 12px;
          cursor: pointer;
          transition: border-color 150ms ease, background 150ms ease, color 150ms ease;
        }
        .branch-pill:hover {
          border-color: var(--border-strong);
        }
        .branch-pill-active {
          background: color-mix(in srgb, var(--branch-color) 18%, transparent);
          border-color: var(--branch-color);
          color: var(--branch-color);
        }
        .group-select-check {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: var(--text-secondary);
          cursor: pointer;
        }
        .group-select-check-disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .group-session-bar {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 10px;
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 10px 14px;
          margin-bottom: var(--space-4);
          position: sticky;
          top: 60px;
          z-index: 5;
        }
        .group-session-bar-done {
          color: var(--success, #6bcf8a);
          font-size: 13px;
          font-weight: 600;
        }
        .group-session-hint {
          font-size: 12px;
          color: var(--text-tertiary);
        }
        .group-session-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .group-session-chip {
          display: flex;
          align-items: center;
          gap: 6px;
          background: var(--bg-surface-raised);
          border: 1px solid var(--border-subtle);
          border-radius: 999px;
          padding: 4px 6px 4px 10px;
          font-size: 12px;
          color: var(--text-primary);
        }
        .group-session-chip button {
          background: none;
          border: none;
          color: var(--text-tertiary);
          cursor: pointer;
          font-size: 14px;
          line-height: 1;
          padding: 2px;
        }
      `}</style>
    </div>
  );
}

interface TrainingSessionResult {
  gains: Record<string, number>;
  skillPointsSpent: number;
  skippedIds: string[];
}

/** The one, unified way to train now: check items off across any of the three tabs below (selection lives
 *  at the screen level so it survives switching tabs), set a duration, and confirm once. Total hours split
 *  evenly across everything selected, one shared fatigue/clock charge for the whole session - see
 *  useSaveStore.ts's trainSession. Stays mounted (rendering nothing) whenever nothing's selected and no
 *  session is mid-flight, so the "done" summary can display after the parent clears the selection. */
function SessionBuilderBar({
  selected,
  onRemove,
  labelFor,
  onTrain,
}: {
  selected: SessionSelection;
  onRemove: (id: string) => void;
  labelFor: (id: string, kind: SessionEntryKind) => string;
  onTrain: (hours: number) => TrainingSessionResult;
}) {
  const [phase, setPhase] = useState<"idle" | "training" | "done">("idle");
  const [hours, setHours] = useState(1);
  const [snapshot, setSnapshot] = useState<[string, SessionEntryKind][]>([]);
  const [result, setResult] = useState<TrainingSessionResult>({ gains: {}, skillPointsSpent: 0, skippedIds: [] });
  const entries = Array.from(selected.entries());

  if (phase === "idle" && entries.length === 0) return null;

  if (phase === "done") {
    return (
      <div className="group-session-bar group-session-bar-done">
        Session complete:{" "}
        {snapshot.map(([id, kind]) => `${labelFor(id, kind)} +${result.gains[id] ?? 0}`).join(", ")}
        {result.skippedIds.length > 0 &&
          ` — ${result.skippedIds.length} skipped (not enough Skill Points)`}
      </div>
    );
  }

  return (
    <div className="group-session-bar">
      {entries.length === 0 ? (
        <span className="group-session-hint">Check off items below to add them to this session.</span>
      ) : (
        <div className="group-session-chips">
          {entries.map(([id, kind]) => (
            <span key={id} className="group-session-chip">
              {labelFor(id, kind)}
              <button onClick={() => onRemove(id)} aria-label="Remove">
                &times;
              </button>
            </span>
          ))}
        </div>
      )}
      {entries.length > 0 && phase === "idle" && (
        <div className="train-btn-group">
          {[1, 2, 3].map((h) => (
            <button
              key={h}
              className="train-btn train-btn-hour"
              onClick={() => {
                setHours(h);
                setSnapshot(entries);
                setPhase("training");
                setTimeout(() => {
                  const r = onTrain(h);
                  setResult(r);
                  setPhase("done");
                  setTimeout(() => setPhase("idle"), 2400);
                }, 550);
              }}
            >
              {h}h
            </button>
          ))}
        </div>
      )}
      {phase === "training" && (
        <span className="group-session-hint">
          Training {hours}h across {entries.length} item{entries.length === 1 ? "" : "s"}…
        </span>
      )}
    </div>
  );
}

interface TabProps {
  selected: SessionSelection;
  toggleSelected: (id: string, kind: SessionEntryKind) => void;
}

function SessionCheckbox({
  id,
  kind,
  selected,
  toggleSelected,
  disabled,
}: TabProps & { id: string; kind: SessionEntryKind; disabled?: boolean }) {
  return (
    <label className={"group-select-check" + (disabled ? " group-select-check-disabled" : "")}>
      <input
        type="checkbox"
        checked={selected.has(id)}
        disabled={disabled}
        onChange={() => toggleSelected(id, kind)}
      />
      Add to session
    </label>
  );
}

function FoundationTab({ selected, toggleSelected }: TabProps) {
  const s = useSaveStore();
  return (
    <>
      {FOUNDATION_GROUPS.map((group) => (
        <SectionShell
          key={group.label}
          title={group.costsSkillPoint ? `${group.label} (costs Skill Points)` : `${group.label} (freeplay)`}
        >
          <div className="card-grid">
            {group.categories.map((cat) => {
              const meta = FOUNDATION_META[cat];
              const locked = group.costsSkillPoint && s.skillPoints < 1;
              return (
                <Card key={cat}>
                  <div className="foundation-card">
                    <div className="foundation-card-top">
                      <IconBadge icon={meta.icon} color={meta.color} />
                      <div>
                        <div className="foundation-card-label">{FOUNDATION_LABELS[cat]}</div>
                        <div className="foundation-card-value" style={{ color: meta.color }}>
                          {s.foundationStats[cat].toLocaleString()}
                        </div>
                      </div>
                    </div>
                    <div
                      className="foundation-card-footer"
                      style={group.costsSkillPoint ? { justifyContent: "space-between" } : undefined}
                    >
                      {group.costsSkillPoint && <span className="sp-cost-tag">1 SP / session</span>}
                      {locked && (
                        <div className="sp-locked" style={{ marginRight: "var(--space-2)" }}>
                          Play ranked to earn a Skill Point
                        </div>
                      )}
                      <SessionCheckbox
                        id={cat}
                        kind="foundation"
                        selected={selected}
                        toggleSelected={toggleSelected}
                        disabled={locked}
                      />
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </SectionShell>
      ))}
    </>
  );
}

function MechanicsTab({ selected, toggleSelected }: TabProps) {
  const s = useSaveStore();
  const branches: string[] = [];
  MECHANICS.forEach((m) => {
    if (!branches.includes(m.branch)) branches.push(m.branch);
  });
  const [branch, setBranch] = useState<string>(branches[0]);
  const meta = BRANCH_META[branch] ?? { icon: "training" as IconName, color: "var(--accent)" };
  const mechanicsInBranch = MECHANICS.filter((m) => m.branch === branch);
  const trainedCount = mechanicsInBranch.filter((m) => (s.mechanicProgress[m.id]?.currentValue ?? 0) > 0).length;

  return (
    <>
      <div className="branch-picker">
        {branches.map((b) => {
          const bMeta = BRANCH_META[b] ?? { icon: "training" as IconName, color: "var(--accent)" };
          const active = b === branch;
          return (
            <button
              key={b}
              className={"branch-pill" + (active ? " branch-pill-active" : "")}
              style={{ ["--branch-color" as string]: bMeta.color }}
              onClick={() => setBranch(b)}
            >
              <Icon name={bMeta.icon} size={14} />
              {b}
            </button>
          );
        })}
      </div>

      <div key={branch} className="fade-in">
        <div className="branch-header">
          <IconBadge icon={meta.icon} color={meta.color} size={30} />
          <div>
            <span className="branch-header-label" style={{ color: meta.color }}>
              {branch}
            </span>
            <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
              {trainedCount}/{mechanicsInBranch.length} trained
            </div>
          </div>
        </div>

        <div className="card-grid">
          {mechanicsInBranch.map((def) => {
            const availability = getMechanicAvailability(def, s.currentDate, s.foundationStats, s.mechanicProgress);
            const mastery = s.mechanicProgress[def.id]?.currentValue ?? 0;
            const trainedSynergy = (def.recommendedAfter ?? []).filter(
              (id) => (s.mechanicProgress[id]?.currentValue ?? 0) > 0
            );
            const untrainedSynergy = (def.recommendedAfter ?? []).filter(
              (id) => (s.mechanicProgress[id]?.currentValue ?? 0) === 0
            );
            const effColors = efficiencyColors(availability.efficiency);

            return (
              <Card key={def.id}>
                <div className="mechanic-card">
                  <div className="mechanic-top">
                    <IconBadge icon={meta.icon} color={meta.color} />
                    <div>
                      <div className="mechanic-label">{def.label}</div>
                      {availability.discovered && (
                        <span className="mechanic-efficiency" style={{ background: effColors.bg, color: effColors.text }}>
                          {availability.efficiency}% efficiency
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="mechanic-desc">{def.description}</p>

                  {!availability.discovered ? (
                    <LockedSection reason={availability.eraDetail!} />
                  ) : (
                    <>
                      <UncappedStat label="Mastery" value={mastery} color={meta.color} />
                      <div className="mechanic-breakdown">
                        {def.recommendedStat && def.recommendedStatValue && (
                          <span>
                            {FOUNDATION_LABELS[def.recommendedStat]}: {s.foundationStats[def.recommendedStat]} /{" "}
                            {def.recommendedStatValue} recommended ({availability.statReadiness}% readiness)
                          </span>
                        )}
                        {trainedSynergy.length > 0 && (
                          <span>
                            +{availability.synergyBonus}% synergy bonus from{" "}
                            {trainedSynergy.map((id) => MECHANICS.find((m) => m.id === id)?.label).join(", ")}
                          </span>
                        )}
                      </div>
                      {untrainedSynergy.length > 0 && (
                        <div className="mechanic-hint">
                          Tip: training goes faster after{" "}
                          {untrainedSynergy.map((id) => MECHANICS.find((m) => m.id === id)?.label).join(", ")}
                        </div>
                      )}
                      <div className="mechanic-footer">
                        <SessionCheckbox id={def.id} kind="mechanic" selected={selected} toggleSelected={toggleSelected} />
                      </div>
                    </>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </>
  );
}

function PlaylistTab({ selected, toggleSelected }: TabProps) {
  const [queue, setQueue] = useState<QueueMode>("2v2");
  const s = useSaveStore();

  const concepts = QUEUE_CONCEPTS.filter((c) => c.queue === queue);
  const categories: ConceptCategory[] = [];
  concepts.forEach((c) => {
    if (!categories.includes(c.category)) categories.push(c.category);
  });

  return (
    <>
      <div className="queue-tabbar" role="tablist">
        {QUEUES.map((q) => (
          <button
            key={q}
            role="tab"
            aria-selected={queue === q}
            className={"queue-tab" + (queue === q ? " queue-tab-active" : "")}
            onClick={() => setQueue(q)}
            title={QUEUE_LABELS[q]}
          >
            <Icon name={QUEUE_ICONS[q]} size={16} />
            {q}
          </button>
        ))}
      </div>

      <div key={queue} className="fade-in">
        {categories.map((category) => {
          const meta = CONCEPT_CATEGORY_META[category];
          return (
            <section key={category} style={{ marginBottom: "var(--space-5)" }}>
              <div className="branch-header">
                <IconBadge icon={meta.icon} color={meta.color} size={30} />
                <span className="branch-header-label" style={{ color: meta.color }}>
                  {CONCEPT_CATEGORY_LABELS[category]}
                </span>
              </div>

              <div className="card-grid">
                {concepts
                  .filter((c) => c.category === category)
                  .map((def) => {
                    const availability = getConceptAvailability(def, s.foundationStats, s.player.gameSense[def.queue], s.queueConceptProgress);
                    const mastery = s.queueConceptProgress[def.id]?.currentValue ?? 0;
                    const trainedSynergy = (def.recommendedAfter ?? []).filter(
                      (id) => (s.queueConceptProgress[id]?.currentValue ?? 0) > 0
                    );
                    const untrainedSynergy = (def.recommendedAfter ?? []).filter(
                      (id) => (s.queueConceptProgress[id]?.currentValue ?? 0) === 0
                    );
                    const effColors = efficiencyColors(availability.efficiency);
                    const statLabel = def.recommendedStat === "gameSense" ? "Game Sense" : def.recommendedStat ? FOUNDATION_LABELS[def.recommendedStat] : null;
                    const statValue = def.recommendedStat === "gameSense" ? s.player.gameSense[def.queue] : def.recommendedStat ? s.foundationStats[def.recommendedStat] : null;
                    const locked = s.skillPoints < 1;

                    return (
                      <Card key={def.id}>
                        <div className="mechanic-card">
                          <div className="mechanic-top">
                            <IconBadge icon={meta.icon} color={meta.color} />
                            <div>
                              <div className="mechanic-label">{def.label}</div>
                              <span className="mechanic-efficiency" style={{ background: effColors.bg, color: effColors.text }}>
                                {availability.efficiency}% efficiency
                              </span>
                            </div>
                          </div>
                          <p className="mechanic-desc">{def.description}</p>
                          <UncappedStat label="Mastery" value={mastery} color={meta.color} />
                          <div className="mechanic-breakdown">
                            {statLabel && statValue !== null && (
                              <span>
                                {statLabel}: {statValue} / {def.recommendedStatValue} recommended ({availability.statReadiness}% readiness)
                              </span>
                            )}
                            {trainedSynergy.length > 0 && (
                              <span>
                                +{availability.synergyBonus}% synergy bonus from{" "}
                                {trainedSynergy.map((id) => QUEUE_CONCEPTS.find((c) => c.id === id)?.label).join(", ")}
                              </span>
                            )}
                          </div>
                          {untrainedSynergy.length > 0 && (
                            <div className="mechanic-hint">
                              Tip: training goes faster after{" "}
                              {untrainedSynergy.map((id) => QUEUE_CONCEPTS.find((c) => c.id === id)?.label).join(", ")}
                            </div>
                          )}
                          <div className="mechanic-footer" style={{ justifyContent: "space-between" }}>
                            <span className="sp-cost-tag">1 SP / session</span>
                            {locked && (
                              <div className="sp-locked" style={{ marginRight: "var(--space-2)" }}>
                                Play ranked to earn a Skill Point
                              </div>
                            )}
                            <SessionCheckbox id={def.id} kind="concept" selected={selected} toggleSelected={toggleSelected} disabled={locked} />
                          </div>
                        </div>
                      </Card>
                    );
                  })}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

function PlaystyleTab() {
  const [queue, setQueue] = useState<QueueMode>("2v2");
  const s = useSaveStore();
  const profile = s.playstyleProfiles[queue];

  return (
    <>
      <div className="queue-tabbar" role="tablist">
        {QUEUES.map((q) => (
          <button
            key={q}
            role="tab"
            aria-selected={queue === q}
            className={"queue-tab" + (queue === q ? " queue-tab-active" : "")}
            onClick={() => setQueue(q)}
            title={QUEUE_LABELS[q]}
          >
            <Icon name={QUEUE_ICONS[q]} size={16} />
            {q}
          </button>
        ))}
      </div>

      <div key={queue} className="card-grid fade-in">
        {PLAYSTYLE_TRAITS.map((trait) => {
          const meta = PLAYSTYLE_TRAIT_META[trait];
          const value = profile[trait];
          return (
            <Card key={trait}>
              <div className="mechanic-card">
                <div className="mechanic-top">
                  <IconBadge icon={meta.icon} color={meta.color} />
                  <div>
                    <div className="mechanic-label">{meta.label}</div>
                  </div>
                </div>
                <StatBar label={`${QUEUE_LABELS[queue]} ${meta.label}`} value={value} color={meta.color} />
                <p className="mechanic-desc">
                  High: {meta.high}
                  <br />
                  Low: {meta.low}
                </p>
                <div className="mechanic-footer" style={{ justifyContent: "flex-end" }}>
                  <span className="sp-cost-tag">Derived from your training - no direct control</span>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
