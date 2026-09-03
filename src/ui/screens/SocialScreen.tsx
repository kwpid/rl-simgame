import { useState, useEffect } from "react";
import { useSaveStore } from "@/store/useSaveStore";
import { useMatchStore, type SelfStats } from "@/store/useMatchStore";
import { PRO_PLAYERS, type ProRegion } from "@/data/proPlayers";
import { useLeaderboardFillerStore, fillerLeaderboardNames } from "@/store/useLeaderboardFillerStore";
import { useProLeaderboardStore } from "@/store/useProLeaderboardStore";
import { useRegionalRosterStore } from "@/store/useRegionalRosterStore";
import { regionalGrinderRoster } from "@/data/regionalGrinders";
import { STREAMERS } from "@/data/showmatches";
import { computeOverallRating } from "@/data/matchSim";
import { flattenProgress } from "@/data/matchSim";
import { eraForDate, deriveRankFromMmr, divisionLabel, tierColor, type RankTierId } from "@/data/rankSystem";
import { daysBetween } from "@/data/dateUtils";
import { FOUNDATION_LABELS, type FoundationCategory } from "@/data/mechanics";
import type { FriendRecord, QueueMode } from "@/data/mockSave";
import { orgTagForOrgName, saveRegionToProRegion } from "@/data/tournaments";
import { isOnlineNow } from "@/data/aiActivity";
import { RankBadge } from "@/ui/components/RankBadge";

// --- Accept chance logic ---
// Similar-rank (same tier/MMR range) friends will almost always accept. A real pro or leaderboard regular
// sitting far above the player's skill has no real reason to accept from a stranger.
// Uses RATIO of overall rating (not raw MMR) since the scale is vastly different at every rank.
const ACCEPT_CHANCE_RATIO_FLOOR = 1.3;
const ACCEPT_CHANCE_RATIO_CEILING = 4;
const ACCEPT_CHANCE_MIN = 0.05;

function acceptChanceForOverallGap(myRating: number, otherRating: number): number {
  const lo = Math.max(1, Math.min(myRating, otherRating));
  const hi = Math.max(myRating, otherRating);
  const ratio = hi / lo;
  if (ratio <= ACCEPT_CHANCE_RATIO_FLOOR) return 1;
  if (ratio >= ACCEPT_CHANCE_RATIO_CEILING) return ACCEPT_CHANCE_MIN;
  const t = (ratio - ACCEPT_CHANCE_RATIO_FLOOR) / (ACCEPT_CHANCE_RATIO_CEILING - ACCEPT_CHANCE_RATIO_FLOOR);
  return 1 - t * (1 - ACCEPT_CHANCE_MIN);
}

/** A leaderboard name's persisted stats only track Game Sense/Mechanical Consistency, not a real per-
 *  category foundation-stat breakdown, so this approximates their Overall Rating by treating their
 *  foundation as uniformly equal to their Game Sense — the same proxy relationship already used elsewhere
 *  in this codebase (matchSim.ts's ranked-opponent generation) between a rank's Game Sense and its
 *  foundation baseline. */
function approximateOverallRating(gameSense: number, mechanicalConsistency: number): number {
  const uniformFoundation = Object.fromEntries(
    (Object.keys(FOUNDATION_LABELS) as FoundationCategory[]).map((cat) => [cat, gameSense])
  ) as Record<FoundationCategory, number>;
  return computeOverallRating(gameSense, mechanicalConsistency, uniformFoundation);
}

const ALL_MATCHMAKING_REGIONS: ProRegion[] = ["NA", "EU", "OCE", "SAM", "MENA", "APAC", "SSA"];
const FILLER_REGIONS = ["NA", "EU", "OCE", "SAM", "MENA", "APAC"];

/** Best-effort region + pro flag for a name encountered in a match: a real pro's own region, a regional
 *  grinder identity's real assigned region, a (pre-migration) filler leaderboard regular's fake round-robin
 *  region kept only as a fallback for names recorded before this store existed, or unknown for a plain
 *  low-rank opponent name (never tracked anywhere, just flavor for that tier). */
function lookupPlayerInfo(name: string, currentYear: number): { region: string; isPro: boolean } {
  const pro = PRO_PLAYERS.find((p) => p.name === name);
  if (pro) return { region: pro.region, isPro: true };
  for (const region of ALL_MATCHMAKING_REGIONS) {
    if (regionalGrinderRoster(region, currentYear).some((g) => g.name === name)) return { region, isPro: false };
  }
  const fillerIndex = fillerLeaderboardNames().indexOf(name);
  if (fillerIndex >= 0) return { region: FILLER_REGIONS[fillerIndex % FILLER_REGIONS.length], isPro: false };
  return { region: "Unknown", isPro: false };
}

