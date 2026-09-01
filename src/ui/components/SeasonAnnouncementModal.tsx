import { useSaveStore } from "@/store/useSaveStore";
import { eraForDate, tierColor, TIER_LABELS } from "@/data/rankSystem";

export function SeasonAnnouncementModal() {
  const announcement = useSaveStore((s) => s.pendingSeasonAnnouncement);
  const currentDate = useSaveStore((s) => s.currentDate);
  const dismiss = useSaveStore((s) => s.dismissSeasonAnnouncement);

  if (!announcement) return null;
  const era = eraForDate(currentDate);

  return (
    <div className="season-announce-overlay">
      <div className="season-announce-card">
        <div className="season-announce-badge">New Season</div>
        <h2 className="season-announce-title">Season {announcement.seasonNumber}</h2>
        <p className="season-announce-sub">Ranks have soft-reset. Time to climb back up.</p>

        {announcement.sslIntroduced && (
          <div className="season-announce-ssl">
            Supersonic Legend has arrived. The top of the ladder just got a new ceiling.
          </div>
        )}

        <div className="season-announce-reward">
          <span>Reward level locked in:</span>
          <strong style={{ color: tierColor(announcement.rewardTierAchieved, era) }}>
            {TIER_LABELS[announcement.rewardTierAchieved]}
          </strong>
        </div>

        <button className="season-announce-btn" onClick={dismiss}>
          Continue
        </button>
      </div>

      <style>{`
        .season-announce-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.6);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 200;
          padding: var(--space-4);
        }
        .season-announce-card {
          background: var(--bg-surface-raised);
          border: 1px solid var(--border-strong);
          border-radius: var(--radius-lg);
          padding: var(--space-5);
          max-width: 380px;
          width: 100%;
          text-align: center;
        }
        .season-announce-badge {
          display: inline-block;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--accent);
          background: color-mix(in srgb, var(--accent) 16%, transparent);
          border-radius: 999px;
          padding: 4px 12px;
          margin-bottom: var(--space-3);
        }
        .season-announce-title {
          margin: 0 0 6px;
          font-size: 26px;
          font-weight: 700;
        }
        .season-announce-sub {
          margin: 0 0 var(--space-4);
          font-size: 13px;
          color: var(--text-secondary);
        }
        .season-announce-ssl {
          background: color-mix(in srgb, #e3c76f 16%, transparent);
          border: 1px solid #e3c76f;
          color: #e3c76f;
          border-radius: var(--radius-md);
          padding: 10px 12px;
          font-size: 13px;
          font-weight: 600;
          margin-bottom: var(--space-4);
        }
        .season-announce-reward {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          font-size: 13px;
          color: var(--text-secondary);
          margin-bottom: var(--space-4);
        }
        .season-announce-btn {
          width: 100%;
          background: var(--accent);
          color: var(--bg-base);
          border: none;
          border-radius: var(--radius-md);
          font-size: 14px;
          font-weight: 700;
          padding: 12px;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}
