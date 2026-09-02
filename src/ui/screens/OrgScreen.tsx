import { useEffect, useState } from "react";
import { Card } from "@/ui/components/Card";
import { StatBar } from "@/ui/components/StatBar";
import { SectionShell } from "@/ui/components/LockedSection";
import { useSaveStore } from "@/store/useSaveStore";
import { useMatchStore, type SelfStats } from "@/store/useMatchStore";
import { useProLeaderboardStore } from "@/store/useProLeaderboardStore";
import { activeProPlayers, type ProRegion } from "@/data/proPlayers";
import {
  saveRegionToProRegion,
  rlcsSeasonForDate,
  ORG_NAMES,
  orgTagForOrgName,
  generateTeamsForRegion,
  generateGlobalTeams,
  applyPlayerOrgOverride,
  REGION_LABELS,
  rlcsSeasonPhase,
} from "@/data/tournaments";
import {
  ORG_TIER_LABELS,
  meetsOrgRankRequirement,
  orgRankFloorMmr,
  orgTalentDetail,
  resolveContractRenewal,
  promotedTier,
  rollsTeammateChurn,
  coachingIntervalDaysForTier,
  bootcampIntervalDaysForTier,
} from "@/data/orgs";
import { eraForDate, type RankEra } from "@/data/rankSystem";
import { flattenProgress } from "@/data/matchSim";
import { daysBetween, type SimDate } from "@/data/dateUtils";
import { LB_NAMES, type QueueMode } from "@/data/mockSave";
import { QUEUE_LABELS } from "@/data/queues";

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

/** Org scrims/tryouts scrimmage a real rival org's actual current-season roster (see
 *  data/tournaments.ts's generateTeamsForRegion) instead of generic filler names — a scrim opponent is
 *  always a real, named, org-signed lineup, same as the player's own. Falls back to generic filler names
 *  only in the genuinely-empty-region edge case (too early in a fresh save for 2+ real teams to exist
 *  yet), same "not enough real players yet" guard used elsewhere in this screen. */
