import { Icon, type IconName } from "@/ui/components/Icon";

export function ComingSoonScreen({ title, icon }: { title: string; icon: IconName }) {
  return (
    <div
      style={{
        maxWidth: 960,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "60vh",
        textAlign: "center",
        color: "var(--text-tertiary)",
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: "var(--radius-lg)",
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: "var(--space-4)",
          color: "var(--text-secondary)",
        }}
      >
        <Icon name={icon} size={26} />
      </div>
      <h2 style={{ margin: 0, fontSize: 18, color: "var(--text-primary)" }}>{title}</h2>
      <p style={{ maxWidth: 320, fontSize: 13 }}>This screen isn't built yet, it's next up on the skeleton.</p>
    </div>
  );
}