// --- Online/Activity status ---
type FriendStatus =
  | { kind: "offline" }
  | { kind: "online" }
  | { kind: "in_game"; queue: QueueMode }
  | { kind: "in_party" };

const QUEUE_LABELS: Record<QueueMode, string> = { "1v1": "1s", "2v2": "2s", "3v3": "3s" };

/** Deterministic online status for a friend. Uses the same isOnlineNow logic as matchmaking for
 *  consistency, then layers a simulated "focus queue" to show which mode they're in. */
function friendStatus(f: FriendRecord, currentDate: { year: number; month: number; day: number }, hourOfDay: number, inParty: boolean): FriendStatus {
  if (inParty) return { kind: "in_party" };
  // Plain friends don't have a ProRegion, fall back to NA for the activity model
  const region = (["NA", "EU", "OCE", "SAM", "MENA", "APAC", "SSA"].includes(f.region) ? f.region : "NA") as ProRegion;
  const simDate = { year: currentDate.year, month: currentDate.month, day: currentDate.day };
  const online = isOnlineNow(f.name, region, simDate, hourOfDay);
  if (!online) return { kind: "offline" };
  // Pick which queue they're grinding right now — cycle every 3 hours of in-game time
  const ALL_QUEUES: QueueMode[] = ["1v1", "2v2", "3v3"];
  const block = Math.floor(hourOfDay / 3);
  // Simple deterministic hash of name + date + block
  const seed = f.name.split("").reduce((a, c) => a + c.charCodeAt(0), 0) * 31 +
    currentDate.year * 7 + currentDate.month * 5 + currentDate.day * 3 + block;
  const focusQueue = ALL_QUEUES[seed % 3];
  // 70% of the time they're actively in a match, 30% just online/idle
  const inGameSeed = (seed * 17 + 3) % 10;
  if (inGameSeed < 7) return { kind: "in_game", queue: focusQueue };
  return { kind: "online" };
}

function StatusDot({ status }: { status: FriendStatus }) {
  const color =
    status.kind === "in_party" ? "var(--accent)" :
    status.kind === "in_game" ? "#f5a623" :
    status.kind === "online" ? "var(--success)" :
    "var(--text-tertiary)";
  const label =
    status.kind === "in_party" ? "In Party" :
    status.kind === "in_game" ? `In Game (${QUEUE_LABELS[status.queue]})` :
    status.kind === "online" ? "Online" :
    "Offline";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color }}>
      <span style={{
        width: 7, height: 7, borderRadius: "50%", background: color,
        flexShrink: 0,
        boxShadow: status.kind !== "offline" ? `0 0 6px ${color}` : "none",
      }} />
      {label}
    </span>
  );
}

type Tab = "friends" | "showmatches";

