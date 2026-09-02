// Multi-save persistence, backed by IndexedDB via idb-keyval. Up to MAX_SAVES profiles at once, each a
// full SaveData blob under its own key, plus a lightweight index for the Save Select screen so we don't
// have to load every full save just to list them.

import { get, set, del } from "idb-keyval";
import { mockSave, isValidUsername, type SaveData, type QueueMode } from "./mockSave";
import type { Region } from "./mockSave";
import { MECHANICS } from "./mechanics";
import { QUEUE_CONCEPTS } from "./queueConcepts";
import { eraForDate, divisionCount } from "./rankSystem";
import { initialSeasonForDate } from "./seasons";
import { clearTournamentDataForSave } from "@/store/useTournamentStore";
import { saveRegionToProRegion } from "./tournaments";

/**
 * Saves persisted from an older build can be missing fields the current schema expects, or have fields
 * under an old shape entirely (this project's data model has changed a lot during development). Rather
 * than a full versioned migration system, this patches the specific breaking changes made so far so an
 * old save loads without crashing screens that assume the new shape. Add a new patch here whenever a
 * save-breaking rename/reshape happens, don't remove old patches, they cover saves from any older build.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrateSaveData(raw: any): SaveData {
  const data = { ...raw };

  // titles: string[] + equippedTitle: string -> titles: TitleEntry[] + equippedTitleId: string | null
  if (Array.isArray(data.titles) && data.titles.length > 0 && typeof data.titles[0] === "string") {
    const oldEquipped = data.equippedTitle;
    data.titles = data.titles.map((label: string) => ({
      id: label.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
      label,
      glow: "none",
    }));
    data.equippedTitleId = data.titles.find((t: { label: string }) => t.label === oldEquipped)?.id ?? data.titles[0]?.id ?? null;
  }
  if (data.equippedTitleId === undefined) {
    data.equippedTitleId = data.titles?.[0]?.id ?? null;
  }
  delete data.equippedTitle;

  // The clock used to only track whole hours, matches now advance it by realistic minute counts instead.
  if (data.clockMinute === undefined) data.clockMinute = 0;

  // Game sense/mechanical consistency used to be one flat number account-wide, now tracked per playlist
  // so a duel specialist's 1v1 reads can genuinely outpace a 2v2 pro's. Seed every queue from the old
  // single value, they'll diverge naturally from here as each queue gets played/trained.
  if (typeof data.player?.gameSense === "number") {
    const flat = data.player.gameSense;
    data.player.gameSense = { "1v1": flat, "2v2": flat, "3v3": flat };
  }
  if (typeof data.player?.mechanicalConsistency === "number") {
    const flat = data.player.mechanicalConsistency;
    data.player.mechanicalConsistency = { "1v1": flat, "2v2": flat, "3v3": flat };
  }

  if (data.totalMinutesPlayed === undefined) data.totalMinutesPlayed = 0;

  // GC+/SSL ranked matchmaking's region multi-select didn't exist before, default to just the player's own
  // region, same as a fresh save.
  if (data.selectedMatchmakingRegions === undefined) data.selectedMatchmakingRegions = [saveRegionToProRegion(data.region)];

  // Display Name (the free-text, always-editable name shown everywhere) didn't exist before, the fixed
  // username used to double as the shown name. Old saves keep whatever they already had as their display
  // name so nothing appears to change on load, the username itself is left untouched even if it happens
  // to contain characters the new IGN rule wouldn't allow for a fresh save, only rename is validated.
  if (data.displayName === undefined) data.displayName = data.username;

  // Org/pro-scene track didn't exist before, `orgStatus` was a stub placeholder never actually read
  // anywhere — drop it in favor of the real invite/tryout/contract/news shape.
  delete data.orgStatus;
  if (data.pendingOrgInvite === undefined) data.pendingOrgInvite = null;
  if (data.pendingOrgTryout === undefined) data.pendingOrgTryout = null;
  if (data.orgContract === undefined) data.orgContract = null;
  if (data.orgNews === undefined) data.orgNews = [];
  if (data.lastOrgScoutCheckDate === undefined) data.lastOrgScoutCheckDate = data.currentDate;
  // Coaching/bootcamp didn't exist before, null means "never attended one yet" same as a fresh save.
  if (data.lastOrgCoachingDate === undefined) data.lastOrgCoachingDate = null;
  if (data.lastOrgBootcampDate === undefined) data.lastOrgBootcampDate = null;
  // Ongoing post-signing scrims/renewal didn't exist in the very first cut of the org system, an
  // already-signed save from that window is missing these, backfill so it doesn't crash on read.
  if (data.orgContract && data.orgContract.scrimWins === undefined) {
    data.orgContract.scrimWins = 0;
    data.orgContract.scrimLosses = 0;
    data.orgContract.nextScrimDate = data.currentDate;
  }

  // Social (friends + showmatches) didn't exist before.
  if (data.friends === undefined) data.friends = {};
  // Persistent per-queue friend MMR/stats didn't exist before, an already-added friend from that window
  // is missing them — backfill near the save's own current numbers, same seed formula addFriend uses now.
  for (const friend of Object.values(data.friends) as Record<string, unknown>[]) {
    if (friend.mmr !== undefined) continue;
    friend.mmr = { "1v1": data.rankedProfiles["1v1"].mmr, "2v2": data.rankedProfiles["2v2"].mmr, "3v3": data.rankedProfiles["3v3"].mmr };
    friend.gameSense = { ...data.player.gameSense };
    friend.mechanicalConsistency = { ...data.player.mechanicalConsistency };
  }
  if (data.pendingShowmatchInvite === undefined) data.pendingShowmatchInvite = null;
  if (data.showmatchHistory === undefined) data.showmatchHistory = [];
  if (data.lastShowmatchInviteCheckDate === undefined) data.lastShowmatchInviteCheckDate = data.currentDate;
  if (data.recentlyPlayedWith === undefined) data.recentlyPlayedWith = [];
  if (data.partyMembers === undefined) data.partyMembers = [];

  // Ranked seasons didn't exist before, seed sensible defaults from whatever date the save is at.
  if (data.seasonNumber === undefined) data.seasonNumber = 1;
  if (data.seasonStartDate === undefined) data.seasonStartDate = { ...data.currentDate };
  if (data.seasonNumberingReset === undefined) data.seasonNumberingReset = eraForDate(data.currentDate) === "modern";
  if (data.pendingSeasonAnnouncement === undefined) data.pendingSeasonAnnouncement = null;

  // Placements and peak-rank tracking are newer fields on RankedProfile.
  (Object.keys(data.rankedProfiles ?? {}) as QueueMode[]).forEach((q) => {
    const p = data.rankedProfiles[q];
    if (p.placementMatchesRemaining === undefined) p.placementMatchesRemaining = 0;
    if (p.peakRankTier === undefined) p.peakRankTier = p.rankTier;
    if (p.peakDivision === undefined) p.peakDivision = p.division ?? 0;
    // Peak MMR didn't exist before, seed it from wherever the save currently sits, it can only climb
    // higher (or get backfilled correctly) from here.
    if (p.peakMmr === undefined) p.peakMmr = p.mmr ?? 0;
    if (p.peakMmrSeason === undefined) p.peakMmrSeason = data.seasonNumber ?? 1;
    if (p.streakType === undefined) p.streakType = null;
    if (p.streakCount === undefined) p.streakCount = 0;

    // Bronze-Champion used to (incorrectly) go up to division IV, real RL only has I-III. Clamp any save
    // that picked up a division 4 down to 3 (the new top), rather than leaving it displaying a division
    // that no longer exists.
    const era = eraForDate(data.currentDate);
    const maxDivision = divisionCount(p.rankTier, era);
    if (maxDivision > 0 && p.division > maxDivision) p.division = maxDivision;
    const maxPeakDivision = divisionCount(p.peakRankTier, era);
    if (maxPeakDivision > 0 && p.peakDivision > maxPeakDivision) p.peakDivision = maxPeakDivision;
  });

  if (data.seasonHistory === undefined) data.seasonHistory = [];
  if (data.pendingPlacementResult === undefined) data.pendingPlacementResult = null;
  if (data.pendingPromotion === undefined) data.pendingPromotion = null;

  // Reward level used to live per-queue on RankedProfile; it's account-wide now, matching real RL
  // (a win in any playlist counts). Migrate an old save's per-queue values up by keeping whichever
  // queue had progressed furthest, then drop the stale per-queue fields.
  if (data.rewardTierUnlocked === undefined) {
    const TIER_ORDER = ["unranked", "bronze", "silver", "gold", "platinum", "diamond", "champion", "grand_champion", "ssl"];
    let best = { rewardTierUnlocked: "unranked", rewardWinsProgress: 0 };
    (Object.keys(data.rankedProfiles ?? {}) as QueueMode[]).forEach((q) => {
      const p = data.rankedProfiles[q];
      if (p?.rewardTierUnlocked && TIER_ORDER.indexOf(p.rewardTierUnlocked) > TIER_ORDER.indexOf(best.rewardTierUnlocked)) {
        best = { rewardTierUnlocked: p.rewardTierUnlocked, rewardWinsProgress: p.rewardWinsProgress ?? 0 };
      }
    });
    data.rewardTierUnlocked = best.rewardTierUnlocked;
    data.rewardWinsProgress = best.rewardWinsProgress;
  }
  (Object.keys(data.rankedProfiles ?? {}) as QueueMode[]).forEach((q) => {
    delete data.rankedProfiles[q].rewardTierUnlocked;
    delete data.rankedProfiles[q].rewardWinsProgress;
  });

  // Reward progress used to be one sequential counter (unlock Bronze, then Silver, ...), now every tier
  // tracks its own win count in parallel. Migrate the old flat shape by marking every tier up to (and
  // including) whatever was already unlocked as complete, and seeding the next tier's count from the old
  // progress number, which is what it was actually counting toward.
  if (data.rewardProgressByTier === undefined) {
    const TIER_ORDER = ["unranked", "bronze", "silver", "gold", "platinum", "diamond", "champion", "grand_champion", "ssl"];
    const rewardProgressByTier: Partial<Record<string, number>> = {};
    const unlockedIdx = TIER_ORDER.indexOf(data.rewardTierUnlocked ?? "unranked");
    for (let i = 1; i <= unlockedIdx; i++) rewardProgressByTier[TIER_ORDER[i]] = 10;
    const nextTier = TIER_ORDER[unlockedIdx + 1];
    if (nextTier) rewardProgressByTier[nextTier] = data.rewardWinsProgress ?? 0;
    data.rewardProgressByTier = rewardProgressByTier;
  }
  delete data.rewardWinsProgress;

  return data as SaveData;
}

export const MAX_SAVES = 3;
const PLACEMENT_MATCHES = 10;
const STARTING_MMR = 600;

const INDEX_KEY = "rl-sim:save-index";
const ACTIVE_KEY = "rl-sim:active-save-id";
const saveKey = (id: string) => `rl-sim:save:${id}`;

export interface SaveSummary {
  id: string;
  username: string;
  displayName: string;
  region: Region;
  level: number;
  startYear: number;
  createdAt: string;
  updatedAt: string;
}

export interface NewSaveConfig {
  username: string;
  displayName: string;
  realName: string;
  age: number;
  region: Region;
  startYear: number;
}

export async function listSaves(): Promise<SaveSummary[]> {
  return (await get<SaveSummary[]>(INDEX_KEY)) ?? [];
}

async function writeIndex(index: SaveSummary[]): Promise<void> {
  await set(INDEX_KEY, index);
}

export async function getActiveSaveId(): Promise<string | null> {
  return (await get<string>(ACTIVE_KEY)) ?? null;
}

export async function setActiveSaveId(id: string | null): Promise<void> {
  if (id === null) await del(ACTIVE_KEY);
  else await set(ACTIVE_KEY, id);
}

export async function loadSave(id: string): Promise<SaveData | null> {
  const raw = await get<SaveData>(saveKey(id));
  return raw ? migrateSaveData(raw) : null;
}

export async function writeSave(id: string, data: SaveData): Promise<void> {
  await set(saveKey(id), data);
  const index = await listSaves();
  const existing = index.find((s) => s.id === id);
  const summary: SaveSummary = {
    id,
    username: data.username,
    displayName: data.displayName,
    region: data.region,
    level: data.level,
    startYear: data.startDate.year,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await writeIndex([...index.filter((s) => s.id !== id), summary]);
}

export async function deleteSave(id: string): Promise<void> {
  await del(saveKey(id));
  const index = await listSaves();
  await writeIndex(index.filter((s) => s.id !== id));
  const activeId = await getActiveSaveId();
  if (activeId === id) await setActiveSaveId(null);
  // Tournament progress (majors, regionals, the player's own registration) is scoped per save, delete it
  // along with everything else rather than leaving an orphaned blob nothing will ever read again.
  clearTournamentDataForSave(id);
}

function zeroRecord<T extends string>(ids: T[]): Record<T, { currentValue: number }> {
  return Object.fromEntries(ids.map((id) => [id, { currentValue: 0 }])) as Record<T, { currentValue: number }>;
}

function createFreshSaveData(config: NewSaveConfig): SaveData {
  const emptyRanked = {
    mmr: STARTING_MMR,
    rankTier: "unranked" as const,
    division: 0,
    divisionProgress: 0,
    seasonMatchesPlayed: 0,
    placementMatchesRemaining: PLACEMENT_MATCHES,
    peakRankTier: "unranked" as const,
    peakDivision: 0,
    peakMmr: STARTING_MMR,
    peakMmrSeason: 1,
    streakType: null as "win" | "loss" | null,
    streakCount: 0,
  };
  const emptyCareer = { wins: 0, losses: 0, goals: 0, assists: 0, saves: 0, mvps: 0 };
  const emptyPlaystyle = { aggression: 50, rotationDiscipline: 50, mechanicalFlair: 50, consistency: 50 };
  const startDate = { year: config.startYear, month: 1, day: 1 };

  return {
    username: config.username,
    displayName: config.displayName,
    realName: config.realName,
    age: config.age,
    region: config.region,
    selectedMatchmakingRegions: [saveRegionToProRegion(config.region)],
    startDate: { year: config.startYear },
    currentDate: startDate,
    clockHour: 9,
    clockMinute: 0,
    totalMinutesPlayed: 0,
    level: 1,
    xp: 0,
    xpToNextLevel: 1000,
    skillPoints: 0,
    playstyle: "mechanical",

    // A brand-new character isn't a total blank slate, everyone's played SOME Rocket League before turning
    // pro, this lands right around a 500 overall rating (see matchSim.ts's computeOverallRating), a fresh
    // Silver/Gold-ish starting point rather than a true 0, which used to make the very first few ranked
    // matches feel unwinnably raw compared to literally anyone else on the ladder.
    player: {
      fame: 0,
      gameSense: { "1v1": 500, "2v2": 500, "3v3": 500 },
      mechanicalConsistency: { "1v1": 450, "2v2": 450, "3v3": 450 },
      fatigue: 0,
    },

    foundationStats: { carControl: 550, aerialControl: 550, boostManagement: 550, offense: 550, defense: 550, passing: 550 },

    mechanicProgress: zeroRecord(MECHANICS.map((m) => m.id)),
    queueConceptProgress: zeroRecord(QUEUE_CONCEPTS.map((c) => c.id)),

    rankedProfiles: {
      "1v1": { queue: "1v1", ...emptyRanked },
      "2v2": { queue: "2v2", ...emptyRanked },
      "3v3": { queue: "3v3", ...emptyRanked },
    },

    careerStats: { "1v1": { ...emptyCareer }, "2v2": { ...emptyCareer }, "3v3": { ...emptyCareer } },
    playstyleProfiles: { "1v1": { ...emptyPlaystyle }, "2v2": { ...emptyPlaystyle }, "3v3": { ...emptyPlaystyle } },

    pendingOrgInvite: null,
    pendingOrgTryout: null,
    orgContract: null,
    orgNews: [],
    lastOrgScoutCheckDate: startDate,
    lastOrgCoachingDate: null,
    lastOrgBootcampDate: null,
    recentMatches: [],
    titles: [{ id: "rookie", label: "Rookie", glow: "none" }],
    equippedTitleId: "rookie",
    seasonRewardTier: 0,
    rewardTierUnlocked: "unranked",
    rewardProgressByTier: {},

    ...initialSeasonForDate(startDate),
    pendingSeasonAnnouncement: null,
    seasonHistory: [],
    pendingPlacementResult: null,
    pendingPromotion: null,

    friends: {},
    pendingShowmatchInvite: null,
    showmatchHistory: [],
    lastShowmatchInviteCheckDate: startDate,
    recentlyPlayedWith: [],
    partyMembers: [],
  };
}

export async function createSave(config: NewSaveConfig): Promise<SaveSummary> {
  const index = await listSaves();
  if (index.length >= MAX_SAVES) {
    throw new Error(`Cannot have more than ${MAX_SAVES} saves at once.`);
  }
  if (!isValidUsername(config.username)) {
    throw new Error("Username can only contain letters and numbers, no spaces or special characters.");
  }
  const id = `save_${Date.now()}_${Math.round(Math.random() * 1e6)}`;
  const data = createFreshSaveData(config);
  await writeSave(id, data);
  return (await listSaves()).find((s) => s.id === id)!;
}

/** Imports a save previously exported via `exportSaveData` (see SettingsScreen.tsx), as a brand-new save
 *  entry alongside whatever's already in the list — never overwrites an existing save, even one with a
 *  matching username, this is how a save actually moves from one device/browser to another. Runs the
 *  imported blob through the exact same `migrateSaveData` path a normal IndexedDB load does, so a save
 *  exported from an older (or newer) build still comes in cleanly. Throws on anything that doesn't look
 *  like a real save at all, rather than silently creating a save full of undefined fields. */
export async function importSaveFile(raw: unknown): Promise<SaveSummary> {
  const index = await listSaves();
  if (index.length >= MAX_SAVES) {
    throw new Error(`Cannot have more than ${MAX_SAVES} saves at once.`);
  }
  if (typeof raw !== "object" || raw === null || !("username" in raw) || !("rankedProfiles" in raw) || !("currentDate" in raw)) {
    throw new Error("That file doesn't look like a valid save.");
  }
  const data = migrateSaveData(raw);
  const id = `save_import_${Date.now()}_${Math.round(Math.random() * 1e6)}`;
  await writeSave(id, data);
  return (await listSaves()).find((s) => s.id === id)!;
}

/** Seeds the bundled example save on a completely fresh install, so first-run isn't an empty list.
 *  Only called when no saves exist at all yet. */
export async function seedDemoSave(): Promise<SaveSummary> {
  const id = `save_demo_${Date.now()}`;
  await writeSave(id, mockSave);
  return (await listSaves()).find((s) => s.id === id)!;
}
