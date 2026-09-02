import { useState, useEffect } from "react";
import { useSaveStore } from "@/store/useSaveStore";
import { useMatchStore, type SelfStats } from "@/store/useMatchStore";
import { PRO_PLAYERS } from "@/data/proPlayers";
import { useLeaderboardFillerStore, fillerLeaderboardNames } from "@/store/useLeaderboardFillerStore";
import { useProLeaderboardStore } from "@/store/useProLeaderboardStore";
import { STREAMERS } from "@/data/showmatches";
import { computeOverallRating } from "@/data/matchSim";
import { flattenProgress } from "@/data/matchSim";
import { eraForDate } from "@/data/rankSystem";
import { daysBetween } from "@/data/dateUtils";
import { FOUNDATION_LABELS, type FoundationCategory } from "@/data/mechanics";
import type { FriendRecord } from "@/data/mockSave";
import { orgTagForOrgName } from "@/data/tournaments";

// A real pro or leaderboard regular sitting far above (or below) the player's own actual skill has no real
// reason to accept a friend request or a party invite from a total stranger, let alone keep queuing with
// them — nobody wants to be farmed for wins, and a pro isn't going to bother partying with someone way
// below their own level. Compared by OVERALL RATING, not raw MMR: MMR is a bounded-ish ladder number where
// even 200 apart is already a real gap, but overall rating is uncapped and spans a vastly different scale
// at every rank (a few hundred at Bronze, tens of thousands for a pro), so this uses a RATIO instead of a
// fixed point gap — "3x better than me" means the same real mismatch whether that's 300 vs 100 or 60,000 vs
// 20,000. Within a close ratio it's basically always a yes, only a real multiple-of-skill gap starts
// mattering, and by 4x+ apart it's a rare, generous exception rather than the norm. Untracked/plain names
// (nobody the leaderboard actually follows) always accept, they were already matched near the player's own
// rank to begin with, there's no real gap to check.
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

const FILLER_REGIONS = ["NA", "EU", "OCE", "SAM", "MENA", "APAC"];

/** Best-effort region + pro flag for a name encountered in a match: a real pro's own region, a filler
 *  leaderboard regular's assigned region (same deterministic formula the board itself uses), or unknown
 *  for a plain low-rank opponent name (never tracked anywhere, just flavor for that tier). */
function lookupPlayerInfo(name: string): { region: string; isPro: boolean } {
  const pro = PRO_PLAYERS.find((p) => p.name === name);
  if (pro) return { region: pro.region, isPro: true };
  const fillerIndex = fillerLeaderboardNames().indexOf(name);
  if (fillerIndex >= 0) return { region: FILLER_REGIONS[fillerIndex % FILLER_REGIONS.length], isPro: false };
  return { region: "Unknown", isPro: false };
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

function FriendsTab() {
  const s = useSaveStore();
  const addFriend = useSaveStore((st) => st.addFriend);
  const removeFriend = useSaveStore((st) => st.removeFriend);
  const invitePartyMember = useSaveStore((st) => st.invitePartyMember);
  const removePartyMember = useSaveStore((st) => st.removePartyMember);
  const [declineMessage, setDeclineMessage] = useState<string | null>(null);

  const friendList = Object.values(s.friends).sort((a, b) => a.name.localeCompare(b.name));
  const recentCandidates = s.recentlyPlayedWith.filter((n) => !s.friends[n]).slice(0, 15);
  const partyFull = s.partyMembers.length >= 2;

  const era = eraForDate(s.currentDate);
  const playerOverallRating = computeOverallRating(s.player.gameSense["2v2"], s.player.mechanicalConsistency["2v2"], s.foundationStats);

  /** A named pro or leaderboard regular's approximate Overall Rating (2v2, the "main" queue, since friends
   *  aren't tied to any one playlist), or null for an untracked/plain name — those were already matched
   *  near the player's own rank to begin with, so there's no real gap to check. */
  function lookupOverallRating(name: string, isPro: boolean): number | null {
    if (isPro) {
      const { gameSense, mechanicalConsistency } = useProLeaderboardStore.getState().getStats(name, "2v2", era, s.currentDate.year, s.currentDate, s.seasonStartDate);
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

  return (
    <>
      {declineMessage && (
        <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginBottom: "var(--space-3)" }}>{declineMessage}</div>
      )}

      <div className="section-label">Your Friends ({friendList.length})</div>
      {friendList.length === 0 && (
        <div style={{ fontSize: 13, color: "var(--text-tertiary)", marginBottom: "var(--space-4)" }}>
          No friends added yet, add someone from "Recently Played With" below.
        </div>
      )}
      {friendList.map((f) => {
        const inParty = s.partyMembers.includes(f.name);
        return (
          <div key={f.name} className="friend-card">
            <div>
              <span className="friend-name">
                {f.name}
                {f.isPro && <span className="friend-pro-badge">PRO</span>}
              </span>
              <div className="friend-region">{f.region}</div>
              <div className="friend-record">{friendRecordLabel(f)}</div>
              {f.moments[0] && <div className="friend-moment">"{f.moments[0]}"</div>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
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
          const info = lookupPlayerInfo(name);
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
    };
    startTournamentSeries(self, [invite.opponentName], 1, era, s.seasonNumber, s.currentDate.year, (wonSeries) => {
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
