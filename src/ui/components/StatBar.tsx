export function StatBar({
  label,
  value,
  max = 100,
  color = "var(--accent)",
  suffix,
}: {
  label: string;
  value: number;
  max?: number;
  color?: string;
  suffix?: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div style={{ marginBottom: "var(--space-3)" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 13,
          color: "var(--text-secondary)",
          marginBottom: 4,
        }}
      >
        <span>{label}</span>
        <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>
          {value}
          {suffix ?? `/${max}`}
        </span>
      </div>
      <div
        style={{
          height: 6,
          borderRadius: 999,
          background: "var(--bg-surface-raised)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: color,
            borderRadius: 999,
            transition: "width 300ms ease",
          }}
        />
      </div>
    </div>
  );
}
