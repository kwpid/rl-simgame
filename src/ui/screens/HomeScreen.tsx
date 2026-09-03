import { useState } from "react";
import { Card } from "@/ui/components/Card";
import { StatBar } from "@/ui/components/StatBar";
import { Icon } from "@/ui/components/Icon";
import type { QueueMode, RecentMatchEntry } from "@/data/mockSave";
import { eraForDate, tierColor, divisionLabel as rankDivisionLabel } from "@/data/rankSystem";
import { formatClockHour, formatSimDate } from "@/data/dateUtils";
import { useSaveStore } from "@/store/useSaveStore";
import { useAiProfileStore } from "@/store/useAiProfileStore";

const QUEUES: QueueMode[] = ["1v1", "2v2", "3v3"];

export function HomeScreen() {
  const s = useSaveStore();
  const openAiProfile = useAiProfileStore((store) => store.open);
  const rest = useSaveStore((store) => store.rest);
  const sleepToNextDay = useSaveStore((store) => store.sleepToNextDay);
  const era = eraForDate(s.currentDate);
  const [viewingReplay, setViewingReplay] = useState<RecentMatchEntry | null>(null);

  return (
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      <header style={{ marginBottom: "var(--space-5)" }}>
        <div style={{ fontSize: 13, color: "var(--text-tertiary)" }}>
          {formatSimDate(s.currentDate)} &middot; {formatClockHour(s.clockHour, s.clockMinute)}
        </div>
        <h1 style={{ margin: "2px 0 0", fontSize: 24, fontWeight: 650 }}>{s.displayName}</h1>
        <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          Level {s.level} &middot; {s.playstyle[0].toUpperCase() + s.playstyle.slice(1)} playstyle
        </div>
      </header>

      <div className="home-grid">
        <Card title="Level Progress">
          <StatBar
            label={`Level ${s.level} → ${s.level + 1}`}
            value={s.xp}
            max={s.xpToNextLevel}
            suffix={` / ${s.xpToNextLevel} XP`}
          />
          <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            {s.skillPoints} skill point{s.skillPoints === 1 ? "" : "s"} available to spend
          </div>
        </Card>

        <Card title="Ranked Standing">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {QUEUES.map((q) => {
              const p = s.rankedProfiles[q];
              return (
                <div key={q} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13, color: "var(--text-secondary)", width: 36 }}>{q}</span>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: p.placementMatchesRemaining > 0 ? "var(--text-tertiary)" : tierColor(p.rankTier, era),
                    }}
                  >
                    {p.placementMatchesRemaining > 0
                      ? `Placement ${10 - p.placementMatchesRemaining}/10`
                      : rankDivisionLabel(p.rankTier, p.division, era)}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{p.mmr} MMR</span>
                </div>
              );
            })}
          </div>
        </Card>

        <Card title="Fame & Recognition">
          <StatBar label="Fame" value={s.player.fame} color="var(--warning)" />
          <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            Org status: <span style={{ color: "var(--text-primary)" }}>Scouted interest</span>
          </div>
        </Card>

        <Card title="Clock">
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-3)" }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: "var(--radius-md)",
                background: "var(--accent-muted)",
                color: "var(--accent)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Icon name="training" size={18} />
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 650 }}>{formatClockHour(s.clockHour, s.clockMinute)}</div>
              <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{formatSimDate(s.currentDate)}</div>
            </div>
          </div>
          <StatBar label="Fatigue" value={s.player.fatigue} color="var(--danger)" />
          <div style={{ display: "flex", gap: 6 }}>
            <button className="clock-btn" onClick={() => rest(2)}>
              Rest 2h
            </button>
            <button className="clock-btn clock-btn-primary" onClick={sleepToNextDay}>
              End Day
            </button>
          </div>
        </Card>
      </div>

      <Card title="Recent Matches">
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          {s.recentMatches.map((m, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                padding: "var(--space-2) 0",
                borderTop: i > 0 ? "1px solid var(--border-subtle)" : "none",
              }}
            >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-3)",
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: 999,
                  background: m.result === "win" ? "rgba(107,181,131,0.16)" : "rgba(217,100,91,0.16)",
                  color: m.result === "win" ? "var(--success)" : "var(--danger)",
                }}
              >
                {m.result === "win" ? "WIN" : "LOSS"}
              </span>
              <span style={{ fontSize: 13, color: "var(--text-secondary)", width: 32 }}>{m.queue}</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{m.score}</span>
              <span style={{ fontSize: 12, color: "var(--text-tertiary)", flex: 1 }}>{m.note}</span>
              {m.log.length > 0 && (
                <button className="recent-match-view-btn" onClick={() => setViewingReplay(m)}>
                  View
                </button>
              )}
            </div>
            {m.opponents.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, paddingLeft: 2 }}>
                {m.opponents.map((name, oi) => (
                  <button
                    key={`${name}-${oi}`}
                    className="recent-match-opponent"
                    onClick={() => openAiProfile(name)}
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
            </div>
          ))}
        </div>
      </Card>

      {viewingReplay && <MatchReplayModal entry={viewingReplay} onClose={() => setViewingReplay(null)} />}

      <style>{`
        .recent-match-opponent {
          background: var(--bg-surface-raised);
          border: 1px solid var(--border-subtle);
          border-radius: 999px;
          color: var(--text-secondary);
          font-size: 11px;
          padding: 2px 10px;
          cursor: pointer;
          transition: border-color 150ms ease, color 150ms ease;
        }
        .recent-match-opponent:hover {
          border-color: var(--accent);
          color: var(--accent);
        }
        .recent-match-view-btn {
          background: none;
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-sm);
          color: var(--text-secondary);
          font-size: 11px;
          font-weight: 600;
          padding: 4px 10px;
          cursor: pointer;
          white-space: nowrap;
          transition: border-color 150ms ease, color 150ms ease;
        }
        .recent-match-view-btn:hover {
          border-color: var(--accent);
          color: var(--accent);
        }
        .replay-modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.65);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          padding: 16px;
          backdrop-filter: blur(3px);
        }
        .replay-modal {
          background: var(--bg-card, #1c1e24);
          border: 1px solid var(--border-strong);
          border-radius: var(--radius-lg, 12px);
          width: 100%;
          max-width: 560px;
          max-height: 85vh;
          display: flex;
          flex-direction: column;
          box-shadow: 0 20px 60px rgba(0,0,0,0.5);
        }
        .replay-modal-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          padding: var(--space-4) var(--space-4) var(--space-3);
          border-bottom: 1px solid var(--border-subtle);
          gap: var(--space-3);
        }
        .replay-modal-title {
          font-weight: 700;
          font-size: 15px;
        }
        .replay-modal-sub {
          font-size: 12px;
          color: var(--text-tertiary);
          margin-top: 2px;
        }
        .replay-modal-close {
          background: none;
          border: none;
          color: var(--text-tertiary);
          font-size: 18px;
          cursor: pointer;
          padding: 0 4px;
          line-height: 1;
          flex-shrink: 0;
        }
        .replay-modal-close:hover { color: var(--text-primary); }
        .replay-modal-body {
          padding: var(--space-3) var(--space-4);
          overflow-y: auto;
          font-size: 12px;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          line-height: 1.6;
        }
        .replay-log-line {
          display: flex;
          gap: 10px;
        }
        .replay-log-clock {
          color: var(--text-tertiary);
          flex-shrink: 0;
          width: 48px;
        }
        .replay-modal-footer {
          display: flex;
          justify-content: flex-end;
          gap: var(--space-2);
          padding: var(--space-3) var(--space-4);
          border-top: 1px solid var(--border-subtle);
        }
        .home-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: var(--space-4);
          margin-bottom: var(--space-4);
        }
        @media (min-width: 640px) {
          .home-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }
        @media (min-width: 1100px) {
          .home-grid {
            grid-template-columns: repeat(4, 1fr);
          }
        }
        .clock-btn {
          flex: 1;
          background: var(--bg-surface-raised);
          border: 1px solid var(--border-subtle);
          color: var(--text-secondary);
          border-radius: var(--radius-sm);
          font-size: 12px;
          font-weight: 600;
          padding: 8px 0;
          cursor: pointer;
        }
        .clock-btn:hover {
          border-color: var(--border-strong);
          color: var(--text-primary);
        }
        .clock-btn-primary {
          background: var(--accent);
          color: #17181c;
          border-color: transparent;
        }
        .clock-btn-primary:hover {
          background: var(--accent-hover);
          color: #17181c;
        }
      `}</style>
    </div>
  );
}

