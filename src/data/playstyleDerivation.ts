// Playstyle (aggression/rotationDiscipline/mechanicalFlair/consistency) is no longer manually trained -
// it's derived automatically from what the player actually trains, recomputed and written into
// playstyleProfiles at the end of every relevant training action (see useSaveStore.ts's trainSession),
// rather than derived on read. That keeps playstyleProfiles a plain, already-populated field, so the 7
// existing read-sites (TrainingScreen, OrgScreen, RankedScreen, StatsScreen, SocialScreen, TourneysScreen,
// useMatchStore) need zero changes.

import { MECHANICS, type FoundationCategory } from "./mechanics";
import { QUEUE_CONCEPTS } from "./queueConcepts";
import type { QueueMode, PlaystyleProfile } from "./mockSave";

type Progress = Record<string, { currentValue: number; reps: number }>;

// Mechanic branches that read as attacking/flashy vs. defensive, used to lean aggression/mechanicalFlair
// vs. rotationDiscipline toward whichever kind of mechanic the player actually drills.
const ATTACK_BRANCHES = new Set(["Flicks", "Aerial Control", "Pinches", "Kickoff"]);
const DEFENSE_BRANCHES = new Set(["Defensive Mechanics", "Positioning"]);

// Same confidence weighting matchSim.ts's moveMasteryValue/conceptMasteryValue use for in-match move
// picking, kept in sync conceptually: reps use a sub-linear (sqrt) curve distinct from the roughly-linear
// currentValue term, so heavy reps at a middling mastery value still meaningfully shift playstyle.
const CONFIDENCE_WEIGHT_PER_SQRT_REP = 40;

// How much total trained weight it takes to reach roughly half of a trait's training-driven swing -
// keeps early training from swinging playstyle wildly while heavy investment still visibly shifts it.
const PLAYSTYLE_TRAIT_SCALE = 20000;

function trainedWeight(entry?: { currentValue: number; reps: number }): number {
  if (!entry) return 0;
  return entry.currentValue + CONFIDENCE_WEIGHT_PER_SQRT_REP * Math.sqrt(entry.reps);
}

function contribution(weight: number, maxContrib: number): number {
  return (maxContrib * weight) / (weight + PLAYSTYLE_TRAIT_SCALE);
}

export function derivePlaystyleProfile(
  queue: QueueMode,
  mechanicProgress: Progress,
  queueConceptProgress: Progress,
  foundationStats: Record<FoundationCategory, number>,
  mechanicalConsistency: number
): PlaystyleProfile {
  let attackW = 0;
  let defenseW = 0;
  for (const def of MECHANICS) {
    if (ATTACK_BRANCHES.has(def.branch)) attackW += trainedWeight(mechanicProgress[def.id]);
    if (DEFENSE_BRANCHES.has(def.branch)) defenseW += trainedWeight(mechanicProgress[def.id]);
  }

  let pressureW = 0;
  let rotationW = 0;
  for (const def of QUEUE_CONCEPTS) {
    if (def.queue !== queue) continue;
    if (def.category === "pressure") pressureW += trainedWeight(queueConceptProgress[def.id]);
    if (def.category === "rotation") rotationW += trainedWeight(queueConceptProgress[def.id]);
  }

  const offenseLean = foundationStats.offense - foundationStats.defense;
  const clamp = (v: number) => Math.max(5, Math.min(95, Math.round(v)));

  return {
    aggression: clamp(50 + offenseLean / 40 + contribution(attackW, 30) + contribution(pressureW, 20) - contribution(defenseW, 15)),
    rotationDiscipline: clamp(40 + foundationStats.defense / 200 + contribution(rotationW, 30) + contribution(defenseW, 20)),
    mechanicalFlair: clamp(40 + foundationStats.aerialControl / 300 + contribution(attackW, 45)),
    consistency: clamp(30 + mechanicalConsistency / 250),
  };
}

export function derivePlaystyleProfiles(
  mechanicProgress: Progress,
  queueConceptProgress: Progress,
  foundationStats: Record<FoundationCategory, number>,
  mechanicalConsistency: Record<QueueMode, number>
): Record<QueueMode, PlaystyleProfile> {
  return {
    "1v1": derivePlaystyleProfile("1v1", mechanicProgress, queueConceptProgress, foundationStats, mechanicalConsistency["1v1"]),
    "2v2": derivePlaystyleProfile("2v2", mechanicProgress, queueConceptProgress, foundationStats, mechanicalConsistency["2v2"]),
    "3v3": derivePlaystyleProfile("3v3", mechanicProgress, queueConceptProgress, foundationStats, mechanicalConsistency["3v3"]),
  };
}
