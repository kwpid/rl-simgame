import { Icon } from "./Icon";
import { useSaveStore } from "@/store/useSaveStore";
import { useAppStore } from "@/store/useAppStore";
import { formatClockHour, formatSimDate } from "@/data/dateUtils";

export function ClockWidget() {
  const currentDate = useSaveStore((s) => s.currentDate);
  const clockHour = useSaveStore((s) => s.clockHour);
  const clockMinute = useSaveStore((s) => s.clockMinute);
  const screen = useAppStore((s) => s.screen);
  const setScreen = useAppStore((s) => s.setScreen);

  return (
    <div className="top-bar">
      <div className="clock-widget">
        <Icon name="clock" size={14} />
        <span className="clock-widget-time">{formatClockHour(clockHour, clockMinute)}</span>
        <span className="clock-widget-date">{formatSimDate(currentDate)}</span>
      </div>
      <button
        className={"settings-btn" + (screen === "settings" ? " settings-btn-active" : "")}
        onClick={() => setScreen("settings")}
        title="Settings"
      >
        <Icon name="settings" size={16} />
      </button>

      <style>{`
        .top-bar {
          position: fixed;
          top: 10px;
          right: 12px;
          z-index: 45;
          display: flex;
          align-items: center;
          gap: 6px;
          transition: top 150ms ease;
        }
        .clock-widget {
          display: flex;
          align-items: center;
          gap: 6px;
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: 999px;
          padding: 6px 12px;
          font-size: 12px;
          color: var(--text-primary);
        }
        .clock-widget-time {
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .clock-widget-date {
          color: var(--text-tertiary);
        }
        .settings-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 30px;
          height: 30px;
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: 50%;
          color: var(--text-secondary);
          cursor: pointer;
          flex-shrink: 0;
        }
        .settings-btn:hover {
          color: var(--text-primary);
          border-color: var(--border-strong);
        }
        .settings-btn-active {
          color: var(--accent);
          border-color: var(--accent);
        }
        .app-shell-queuing .top-bar {
          top: 50px;
        }
        @media (max-width: 480px) {
          .clock-widget-date {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}
