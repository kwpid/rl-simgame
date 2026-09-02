import { useEffect } from "react";
import { useAiProfileStore } from "@/store/useAiProfileStore";
import { useSaveStore } from "@/store/useSaveStore";
import { useProLeaderboardStore } from "@/store/useProLeaderboardStore";
import { useRegionalRosterStore } from "@/store/useRegionalRosterStore";
import { PRO_PLAYERS, type ProRegion } from "@/data/proPlayers";
import { regionalGrinderRoster } from "@/data/regionalGrinders";
import { QUEUES, QUEUE_LABELS } from "@/data/queues";
import { eraForDate, deriveRankFromMmr, TIER_LABELS } from "@/data/rankSystem";
import { REGION_LABELS as PRO_REGION_LABELS } from "@/data/tournaments";
import { RankBadge } from "./RankBadge";
import { Card } from "./Card";
import { UncappedStat } from "./UncappedStat";

const ALL_REGIONS: ProRegion[] = ["NA", "EU", "OCE", "SAM", "MENA", "APAC", "SSA"];

/** Full-screen overlay showing a real tracked opponent's (pro or regional grinder) per-queue stats, mirroring
 *  the shape of the player's own Stats screen — current MMR/rank, all-time peak, Game Sense, Mechanical
 *  Consistency. Opened by clicking a name in the Recent Matches list (see HomeScreen.tsx). A name with no
 *  tracked identity (a plain filler/generic opponent) shows a simple "no data" message instead. */
export function AiProfileModal() {
  const viewingName = useAiProfileStore((st) => st.viewingName);
  const close = useAiProfileStore((st) => st.close);
  const s = useSaveStore();
  const proMmrTable = useProLeaderboardStore((st) => st.mmr);
  const rosterMmrTable = useRegionalRosterStore((st) => st.mmr);

  const era = eraForDate(s.currentDate);
  const currentYear = s.currentDate.year;
  const pro = viewingName ? PRO_PLAYERS.find((p) => p.name === viewingName) : undefined;
  const grinderRegion = viewingName && !pro ? ALL_REGIONS.find((r) => regionalGrinderRoster(r, currentYear).some((g) => g.name === viewingName)) : undefined;

  // Warms this identity's entry for every queue (side-effecting store call) — done in an effect, never
  // during render, same rule every other screen in this codebase follows for these stores.
  useEffect(() => {
    if (!viewingName) return;
    QUEUES.forEach((q) => {
      if (pro) useProLeaderboardStore.getState().getStats(viewingName, q, era, currentYear, s.currentDate, s.seasonStartDate);
      else if (grinderRegion) useRegionalRosterStore.getState().getStats(viewingName, grinderRegion, q, era, currentYear, s.currentDate, s.seasonStartDate);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewingName]);

  if (!viewingName) return null;

  const region = pro?.region ?? grinderRegion;
  const isKnown = !!pro || !!grinderRegion;

  return (
    <div className="ai-profile-backdrop" onClick={close}>
      <div className="ai-profile-card" onClick={(e) => e.stopPropagation()}>
        <button className="ai-profile-close" onClick={close} aria-label="Close">
          &times;
        </button>
        <div className="ai-profile-header">
          <div className="ai-profile-name">{viewingName}</div>
          <div className="ai-profile-sub">
            {region ? PRO_REGION_LABELS[region] : "Unknown region"}
            {pro ? " · Pro" : grinderRegion ? " · Ranked Grinder" : ""}
          </div>
        </div>

        {!isKnown ? (
          <div className="ai-profile-empty">No tracked stats for this player — just a name that showed up that match.</div>
        ) : (
          <div className="ai-profile-grid">
            {QUEUES.map((q) => {
              const entry = pro ? proMmrTable[viewingName]?.[q] : grinderRegion ? rosterMmrTable[grinderRegion]?.[viewingName]?.[q] : undefined;
              if (!entry) return null;
              const rank = deriveRankFromMmr(entry.mmr, era, q);
              const peakRank = deriveRankFromMmr(entry.peakMmr, era, q);
              return (
                <Card key={q} title={QUEUE_LABELS[q]}>
                  <div className="ai-profile-rank-row">
                    <RankBadge tier={rank.tier} division={rank.division} era={era} size={48} />
                    <div>
                      <div className="ai-profile-mmr">{entry.mmr} MMR</div>
                      <div className="ai-profile-peak">
                        Peak: {entry.peakMmr} MMR ({TIER_LABELS[peakRank.tier]})
                      </div>
                    </div>
                  </div>
                  <UncappedStat label="Game Sense" value={entry.gameSense} />
                  <UncappedStat label="Mechanical Consistency" value={entry.mechanicalConsistency} />
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <style>{`
        .ai-profile-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.55);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 200;
          padding: var(--space-4);
        }
        .ai-profile-card {
          position: relative;
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          padding: var(--space-5);
          max-width: 640px;
          width: 100%;
          max-height: 85vh;
          overflow-y: auto;
        }
        .ai-profile-close {
          position: absolute;
          top: var(--space-3);
          right: var(--space-3);
          background: none;
          border: none;
          font-size: 20px;
          line-height: 1;
          color: var(--text-tertiary);
          cursor: pointer;
        }
        .ai-profile-header {
          margin-bottom: var(--space-4);
        }
        .ai-profile-name {
          font-size: 20px;
          font-weight: 700;
        }
        .ai-profile-sub {
          font-size: 13px;
          color: var(--text-tertiary);
          margin-top: 2px;
        }
        .ai-profile-empty {
          font-size: 13px;
          color: var(--text-tertiary);
        }
        .ai-profile-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: var(--space-3);
        }
        @media (min-width: 560px) {
          .ai-profile-grid {
            grid-template-columns: repeat(3, 1fr);
          }
        }
        .ai-profile-rank-row {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          margin-bottom: var(--space-3);
        }
        .ai-profile-mmr {
          font-size: 16px;
          font-weight: 700;
        }
        .ai-profile-peak {
          font-size: 12px;
          color: var(--text-tertiary);
        }
      `}</style>
    </div>
  );
}
