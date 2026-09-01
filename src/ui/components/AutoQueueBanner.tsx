import { useMatchStore } from "@/store/useMatchStore";
import { QUEUE_LABELS } from "@/data/queues";

/** Persistent while auto-queue is on, unlike QueueBanner (which only shows during an active search and
 *  lives inside NavShell, so it disappears the moment a match actually starts) — this one is mounted
 *  unconditionally at the very top of App.tsx, visible through the whole found/in_match/post_match cycle
 *  too, so the player always has a one-tap way to stop the loop, mid-match included. */
export function AutoQueueBanner() {
  const autoQueueModes = useMatchStore((m) => m.autoQueueModes);
  const phase = useMatchStore((m) => m.phase);
  const cancelQueue = useMatchStore((m) => m.cancelQueue);
  const setAutoQueueModes = useMatchStore((m) => m.setAutoQueueModes);

  if (!autoQueueModes || autoQueueModes.length === 0) return null;

  const modesLabel = autoQueueModes.map((q) => QUEUE_LABELS[q]).join(", ");
  const statusLabel =
    phase === "searching"
      ? `Searching for ${modesLabel}…`
      : phase === "found" || phase === "in_match" || phase === "post_match"
        ? `Match in progress (${modesLabel})`
        : `Queuing up ${modesLabel}…`;

  function handleStop() {
    setAutoQueueModes(null);
    if (phase === "searching") cancelQueue();
  }

  return (
    <button className="auto-queue-banner" onClick={handleStop} title="Tap to stop auto-queuing">
      <span className="auto-queue-dot" aria-hidden="true" />
      <span className="auto-queue-text">Auto-Queue ON — {statusLabel}</span>
      <span className="auto-queue-stop">Tap to stop</span>

      <style>{`
        .auto-queue-banner {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          height: 36px;
          display: flex;
          align-items: center;
          gap: var(--space-2);
          padding: 0 var(--space-4);
          background: var(--accent);
          color: #17181c;
          border: none;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          z-index: 50;
        }
        .auto-queue-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #17181c;
          animation: auto-queue-pulse 1.4s ease-in-out infinite;
          flex-shrink: 0;
        }
        .auto-queue-text {
          flex: 1;
          text-align: left;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .auto-queue-stop {
          text-decoration: underline;
          flex-shrink: 0;
        }
        @keyframes auto-queue-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>
    </button>
  );
}
