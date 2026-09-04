import { useState } from "react";
import { Card } from "@/ui/components/Card";
import { StatBar } from "@/ui/components/StatBar";
import { UncappedStat } from "@/ui/components/UncappedStat";
import { SectionShell } from "@/ui/components/LockedSection";
import { RadarChart } from "@/ui/components/RadarChart";
import type { QueueMode } from "@/data/mockSave";
import { gameSenseHint } from "@/ui/gameSense";
import { useSaveStore } from "@/store/useSaveStore";
import { useWorldRecordStore } from "@/store/useWorldRecordStore";
import { computeOverallRating } from "@/data/matchSim";
import { TIER_LABELS, divisionLabel, tierRank, eraForDate, deriveRankFromMmr, rankDistribution, RANKED_POPULATION_BY_QUEUE, type RankTierId } from "@/data/rankSystem";
import { QUEUE_LABELS } from "@/data/queues";
import { RankBadge } from "@/ui/components/RankBadge";

const QUEUES: QueueMode[] = ["1v1", "2v2", "3v3"];

type StatsTab = "overview" | "ranked" | "career";

const TABS: { id: StatsTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "ranked", label: "Ranked" },
  { id: "career", label: "Career" },
];

export function StatsScreen() {
  const [tab, setTab] = useState<StatsTab>("overview");
  const s = useSaveStore();

  return (
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      <header style={{ marginBottom: "var(--space-4)" }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 650 }}>Stats</h1>
        <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>Everything tracked on {s.displayName}</div>
      </header>

      <div className="stats-tabbar" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={"stats-tab" + (tab === t.id ? " stats-tab-active" : "")}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div key={tab} className="fade-in">
        {tab === "overview" && <OverviewTab />}
        {tab === "ranked" && <RankedTab />}
        {tab === "career" && <CareerTab />}
      </div>

      <style>{`
        .stats-tabbar {
          display: flex;
          gap: 4px;
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 4px;
          margin-bottom: var(--space-4);
        }
        .stats-tab {
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
        .stats-tab-active {
          background: var(--accent-muted);
          color: var(--accent);
          font-weight: 600;
        }
        .stats-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: var(--space-4);
        }
        @media (min-width: 860px) {
          .stats-grid {
            grid-template-columns: repeat(3, 1fr);
          }
        }
      `}</style>
    </div>
  );
}

function OverviewTab() {
  const s = useSaveStore();
  return (
    <>
      <SectionShell title="Overall Rating">
        <Card>
          {QUEUES.map((q) => (
            <UncappedStat
              key={q}
              label={q}
              value={computeOverallRating(s.player.gameSense[q], s.player.mechanicalConsistency[q], s.foundationStats)}
              color="var(--accent)"
            />
          ))}
        </Card>
      </SectionShell>

      <SectionShell title="Core Attributes">
        <Card>
          {QUEUES.map((q) => (
            <UncappedStat
              key={q}
              label={`Game Sense (${q})`}
              value={s.player.gameSense[q]}
              color="var(--team-blue)"
              hint={gameSenseHint(s.player.gameSense[q])}
            />
          ))}
          <StatBar label="Fame" value={s.player.fame} color="var(--warning)" />
          <StatBar label="Fatigue" value={s.player.fatigue} color="var(--danger)" />
        </Card>
      </SectionShell>

      <SectionShell title="Mechanical Consistency">
        <Card>
          {QUEUES.map((q) => (
            <UncappedStat key={q} label={q} value={s.player.mechanicalConsistency[q]} color="var(--team-orange)" />
          ))}
        </Card>
      </SectionShell>

      <SectionShell title="Profile">
        <Card>
          <StatRow label="Starting era" value={s.startDate.year} />
          <StatRow label="Region" value={s.region.replace("_", " ")} />
          <StatRow label="Age" value={s.age} />
          <StatRow label="Hours played" value={(s.totalMinutesPlayed / 60).toFixed(1)} />
        </Card>
      </SectionShell>
    </>
  );
}

/** Compares two peak-rank results (tier, then division, then raw MMR as the final tiebreak) to find which
 *  queue a player's single best-ever rank actually came from, mirroring how a real tracker site picks
 *  which playlist to headline in its "Peak Rating" banner. */
function isBetterPeak(a: { tier: RankTierId; division: number; mmr: number }, b: { tier: RankTierId; division: number; mmr: number }): boolean {
  if (tierRank(a.tier) !== tierRank(b.tier)) return tierRank(a.tier) > tierRank(b.tier);
  if (a.division !== b.division) return a.division > b.division;
  return a.mmr > b.mmr;
}