/** The full start-to-end log for one past match (see mockSave.ts's RecentMatchEntry.log), plus a one-click
 *  copy of the whole thing as plain text — for pasting into a chat/forum post, same idea as a real replay
 *  code. Real names only, this is exactly what got recorded when the match ended. */
function MatchReplayModal({ entry, onClose }: { entry: RecentMatchEntry; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  function replayText(): string {
    return entry.log.map((l) => `[${l.clockLabel}] ${l.text}`).join("\n");
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(replayText());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access denied/unavailable — the button just silently doesn't confirm, nothing else to do.
    }
  }

  return (
    <div className="replay-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="replay-modal">
        <div className="replay-modal-header">
          <div>
            <div className="replay-modal-title">
              {entry.queue} &middot; {entry.score} &middot; {entry.result === "win" ? "Win" : "Loss"}
            </div>
            <div className="replay-modal-sub">{entry.log.length} log lines</div>
          </div>
          <button className="replay-modal-close" onClick={onClose} aria-label="Close replay">
            ✕
          </button>
        </div>
        <div className="replay-modal-body">
          {entry.log.map((l, i) => (
            <div key={i} className="replay-log-line">
              <span className="replay-log-clock">{l.clockLabel}</span>
              <span>{l.text}</span>
            </div>
          ))}
        </div>
        <div className="replay-modal-footer">
          <button className="recent-match-view-btn" onClick={handleCopy}>
            {copied ? "Copied!" : "Copy Log"}
          </button>
        </div>
      </div>
    </div>
  );
}
