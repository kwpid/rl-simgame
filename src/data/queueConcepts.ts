// Playlist-specific tactical/mental concepts, distinct from the physical Mechanic Fund (data/mechanics.ts).
// A 1v1 grind is a completely different skillset from 2v2 or 3v3, not just "the same game with fewer
// players", so each queue gets its own set of trainable concepts: reading an opponent and low-boost
// defending matter enormously in 1v1 and barely at all in 3v3; rotation discipline is the opposite.
//
// Same fund model as mechanics: no hard prerequisites, only readiness (a relevant stat) and synergy
// (another concept already trained) affect training *efficiency*, never availability. Unlike mechanics,
// these aren't physically discovered tech, so there's no era gate, they're always available to train.

import type { QueueMode } from "./mockSave";
import type { FoundationCategory } from "./mechanics";

export type ConceptCategory = "mindset" | "rotation" | "boost" | "pressure" | "teamplay";

export const CONCEPT_CATEGORY_LABELS: Record<ConceptCategory, string> = {
  mindset: "Mindset",
  rotation: "Rotation",
  boost: "Boost Control",
  pressure: "Pressure",
  teamplay: "Teamplay",
};

/** A stat readiness gate can point at a foundation category or at gameSense directly, mindset concepts
 *  often scale off decision-making rather than any single mechanical/tactical foundation stat. */
export type ReadinessStat = FoundationCategory | "gameSense";

export interface QueueConceptDefinition {
  id: string;
  label: string;
  description: string;
  queue: QueueMode;
  category: ConceptCategory;
  recommendedStat?: ReadinessStat;
  recommendedStatValue?: number;
  recommendedAfter?: string[];
}

