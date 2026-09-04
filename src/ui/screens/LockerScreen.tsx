import { Card } from "@/ui/components/Card";
import { SectionShell } from "@/ui/components/LockedSection";
import { useSaveStore } from "@/store/useSaveStore";
import type { TitleGlow } from "@/data/seasons";
import { formatSimDate } from "@/data/dateUtils";

const GLOW_STYLES: Record<TitleGlow, { color: string; shadow: string; border: string }> = {
  none: { color: "var(--text-secondary)", shadow: "none", border: "var(--border-subtle)" },
  gold: { color: "#f0d68a", shadow: "0 0 8px rgba(240,214,138,0.65)", border: "#f0d68a" },
  red: { color: "#ff6b5e", shadow: "0 0 8px rgba(255,107,94,0.65)", border: "#ff6b5e" },
  white: { color: "#ffffff", shadow: "0 0 8px rgba(255,255,255,0.7)", border: "#ffffff" },
  aqua: { color: "#5ee6d8", shadow: "0 0 8px rgba(94,230,216,0.65)", border: "#5ee6d8" },
};

function TitleChip({
  label,
  glow,
  active,
  onClick,
}: {
  label: string;
  glow: TitleGlow;
  active: boolean;
  onClick: () => void;
}) {
  const style = GLOW_STYLES[glow];
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 12,
        fontWeight: glow === "none" ? 500 : 700,
        padding: "6px 12px",
        borderRadius: 999,
        background: active ? "var(--bg-surface-raised)" : "var(--bg-surface)",
        color: style.color,
        textShadow: glow === "none" ? "none" : style.shadow,
        border: `1px solid ${active ? style.border : "var(--border-subtle)"}`,
        boxShadow: active && glow !== "none" ? style.shadow : "none",
        cursor: "pointer",
        letterSpacing: glow === "none" ? 0 : 0.3,
        textTransform: "uppercase",
      }}
    >
      {label}
    </button>
  );
}

export function LockerScreen() {
  const s = useSaveStore();
  const setEquippedTitleId = useSaveStore((store) => store.setEquippedTitleId);
  const equipped = s.titles.find((t) => t.id === s.equippedTitleId) ?? null;

  return (
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      <header style={{ marginBottom: "var(--space-4)" }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 650 }}>Locker</h1>
        <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>Titles and cosmetics for {s.displayName}</div>
      </header>

      <SectionShell title="Wallet">
        <Card>
          <div style={{ fontSize: 24, fontWeight: 700, color: "var(--accent-positive, #4caf50)", marginBottom: "var(--space-3)" }}>
            ${s.cash.toLocaleString()}
          </div>
          {s.cashHistory.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--text-tertiary)" }}>No earnings yet.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {s.cashHistory.slice(0, 10).map((entry, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <span style={{ color: "var(--text-secondary)" }}>
                    {entry.source} <span style={{ color: "var(--text-tertiary)" }}>· {formatSimDate(entry.date)}</span>
                  </span>
                  <span style={{ fontWeight: 600, color: "var(--accent-positive, #4caf50)" }}>+${entry.amount.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </SectionShell>

      <SectionShell title="Equipped Title">
        <Card>
          {equipped ? (
            <TitleChip label={equipped.label} glow={equipped.glow} active onClick={() => {}} />
          ) : (
            <span style={{ fontSize: 13, color: "var(--text-tertiary)" }}>No title equipped.</span>
          )}
        </Card>
      </SectionShell>

      <SectionShell title="Titles Earned">
        <Card>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <TitleChip
              label="No Title"
              glow="none"
              active={s.equippedTitleId === null}
              onClick={() => setEquippedTitleId(null)}
            />
            {s.titles.map((t) => (
              <TitleChip
                key={t.id}
                label={t.label}
                glow={t.glow}
                active={t.id === s.equippedTitleId}
                onClick={() => setEquippedTitleId(t.id)}
              />
            ))}
          </div>
        </Card>
      </SectionShell>

      <SectionShell title="Cosmetics" locked lockedReason="Item inventory not built yet.">
        <Card>
          <div style={{ fontSize: 13, color: "var(--text-tertiary)" }}>Nothing here yet.</div>
        </Card>
      </SectionShell>
    </div>
  );
}
