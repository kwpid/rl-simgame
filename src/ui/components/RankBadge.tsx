import { useState } from "react";
import { rankImagePath, tierColor, TIER_LABELS, type RankEra, type RankTierId } from "@/data/rankSystem";

export function RankBadge({
  tier,
  division,
  era,
  size = 48,
}: {
  tier: RankTierId;
  division?: number;
  era: RankEra;
  size?: number;
}) {
  const [errored, setErrored] = useState(false);
  const src = rankImagePath(tier, division, era);
  const color = tierColor(tier, era);

  if (errored) {
    return (
      <div
        title={TIER_LABELS[tier]}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: `${color}22`,
          border: `2px solid ${color}`,
          color,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 700,
          fontSize: size * 0.34,
          flexShrink: 0,
        }}
      >
        {TIER_LABELS[tier].slice(0, 1)}
        {division && division > 1 ? division : ""}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={TIER_LABELS[tier]}
      width={size}
      height={size}
      style={{ objectFit: "contain", flexShrink: 0 }}
      onError={() => setErrored(true)}
    />
  );
}
