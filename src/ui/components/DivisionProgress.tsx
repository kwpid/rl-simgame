const PIP_COUNT = 5;

/** The promotion progress meter within a single division, like real RL: each pip is roughly 2 wins,
 *  filling all 5 promotes to the next division (or next rank if already at the top division). */
export function DivisionProgress({ filled, color }: { filled: number; color: string }) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {Array.from({ length: PIP_COUNT }).map((_, i) => (
        <div
          key={i}
          style={{
            width: 20,
            height: 6,
            borderRadius: 3,
            background: i < filled ? color : "var(--bg-surface-raised)",
            border: i < filled ? "none" : "1px solid var(--border-subtle)",
          }}
        />
      ))}
    </div>
  );
}
