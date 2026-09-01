// Rough, purely presentational framing for an uncapped stat, not a real percentile calculation yet.
// Placeholder bands until the engine tracks a real population of simulated players to compare against.
export function gameSenseHint(value: number): string {
  if (value >= 8000) return "Elite reads, top-pro territory";
  if (value >= 4000) return "Strong reads for a competitive player";
  if (value >= 1500) return "Solid reads, still developing";
  if (value >= 500) return "Building game sense through reps";
  return "Early reads, mostly mechanical so far";
}