export function SocialScreen() {
  const [tab, setTab] = useState<Tab>("friends");

  return (
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      <header style={{ marginBottom: "var(--space-4)" }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 650 }}>Social</h1>
        <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>Friends, rivalries, and 1v1 showmatches</div>
      </header>

      <div className="social-tabbar" role="tablist">
        {(["friends", "showmatches"] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={"social-tab" + (tab === t ? " social-tab-active" : "")}
            onClick={() => setTab(t)}
          >
            {t === "friends" ? "Friends" : "Showmatches"}
          </button>
        ))}
      </div>

      <div key={tab} className="fade-in">
        {tab === "friends" && <FriendsTab />}
        {tab === "showmatches" && <ShowmatchesTab />}
      </div>

      <style>{`
        .social-tabbar {
          display: flex;
          gap: 4px;
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 4px;
          margin-bottom: var(--space-4);
        }
        .social-tab {
          flex: 1;
          background: none;
          border: none;
          border-radius: calc(var(--radius-md) - 2px);
          color: var(--text-secondary);
          font-size: 13px;
          padding: 8px 0;
          cursor: pointer;
          transition: background 150ms ease, color 150ms ease;
        }
        .social-tab-active {
          background: var(--accent-muted);
          color: var(--accent);
          font-weight: 600;
        }
        .friend-card {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: var(--space-3);
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: var(--space-3) var(--space-4);
          margin-bottom: var(--space-2);
          transition: border-color 150ms ease;
        }
        .friend-card:hover {
          border-color: var(--border-strong);
        }
        .friend-name {
          font-weight: 700;
          font-size: 14px;
        }
        .friend-pro-badge {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          color: var(--accent);
          margin-left: 6px;
        }
        .friend-region {
          font-size: 12px;
          color: var(--text-tertiary);
        }
        .friend-record {
          font-size: 12px;
          color: var(--text-secondary);
          margin-top: 4px;
        }
        .friend-moment {
          font-size: 11px;
          color: var(--text-tertiary);
          margin-top: 2px;
        }
        .friend-remove-btn {
          background: none;
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-sm);
          color: var(--text-tertiary);
          font-size: 11px;
          padding: 4px 10px;
          cursor: pointer;
          white-space: nowrap;
        }
        .friend-remove-btn:hover {
          color: var(--danger);
          border-color: var(--danger);
        }
        .friend-view-btn {
          background: none;
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-sm);
          color: var(--text-secondary);
          font-size: 11px;
          padding: 4px 10px;
          cursor: pointer;
          white-space: nowrap;
          transition: border-color 150ms, color 150ms;
        }
        .friend-view-btn:hover {
          color: var(--accent);
          border-color: var(--accent);
        }
        .add-friend-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 12px;
          border-bottom: 1px solid var(--border-subtle);
          font-size: 13px;
        }
        .add-friend-row:last-child {
          border-bottom: none;
        }
        .add-friend-btn {
          background: var(--accent-muted);
          color: var(--accent);
          border: none;
          border-radius: var(--radius-sm);
          font-size: 11px;
          font-weight: 700;
          padding: 5px 12px;
          cursor: pointer;
          white-space: nowrap;
        }
        .add-friend-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .streamer-card {
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: var(--space-3) var(--space-4);
          margin-bottom: var(--space-2);
        }
        .streamer-name {
          font-weight: 700;
          font-size: 14px;
        }
        .streamer-desc {
          font-size: 12px;
          color: var(--text-secondary);
          margin-top: 4px;
        }
        .streamer-fame {
          font-size: 11px;
          color: var(--text-tertiary);
          margin-top: 6px;
        }
        .invite-banner {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: var(--space-3);
          background: var(--accent-muted);
          border: 1px solid var(--accent);
          border-radius: var(--radius-md);
          padding: var(--space-3) var(--space-4);
          margin-bottom: var(--space-4);
          flex-wrap: wrap;
        }
        .invite-title {
          font-weight: 700;
          font-size: 14px;
        }
        .invite-sub {
          font-size: 12px;
          color: var(--text-secondary);
        }
        .invite-actions {
          display: flex;
          gap: 8px;
        }
        .invite-accept-btn {
          background: var(--accent);
          color: #17181c;
          border: none;
          border-radius: var(--radius-sm);
          font-size: 12px;
          font-weight: 700;
          padding: 8px 16px;
          cursor: pointer;
        }
        .invite-decline-btn {
          background: none;
          border: 1px solid var(--border-strong);
          border-radius: var(--radius-sm);
          color: var(--text-secondary);
          font-size: 12px;
          padding: 8px 16px;
          cursor: pointer;
        }
        .history-row {
          display: flex;
          justify-content: space-between;
          font-size: 12px;
          padding: 6px 0;
          border-bottom: 1px solid var(--border-subtle);
        }
        .history-row:last-child {
          border-bottom: none;
        }
        .section-label {
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          color: var(--text-tertiary);
          margin: var(--space-5) 0 var(--space-3);
        }
        .section-label:first-child {
          margin-top: 0;
        }

        /* Stats Modal */
        .stats-modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.65);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          padding: 16px;
          backdrop-filter: blur(3px);
        }
        .stats-modal {
          background: var(--bg-card, #1c1e24);
          border: 1px solid var(--border-strong);
          border-radius: var(--radius-lg, 12px);
          width: 100%;
          max-width: 480px;
          max-height: 85vh;
          overflow-y: auto;
          box-shadow: 0 20px 60px rgba(0,0,0,0.5);
          animation: modal-in 180ms ease;
        }
        @keyframes modal-in {
          from { opacity: 0; transform: scale(0.96) translateY(8px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        .stats-modal-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          padding: var(--space-4) var(--space-4) var(--space-3);
          border-bottom: 1px solid var(--border-subtle);
        }
        .stats-modal-close {
          background: none;
          border: none;
          color: var(--text-tertiary);
          font-size: 18px;
          cursor: pointer;
          padding: 0 4px;
          line-height: 1;
          transition: color 120ms;
        }
        .stats-modal-close:hover { color: var(--text-primary); }
        .stats-modal-body { padding: var(--space-4); }
        .stats-queue-section {
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: var(--space-3) var(--space-3);
          margin-bottom: var(--space-2);
        }
        .stats-queue-title {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          color: var(--text-tertiary);
          margin-bottom: var(--space-2);
          font-weight: 600;
        }
        .stats-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 12px;
          padding: 3px 0;
        }
        .stats-row-label { color: var(--text-secondary); }
        .stats-row-value { font-weight: 600; color: var(--text-primary); }
        .stats-peak-badge {
          font-size: 10px;
          padding: 2px 7px;
          border-radius: 20px;
          font-weight: 700;
          margin-left: 6px;
        }
      `}</style>
    </div>
  );
}

