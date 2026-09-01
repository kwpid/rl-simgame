import { Icon } from "@/ui/components/Icon";
import { useMatchStore } from "@/store/useMatchStore";
import { QUEUE_LABELS, QUEUE_ICONS } from "@/data/queues";

export function QueueBanner() {
  const phase = useMatchStore((m) => m.phase);
  const queue = useMatchStore((m) => m.queue);
  const cancelQueue = useMatchStore((m) => m.cancelQueue);

  if (phase !== "searching" || !queue) return null;

  return (
    <div className="queue-banner">
      <Icon name={QUEUE_ICONS[queue]} size={16} />
      <span className="queue-banner-text">Searching for {QUEUE_LABELS[queue]}</span>
      <div className="queue-bars" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <button className="queue-cancel" onClick={cancelQueue}>
        Cancel
      </button>

      <style>{`
        .queue-banner {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          height: 40px;
          background: var(--bg-surface);
          border-bottom: 1px solid var(--border-subtle);
          display: flex;
          align-items: center;
          gap: var(--space-2);
          padding: 0 var(--space-4);
          z-index: 40;
          color: var(--text-primary);
        }
        .queue-banner-text {
          font-size: 13px;
          font-weight: 600;
        }
        .queue-bars {
          display: flex;
          align-items: flex-end;
          gap: 3px;
          height: 14px;
          margin-left: 4px;
        }
        .queue-bars span {
          width: 3px;
          background: var(--accent);
          border-radius: 2px;
          animation: queue-bar-bounce 900ms ease-in-out infinite;
        }
        .queue-bars span:nth-child(1) { height: 40%; animation-delay: 0ms; }
        .queue-bars span:nth-child(2) { height: 100%; animation-delay: 150ms; }
        .queue-bars span:nth-child(3) { height: 65%; animation-delay: 300ms; }
        @keyframes queue-bar-bounce {
          0%, 100% { transform: scaleY(0.4); }
          50% { transform: scaleY(1); }
        }
        .queue-cancel {
          margin-left: auto;
          background: none;
          border: 1px solid var(--border-strong);
          border-radius: var(--radius-sm);
          color: var(--text-secondary);
          font-size: 12px;
          padding: 4px 10px;
          cursor: pointer;
        }
        .queue-cancel:hover {
          color: var(--text-primary);
          border-color: var(--text-tertiary);
        }
      `}</style>
    </div>
  );
}