export const QUEUE_CONCEPTS: QueueConceptDefinition[] = [
  // ============ 1v1 ============
  {
    id: "1v1_adaptation",
    label: "Mid-Match Adaptation",
    description: "Recognizing an opponent's patterns and adjusting your approach as the game goes on.",
    queue: "1v1",
    category: "mindset",
    recommendedStat: "gameSense",
    recommendedStatValue: 2000,
  },
  {
    id: "1v1_opponent_read",
    label: "Reading Your Opponent",
    description: "Anticipating the next move from an opponent's positioning and habits, not just the ball.",
    queue: "1v1",
    category: "mindset",
    recommendedStat: "gameSense",
    recommendedStatValue: 2600,
    recommendedAfter: ["1v1_adaptation"],
  },
  {
    id: "1v1_car_reading",
    label: "Car Reading",
    description: "Judging where the ball will end up based on an opponent's car angle and boost usage, before they touch it.",
    queue: "1v1",
    category: "mindset",
    recommendedStat: "gameSense",
    recommendedStatValue: 3200,
    recommendedAfter: ["1v1_opponent_read"],
  },
  {
    id: "1v1_mind_games",
    label: "Mind Games",
    description: "Faking a challenge or a shot to bait a reaction and open up the real play.",
    queue: "1v1",
    category: "pressure",
    recommendedStat: "offense",
    recommendedStatValue: 1400,
    recommendedAfter: ["1v1_opponent_read"],
  },
  {
    id: "1v1_air_dribble_bump",
    label: "Air Dribble Bumps",
    description: "Timing a bump to break up an opponent's air dribble before they can finish it.",
    queue: "1v1",
    category: "pressure",
    recommendedStat: "defense",
    recommendedStatValue: 1600,
  },
  {
    id: "1v1_low_boost_defense",
    label: "Low Boost Defending",
    description: "Defending effectively with little to no boost, using field position and timing instead of speed.",
    queue: "1v1",
    category: "boost",
    recommendedStat: "defense",
    recommendedStatValue: 1200,
  },
  {
    id: "1v1_low_boost_offense",
    label: "Low Boost Attacking",
    description: "Playing patient, low-risk offense when boost is scarce instead of forcing a play you can't recover from.",
    queue: "1v1",
    category: "boost",
    recommendedStat: "offense",
    recommendedStatValue: 1200,
    recommendedAfter: ["1v1_low_boost_defense"],
  },
  {
    id: "1v1_boost_starving",
    label: "Boost Starving",
    description: "Denying pads to keep the opponent permanently low on boost and limit their options.",
    queue: "1v1",
    category: "boost",
    recommendedStat: "boostManagement",
    recommendedStatValue: 1400,
    recommendedAfter: ["1v1_low_boost_offense"],
  },
  {
    id: "1v1_shot_selection",
    label: "Shot Selection",
    description: "Recognizing genuinely high-value scoring windows instead of forcing a low-percentage shot.",
    queue: "1v1",
    category: "mindset",
    recommendedStat: "offense",
    recommendedStatValue: 1800,
  },
  {
    id: "1v1_tilt_management",
    label: "Tilt Management",
    description: "Staying even-keeled after conceding instead of overcommitting to force an immediate answer.",
    queue: "1v1",
    category: "mindset",
    recommendedStat: "gameSense",
    recommendedStatValue: 1500,
  },

  // ============ 2v2 ============
  {
    id: "2v2_teammate_adaptation",
    label: "Teammate Adaptation",
    description: "Adjusting your positioning and habits to fit a specific teammate's tendencies instead of a generic rotation.",
    queue: "2v2",
    category: "teamplay",
    recommendedStat: "gameSense",
    recommendedStatValue: 1800,
  },
  {
    id: "2v2_possession",
    label: "Possession Play",
    description: "Cycling boost and passing to control tempo instead of forcing a 50/50 every time the ball is loose.",
    queue: "2v2",
    category: "rotation",
    recommendedStat: "passing",
    recommendedStatValue: 1300,
  },
  {
    id: "2v2_rotation_basics",
    label: "Rotation Basics",
    description: "Cycling back to the correct position after a challenge instead of both players committing forward.",
    queue: "2v2",
    category: "rotation",
    recommendedStat: "defense",
    recommendedStatValue: 900,
  },
  {
    id: "2v2_leave_one_back",
    label: "Leaving One Back",
    description: "Committing one player forward while the other holds defense, instead of both going for it.",
    queue: "2v2",
    category: "rotation",
    recommendedStat: "defense",
    recommendedStatValue: 1400,
    recommendedAfter: ["2v2_rotation_basics"],
  },
  {
    id: "2v2_punish_overcommit",
    label: "Punishing Overcommits",
    description: "Reading when an opponent has overcommitted and immediately going for the ump or the open net.",
    queue: "2v2",
    category: "pressure",
    recommendedStat: "offense",
    recommendedStatValue: 1600,
    recommendedAfter: ["2v2_rotation_basics"],
  },
  {
    id: "2v2_backpost_rotation",
    label: "Backpost Rotation",
    description: "Rotating to the far post to cover a cross instead of both defenders collapsing on the same side.",
    queue: "2v2",
    category: "rotation",
    recommendedStat: "defense",
    recommendedStatValue: 2000,
    recommendedAfter: ["2v2_leave_one_back"],
  },
  {
    id: "2v2_fake_challenge",
    label: "Fake Challenges",
    description: "Faking a 50/50 challenge to bait a clear while your teammate collects the rebound.",
    queue: "2v2",
    category: "pressure",
    recommendedStat: "offense",
    recommendedStatValue: 1900,
    recommendedAfter: ["2v2_punish_overcommit"],
  },
  {
    id: "2v2_duo_boost_starving",
    label: "Boost Starving as a Duo",
    description: "Coordinating with a teammate to deny the opponents' boost pads as a pair instead of individually.",
    queue: "2v2",
    category: "boost",
    recommendedStat: "boostManagement",
    recommendedStatValue: 1500,
  },
  {
    id: "2v2_callouts",
    label: "Communication Timing",
    description: "Calling out challenges and passes at the right moment to avoid two players committing to the same ball.",
    queue: "2v2",
    category: "teamplay",
    recommendedStat: "gameSense",
    recommendedStatValue: 2200,
    recommendedAfter: ["2v2_teammate_adaptation"],
  },
  {
    id: "2v2_shadow_reads",
    label: "Shadow Reads",
    description: "Backing off into a shadow at the right distance instead of committing early and getting beaten clean.",
    queue: "2v2",
    category: "rotation",
    recommendedStat: "defense",
    recommendedStatValue: 1300,
  },
  {
    id: "2v2_challenge_timing",
    label: "Challenge Timing",
    description: "Reading exactly when to step up on a 50/50 instead of committing too early or too late.",
    queue: "2v2",
    category: "pressure",
    recommendedStat: "gameSense",
    recommendedStatValue: 2000,
  },

  // ============ 3v3 ============
  {
    id: "3v3_full_rotation",
    label: "Full Rotation Discipline",
    description: "Maintaining a clean back-mid-front rotation across three players instead of clumping near the ball.",
    queue: "3v3",
    category: "rotation",
    recommendedStat: "defense",
    recommendedStatValue: 1200,
  },
  {
    id: "3v3_third_man",
    label: "Third Man Rotation",
    description: "Reading when to hang back as the third man instead of joining a challenge that's already a 2v1.",
    queue: "3v3",
    category: "rotation",
    recommendedStat: "gameSense",
    recommendedStatValue: 1900,
    recommendedAfter: ["3v3_full_rotation"],
  },
  {
    id: "3v3_passback_setups",
    label: "Passback Setups",
    description: "Setting up a pass to a rotating teammate instead of forcing a shot while under pressure.",
    queue: "3v3",
    category: "teamplay",
    recommendedStat: "passing",
    recommendedStatValue: 1500,
  },
  {
    id: "3v3_boost_distribution",
    label: "Boost Distribution",
    description: "Managing boost pads across three players so nobody ends up stranded empty at a bad moment.",
    queue: "3v3",
    category: "boost",
    recommendedStat: "boostManagement",
    recommendedStatValue: 1300,
  },
  {
    id: "3v3_field_awareness",
    label: "Field Awareness",
    description: "Tracking all five other players' positions at once instead of just watching the ball.",
    queue: "3v3",
    category: "mindset",
    recommendedStat: "gameSense",
    recommendedStatValue: 2400,
    recommendedAfter: ["3v3_third_man"],
  },
  {
    id: "3v3_defensive_shell",
    label: "Defensive Shell",
    description: "Collapsing into a compact defensive shape when badly outnumbered up front instead of chasing individually.",
    queue: "3v3",
    category: "rotation",
    recommendedStat: "defense",
    recommendedStatValue: 2100,
    recommendedAfter: ["3v3_full_rotation"],
  },
  {
    id: "3v3_shadow_reads",
    label: "Shadow Reads",
    description: "Backing off into a shadow at the right distance instead of committing early and getting beaten clean.",
    queue: "3v3",
    category: "rotation",
    recommendedStat: "defense",
    recommendedStatValue: 1400,
  },
  {
    id: "3v3_challenge_timing",
    label: "Challenge Timing",
    description: "Reading exactly when to step up on a 50/50 instead of committing too early or too late.",
    queue: "3v3",
    category: "pressure",
    recommendedStat: "gameSense",
    recommendedStatValue: 2200,
  },
];