function friendRecordLabel(f: FriendRecord): string {
  const parts: string[] = [];
  if (f.winsAgainst + f.lossesAgainst > 0) parts.push(`Vs: ${f.winsAgainst}W-${f.lossesAgainst}L`);
  if (f.winsWith + f.lossesWith > 0) parts.push(`Partied: ${f.winsWith}W-${f.lossesWith}L`);
  return parts.length > 0 ? parts.join(" · ") : "No games recorded yet";
}

// --- Friend Stats Modal ---
// Mirror the same stat-resolution priority the match engine uses (useMatchStore.ts buildOpponent):
//   1. Real pro  → useProLeaderboardStore
//   2. Regional grinder → useRegionalRosterStore
//   3. Filler leaderboard name → useLeaderboardFillerStore
//   4. Plain friend (nobody else tracks them) → FriendRecord persisted values
type TrackedKind = "pro" | "grinder" | "filler" | "plain";
interface ResolvedFriendStats {
  kind: TrackedKind;
  grinderRegion?: ProRegion;
  perQueue: Record<QueueMode, { mmr: number; gameSense: number; mechanicalConsistency: number; peakMmr: number }>;
}

function resolveFriendStats(
  friend: FriendRecord,
  era: ReturnType<typeof eraForDate>,
  currentYear: number,
  currentDate: import("@/data/dateUtils").SimDate,
  seasonStartDate: import("@/data/dateUtils").SimDate
): ResolvedFriendStats {
  const QUEUES: QueueMode[] = ["1v1", "2v2", "3v3"];

  // 1. Known pro player
  const pro = PRO_PLAYERS.find((p) => p.name === friend.name);
  if (pro) {
    const perQueue = {} as ResolvedFriendStats["perQueue"];
    for (const q of QUEUES) {
      const mmr = useProLeaderboardStore.getState().getMmr(friend.name, q, era, currentYear, currentDate, seasonStartDate);
      const { gameSense, mechanicalConsistency, peakMmr } = useProLeaderboardStore.getState().getStats(friend.name, q, era, currentYear, currentDate, seasonStartDate);
      perQueue[q] = { mmr, gameSense, mechanicalConsistency, peakMmr };
    }
    return { kind: "pro", perQueue };
  }

  // 2. Regional grinder
  const grinderRegion = ALL_MATCHMAKING_REGIONS.find((region) =>
    regionalGrinderRoster(region, currentYear).some((g) => g.name === friend.name)
  );
  if (grinderRegion) {
    const perQueue = {} as ResolvedFriendStats["perQueue"];
    for (const q of QUEUES) {
      const mmr = useRegionalRosterStore.getState().getMmr(friend.name, grinderRegion, q, era, currentYear, currentDate, seasonStartDate);
      const { gameSense, mechanicalConsistency, peakMmr } = useRegionalRosterStore.getState().getStats(friend.name, grinderRegion, q, era, currentYear, currentDate, seasonStartDate);
      perQueue[q] = { mmr, gameSense, mechanicalConsistency, peakMmr };
    }
    return { kind: "grinder", grinderRegion, perQueue };
  }

  // 3. Filler leaderboard name
  if (fillerLeaderboardNames().includes(friend.name)) {
    const perQueue = {} as ResolvedFriendStats["perQueue"];
    for (const q of QUEUES) {
      const mmr = useLeaderboardFillerStore.getState().getMmr(friend.name, q, era, currentYear, currentDate, seasonStartDate);
      const { gameSense, mechanicalConsistency } = useLeaderboardFillerStore.getState().getStats(friend.name, q, era, currentYear, currentDate, seasonStartDate);
      perQueue[q] = { mmr, gameSense, mechanicalConsistency, peakMmr: friend.peakMmr?.[q] ?? mmr };
    }
    return { kind: "filler", perQueue };
  }

  // 4. Plain friend — use FriendRecord persisted values directly
  const perQueue = {} as ResolvedFriendStats["perQueue"];
  for (const q of QUEUES) {
    perQueue[q] = {
      mmr: friend.mmr[q],
      gameSense: friend.gameSense[q],
      mechanicalConsistency: friend.mechanicalConsistency[q],
      peakMmr: friend.peakMmr?.[q] ?? friend.mmr[q],
    };
  }
  return { kind: "plain", perQueue };
}

