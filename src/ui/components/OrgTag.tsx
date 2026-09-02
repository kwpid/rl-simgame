/** Renders `[TAG] ` before a name when signed to an org, nothing at all otherwise. Shared by the player's
 *  own name (via their orgContract) and AI opponents (via MatchParticipantStats.orgTag). */
export function OrgTag({ tag }: { tag?: string }) {
  if (!tag) return null;
  return <span className="org-tag">[{tag}]</span>;
}
