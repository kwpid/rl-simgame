import { Card } from "@/ui/components/Card";
import { StatBar } from "@/ui/components/StatBar";
import { Icon } from "@/ui/components/Icon";
import type { QueueMode } from "@/data/mockSave";
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
