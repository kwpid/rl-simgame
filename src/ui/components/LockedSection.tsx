import type { ReactNode } from "react";
import { Icon } from "./Icon";

export function LockedSection({ reason }: { reason: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
        padding: "var(--space-4)",
        borderRadius: "var(--radius-md)",
        background: "var(--bg-surface-raised)",
        color: "var(--text-tertiary)",
      }}
    >
      <Icon name="lock" size={18} />
      <span style={{ fontSize: 13 }}>{reason}</span>
    </div>
  );
}

export function SectionShell({
  title,
  locked,
  lockedReason,
  children,
}: {
  title: string;
  locked?: boolean;
  lockedReason?: string;
  children: ReactNode;
}) {
  return (
    <section style={{ marginBottom: "var(--space-5)" }}>
      <h2
        style={{
          fontSize: 12,
          textTransform: "uppercase",
          letterSpacing: 0.8,
          color: "var(--text-tertiary)",
          margin: "0 0 var(--space-3) 2px",
        }}
      >
        {title}
      </h2>
      {locked ? <LockedSection reason={lockedReason ?? "Locked"} /> : children}
    </section>
  );
}
