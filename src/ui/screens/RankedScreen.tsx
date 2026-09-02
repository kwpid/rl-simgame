import { useEffect, useState } from "react";
import { RankBadge } from "@/ui/components/RankBadge";
import { Icon } from "@/ui/components/Icon";
import { DivisionProgress } from "@/ui/components/DivisionProgress";
import type { QueueMode } from "@/data/mockSave";
import { eraForDate, tierColor, divisionLabel, divisionCount, deriveRankFromMmr, tierMinMmr, TIER_LABELS } from "@/data/rankSystem";
import { QUEUES, QUEUE_LABELS, QUEUE_ICONS } from "@/data/queues";
import { useMatchStore, isTopmostTierForEra } from "@/store/useMatchStore";
import { useSaveStore } from "@/store/useSaveStore";
import { useProLeaderboardStore } from "@/store/useProLeaderboardStore";
import { useRegionalRosterStore } from "@/store/useRegionalRosterStore";
import { regionalGrinderRoster } from "@/data/regionalGrinders";
import { activeProPlayers, type ProRegion } from "@/data/proPlayers";
import { flattenProgress } from "@/data/matchSim";
import { orgTagForOrgName, saveRegionToProRegion, REGION_LABELS as PRO_REGION_LABELS } from "@/data/tournaments";
import { seasonEndDate, rewardTierSequence, REWARD_WINS_REQUIRED } from "@/data/seasons";
import { daysBetween } from "@/data/dateUtils";

const LEADERBOARD_SIZE = 50;

const TEAM_SIZE: Record<QueueMode, number> = { "1v1": 1, "2v2": 2, "3v3": 3 };

const ALL_MATCHMAKING_REGIONS: ProRegion[] = ["NA", "EU", "OCE", "SAM", "MENA", "APAC", "SSA"];

