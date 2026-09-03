/** Renders `[LFT] ` before a name when currently posting a Looking For Team listing, nothing otherwise.
 *  Shared by the player's own name (via useSaveStore's postingLft) and AI opponents (via
 *  MatchParticipantStats.isLft) — grey, not the org tag's accent color, see tokens.css's `.lft-tag`. */
export function LftTag({ active }: { active?: boolean }) {
  if (!active) return null;
  return <span className="lft-tag">[LFT]</span>;
}