const SYNERGY_BONUS_PER_CONCEPT = 15;
const MAX_SYNERGY_BONUS = 30;
const MIN_EFFICIENCY_FLOOR = 25;
const MAX_EFFICIENCY = 150;

export interface ConceptAvailability {
  statReadiness: number;
  synergyBonus: number;
  efficiency: number;
}

export function getConceptAvailability(
  def: QueueConceptDefinition,
  foundationStats: Record<FoundationCategory, number>,
  gameSense: number,
  conceptProgress: Record<string, { currentValue: number }>
): ConceptAvailability {
  const readinessValue = (stat: ReadinessStat) => (stat === "gameSense" ? gameSense : foundationStats[stat]);

  const statReadiness = def.recommendedStat && def.recommendedStatValue
    ? Math.round((readinessValue(def.recommendedStat) / def.recommendedStatValue) * 100)
    : 100;

  const trainedSynergyCount = (def.recommendedAfter ?? []).filter(
    (id) => (conceptProgress[id]?.currentValue ?? 0) > 0
  ).length;
  const synergyBonus = Math.min(MAX_SYNERGY_BONUS, trainedSynergyCount * SYNERGY_BONUS_PER_CONCEPT);

  const baseEfficiency = Math.max(MIN_EFFICIENCY_FLOOR, Math.min(100, statReadiness));
  const efficiency = Math.min(MAX_EFFICIENCY, baseEfficiency + synergyBonus);

  return { statReadiness, synergyBonus, efficiency };
}
