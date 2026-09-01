interface RadarAxis {
  label: string;
  value: number; // 0-100
}

export function RadarChart({
  axes,
  size = 220,
  color = "var(--team-blue)",
}: {
  axes: RadarAxis[];
  size?: number;
  color?: string;
}) {
  const center = size / 2;
  const labelPad = 34;
  const radius = center - labelPad;
  const n = axes.length;

  const pointAt = (index: number, fraction: number) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / n;
    return {
      x: center + Math.cos(angle) * radius * fraction,
      y: center + Math.sin(angle) * radius * fraction,
    };
  };

  const ringLevels = [0.25, 0.5, 0.75, 1];
  const dataPoints = axes.map((a, i) => pointAt(i, Math.max(0.04, a.value / 100)));
  const dataPath = dataPoints.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {ringLevels.map((level) => {
        const ringPoints = axes.map((_, i) => pointAt(i, level));
        return (
          <polygon
            key={level}
            points={ringPoints.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke="var(--border-subtle)"
            strokeWidth={1}
          />
        );
      })}

      {axes.map((_, i) => {
        const p = pointAt(i, 1);
        return (
          <line key={i} x1={center} y1={center} x2={p.x} y2={p.y} stroke="var(--border-subtle)" strokeWidth={1} />
        );
      })}

      <polygon points={dataPath} fill={color} fillOpacity={0.22} stroke={color} strokeWidth={2} />
      {dataPoints.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3} fill={color} />
      ))}

      {axes.map((a, i) => {
        const p = pointAt(i, 1.24);
        return (
          <text
            key={a.label}
            x={p.x}
            y={p.y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={11}
            fill="var(--text-secondary)"
          >
            {a.label}
          </text>
        );
      })}
    </svg>
  );
}
