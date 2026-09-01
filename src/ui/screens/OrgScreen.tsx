import { useEffect } from "react";
import { Card } from "@/ui/components/Card";
import { SectionShell } from "@/ui/components/LockedSection";
import { useSaveStore } from "@/store/useSaveStore";
import { useMatchStore, type SelfStats } from "@/store/useMatchStore";
import { useProLeaderboardStore } from "@/store/useProLeaderboardStore";
import { activeProPlayers } from "@/data/proPlayers";
import { saveRegionToProRegion, rlcsSeasonForDate, ORG_NAMES } from "@/data/tournaments";
import {
  ORG_TIER_LABELS,
  orgEligibilityDetail,
  resolveContractRenewal,
  promotedTier,
  rollsTeammateChurn,
} from "@/data/orgs";
import { eraForDate, type RankEra } from "@/data/rankSystem";
import { flattenProgress } from "@/data/matchSim";
import { daysBetween, type SimDate } from "@/data/dateUtils";
import { LB_NAMES } from "@/data/mockSave";

// Teammates are picked in roughly the player's own 2v2 skill range (needs live pro-leaderboard MMR, which
// lives outside useSaveStore, same reason TourneysScreen/SocialScreen do this kind of lookup in the UI
// layer rather than inside the save store itself). Used both for a fresh tryout roster and for picking a
// single replacement on contract-renewal teammate churn.
const TEAMMATE_MMR_BAND = 400;

function pickOrgPros(
  count: number,
  playerMmr: number,
  era: RankEra,
  currentYear: number,
  currentDate: SimDate,
  seasonStartDate: SimDate,
  proRegion: string,
  exclude: string[]
): string[] {
  const pool = activeProPlayers(currentYear).filter((p) => !exclude.includes(p.name));
  const withMmr = pool.map((p) => ({
    name: p.name,
    region: p.region,
    mmr: useProLeaderboardStore.getState().getMmr(p.name, "2v2", era, currentYear, currentDate, seasonStartDate),
  }));
  const band = withMmr.filter((p) => Math.abs(p.mmr - playerMmr) <= TEAMMATE_MMR_BAND);
  const sameRegion = band.filter((p) => p.region === proRegion);
  const pickFrom = sameRegion.length >= count ? sameRegion : band;
  if (pickFrom.length < count) return [];
  const shuffled = [...pickFrom].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count).map((p) => p.name);
}

function pickTryoutTeammates(playerMmr: number, era: RankEra, currentYear: number, currentDate: SimDate, seasonStartDate: SimDate, proRegion: string): [string, string] | null {
  const picked = pickOrgPros(2, playerMmr, era, currentYear, currentDate, seasonStartDate, proRegion, []);
  return picked.length === 2 ? [picked[0], picked[1]] : null;
}

function randomScrimOpponents(used: Set<string>): string[] {
  const names: string[] = [];
  while (names.length < 3) {
    const name = LB_NAMES[Math.floor(Math.random() * LB_NAMES.length)];
    if (used.has(name) || names.includes(name)) continue;
    names.push(name);
  }
  return names;
}

