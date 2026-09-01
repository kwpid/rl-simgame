export function UncappedStat({
  label,
  value,
  hint,
  color = "var(--team-blue)",
}: {
  label: string;
  value: number;
  hint?: string;
  color?: string;
}) {
  return (
    <div style={{ marginBottom: "var(--space-3)" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          fontSize: 13,
          color: "var(--text-secondary)",
        }}
      >
        <span>{label}</span>
        <span style={{ color, fontWeight: 700, fontSize: 16 }}>{value.toLocaleString()}</span>
      </div>
      {hint && (
        <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 2 }}>{hint}</div>
      )}
    </div>
  );
}
