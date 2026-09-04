import type { ReactNode } from "react";
import { NAV_ITEMS, useAppStore, type ScreenId } from "@/store/useAppStore";
import { Icon } from "./Icon";
import { QueueBanner } from "./QueueBanner";
import { ClockWidget } from "./ClockWidget";
import { useMatchStore } from "@/store/useMatchStore";
import { useSaveStore } from "@/store/useSaveStore";
import { useTournamentStore } from "@/store/useTournamentStore";
import { daysBetween } from "@/data/dateUtils";

export function NavShell({ children }: { children: ReactNode }) {
  const screen = useAppStore((s) => s.screen);
  const setScreen = useAppStore((s) => s.setScreen);
  // While auto-queue is active, AutoQueueBanner (mounted in App.tsx, above this whole shell) already
  // reserves its own top space — NavShell's own QueueBanner is suppressed then, so it shouldn't ALSO
  // reserve room for a banner that isn't rendering.
  const autoQueueActive = useMatchStore((m) => !!m.autoQueueModes && m.autoQueueModes.length > 0);
  const isQueuing = useMatchStore((m) => m.phase === "searching") && !autoQueueActive;

  const currentDate = useSaveStore((s) => s.currentDate);
  const pendingOrgInvite = useSaveStore((s) => s.pendingOrgInvite);
  const pendingOrgTryout = useSaveStore((s) => s.pendingOrgTryout);
  const orgContract = useSaveStore((s) => s.orgContract);
  // A new invite, an ongoing tryout (always ready to play another scrim), or a signed contract's next
  // scrim having come due, all light up the Org tab so the player notices without having to check it on
  // spec every day.
  const orgNeedsAttention =
    pendingOrgInvite !== null ||
    pendingOrgTryout !== null ||
    (orgContract !== null && daysBetween(orgContract.nextScrimDate, currentDate) >= 0);
  // A live tournament match ready to play (see useTournamentStore's pendingMatch) lights up the Tourneys
  // tab the same way an org invite/scrim lights up Org — otherwise nothing tells the player their next
  // RLCS series is waiting on them until they happen to check the screen themselves.
  const tournamentInstances = useTournamentStore((store) => store.instances);
  const tourneysNeedsAttention = Object.values(tournamentInstances).some((inst) => inst.playerTeamId && inst.pendingMatch);
  const dotForScreen: Partial<Record<ScreenId, boolean>> = { org: orgNeedsAttention, tournaments: tourneysNeedsAttention };

  return (
    <div className={"app-shell" + (isQueuing ? " app-shell-queuing" : "")}>
      <QueueBanner />
      <ClockWidget />
      <nav className="side-nav" aria-label="Primary">
        <div className="side-nav-brand">RL Sim</div>
        <ul className="side-nav-list">
          {NAV_ITEMS.map((item) => (
            <li key={item.id}>
              <button
                className={"nav-btn" + (screen === item.id ? " nav-btn-active" : "")}
                onClick={() => setScreen(item.id)}
              >
                <span className="nav-icon-wrap">
                  <Icon name={item.icon} size={18} />
                  {dotForScreen[item.id] && <span className="nav-dot" />}
                </span>
                <span>{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <main className="app-content">{children}</main>

      <nav className="bottom-nav" aria-label="Primary">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={"bottom-nav-btn" + (screen === item.id ? " bottom-nav-btn-active" : "")}
            onClick={() => setScreen(item.id)}
          >
            <span className="nav-icon-wrap">
              <Icon name={item.icon} size={18} />
              {dotForScreen[item.id] && <span className="nav-dot" />}
            </span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <style>{`
        .nav-icon-wrap {
          position: relative;
          display: inline-flex;
        }
        .nav-dot {
          position: absolute;
          top: -2px;
          right: -2px;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--danger);
          border: 1.5px solid var(--bg-surface);
        }
        .app-shell {
          display: flex;
          min-height: 100vh;
        }
        .side-nav {
          display: none;
        }
        .app-content {
          flex: 1;
          min-width: 0;
          padding: var(--space-5);
          padding-bottom: calc(var(--nav-height-mobile) + var(--space-5));
        }
        .app-shell-queuing .app-content {
          padding-top: calc(var(--space-5) + 40px);
        }
        .app-shell-queuing .side-nav {
          padding-top: calc(var(--space-5) + 40px);
        }
        .bottom-nav {
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          height: var(--nav-height-mobile);
          display: flex;
          background: var(--bg-surface);
          border-top: 1px solid var(--border-subtle);
          padding: 4px calc(env(safe-area-inset-bottom, 0px)) env(safe-area-inset-bottom, 0px);
          overflow-x: auto;
          z-index: 20;
        }
        .bottom-nav-btn {
          flex: 1 1 0;
          min-width: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 2px;
          background: none;
          border: none;
          color: var(--text-tertiary);
          font-size: 9px;
          padding: 6px 2px;
          cursor: pointer;
          transition: color 150ms ease, transform 150ms ease;
        }
        .bottom-nav-btn-active {
          transform: translateY(-1px);
        }
        .bottom-nav-btn span {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 100%;
        }
        .bottom-nav-btn-active {
          color: var(--accent);
        }

        @media (min-width: 860px) {
          .side-nav {
            display: flex;
            flex-direction: column;
            width: var(--nav-width-desktop);
            flex-shrink: 0;
            background: var(--bg-surface);
            border-right: 1px solid var(--border-subtle);
            padding: var(--space-5) var(--space-3);
            position: sticky;
            top: 0;
            height: 100vh;
          }
          .side-nav-brand {
            font-size: 15px;
            font-weight: 600;
            color: var(--text-primary);
            padding: 0 var(--space-3) var(--space-5);
            letter-spacing: 0.2px;
          }
          .side-nav-list {
            list-style: none;
            margin: 0;
            padding: 0;
            display: flex;
            flex-direction: column;
            gap: 2px;
          }
          .nav-btn {
            width: 100%;
            display: flex;
            align-items: center;
            gap: var(--space-3);
            background: none;
            border: none;
            border-radius: var(--radius-md);
            color: var(--text-secondary);
            font-size: 14px;
            padding: 10px 12px;
            cursor: pointer;
            text-align: left;
            transition: background 150ms ease, color 150ms ease;
          }
          .nav-btn:hover {
            background: var(--bg-surface-hover);
            color: var(--text-primary);
          }
          .nav-btn-active {
            background: var(--accent-muted);
            color: var(--accent);
          }
          .bottom-nav {
            display: none;
          }
          .app-content {
            padding: var(--space-6);
            padding-bottom: var(--space-6);
          }
        }
      `}</style>
    </div>
  );
}
