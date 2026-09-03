import { useEffect } from "react";
import { usePfpStore } from "@/store/usePfpStore";
import type { SimDate } from "@/data/dateUtils";

/** The generic default pfp: a plain silhouette on a neutral tile, shown for anyone not recognizable enough
 *  to warrant a real assigned picture (see usePfpStore's `isNotableIdentity`) and, if the pool itself is
 *  still empty, for literally everyone. Deliberately a static icon, not per-name colored/lettered, so it
 *  reads as "generic/unknown player" rather than its own second identity system. */
function DefaultAvatar({ size, radius }: { size: number; radius: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg-surface-raised, #2a2c33)",
        color: "var(--text-tertiary)",
        overflow: "hidden",
      }}
    >
      <svg width="70%" height="70%" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
      </svg>
    </span>
  );
}

/** One tracked identity's profile picture (assigned/persisted via usePfpStore) — the shared default avatar
 *  when the pfp pool (src/assets/pfps/) is empty or this name isn't notable enough to warrant a real pool
 *  picture, never a broken image icon. Square with rounded corners, not circular.
 *
 *  `overrideUrl` shows a specific image regardless of the store (the player's own chosen pfp, see
 *  useSaveStore's `playerPfp` — pass it here for any "self" row instead of relying on assignment). `notable`
 *  forces a real pool assignment even for a name usePfpStore wouldn't otherwise consider recognizable (pass
 *  this for friends — the player chose to add them).
 *
 *  Subscribes to the store reactively (not a plain `getState()` read) specifically so the Settings screen's
 *  "Reset Profile Pictures" button visibly re-resolves every already-mounted avatar, not just ones looked
 *  up fresh afterward. */
export function Avatar({
  name,
  currentDate,
  size = 28,
  overrideUrl,
  notable,
}: {
  name: string;
  currentDate: SimDate;
  size?: number;
  overrideUrl?: string | null;
  notable?: boolean;
}) {
  const entry = usePfpStore((s) => s.table[name]);
  const version = usePfpStore((s) => s.version);
  const getPfp = usePfpStore((s) => s.getPfp);

  useEffect(() => {
    if (overrideUrl) return;
    getPfp(name, currentDate, notable);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, currentDate.year, currentDate.month, version, notable, overrideUrl]);

  const radius = Math.max(4, Math.round(size * 0.22));
  const url = overrideUrl || entry?.file || "";
  if (!url) return <DefaultAvatar size={size} radius={radius} />;
  return (
    <img
      src={url}
      alt=""
      style={{ width: size, height: size, borderRadius: radius, objectFit: "cover", flexShrink: 0 }}
    />
  );
}
