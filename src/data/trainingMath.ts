// Shared training-gain curve, used by useSaveStore.ts's training actions and by saveManager.ts's save
// migration (which can't import the store module itself without a circular import).

export const BASE_TRAINING_GAIN_PER_HOUR = 55;

export function fatiguePenalty(fatigue: number): number {
  return Math.max(0.5, 1 - fatigue / 200);
}

// Past roughly the SSL-floor Game Sense level, returns get noticeably harder to squeeze out on top of the
// normal curve below — keeping pace once you're already competing near the top costs real, ongoing
// training investment, not just more of the same easy early gains. Foundation stats/mechanic mastery
// rarely if ever reach this range in practice, so this only actually bites for Game Sense/Mechanical
// Consistency at high-SSL-and-up levels, exactly where it's meant to.
export const HIGH_VALUE_STEEPENING_THRESHOLD = 15000;

/** Uncapped stats (game sense, foundation stats, mechanic/concept mastery) all use this same diminishing
 *  curve: big early gains, slow late gains, but never truly capped, and steeper still once a stat is
 *  already deep into SSL-and-up territory (see `HIGH_VALUE_STEEPENING_THRESHOLD`). Scales with hours spent. */
export function diminishingGain(currentValue: number, hours: number, efficiencyPct: number, fatigue: number): number {
  const highValueFactor = 1 + Math.max(0, currentValue - HIGH_VALUE_STEEPENING_THRESHOLD) / HIGH_VALUE_STEEPENING_THRESHOLD;
  const diminishing = 3000 / (3000 + currentValue * highValueFactor);
  const efficiency = efficiencyPct / 100;
  const gain = BASE_TRAINING_GAIN_PER_HOUR * hours * diminishing * efficiency * fatiguePenalty(fatigue);
  return Math.max(3, Math.round(gain));
}

/** Migration-only: estimates a "reps" (training-session count) figure from an existing currentValue, by
 *  inverting diminishingGain's own curve at 100% efficiency/0 fatigue, so a save from before reps existed
 *  doesn't suddenly read its already-trained mechanics as never-drilled. Not used by live training, which
 *  tracks reps directly as sessions happen. */
export function estimateRepsFromValue(currentValue: number): number {
  return Math.round((3000 * currentValue + (currentValue * currentValue) / 2) / (BASE_TRAINING_GAIN_PER_HOUR * 3000));
}