function formatMmSs(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const sec = totalSeconds % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function RankedScreen() {
  const [queue, setQueue] = useState<QueueMode>("2v2");
  // Multi-queue: extra queues (besides whichever tab is currently shown) to search at the same time,
  // whichever pops first wins and the rest cancel automatically (see useMatchStore's startQueue).
  const [multiQueueExtras, setMultiQueueExtras] = useState<Set<QueueMode>>(new Set());
  const s = useSaveStore();
  const removePartyMember = useSaveStore((st) => st.removePartyMember);
  const clearParty = useSaveStore((st) => st.clearParty);
  const dismissPendingPromotion = useSaveStore((st) => st.dismissPendingPromotion);
  const dismissPendingPlacementResult = useSaveStore((st) => st.dismissPendingPlacementResult);
  const partyTotal = s.partyMembers.length + 1;
  const queueBlockedByParty = partyTotal > TEAM_SIZE[queue];
  const era = eraForDate(s.currentDate);
  const profile = s.rankedProfiles[queue];

  // Subscribed for reactivity (re-renders whenever a match changes a pro's MMR); reads here are pure,
  // no seeding side effect, that happens once in the effect below instead of mid-render.
  const proMmrTable = useProLeaderboardStore((store) => store.mmr);
  const ensureProsSeeded = useProLeaderboardStore((store) => store.ensureSeeded);
  const regionalRosterMmrTable = useRegionalRosterStore((store) => store.mmr);
  const ensureRegionalRosterSeeded = useRegionalRosterStore((store) => store.ensureSeeded);
  const currentYear = s.currentDate.year;
  const activePros = activeProPlayers(currentYear);

  useEffect(() => {
    ensureProsSeeded(activePros.map((p) => p.name), queue, era, currentYear, s.currentDate, s.seasonStartDate);
    ALL_MATCHMAKING_REGIONS.forEach((region) => ensureRegionalRosterSeeded(region, queue, era, currentYear, s.currentDate, s.seasonStartDate));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, era, currentYear, s.currentDate.year, s.currentDate.month, s.currentDate.day, s.seasonStartDate.year, s.seasonStartDate.month, s.seasonStartDate.day]);

  // Rank-up animation: only plays once the player's actually looking at the queue that just promoted,
  // then clears itself so it doesn't replay every time they revisit Ranked.
  const showPromotionAnim = s.pendingPromotion?.queue === queue;
  useEffect(() => {
    if (!showPromotionAnim) return;
    const timer = setTimeout(() => dismissPendingPromotion(), 2200);
    return () => clearTimeout(timer);
  }, [showPromotionAnim, dismissPendingPromotion]);

  // Top 50 is by definition everyone at the very top of the ladder, so nobody on it (real pro or filler)
  // can sit below the MMR floor for the best tier this era actually offers (SSL in modern, Grand
  // Champion in legacy). A pro whose live MMR in THIS queue doesn't clear that floor (a 2v2-main pro's
  // weaker 1v1, or basically anyone's neglected 3v3) just isn't Top 50 caliber here and is left out.
  const topTierFloor = tierMinMmr(era === "modern" ? "ssl" : "grand_champion", era, queue);
  const proRows = activePros
    .map((pro) => {
      const entry = proMmrTable[pro.name]?.[queue];
      const mmr = entry?.mmr ?? 0;
      const derived = deriveRankFromMmr(mmr, era, queue);
      return { rank: 0, name: pro.name, mmr, rankTier: derived.tier, division: derived.division, region: pro.region, isPlayer: false };
    })
    .filter((row) => row.mmr >= topTierFloor);
  // Grinder identities carry a real, persistent, region-tagged MMR (see useRegionalRosterStore) instead of
  // a fresh random roll every render, so the board is stable and a match opponent sharing one of these
  // names is provably the same person with the same MMR the board is showing — a global "see how every
  // region's grinders/pros are doing" view, not scoped to whichever region(s) the player has selected for
  // their own search.
  const grinderRows = ALL_MATCHMAKING_REGIONS.flatMap((region) =>
    regionalGrinderRoster(region, currentYear).map((grinder) => {
      const entry = regionalRosterMmrTable[region]?.[grinder.name]?.[queue];
      const mmr = entry?.mmr ?? 0;
      const derived = deriveRankFromMmr(mmr, era, queue);
      return { rank: 0, name: grinder.name, mmr, rankTier: derived.tier, division: derived.division, region, isPlayer: false };
    })
  ).filter((row) => row.mmr >= topTierFloor);
  const leaderboard =
    profile.placementMatchesRemaining > 0
      ? [...proRows, ...grinderRows].sort((a, b) => b.mmr - a.mmr).slice(0, LEADERBOARD_SIZE).map((row, i) => ({ ...row, rank: i + 1 }))
      : [
          ...proRows,
          ...grinderRows,
          { rank: 0, name: s.displayName, mmr: profile.mmr, rankTier: profile.rankTier, division: profile.division, region: saveRegionToProRegion(s.region), isPlayer: true },
        ]
          .sort((a, b) => b.mmr - a.mmr)
          .slice(0, LEADERBOARD_SIZE)
          .map((row, i) => ({ ...row, rank: i + 1 }));
  const topRankTier = era === "modern" ? "ssl" : "grand_champion";

  const matchPhase = useMatchStore((m) => m.phase);
  const queuedModes = useMatchStore((m) => m.queuedModes);
  const startQueue = useMatchStore((m) => m.startQueue);
  const cancelQueue = useMatchStore((m) => m.cancelQueue);
  const setAutoQueueModes = useMatchStore((m) => m.setAutoQueueModes);
  const estimatedQueueDurationsMs = useMatchStore((m) => m.estimatedQueueDurationsMs);
  const searchStartedAt = useMatchStore((m) => m.searchStartedAt);
  const setSelectedMatchmakingRegions = useSaveStore((st) => st.setSelectedMatchmakingRegions);
  const [autoQueueChecked, setAutoQueueChecked] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const isTopTierQueue = profile.rankTier === "grand_champion" || profile.rankTier === "ssl";
  const isTopmostQueue = isTopmostTierForEra(profile.rankTier, era);

  useEffect(() => {
    if (matchPhase !== "searching" || searchStartedAt === null) return;
    const tick = () => setElapsedMs(Date.now() - searchStartedAt);
    tick();
    const interval = setInterval(tick, 300);
    return () => clearInterval(interval);
  }, [matchPhase, searchStartedAt]);

  function toggleRegion(region: ProRegion) {
    const current = s.selectedMatchmakingRegions;
    const next = current.includes(region) ? current.filter((r) => r !== region) : [...current, region];
    setSelectedMatchmakingRegions(next);
  }

  const endDate = seasonEndDate(s.seasonStartDate);
  const totalHoursRemaining = Math.max(0, daysBetween(s.currentDate, endDate) * 24 - s.clockHour);
  const daysRemaining = Math.floor(totalHoursRemaining / 24);
  const hoursRemaining = totalHoursRemaining % 24;

  /** Builds this queue's own search request (rank tier/MMR/self stats all vary per playlist). */
  function buildQueueRequest(q: QueueMode) {
    const p = s.rankedProfiles[q];
    const qMatchmakingTier = p.placementMatchesRemaining > 0 ? deriveRankFromMmr(p.mmr, era, q).tier : p.rankTier;
    return {
      queue: q,
      rankTier: qMatchmakingTier,
      playerMmr: p.mmr,
      regions: s.selectedMatchmakingRegions,
      self: {
        name: s.displayName,
        gameSense: s.player.gameSense[q],
        mechanicalConsistency: s.player.mechanicalConsistency[q],
        foundationStats: s.foundationStats,
        title: s.titles.find((t) => t.id === s.equippedTitleId) ?? null,
        duelMastery: {
          mechanicMastery: flattenProgress(s.mechanicProgress),
          queueConceptMastery: flattenProgress(s.queueConceptProgress),
          playstyle: s.playstyleProfiles[q],
        },
        orgTag: s.orgContract ? orgTagForOrgName(s.orgContract.orgName) : undefined,
        region: saveRegionToProRegion(s.region),
      },
    };
  }

  function toggleMultiQueueExtra(q: QueueMode) {
    setMultiQueueExtras((prev) => {
      const next = new Set(prev);
      if (next.has(q)) next.delete(q);
      else next.add(q);
      return next;
    });
  }

  function handleSearch() {
    const queuesToSearch = [queue, ...Array.from(multiQueueExtras).filter((q) => q !== queue && partyTotal <= TEAM_SIZE[q])];
    const partyFriendStats: Record<string, { mmr: Record<QueueMode, number>; gameSense: Record<QueueMode, number>; mechanicalConsistency: Record<QueueMode, number> }> = {};
    for (const name of s.partyMembers) {
      const friend = s.friends[name];
      if (friend) partyFriendStats[name] = { mmr: friend.mmr, gameSense: friend.gameSense, mechanicalConsistency: friend.mechanicalConsistency };
    }
    setAutoQueueModes(autoQueueChecked ? queuesToSearch : null);
    startQueue(queuesToSearch.map(buildQueueRequest), s.clockHour, era, s.seasonNumber, s.currentDate.year, s.currentDate, s.seasonStartDate, s.partyMembers, partyFriendStats);
  }

  return (
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      <header style={{ marginBottom: "var(--space-4)" }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 650 }}>Ranked</h1>
        <div className="season-badge">
          <span>Season {s.seasonNumber}</span>
          <span className="season-badge-sep">&middot;</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {daysRemaining}d {hoursRemaining}h left
          </span>
        </div>
      </header>

      {s.partyMembers.length > 0 && (
        <div className="party-banner">
          <span>
            Partied with {s.partyMembers.map((n, i) => (
              <span key={n}>
                {i > 0 && ", "}
                <strong>{n}</strong>
                <button className="party-leave-btn" onClick={() => removePartyMember(n)} title={`Remove ${n} from party`}>
                  ×
                </button>
              </span>
            ))}
          </span>
          <button className="party-clear-btn" onClick={clearParty}>
            Leave Party
          </button>
        </div>
      )}

      {profile.placementMatchesRemaining > 0 ? (
        <div className="reward-progress">
          <span className="reward-progress-label">Reward progress unlocks once placements are done</span>
        </div>
      ) : (
        <div className="reward-progress">
          <span className="reward-progress-label">
            Reward level: <strong style={{ color: tierColor(s.rewardTierUnlocked, era) }}>{TIER_LABELS[s.rewardTierUnlocked]}</strong>
          </span>
          {(() => {
            const sequence = rewardTierSequence(era);
            const nextTier = sequence[sequence.indexOf(s.rewardTierUnlocked) + 1];
            if (!nextTier) return <span className="reward-progress-count">Maxed out for this era</span>;
            const winsTowardNext = s.rewardProgressByTier[nextTier] ?? 0;
            return (
              <>
                <div className="reward-progress-bar">
                  <div
                    className="reward-progress-fill"
                    style={{ width: `${(winsTowardNext / REWARD_WINS_REQUIRED) * 100}%`, background: tierColor(nextTier, era) }}
                  />
                </div>
                <span className="reward-progress-count">
                  {winsTowardNext}/{REWARD_WINS_REQUIRED} wins toward {TIER_LABELS[nextTier]}
                </span>
              </>
            );
          })()}
        </div>
      )}

      <div className="mode-row">
        {QUEUES.map((q) => {
          const p = s.rankedProfiles[q];
          const active = queue === q;
          const blocked = partyTotal > TEAM_SIZE[q];
          return (
            <button
              key={q}
              className={"mode-tile" + (active ? " mode-tile-active" : "") + (blocked ? " mode-tile-blocked" : "")}
              style={{ ["--tier-color" as string]: tierColor(p.rankTier, era) }}
              onClick={() => setQueue(q)}
              title={blocked ? `Can't queue ${QUEUE_LABELS[q]} with a party of ${partyTotal}` : QUEUE_LABELS[q]}
            >
              <RankBadge tier={p.rankTier} division={p.division} era={era} size={36} />
              <Icon name={QUEUE_ICONS[q]} size={18} />
            </button>
          );
        })}
      </div>

      <div key={queue} className="fade-in">
        <div className="play-card" style={{ ["--tier-color" as string]: tierColor(profile.rankTier, era) }}>
          <div className="play-card-gradient" />
          <div className="play-card-icon">
            <Icon name={QUEUE_ICONS[queue]} size={140} />
          </div>
          <div className="play-panel">
            <div className={"rank-badge-wrap" + (showPromotionAnim ? " rank-up-anim" : "")}>
              <RankBadge tier={profile.rankTier} division={profile.division} era={era} size={88} />
              {showPromotionAnim && <div className="rank-up-burst" />}
            </div>
            <div className="play-panel-info">
              {profile.placementMatchesRemaining > 0 ? (
                <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text-secondary)" }}>
                  Placement {10 - profile.placementMatchesRemaining}/10
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 20, fontWeight: 700, color: tierColor(profile.rankTier, era) }}>
                    {divisionLabel(profile.rankTier, profile.division, era)}
                  </div>
                  {divisionCount(profile.rankTier, era) > 0 && (
                    <div style={{ marginTop: 6, marginBottom: 2 }}>
                      <DivisionProgress filled={profile.divisionProgress} color={tierColor(profile.rankTier, era)} />
                    </div>
                  )}
                </>
              )}
              <div style={{ fontSize: 13, color: "var(--text-tertiary)", marginTop: 6 }}>
                {profile.mmr} MMR, {profile.seasonMatchesPlayed} matches this season
              </div>
              {profile.streakCount > 0 && profile.streakType && (
                <div className={"streak-badge" + (profile.streakType === "win" ? " streak-win" : " streak-loss")}>
                  {profile.streakCount} {profile.streakType === "win" ? "Win" : "Loss"} Streak
                </div>
              )}
            </div>

            <div className="play-panel-action">
              {matchPhase === "idle" && isTopTierQueue && (
                <div className="multi-queue-row">
                  <span className="multi-queue-label">Regions:</span>
                  {ALL_MATCHMAKING_REGIONS.map((region) => (
                    <button
                      key={region}
                      className={"multi-queue-chip" + (s.selectedMatchmakingRegions.includes(region) ? " multi-queue-chip-active" : "")}
                      onClick={() => toggleRegion(region)}
                      title="More regions pop faster but pull from a wider, less locally-flavored pool"
                    >
                      {region}
                    </button>
                  ))}
                </div>
              )}
              {matchPhase === "idle" && (
                <div className="multi-queue-row">
                  <span className="multi-queue-label">Also search:</span>
                  {QUEUES.filter((q) => q !== queue).map((q) => {
                    const blocked = partyTotal > TEAM_SIZE[q];
                    return (
                      <button
                        key={q}
                        className={"multi-queue-chip" + (multiQueueExtras.has(q) ? " multi-queue-chip-active" : "")}
                        disabled={blocked}
                        title={blocked ? `Can't queue ${QUEUE_LABELS[q]} with a party of ${partyTotal}` : undefined}
                        onClick={() => toggleMultiQueueExtra(q)}
                      >
                        {QUEUE_LABELS[q]}
                      </button>
                    );
                  })}
                </div>
              )}
              {matchPhase === "idle" && queueBlockedByParty && (
                <div className="search-note">
                  Can't queue {QUEUE_LABELS[queue]} with a party of {partyTotal}. Leave your party or bring fewer friends.
                </div>
              )}
              {matchPhase === "idle" && !queueBlockedByParty && (
                <>
                  <label className="auto-queue-row">
                    <input
                      type="checkbox"
                      checked={autoQueueChecked}
                      onChange={(e) => setAutoQueueChecked(e.target.checked)}
                    />
                    <span>Auto-Queue (re-queue automatically after each game)</span>
                  </label>
                  <button className="search-btn" onClick={handleSearch}>
                    Search for Match
                  </button>
                </>
              )}
              {matchPhase === "searching" && queuedModes.includes(queue) && (
                <button className="search-btn search-btn-active" onClick={cancelQueue}>
                  Searching{queuedModes.length > 1 ? ` (${queuedModes.map((q) => QUEUE_LABELS[q]).join(", ")})` : ""}
                  <span className="dots" />
                  <div className="queue-timer">
                    {isTopmostQueue ? (
                      elapsedMs < 20000
                        ? `elapsed ${formatMmSs(elapsedMs)} — looking for someone online in your region(s)`
                        : elapsedMs < 60000
                          ? `elapsed ${formatMmSs(elapsedMs)} — widening MMR search range`
                          : `elapsed ${formatMmSs(elapsedMs)} — no one else appears to be online right now, still searching`
                    ) : (
                      <>~{formatMmSs(estimatedQueueDurationsMs[queue] ?? 0)} est. &middot; elapsed {formatMmSs(elapsedMs)}</>
                    )}
                  </div>
                </button>
              )}
              {matchPhase === "searching" && !queuedModes.includes(queue) && (
                <div className="search-note">
                  Already searching for {queuedModes.map((q) => QUEUE_LABELS[q]).join(", ")}.
                </div>
              )}
              {(matchPhase === "found" || matchPhase === "in_match" || matchPhase === "post_match") && (
                <div className="search-note">Match in progress.</div>
              )}
            </div>
          </div>
        </div>

        <div className="leaderboard-card" style={{ ["--top-color" as string]: tierColor(topRankTier, era) }}>
          <div className="leaderboard-header">
            <h2 className="leaderboard-title">Top 50</h2>
            <RankBadge tier={topRankTier} era={era} size={22} />
          </div>
          <div className="leaderboard-scroll">
            <table className="leaderboard-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Player</th>
                  <th>Region</th>
                  <th style={{ textAlign: "right" }}>MMR</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((row) => (
                  <tr key={row.isPlayer ? "self" : row.rank} className={row.isPlayer ? "leaderboard-row-self" : undefined}>
                    <td>{row.rank}</td>
                    <td>{row.name}</td>
                    <td style={{ color: "var(--text-tertiary)" }}>{PRO_REGION_LABELS[row.region]}</td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>{row.mmr}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {s.pendingPlacementResult && (
        <div className="placement-modal-backdrop">
          <div className="placement-modal" style={{ ["--tier-color" as string]: tierColor(s.pendingPlacementResult.tier, era) }}>
            <div className="placement-modal-label">Placements Complete</div>
            <RankBadge tier={s.pendingPlacementResult.tier} division={s.pendingPlacementResult.division} era={era} size={120} />
            <div className="placement-modal-rank" style={{ color: tierColor(s.pendingPlacementResult.tier, era) }}>
              {divisionLabel(s.pendingPlacementResult.tier, s.pendingPlacementResult.division, era)}
            </div>
            <div className="placement-modal-queue">{QUEUE_LABELS[s.pendingPlacementResult.queue]} &middot; {s.pendingPlacementResult.mmr} MMR</div>
            <button className="placement-modal-btn" onClick={dismissPendingPlacementResult}>
              Continue
            </button>
          </div>
        </div>
      )}

      <style>{`
        .mode-row {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: var(--space-2);
          margin-bottom: var(--space-4);
        }
        .mode-tile {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: var(--space-2);
          background: linear-gradient(135deg, color-mix(in srgb, var(--tier-color) 14%, var(--bg-surface)), var(--bg-surface) 70%);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: var(--space-3);
          cursor: pointer;
          min-width: 0;
          color: var(--text-secondary);
          transition: border-color 150ms ease, background 150ms ease;
        }
        .mode-tile:hover {
          border-color: var(--border-strong);
        }
        .mode-tile-active {
          border-color: var(--accent);
          background: var(--accent-muted);
        }
        .mode-tile-active svg {
          color: var(--accent);
        }

        .play-card {
          position: relative;
          overflow: hidden;
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          padding: var(--space-4);
          margin-bottom: var(--space-4);
        }
        .play-card-gradient {
          position: absolute;
          inset: 0;
          background: linear-gradient(to left, color-mix(in srgb, var(--tier-color) 16%, transparent), transparent 65%);
          pointer-events: none;
        }
        .play-card-icon {
          position: absolute;
          top: 50%;
          right: 12px;
          transform: translateY(-50%);
          color: var(--tier-color);
          opacity: 0.14;
          pointer-events: none;
        }
        .play-panel {
          position: relative;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: var(--space-4);
        }
        .play-panel-info {
          flex: 1;
          min-width: 200px;
        }
        .rank-badge-wrap {
          position: relative;
          display: inline-flex;
        }
        .rank-up-anim {
          animation: rank-up-pulse 2200ms ease;
        }
        .rank-up-burst {
          position: absolute;
          inset: -14px;
          border-radius: 50%;
          border: 3px solid var(--tier-color);
          opacity: 0;
          animation: rank-up-ring 2200ms ease;
          pointer-events: none;
        }
        @keyframes rank-up-pulse {
          0% { transform: scale(1); }
          15% { transform: scale(1.25); }
          35% { transform: scale(1); }
          50% { transform: scale(1.12); }
          65% { transform: scale(1); }
          100% { transform: scale(1); }
        }
        @keyframes rank-up-ring {
          0% { opacity: 0.9; transform: scale(0.8); }
          70% { opacity: 0; transform: scale(1.6); }
          100% { opacity: 0; transform: scale(1.6); }
        }
        .streak-badge {
          display: inline-block;
          margin-top: 8px;
          padding: 3px 10px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.3px;
        }
        .streak-win {
          color: var(--success);
          background: color-mix(in srgb, var(--success) 15%, transparent);
        }
        .streak-loss {
          color: var(--danger);
          background: color-mix(in srgb, var(--danger) 15%, transparent);
        }
        .placement-modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.6);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 200;
        }
        .placement-modal {
          background: var(--bg-surface);
          border: 1px solid color-mix(in srgb, var(--tier-color) 50%, var(--border-subtle));
          border-radius: var(--radius-lg);
          padding: var(--space-5);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          max-width: 320px;
          text-align: center;
          animation: rank-up-pulse 900ms ease;
        }
        .placement-modal-label {
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          color: var(--text-tertiary);
        }
        .placement-modal-rank {
          font-size: 22px;
          font-weight: 800;
        }
        .placement-modal-queue {
          font-size: 13px;
          color: var(--text-tertiary);
        }
        .placement-modal-btn {
          margin-top: var(--space-2);
          background: var(--accent);
          color: #17181c;
          border: none;
          border-radius: var(--radius-md);
          font-size: 13px;
          font-weight: 700;
          padding: 10px 24px;
          cursor: pointer;
        }
        .season-badge {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-top: 4px;
          font-size: 12px;
          color: var(--text-tertiary);
        }
        .season-badge-sep {
          opacity: 0.6;
        }
        .reward-progress {
          margin-top: 10px;
          max-width: 260px;
        }
        .reward-progress-label {
          font-size: 12px;
          color: var(--text-tertiary);
        }
        .reward-progress-bar {
          height: 5px;
          border-radius: 999px;
          background: var(--bg-surface-raised);
          margin: 5px 0 3px;
          overflow: hidden;
        }
        .reward-progress-fill {
          height: 100%;
          border-radius: 999px;
          transition: width 200ms ease;
        }
        .reward-progress-count {
          font-size: 11px;
          color: var(--text-tertiary);
        }
        .play-panel-action {
          width: 100%;
        }
        @media (min-width: 720px) {
          .play-panel-action {
            width: auto;
            margin-left: auto;
          }
        }

        .auto-queue-row {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: var(--text-secondary);
          cursor: pointer;
          margin-bottom: var(--space-2);
        }

        .search-btn {
          background: var(--accent);
          color: #17181c;
          border: none;
          border-radius: var(--radius-md);
          font-size: 14px;
          font-weight: 700;
          padding: 14px 24px;
          cursor: pointer;
          width: 100%;
          white-space: nowrap;
          transition: background 150ms ease;
        }
        .search-btn:hover {
          background: var(--accent-hover);
        }
        .party-banner {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: var(--space-3);
          background: var(--accent-muted);
          border: 1px solid var(--accent);
          border-radius: var(--radius-md);
          padding: 10px 14px;
          margin-bottom: var(--space-3);
          font-size: 13px;
          flex-wrap: wrap;
        }
        .party-leave-btn {
          background: none;
          border: none;
          color: var(--text-tertiary);
          cursor: pointer;
          font-size: 13px;
          padding: 0 2px;
        }
        .party-leave-btn:hover {
          color: var(--danger);
        }
        .party-clear-btn {
          background: none;
          border: 1px solid var(--border-strong);
          border-radius: var(--radius-sm);
          color: var(--text-secondary);
          font-size: 12px;
          padding: 5px 12px;
          cursor: pointer;
          white-space: nowrap;
        }
        .mode-tile-blocked {
          opacity: 0.4;
        }
        .search-btn-active {
          background: var(--bg-surface-raised);
          color: var(--text-primary);
          border: 1px solid var(--border-strong);
        }
        .queue-timer {
          font-size: 11px;
          font-weight: 500;
          color: var(--text-tertiary);
          font-variant-numeric: tabular-nums;
          margin-top: 2px;
        }
        .dots::after {
          content: "";
          animation: dots 1.2s steps(4, end) infinite;
        }
        @keyframes dots {
          0% { content: ""; }
          25% { content: "."; }
          50% { content: ".."; }
          75% { content: "..."; }
        }

        .search-note {
          background: var(--bg-surface-raised);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 12px 16px;
          font-size: 13px;
          color: var(--text-secondary);
        }
        .multi-queue-row {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 8px;
          flex-wrap: wrap;
        }
        .multi-queue-label {
          font-size: 12px;
          color: var(--text-tertiary);
        }
        .multi-queue-chip {
          background: var(--bg-surface-raised);
          border: 1px solid var(--border-subtle);
          border-radius: 999px;
          color: var(--text-secondary);
          font-size: 12px;
          padding: 4px 12px;
          cursor: pointer;
        }
        .multi-queue-chip:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .multi-queue-chip-active {
          background: var(--accent-muted);
          border-color: var(--accent);
          color: var(--accent);
          font-weight: 600;
        }

        .leaderboard-card {
          background: var(--bg-surface);
          border: 1px solid color-mix(in srgb, var(--top-color) 40%, var(--border-subtle));
          border-radius: var(--radius-lg);
          padding: var(--space-4);
        }
        .leaderboard-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: var(--space-3);
        }
        .leaderboard-title {
          margin: 0;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          color: var(--text-tertiary);
        }
        .leaderboard-scroll {
          max-height: 360px;
          overflow-y: auto;
          margin: 0 calc(var(--space-4) * -1) calc(var(--space-4) * -1);
        }
        .leaderboard-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }
        .leaderboard-table thead th {
          position: sticky;
          top: 0;
          background: var(--bg-surface);
          text-align: left;
          color: var(--text-tertiary);
          font-weight: 500;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          padding: 8px var(--space-4);
          border-bottom: 1px solid var(--border-subtle);
        }
        .leaderboard-table td {
          padding: 7px var(--space-4);
          border-bottom: 1px solid var(--border-subtle);
          white-space: nowrap;
        }
        .leaderboard-table tbody tr:hover {
          background: var(--bg-surface-hover);
        }
        .leaderboard-row-self {
          background: color-mix(in srgb, var(--accent) 14%, transparent);
        }
        .leaderboard-row-self td {
          color: var(--accent);
          font-weight: 700;
        }
      `}</style>
    </div>
  );
}