function RankSummaryCard() {
  const s = useSaveStore();
  const era = eraForDate(s.currentDate);

  // `peakRankTier`/`peakDivision` on the profile are intentionally SEASON-scoped (they reset every season
  // rollover, that's what season-end title eligibility checks against) — they are NOT the same thing as
  // the all-time peak this card wants to show. `peakMmr`/`peakMmrSeason` genuinely are all-time (never
  // reset), so the all-time peak's TIER has to be re-derived from that MMR instead of reusing the
  // season-scoped fields, or right after any rollover this would show "Unranked" next to an old high MMR
  // number — exactly the "best looks wrong/matches current" bug this replaces.
  function allTimePeak(q: QueueMode) {
    const profile = s.rankedProfiles[q];
    const { tier, division } = deriveRankFromMmr(profile.peakMmr, era, q);
    return { tier, division, mmr: profile.peakMmr, season: profile.peakMmrSeason };
  }

  let bestQueue: QueueMode = QUEUES[0];
  for (const q of QUEUES) {
    if (isBetterPeak(allTimePeak(q), allTimePeak(bestQueue))) bestQueue = q;
  }
  const bestPeak = allTimePeak(bestQueue);

  return (
    <Card>
      <div className="rank-peak-banner">
        <RankBadge tier={bestPeak.tier} division={bestPeak.division} era={era} size={56} />
        <div>
          <div className="rank-peak-label">Peak Rating</div>
          <div className="rank-peak-queue">{QUEUE_LABELS[bestQueue]} {bestQueue}</div>
          <div className="rank-peak-value">
            {divisionLabel(bestPeak.tier, bestPeak.division, era)}
            <span className="rank-peak-mmr"> · {bestPeak.mmr}</span>
          </div>
          <div className="rank-peak-season">Season {bestPeak.season}</div>
        </div>
      </div>

      <div className="rank-queue-list">
        {QUEUES.map((q) => {
          const profile = s.rankedProfiles[q];
          const peak = allTimePeak(q);
          return (
            <div key={q} className="rank-queue-row">
              <div className="rank-queue-name">{QUEUE_LABELS[q]} {q}</div>
              <div className="rank-queue-cols">
                <div className="rank-queue-col">
                  <div className="rank-queue-col-label">Current</div>
                  <div className="rank-queue-col-body">
                    <RankBadge tier={profile.rankTier} division={profile.division} era={era} size={40} />
                    <div>
                      <div className="rank-queue-tier">{divisionLabel(profile.rankTier, profile.division, era)}</div>
                      <div className="rank-queue-mmr">{profile.mmr}</div>
                    </div>
                  </div>
                </div>
                <div className="rank-queue-col">
                  <div className="rank-queue-col-label">Best</div>
                  <div className="rank-queue-col-body">
                    <RankBadge tier={peak.tier} division={peak.division} era={era} size={40} />
                    <div>
                      <div className="rank-queue-tier">{divisionLabel(peak.tier, peak.division, era)}</div>
                      <div className="rank-queue-mmr">
                        {peak.mmr} <span className="rank-queue-season">Season {peak.season}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <style>{`
        .rank-peak-banner {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          background: color-mix(in srgb, var(--accent) 10%, var(--bg-surface-raised));
          border: 1px solid var(--accent);
          border-radius: var(--radius-md);
          padding: var(--space-3) var(--space-4);
          margin-bottom: var(--space-4);
        }
        .rank-peak-label {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--text-tertiary);
        }
        .rank-peak-queue {
          font-size: 12px;
          color: var(--accent);
          font-weight: 600;
          margin-top: 2px;
        }
        .rank-peak-value {
          font-size: 20px;
          font-weight: 700;
          color: var(--text-primary);
          margin-top: 2px;
        }
        .rank-peak-mmr {
          font-size: 14px;
          font-weight: 600;
          color: var(--text-secondary);
        }
        .rank-peak-season {
          font-size: 11px;
          color: var(--text-tertiary);
          margin-top: 2px;
        }
        .rank-queue-row {
          padding: var(--space-3) 0;
          border-bottom: 1px solid var(--border-subtle);
        }
        .rank-queue-row:last-child {
          border-bottom: none;
        }
        .rank-queue-name {
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          color: var(--accent);
          margin-bottom: 8px;
        }
        .rank-queue-cols {
          display: flex;
          gap: var(--space-5);
          flex-wrap: wrap;
        }
        .rank-queue-col {
          flex: 1;
          min-width: 140px;
        }
        .rank-queue-col-label {
          font-size: 11px;
          color: var(--text-tertiary);
          margin-bottom: 6px;
        }
        .rank-queue-col-body {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .rank-queue-tier {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
        }
        .rank-queue-mmr {
          font-size: 16px;
          font-weight: 700;
          color: var(--text-primary);
        }
        .rank-queue-season {
          font-size: 11px;
          font-weight: 500;
          color: var(--text-tertiary);
        }
      `}</style>
    </Card>
  );
}

type DistMetric = "pct" | "players";

function SkillDistributionCard() {
  const s = useSaveStore();
  const era = eraForDate(s.currentDate);
  const [queue, setQueue] = useState<QueueMode>("2v2");
  const [metric, setMetric] = useState<DistMetric>("pct");

  const rows = rankDistribution(era, queue);
  const population = RANKED_POPULATION_BY_QUEUE[queue];
  const chartRows = [...rows].reverse().map((row) => ({
    ...row,
    playerCount: Math.round(population * (row.populationPct / 100)),
  }));
  const maxValue = Math.max(...chartRows.map((r) => (metric === "pct" ? r.populationPct : r.playerCount)));

  return (
    <Card>
      <div className="dist-controls">
        <div className="dist-tabbar" role="tablist" aria-label="Playlist">
          {QUEUES.map((q) => (
            <button
              key={q}
              role="tab"
              aria-selected={queue === q}
              className={"dist-tab" + (queue === q ? " dist-tab-active" : "")}
              onClick={() => setQueue(q)}
            >
              {q}
            </button>
          ))}
        </div>
        <div className="dist-tabbar" role="tablist" aria-label="Metric">
          {(["pct", "players"] as DistMetric[]).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={metric === m}
              className={"dist-tab" + (metric === m ? " dist-tab-active" : "")}
              onClick={() => setMetric(m)}
            >
              {m === "pct" ? "% of players" : "Player count"}
            </button>
          ))}
        </div>
      </div>

      <div className="dist-chart">
        {chartRows.map((row) => {
          const value = metric === "pct" ? row.populationPct : row.playerCount;
          const barPct = maxValue > 0 ? (value / maxValue) * 100 : 0;
          return (
            <div key={`${row.tier}_${row.division}`} className="dist-chart-row">
              <RankBadge tier={row.tier} division={row.division || undefined} era={era} size={28} />
              <div className="dist-chart-label">
                <span>{divisionLabel(row.tier, row.division, era)}</span>
                <span className="dist-chart-mmr">{row.minMmr}+ MMR</span>
              </div>
              <div className="dist-chart-bar-track">
                <div className="dist-chart-bar" style={{ width: `${barPct}%` }} />
              </div>
              <div className="dist-chart-value">
                {metric === "pct" ? `${row.populationPct}%` : row.playerCount.toLocaleString()}
              </div>
            </div>
          );
        })}
      </div>

      <style>{`
        .dist-controls {
          display: flex;
          flex-wrap: wrap;
          gap: var(--space-2);
          margin-bottom: var(--space-4);
        }
        .dist-tabbar {
          display: flex;
          gap: 4px;
          background: var(--bg-surface-raised);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 4px;
        }
        .dist-tab {
          background: none;
          border: none;
          color: var(--text-secondary);
          font-size: 12px;
          font-weight: 600;
          padding: 6px 14px;
          border-radius: calc(var(--radius-md) - 2px);
          cursor: pointer;
          text-transform: capitalize;
        }
        .dist-tab-active {
          background: var(--accent-muted);
          color: var(--accent);
        }
        .dist-chart {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .dist-chart-row {
          display: grid;
          grid-template-columns: 28px 130px 1fr 90px;
          align-items: center;
          gap: 10px;
        }
        .dist-chart-label {
          display: flex;
          flex-direction: column;
          font-size: 12px;
          font-weight: 600;
          color: var(--text-primary);
        }
        .dist-chart-mmr {
          font-size: 10px;
          font-weight: 500;
          color: var(--text-tertiary);
        }
        .dist-chart-bar-track {
          height: 14px;
          border-radius: 999px;
          background: var(--bg-surface-raised);
          overflow: hidden;
        }
        .dist-chart-bar {
          height: 100%;
          border-radius: 999px;
          background: var(--accent);
          transition: width 300ms ease;
        }
        .dist-chart-value {
          font-size: 12px;
          font-weight: 600;
          color: var(--text-secondary);
          text-align: right;
        }
      `}</style>
    </Card>
  );
}

function RankedTab() {
  return (
    <>
      <SectionShell title="Ranked Rating">
        <RankSummaryCard />
      </SectionShell>

      <SectionShell title="Skill Distribution">
        <SkillDistributionCard />
      </SectionShell>
    </>
  );
}

function CareerTab() {
  const s = useSaveStore();
  const worldRecords = useWorldRecordStore((store) => store.records);
  return (
    <>
      <SectionShell title="Skill Tree Summary">
        <Card>
          <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            Skill points available: <strong style={{ color: "var(--text-primary)" }}>{s.skillPoints}</strong>
          </div>
        </Card>
      </SectionShell>

      <SectionShell title="Career Record">
        <div className="stats-grid">
          {QUEUES.map((q) => {
            const c = s.careerStats[q];
            const winRate = Math.round((c.wins / (c.wins + c.losses)) * 100);
            return (
              <Card key={q} title={q}>
                <StatRow label="Record" value={`${c.wins}W, ${c.losses}L (${winRate}%)`} />
                <StatRow label="Goals" value={c.goals} />
                <StatRow label="Assists" value={c.assists} />
                <StatRow label="Saves" value={c.saves} />
                <StatRow label="MVPs" value={c.mvps} />
                <StatRow label="Matches this season" value={s.rankedProfiles[q].seasonMatchesPlayed} />
                <StatRow
                  label="Peak MMR"
                  value={`${s.rankedProfiles[q].peakMmr} (Season ${s.rankedProfiles[q].peakMmrSeason})`}
                />
              </Card>
            );
          })}
        </div>
      </SectionShell>

      <SectionShell title="World Records">
        <div className="stats-grid">
          {QUEUES.map((q) => {
            const record = worldRecords[q];
            return (
              <Card key={q} title={q}>
                {record ? (
                  <>
                    <StatRow label="Record MMR" value={record.mmr} />
                    <StatRow label="Held by" value={record.holderName} />
                    <StatRow label="Set in" value={`Season ${record.seasonNumber} (${record.year})`} />
                  </>
                ) : (
                  <div style={{ fontSize: 13, color: "var(--text-tertiary)" }}>No record set yet — visit the Ranked leaderboard.</div>
                )}
              </Card>
            );
          })}
        </div>
      </SectionShell>

      <SectionShell title="Playstyle Map">
        <div className="stats-grid">
          {QUEUES.map((q) => {
            const t = s.playstyleProfiles[q];
            return (
              <Card key={q} title={q}>
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <RadarChart
                    axes={[
                      { label: "Aggression", value: t.aggression },
                      { label: "Rotation", value: t.rotationDiscipline },
                      { label: "Flair", value: t.mechanicalFlair },
                      { label: "Consistency", value: t.consistency },
                    ]}
                    size={200}
                  />
                </div>
              </Card>
            );
          })}
        </div>
      </SectionShell>

      <SectionShell title="Season History">
        <Card>
          {s.seasonHistory.length === 0 && (
            <div style={{ fontSize: 13, color: "var(--text-tertiary)" }}>
              No completed seasons yet, this is your first.
            </div>
          )}
          {[...s.seasonHistory].reverse().map((entry) => (
            <div key={entry.seasonNumber} className="season-history-row">
              <div className="season-history-header">
                <span className="season-history-number">Season {entry.seasonNumber}</span>
                <span className="season-history-reward">{TIER_LABELS[entry.rewardTierAchieved]} reward</span>
              </div>
              <div className="season-history-peaks">
                {QUEUES.map((q) => (
                  <span key={q} className="season-history-peak">
                    {q}: {divisionLabel(entry.peaks[q].tier, entry.peaks[q].division, entry.era)}
                  </span>
                ))}
              </div>
            </div>
          ))}
          <style>{`
            .season-history-row {
              padding: 8px 0;
              border-bottom: 1px solid var(--border-subtle);
            }
            .season-history-row:last-child {
              border-bottom: none;
            }
            .season-history-header {
              display: flex;
              justify-content: space-between;
              font-size: 13px;
              font-weight: 600;
              margin-bottom: 4px;
            }
            .season-history-reward {
              color: var(--text-tertiary);
              font-weight: 500;
            }
            .season-history-peaks {
              display: flex;
              gap: 12px;
              flex-wrap: wrap;
              font-size: 12px;
              color: var(--text-secondary);
            }
          `}</style>
        </Card>
      </SectionShell>

      <SectionShell
        title="Tournament History"
        locked={s.player.fame < 30}
        lockedReason="Unlocks after your first tournament entry."
      >
        <Card>
          <div style={{ fontSize: 13, color: "var(--text-tertiary)" }}>No tournaments played yet.</div>
        </Card>
      </SectionShell>
    </>
  );
}

function StatRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        fontSize: 13,
        padding: "5px 0",
        borderBottom: "1px solid var(--border-subtle)",
      }}
    >
      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span style={{ fontWeight: 500, textTransform: typeof value === "string" ? "capitalize" : "none" }}>
        {value}
      </span>
    </div>
  );
}