function FriendStatsModal({
  friend,
  onClose,
  era,
  currentDate,
  seasonStartDate,
  currentYear,
}: {
  friend: FriendRecord;
  onClose: () => void;
  era: ReturnType<typeof eraForDate>;
  currentDate: import("@/data/dateUtils").SimDate;
  seasonStartDate: import("@/data/dateUtils").SimDate;
  currentYear: number;
}) {
  const QUEUES: QueueMode[] = ["1v1", "2v2", "3v3"];
  const QUEUE_NAMES: Record<QueueMode, string> = { "1v1": "Duel (1v1)", "2v2": "Doubles (2v2)", "3v3": "Standard (3v3)" };

  const resolved = resolveFriendStats(friend, era, currentYear, currentDate, seasonStartDate);

  function rankLabel(mmr: number, queue: QueueMode): string {
    const { tier, division } = deriveRankFromMmr(mmr, era, queue as import("@/data/rankSystem").RankQueue);
    return divisionLabel(tier, division, era);
  }
  function rankCol(mmr: number, queue: QueueMode): string {
    const { tier } = deriveRankFromMmr(mmr, era, queue as import("@/data/rankSystem").RankQueue);
    return tierColor(tier, era);
  }

  const kindBadge =
    resolved.kind === "pro" ? null :
    resolved.kind === "grinder" ? { label: `Ranked Grinder · ${resolved.grinderRegion}`, color: "#f5a623" } :
    resolved.kind === "filler" ? { label: "Leaderboard Regular", color: "var(--text-tertiary)" } :
    null;

  return (
    <div className="stats-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="stats-modal" role="dialog" aria-label={`${friend.name}'s stats`}>
        <div className="stats-modal-header">
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>
              {friend.name}
              {friend.isPro && <span className="friend-pro-badge" style={{ marginLeft: 8 }}>PRO</span>}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 2 }}>
              {friend.region}
              {kindBadge && (
                <span style={{ marginLeft: 8, color: kindBadge.color, fontWeight: 600 }}>
                  · {kindBadge.label}
                </span>
              )}
            </div>
          </div>
          <button className="stats-modal-close" onClick={onClose} aria-label="Close stats">✕</button>
        </div>

        <div className="stats-modal-body">
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: "var(--space-3)" }}>
            {friendRecordLabel(friend)}
          </div>

          {QUEUES.map((q) => {
            const qs = resolved.perQueue[q];
            const currentRank = rankLabel(qs.mmr, q);
            const currentCol = rankCol(qs.mmr, q);
            const peakRank = rankLabel(qs.peakMmr, q);
            const peakCol = rankCol(qs.peakMmr, q);
            const hasPeak = qs.peakMmr > qs.mmr;
            const currentDerived = deriveRankFromMmr(qs.mmr, era, q as import("@/data/rankSystem").RankQueue);
            const peakDerived = deriveRankFromMmr(qs.peakMmr, era, q as import("@/data/rankSystem").RankQueue);

            return (
              <div key={q} className="stats-queue-section">
                <div className="stats-queue-title">{QUEUE_NAMES[q]}</div>
                
                <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
                  <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "10px", background: "var(--bg-surface-raised)", padding: "8px", borderRadius: "8px" }}>
                    <RankBadge tier={currentDerived.tier} division={currentDerived.division} era={era} size={36} />
                    <div>
                      <div style={{ fontSize: 9, color: "var(--text-tertiary)", textTransform: "uppercase", fontWeight: 700, letterSpacing: 0.5 }}>Current</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: currentCol }}>{currentRank}</div>
                      <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{Math.round(qs.mmr)} MMR</div>
                    </div>
                  </div>
                  
                  <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "10px", background: "var(--bg-surface-raised)", padding: "8px", borderRadius: "8px", opacity: hasPeak ? 1 : 0.6 }}>
                    <RankBadge tier={peakDerived.tier} division={peakDerived.division} era={era} size={36} />
                    <div>
                      <div style={{ fontSize: 9, color: "var(--text-tertiary)", textTransform: "uppercase", fontWeight: 700, letterSpacing: 0.5 }}>Peak</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: peakCol }}>{peakRank}</div>
                      <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{Math.round(qs.peakMmr)} MMR</div>
                    </div>
                  </div>
                </div>

                <div className="stats-row">
                  <span className="stats-row-label">Game Sense</span>
                  <span className="stats-row-value">{Math.round(qs.gameSense)}</span>
                </div>
                <div className="stats-row">
                  <span className="stats-row-label">Mech. Consistency</span>
                  <span className="stats-row-value">{Math.round(qs.mechanicalConsistency)}</span>
                </div>
              </div>
            );
          })}

          {friend.moments.length > 0 && (
            <div style={{ marginTop: "var(--space-3)" }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.8px", color: "var(--text-tertiary)", marginBottom: 8 }}>
                Notable Moments
              </div>
              {friend.moments.map((m, i) => (
                <div key={i} style={{ fontSize: 12, color: "var(--text-secondary)", padding: "4px 0", borderBottom: i < friend.moments.length - 1 ? "1px solid var(--border-subtle)" : "none" }}>
                  "{m}"
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


function FriendsTab() {
  const s = useSaveStore();
  const addFriend = useSaveStore((st) => st.addFriend);
  const removeFriend = useSaveStore((st) => st.removeFriend);
  const invitePartyMember = useSaveStore((st) => st.invitePartyMember);
  const removePartyMember = useSaveStore((st) => st.removePartyMember);
  const ensurePartyInvitations = useSaveStore((st) => st.ensurePartyInvitations);
  const acceptPartyInvite = useSaveStore((st) => st.acceptPartyInvite);
  const declinePartyInvite = useSaveStore((st) => st.declinePartyInvite);
  const [declineMessage, setDeclineMessage] = useState<string | null>(null);
  const [viewingStats, setViewingStats] = useState<FriendRecord | null>(null);

  useEffect(() => {
    ensurePartyInvitations(s.currentDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.currentDate.year, s.currentDate.month, s.currentDate.day]);

  const partyInvite = s.pendingPartyInvite;
  const partyInviteDaysLeft = partyInvite ? Math.max(0, daysBetween(s.currentDate, partyInvite.expiresDate)) : 0;

  const friendList = Object.values(s.friends).sort((a, b) => a.name.localeCompare(b.name));
  const recentCandidates = s.recentlyPlayedWith.filter((n) => !s.friends[n]).slice(0, 15);
  const partyFull = s.partyMembers.length >= 2;

  const era = eraForDate(s.currentDate);
  const playerOverallRating = computeOverallRating(s.player.gameSense["2v2"], s.player.mechanicalConsistency["2v2"], s.foundationStats);

  // Simulate an in-game hour-of-day from the sim date (0-23) for the activity model
  // Uses a simple derivation from game date so it's consistent per session
  const simulatedHour = ((s.currentDate.day * 7 + s.currentDate.month * 3) % 24);

  /** A named pro or leaderboard regular's approximate Overall Rating (2v2, the "main" queue, since friends
   *  aren't tied to any one playlist), or null for an untracked/plain name — those were already matched
   *  near the player's own rank to begin with, so there's no real gap to check. */
  function lookupOverallRating(name: string, isPro: boolean): number | null {
    if (isPro) {
      const { gameSense, mechanicalConsistency } = useProLeaderboardStore.getState().getStats(name, "2v2", era, s.currentDate.year, s.currentDate, s.seasonStartDate);
      return approximateOverallRating(gameSense, mechanicalConsistency);
    }
    const grinderRegion = ALL_MATCHMAKING_REGIONS.find((region) => regionalGrinderRoster(region, s.currentDate.year).some((g) => g.name === name));
    if (grinderRegion) {
      const { gameSense, mechanicalConsistency } = useRegionalRosterStore.getState().getStats(name, grinderRegion, "2v2", era, s.currentDate.year, s.currentDate, s.seasonStartDate);
      return approximateOverallRating(gameSense, mechanicalConsistency);
    }
    if (fillerLeaderboardNames().includes(name)) {
      const { gameSense, mechanicalConsistency } = useLeaderboardFillerStore.getState().getStats(name, "2v2", era, s.currentDate.year, s.currentDate, s.seasonStartDate);
      return approximateOverallRating(gameSense, mechanicalConsistency);
    }
    return null;
  }

  function tryAddFriend(name: string, region: string, isPro: boolean) {
    const otherRating = lookupOverallRating(name, isPro);
    if (otherRating !== null && Math.random() > acceptChanceForOverallGap(playerOverallRating, otherRating)) {
      setDeclineMessage(`${name} didn't accept your friend request.`);
      return;
    }
    setDeclineMessage(null);
    addFriend(name, region, isPro, s.currentDate);
  }

  function tryInviteParty(f: FriendRecord) {
    const otherRating = lookupOverallRating(f.name, f.isPro);
    if (otherRating !== null && Math.random() > acceptChanceForOverallGap(playerOverallRating, otherRating)) {
      setDeclineMessage(`${f.name} declined the party invite.`);
      return;
    }
    setDeclineMessage(null);
    invitePartyMember(f.name);
  }

  // Separate friends into online/offline groups
  const onlineFirst = [...friendList].sort((a, b) => {
    const aStatus = friendStatus(a, s.currentDate, simulatedHour, s.partyMembers.includes(a.name));
    const bStatus = friendStatus(b, s.currentDate, simulatedHour, s.partyMembers.includes(b.name));
    const order = { in_party: 0, in_game: 1, online: 2, offline: 3 };
    return order[aStatus.kind] - order[bStatus.kind];
  });

  return (
    <>
      {viewingStats && (
        <FriendStatsModal 
          friend={viewingStats} 
          onClose={() => setViewingStats(null)} 
          era={era}
          currentDate={s.currentDate}
          seasonStartDate={s.seasonStartDate}
          currentYear={s.currentDate.year}
        />
      )}

      {declineMessage && (
        <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginBottom: "var(--space-3)" }}>{declineMessage}</div>
      )}

      {partyInvite && (
        <div className="invite-banner">
          <div>
            <div className="invite-title">{partyInvite.name} wants to party up for {QUEUE_LABELS[partyInvite.queue]}</div>
            <div className="invite-sub">expires in {partyInviteDaysLeft}d</div>
          </div>
          <div className="invite-actions">
            <button className="invite-accept-btn" onClick={acceptPartyInvite}>
              Accept
            </button>
            <button className="invite-decline-btn" onClick={declinePartyInvite}>
              Decline
            </button>
          </div>
        </div>
      )}

      <div className="section-label">Your Friends ({friendList.length})</div>
      {friendList.length === 0 && (
        <div style={{ fontSize: 13, color: "var(--text-tertiary)", marginBottom: "var(--space-4)" }}>
          No friends added yet, add someone from "Recently Played With" below.
        </div>
      )}
      {onlineFirst.map((f) => {
        const inParty = s.partyMembers.includes(f.name);
        const status = friendStatus(f, s.currentDate, simulatedHour, inParty);
        return (
          <div key={f.name} className="friend-card">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span className="friend-name">{f.name}</span>
                {f.isPro && <span className="friend-pro-badge">PRO</span>}
                <StatusDot status={status} />
              </div>
              <div className="friend-region">{f.region}</div>
              <div className="friend-record">{friendRecordLabel(f)}</div>
              {f.moments[0] && <div className="friend-moment">"{f.moments[0]}"</div>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", flexShrink: 0 }}>
              <button
                className="friend-view-btn"
                onClick={() => setViewingStats(f)}
              >
                View Stats
              </button>
              {inParty ? (
                <button className="add-friend-btn" onClick={() => removePartyMember(f.name)}>
                  In Party
                </button>
              ) : (
                <button className="add-friend-btn" disabled={partyFull} onClick={() => tryInviteParty(f)}>
                  Invite to Party
                </button>
              )}
              <button className="friend-remove-btn" onClick={() => removeFriend(f.name)}>
                Remove
              </button>
            </div>
          </div>
        );
      })}

      <div className="section-label">Recently Played With</div>
      <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", padding: "0 var(--space-3)" }}>
        {recentCandidates.length === 0 && (
          <div style={{ padding: "12px 0", fontSize: 13, color: "var(--text-tertiary)" }}>
            Nobody new yet, play some matches and people you face (or party up with) will show up here.
          </div>
        )}
        {recentCandidates.map((name) => {
          const info = lookupPlayerInfo(name, s.currentDate.year);
          return (
            <div key={name} className="add-friend-row">
              <span>
                {name}
                {info.isPro && <span className="friend-pro-badge">PRO</span>}
                <span className="friend-region" style={{ marginLeft: 8 }}>{info.region}</span>
              </span>
              <button className="add-friend-btn" onClick={() => tryAddFriend(name, info.region, info.isPro)}>
                Add
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}

function ShowmatchesTab() {
  const s = useSaveStore();
  const ensureShowmatchInvitations = useSaveStore((st) => st.ensureShowmatchInvitations);
  const declineShowmatchInvite = useSaveStore((st) => st.declineShowmatchInvite);
  const recordShowmatchResult = useSaveStore((st) => st.recordShowmatchResult);
  const startTournamentSeries = useMatchStore((m) => m.startTournamentSeries);
  const matchPhase = useMatchStore((m) => m.phase);
  const era = eraForDate(s.currentDate);

  useEffect(() => {
    ensureShowmatchInvitations(s.currentDate, era, s.currentDate.year);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.currentDate.year, s.currentDate.month, s.currentDate.day]);

  const invite = s.pendingShowmatchInvite;
  const streamer = invite ? STREAMERS.find((st) => st.id === invite.streamerId) : null;
  const daysLeft = invite ? Math.max(0, daysBetween(s.currentDate, invite.expiresDate)) : 0;

  function handleAccept() {
    if (!invite) return;
    const self: SelfStats = {
      name: s.displayName,
      gameSense: s.player.gameSense["1v1"],
      mechanicalConsistency: s.player.mechanicalConsistency["1v1"],
      foundationStats: s.foundationStats,
      title: s.titles.find((t) => t.id === s.equippedTitleId) ?? null,
      duelMastery: {
        mechanicMastery: flattenProgress(s.mechanicProgress),
        queueConceptMastery: flattenProgress(s.queueConceptProgress),
        playstyle: s.playstyleProfiles["1v1"],
      },
      orgTag: s.orgContract ? orgTagForOrgName(s.orgContract.orgName) : undefined,
      region: saveRegionToProRegion(s.region),
    };
    startTournamentSeries(self, [invite.opponentName], 1, era, s.seasonNumber, s.currentDate.year, s.currentDate, s.seasonStartDate, (wonSeries) => {
      recordShowmatchResult(wonSeries);
    });
  }

  return (
    <>
      {invite && streamer && matchPhase === "idle" && (
        <div className="invite-banner">
          <div>
            <div className="invite-title">{streamer.name} invited you to a 1v1 showmatch</div>
            <div className="invite-sub">
              vs {invite.opponentName} · expires in {daysLeft}d
            </div>
          </div>
          <div className="invite-actions">
            <button className="invite-accept-btn" onClick={handleAccept}>
              Play
            </button>
            <button className="invite-decline-btn" onClick={declineShowmatchInvite}>
              Decline
            </button>
          </div>
        </div>
      )}

      <div className="section-label">Streamers</div>
      {STREAMERS.map((st) => (
        <div key={st.id} className="streamer-card">
          <div className="streamer-name">{st.name}</div>
          <div className="streamer-desc">{st.description}</div>
          <div className="streamer-fame">
            Fame: +{st.fameReward.win} on a win, +{st.fameReward.loss} on a loss
          </div>
        </div>
      ))}

      <div className="section-label">Showmatch History</div>
      {s.showmatchHistory.length === 0 && (
        <div style={{ fontSize: 13, color: "var(--text-tertiary)" }}>No showmatches played yet.</div>
      )}
      {s.showmatchHistory.map((h, i) => {
        const st = STREAMERS.find((x) => x.id === h.streamerId);
        return (
          <div key={i} className="history-row">
            <span>
              {st?.name ?? h.streamerId} vs {h.opponentName}
            </span>
            <span style={{ color: h.win ? "var(--success)" : "var(--danger)" }}>
              {h.win ? "Won" : "Lost"} (+{h.fameGained} fame)
            </span>
          </div>
        );
      })}
    </>
  );
}