function pickScrimOpponents(
  proRegion: ProRegion,
  currentYear: number,
  seasonNumber: number,
  resetSeed: number,
  era: RankEra,
  currentDate: SimDate,
  seasonStartDate: SimDate,
  excludeOrgName: string
): { orgName: string | null; players: string[] } {
  const teams = generateTeamsForRegion(proRegion, currentYear, seasonNumber, resetSeed, "orgscrim_opp", era, currentDate, seasonStartDate).filter(
    (t) => t.name !== excludeOrgName
  );
  if (teams.length > 0) {
    const team = teams[Math.floor(Math.random() * teams.length)];
    return { orgName: team.name, players: team.players };
  }
  const names: string[] = [];
  while (names.length < 3) {
    const name = LB_NAMES[Math.floor(Math.random() * LB_NAMES.length)];
    if (names.includes(name)) continue;
    names.push(name);
  }
  return { orgName: null, players: names };
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
  const attendOrgCoaching = useSaveStore((st) => st.attendOrgCoaching);
  const runOrgBootcamp = useSaveStore((st) => st.runOrgBootcamp);
  const startTournamentSeries = useMatchStore((m) => m.startTournamentSeries);
  const matchPhase = useMatchStore((m) => m.phase);
  const [coachingResult, setCoachingResult] = useState<{ gameSense: Record<QueueMode, number>; mechanicalConsistency: Record<QueueMode, number> } | null>(null);
  const [bootcampResult, setBootcampResult] = useState<{ scrimWins: number; scrimLosses: number; gameSense: Record<QueueMode, number>; mechanicalConsistency: Record<QueueMode, number> } | null>(null);
  const [topTeamsScope, setTopTeamsScope] = useState<"region" | "world">("region");

  const era = eraForDate(s.currentDate);
  const currentYear = s.currentDate.year;
  const playerMmr = s.rankedProfiles["2v2"].mmr;
  const proRegion = saveRegionToProRegion(s.region);
  const { seasonNumber: rlcsSeasonNumber } = rlcsSeasonForDate(s.currentDate);

  // The SAME real, season-locked rosters the actual RLCS brackets use (see data/tournaments.ts) — a real
  // snapshot of who the top orgs are this season, not a separate one-off generation. Computed in an effect
  // (not useMemo) because these read real MMR via the leaderboard stores' getMmr, which also warms
  // (writes) that entry's catch-up state — a side effect that must not run during another component's
  // render, same rule every screen reading these stores follows.
  const [topRegionTeams, setTopRegionTeams] = useState<ReturnType<typeof generateTeamsForRegion>>([]);
  const [topWorldTeams, setTopWorldTeams] = useState<ReturnType<typeof generateGlobalTeams>>([]);
  useEffect(() => {
    const regionTeams = generateTeamsForRegion(proRegion, currentYear, rlcsSeasonNumber, s.rlcsTeamsResetSeed, `orgtop_region_${proRegion}`, era, s.currentDate, s.seasonStartDate);
    const worldTeams = generateGlobalTeams(currentYear, rlcsSeasonNumber, s.rlcsTeamsResetSeed, "orgtop_world", era, s.currentDate, s.seasonStartDate);
    setTopRegionTeams(applyPlayerOrgOverride(regionTeams, s.orgContract, s.displayName).sort((a, b) => b.power - a.power));
    setTopWorldTeams(applyPlayerOrgOverride(worldTeams, s.orgContract, s.displayName).sort((a, b) => b.power - a.power));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proRegion, currentYear, rlcsSeasonNumber, s.rlcsTeamsResetSeed, era, s.currentDate.year, s.currentDate.month, s.currentDate.day, s.orgContract, s.displayName]);

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
    acceptOrgInvite(s.currentDate);
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
      orgTag: orgTagForOrgName(contract.orgName),
      region: saveRegionToProRegion(s.region),
      teamChemistry: contract.chemistry,
    };
    const opponent = pickScrimOpponents(proRegion, currentYear, rlcsSeasonNumber, s.rlcsTeamsResetSeed, era, s.currentDate, s.seasonStartDate, contract.orgName);
    const seriesFormat = Math.random() < 0.5 ? 5 : 7;
    startTournamentSeries(self, opponent.players, seriesFormat, era, s.seasonNumber, currentYear, s.currentDate, s.seasonStartDate, (wonSeries) => {
      recordOrgScrimResult(wonSeries, s.currentDate);
    }, 0.6, contract.teammates, opponent.orgName ? orgTagForOrgName(opponent.orgName) : undefined);
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
      region: saveRegionToProRegion(s.region),
    };
    const opponent = pickScrimOpponents(proRegion, currentYear, rlcsSeasonNumber, s.rlcsTeamsResetSeed, era, s.currentDate, s.seasonStartDate, tryout.orgName);
    const seriesFormat = Math.random() < 0.5 ? 5 : 7;
    startTournamentSeries(self, opponent.players, seriesFormat, era, s.seasonNumber, currentYear, s.currentDate, s.seasonStartDate, (wonSeries) => {
      recordOrgTryoutScrim(wonSeries, s.currentDate, rlcsSeasonNumber);
    }, 0.6, tryout.teammates, opponent.orgName ? orgTagForOrgName(opponent.orgName) : undefined);
  }

  function handleAttendCoaching() {
    const result = attendOrgCoaching();
    if (result) setCoachingResult(result);
  }

  function handleRunBootcamp() {
    const result = runOrgBootcamp();
    if (result) setBootcampResult(result);
  }

  const inPlacements = s.rankedProfiles["2v2"].placementMatchesRemaining > 0;
  const meetsRank = meetsOrgRankRequirement(era, playerMmr);
  const talent = orgTalentDetail(era, currentYear, s.foundationStats, s.player.mechanicalConsistency["2v2"], s.player.gameSense["2v2"]);
  const eligible = !inPlacements && meetsRank;

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
            <div style={{ marginTop: 10 }}>
              <StatBar label="Team Chemistry" value={s.orgContract.chemistry} color="var(--accent)" />
            </div>
            {matchPhase === "idle" && daysBetween(s.orgContract.nextScrimDate, s.currentDate) >= 0 && (
              <button className="org-btn org-btn-primary" style={{ marginTop: 12 }} onClick={handlePlayOrgScrim}>
                Play Scrim
              </button>
            )}
          </Card>
        </SectionShell>
      ) : null}

      {s.orgContract ? (
        <SectionShell title="Coaching & Bootcamps">
          <div className="card-grid">
            <Card title="Coaching">
              <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 10 }}>
                A session with the org's coach: boosts Game Sense and Mechanical Consistency in every
                queue, leaning hardest into 3v3 (the org's own competitive queue).
              </div>
              {(() => {
                const cooldownDays = coachingIntervalDaysForTier(s.orgContract!.tier);
                const daysSince = s.lastOrgCoachingDate ? daysBetween(s.lastOrgCoachingDate, s.currentDate) : cooldownDays;
                const ready = daysSince >= cooldownDays;
                return ready ? (
                  <button className="org-btn org-btn-primary" onClick={handleAttendCoaching}>
                    Attend Coaching Session
                  </button>
                ) : (
                  <div className="sp-locked">Next session in {cooldownDays - daysSince}d</div>
                );
              })()}
              {coachingResult && (
                <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 10 }}>
                  {(["1v1", "2v2", "3v3"] as QueueMode[]).map((q) => (
                    <div key={q}>
                      {QUEUE_LABELS[q]}: Game Sense +{coachingResult.gameSense[q]}, Mechanical Consistency +{coachingResult.mechanicalConsistency[q]}
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card title="Bootcamp">
              <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 10 }}>
                A multi-day team retreat, a ton of scrims back to back against org-caliber lineups, plus a
                bigger Game Sense/Mechanical Consistency bump than a single coaching session.
              </div>
              {(() => {
                const cooldownDays = bootcampIntervalDaysForTier(s.orgContract!.tier);
                const daysSince = s.lastOrgBootcampDate ? daysBetween(s.lastOrgBootcampDate, s.currentDate) : cooldownDays;
                const ready = daysSince >= cooldownDays;
                return ready ? (
                  <button className="org-btn org-btn-primary" onClick={handleRunBootcamp}>
                    Run Bootcamp
                  </button>
                ) : (
                  <div className="sp-locked">Next bootcamp in {cooldownDays - daysSince}d</div>
                );
              })()}
              {bootcampResult && (
                <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 10 }}>
                  <div>Scrims: {bootcampResult.scrimWins}W-{bootcampResult.scrimLosses}L</div>
                  {(["1v1", "2v2", "3v3"] as QueueMode[]).map((q) => (
                    <div key={q}>
                      {QUEUE_LABELS[q]}: Game Sense +{bootcampResult.gameSense[q]}, Mechanical Consistency +{bootcampResult.mechanicalConsistency[q]}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </SectionShell>
      ) : null}

      {!s.orgContract && (
        !s.pendingOrgInvite &&
        !s.pendingOrgTryout && (
          <SectionShell title="Status">
            <Card>
              <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                {inPlacements
                  ? "Finish your 2v2 placements first, orgs don't scout during placements."
                  : !meetsRank
                    ? `Not scouted yet — 2v2 rank is the first gate, and yours isn't there (${playerMmr} / ${Math.round(orgRankFloorMmr(era))} MMR needed).`
                    : "Rank requirement met — from here it's about how your actual stats compare to top-player caliber, not the rank number itself. A tryout invite could come any day (checked every few days, not guaranteed)."}
              </div>
              {!inPlacements && meetsRank && (
                <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 6 }}>
                  {rlcsSeasonPhase(s.currentDate) === "off_season"
                    ? "It's the RLCS off-season — rosters are actively shuffling, scouting is much more active right now."
                    : "RLCS is in-season — most orgs' rosters are locked in for the split, scouting is rarer until the off-season."}
                </div>
              )}
              {!inPlacements && meetsRank && (
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-tertiary)" }}>Foundation stats (vs top-player)</span>
                    <span style={{ color: "var(--text-primary)" }}>{Math.round(talent.foundationRatio * 100)}%</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-tertiary)" }}>Mechanical Consistency (vs top-player)</span>
                    <span style={{ color: "var(--text-primary)" }}>{Math.round(talent.mechanicalConsistencyRatio * 100)}%</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-tertiary)" }}>Game Sense (vs top-player)</span>
                    <span style={{ color: "var(--text-primary)" }}>{Math.round(talent.gameSenseRatio * 100)}%</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontWeight: 700 }}>
                    <span style={{ color: "var(--text-secondary)" }}>Overall prospect score</span>
                    <span style={{ color: "var(--text-primary)" }}>{Math.round(talent.overallScore * 100)}%</span>
                  </div>
                </div>
              )}
            </Card>
          </SectionShell>
        )
      )}

      <SectionShell title="Top Teams">
        <div className="queue-tabbar" role="tablist" style={{ maxWidth: 280 }}>
          <button
            role="tab"
            aria-selected={topTeamsScope === "region"}
            className={"queue-tab" + (topTeamsScope === "region" ? " queue-tab-active" : "")}
            onClick={() => setTopTeamsScope("region")}
          >
            {REGION_LABELS[proRegion]}
          </button>
          <button
            role="tab"
            aria-selected={topTeamsScope === "world"}
            className={"queue-tab" + (topTeamsScope === "world" ? " queue-tab-active" : "")}
            onClick={() => setTopTeamsScope("world")}
          >
            World
          </button>
        </div>
        <Card>
          {(topTeamsScope === "region" ? topRegionTeams : topWorldTeams).map((team, i) => (
            <div key={team.id} className="org-team-row">
              <span className="org-team-rank">#{i + 1}</span>
              <div className="org-team-info">
                <div className="org-team-name">{team.name}{topTeamsScope === "world" && ` (${team.region})`}</div>
                <div className="org-team-roster">{team.players.join(", ")}</div>
              </div>
            </div>
          ))}
        </Card>
      </SectionShell>

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
        .queue-tabbar {
          display: flex;
          gap: 4px;
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 4px;
          margin-bottom: var(--space-3);
        }
        .queue-tab {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          background: none;
          border: none;
          border-radius: calc(var(--radius-md) - 2px);
          color: var(--text-secondary);
          font-size: 13px;
          font-weight: 600;
          padding: 8px 0;
          cursor: pointer;
          transition: background 150ms ease, color 150ms ease;
        }
        .queue-tab-active {
          background: var(--accent-muted);
          color: var(--accent);
        }
        .org-team-row {
          display: flex;
          align-items: baseline;
          gap: 10px;
          padding: 8px 0;
          border-bottom: 1px solid var(--border-subtle);
        }
        .org-team-row:last-child {
          border-bottom: none;
        }
        .org-team-rank {
          flex-shrink: 0;
          width: 24px;
          font-size: 12px;
          font-weight: 700;
          color: var(--text-tertiary);
        }
        .org-team-name {
          font-size: 13px;
          font-weight: 650;
          color: var(--text-primary);
        }
        .org-team-roster {
          font-size: 12px;
          color: var(--text-tertiary);
        }
      `}</style>
    </div>
  );
}