export function OrgScreen() {
  const s = useSaveStore();
  const ensureOrgScouting = useSaveStore((st) => st.ensureOrgScouting);
  const declineOrgInvite = useSaveStore((st) => st.declineOrgInvite);
  const acceptOrgInvite = useSaveStore((st) => st.acceptOrgInvite);
  const recordOrgTryoutScrim = useSaveStore((st) => st.recordOrgTryoutScrim);
  const recordOrgScrimResult = useSaveStore((st) => st.recordOrgScrimResult);
  const releaseOrgContract = useSaveStore((st) => st.releaseOrgContract);
  const renewOrgContract = useSaveStore((st) => st.renewOrgContract);
  const startTournamentSeries = useMatchStore((m) => m.startTournamentSeries);
  const matchPhase = useMatchStore((m) => m.phase);

  const era = eraForDate(s.currentDate);
  const currentYear = s.currentDate.year;
  const playerMmr = s.rankedProfiles["2v2"].mmr;
  const proRegion = saveRegionToProRegion(s.region);
  const { seasonNumber: rlcsSeasonNumber } = rlcsSeasonForDate(s.currentDate);

  useEffect(() => {
    ensureOrgScouting(s.currentDate, era, currentYear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.currentDate.year, s.currentDate.month, s.currentDate.day]);

  // Contract renewal/release, checked once the RLCS season the contract was due to run through has
  // actually passed. Re-fires harmlessly every date tick until it acts (renewOrgContract/releaseOrgContract
  // both move `signedSeason`/clear the contract, which makes the guard below false again immediately).
  useEffect(() => {
    const contract = s.orgContract;
    if (!contract) return;
    if (rlcsSeasonNumber < contract.signedSeason + contract.lengthSeasons) return;

    const outcome = resolveContractRenewal(contract.scrimWins, contract.scrimLosses, contract.tier);
    if (outcome === "release") {
      releaseOrgContract(s.currentDate);
      return;
    }

    let newTeammates = contract.teammates;
    if (rollsTeammateChurn()) {
      const replacement = pickOrgPros(1, playerMmr, era, currentYear, s.currentDate, s.seasonStartDate, proRegion, contract.teammates);
      if (replacement.length === 1) {
        const idx = Math.random() < 0.5 ? 0 : 1;
        newTeammates = idx === 0 ? [replacement[0], contract.teammates[1]] : [contract.teammates[0], replacement[0]];
      }
    }

    const newTier = outcome === "promote" ? promotedTier(contract.tier) : contract.tier;
    let newOrgName = contract.orgName;
    if (outcome === "promote") {
      const candidates = (ORG_NAMES[proRegion as keyof typeof ORG_NAMES] ?? Object.values(ORG_NAMES).flat()).filter((n) => n !== contract.orgName);
      if (candidates.length > 0) newOrgName = candidates[Math.floor(Math.random() * candidates.length)];
    }
    renewOrgContract(s.currentDate, newOrgName, newTier, newTeammates);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rlcsSeasonNumber, s.orgContract?.signedSeason, s.orgContract?.lengthSeasons]);

  function handleAcceptInvite() {
    const teammates = pickTryoutTeammates(playerMmr, era, currentYear, s.currentDate, s.seasonStartDate, proRegion);
    if (!teammates) return; // no plausible teammates yet (very early era, too few pros debuted), try again later
    acceptOrgInvite(teammates, s.currentDate);
  }

  function handlePlayOrgScrim() {
    const contract = s.orgContract;
    if (!contract) return;
    const self: SelfStats = {
      name: s.displayName,
      gameSense: s.player.gameSense["3v3"],
      mechanicalConsistency: s.player.mechanicalConsistency["3v3"],
      foundationStats: s.foundationStats,
      title: s.titles.find((t) => t.id === s.equippedTitleId) ?? null,
      duelMastery: {
        mechanicMastery: flattenProgress(s.mechanicProgress),
        queueConceptMastery: flattenProgress(s.queueConceptProgress),
        playstyle: s.playstyleProfiles["3v3"],
      },
    };
    const used = new Set([s.displayName, ...contract.teammates]);
    const opponents = randomScrimOpponents(used);
    const seriesFormat = Math.random() < 0.5 ? 5 : 7;
    startTournamentSeries(self, opponents, seriesFormat, era, s.seasonNumber, currentYear, (wonSeries) => {
      recordOrgScrimResult(wonSeries, s.currentDate);
    }, 0.6, contract.teammates);
  }

  function handlePlayScrim() {
    const tryout = s.pendingOrgTryout;
    if (!tryout) return;
    const self: SelfStats = {
      name: s.displayName,
      gameSense: s.player.gameSense["3v3"],
      mechanicalConsistency: s.player.mechanicalConsistency["3v3"],
      foundationStats: s.foundationStats,
      title: s.titles.find((t) => t.id === s.equippedTitleId) ?? null,
      duelMastery: {
        mechanicMastery: flattenProgress(s.mechanicProgress),
        queueConceptMastery: flattenProgress(s.queueConceptProgress),
        playstyle: s.playstyleProfiles["3v3"],
      },
    };
    const used = new Set([s.displayName, ...tryout.teammates]);
    const opponents = randomScrimOpponents(used);
    const seriesFormat = Math.random() < 0.5 ? 5 : 7;
    startTournamentSeries(self, opponents, seriesFormat, era, s.seasonNumber, currentYear, (wonSeries) => {
      recordOrgTryoutScrim(wonSeries, s.currentDate, rlcsSeasonNumber);
    }, 0.6, tryout.teammates);
  }

  const inPlacements = s.rankedProfiles["2v2"].placementMatchesRemaining > 0;
  const eligibilityDetail = orgEligibilityDetail(era, currentYear, playerMmr, s.player.gameSense["2v2"]);
  const eligible = !inPlacements && eligibilityDetail.meetsRankFloor && eligibilityDetail.meetsStatFloor;

  return (
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      <header style={{ marginBottom: "var(--space-4)" }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 650 }}>Org</h1>
        <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          The competitive 3v3 pro track, separate from ranked
        </div>
      </header>

      {s.pendingOrgInvite && matchPhase === "idle" && (
        <div className="org-invite-banner">
          <div>
            <div className="org-invite-title">{s.pendingOrgInvite.orgName} wants to try you out</div>
            <div className="org-invite-sub">
              {ORG_TIER_LABELS[s.pendingOrgInvite.tier]} · expires in {Math.max(0, daysBetween(s.currentDate, s.pendingOrgInvite.expiresDate))}d
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="org-btn org-btn-primary" onClick={handleAcceptInvite}>
              Accept
            </button>
            <button className="org-btn" onClick={declineOrgInvite}>
              Decline
            </button>
          </div>
        </div>
      )}

      {s.pendingOrgTryout && (
        <SectionShell title="Tryout in Progress">
          <Card>
            <div style={{ fontSize: 13, marginBottom: 8 }}>
              <strong>{s.pendingOrgTryout.orgName}</strong> · {ORG_TIER_LABELS[s.pendingOrgTryout.tier]}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>
              Teammates: {s.pendingOrgTryout.teammates.join(", ")}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 12 }}>
              Scrims: {s.pendingOrgTryout.scrimsPlayed}/{s.pendingOrgTryout.scrimsPlanned} played · {s.pendingOrgTryout.scrimWins}W-{s.pendingOrgTryout.scrimLosses}L
            </div>
            {matchPhase === "idle" && (
              <button className="org-btn org-btn-primary" onClick={handlePlayScrim}>
                Play Next Scrim
              </button>
            )}
          </Card>
        </SectionShell>
      )}

      {s.orgContract ? (
        <SectionShell title="Contract">
          <Card>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{s.orgContract.orgName}</div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
              {ORG_TIER_LABELS[s.orgContract.tier]} · {s.orgContract.role === "starter" ? "Full Starter" : "Sub"} · Signed Season {s.orgContract.signedSeason} · {s.orgContract.lengthSeasons} season{s.orgContract.lengthSeasons > 1 ? "s" : ""}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 8 }}>
              Teammates: {s.orgContract.teammates.join(", ")}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
              Scrim record this contract: {s.orgContract.scrimWins}W-{s.orgContract.scrimLosses}L
            </div>
            {matchPhase === "idle" && daysBetween(s.orgContract.nextScrimDate, s.currentDate) >= 0 && (
              <button className="org-btn org-btn-primary" style={{ marginTop: 12 }} onClick={handlePlayOrgScrim}>
                Play Scrim
              </button>
            )}
          </Card>
        </SectionShell>
      ) : (
        !s.pendingOrgInvite &&
        !s.pendingOrgTryout && (
          <SectionShell title="Status">
            <Card>
              <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                {inPlacements
                  ? "Finish your 2v2 placements first, orgs don't scout during placements."
                  : eligible
                    ? "You're playing at a level orgs scout — keep grinding 2v2, a tryout invite could come any day (checked every few days, not guaranteed)."
                    : "Not scouted yet — one or both of the gates below aren't cleared."}
              </div>
              {!inPlacements && (
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-tertiary)" }}>2v2 MMR</span>
                    <span style={{ color: eligibilityDetail.meetsRankFloor ? "var(--text-primary)" : "var(--danger)" }}>
                      {eligibilityDetail.mmr} / {eligibilityDetail.rankFloorMmr} needed
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-tertiary)" }}>2v2 Game Sense</span>
                    <span style={{ color: eligibilityDetail.meetsStatFloor ? "var(--text-primary)" : "var(--danger)" }}>
                      {eligibilityDetail.gameSense} / {eligibilityDetail.requiredGameSense} needed
                    </span>
                  </div>
                </div>
              )}
            </Card>
          </SectionShell>
        )
      )}

      <SectionShell title="Org News">
        <Card>
          {s.orgNews.length === 0 && (
            <div style={{ fontSize: 13, color: "var(--text-tertiary)" }}>No org news yet.</div>
          )}
          {s.orgNews.map((entry) => (
            <div key={entry.id} className="org-news-row">
              <span>{entry.text}</span>
            </div>
          ))}
        </Card>
      </SectionShell>

      <style>{`
        .org-invite-banner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-3);
          background: color-mix(in srgb, var(--accent) 14%, var(--bg-surface));
          border: 1px solid var(--accent);
          border-radius: var(--radius-md);
          padding: 12px 16px;
          margin-bottom: var(--space-4);
          flex-wrap: wrap;
        }
        .org-invite-title {
          font-size: 14px;
          font-weight: 700;
          color: var(--text-primary);
        }
        .org-invite-sub {
          font-size: 12px;
          color: var(--text-secondary);
          margin-top: 2px;
        }
        .org-btn {
          background: none;
          border: 1px solid var(--border-strong);
          color: var(--text-secondary);
          border-radius: var(--radius-sm);
          font-size: 12px;
          font-weight: 600;
          padding: 8px 16px;
          cursor: pointer;
          white-space: nowrap;
        }
        .org-btn-primary {
          background: var(--accent);
          color: #17181c;
          border: none;
        }
        .org-news-row {
          font-size: 12px;
          color: var(--text-secondary);
          padding: 6px 0;
          border-bottom: 1px solid var(--border-subtle);
        }
        .org-news-row:last-child {
          border-bottom: none;
        }
      `}</style>
    </div>
  );
}
