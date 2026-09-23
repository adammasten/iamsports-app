// WHICH TAGS A TEAM IS OFFERED — the one place the tag-scoping rule lives.
// RN-agnostic. My Tags, the native tagger and the web tagger all call this instead
// of hand-building the same PostgREST filter three times (which is how they drifted
// apart in the first place).
//
// THE RULE
//   global tag:  its sport matches the content's sport (or is NULL = universal)
//                AND its format matches the team's format (or either is NULL)
//   team tag:    belongs to this team. NEVER sport- or format-filtered — a coach's
//                own playbook vocabulary is theirs and does not disappear when the
//                team's format changes.
//
// FORMAT FAILS OPEN. A null/unknown format means "legacy": the full sport
// vocabulary. Vocabulary is never hidden because a lookup failed — the worst case
// is a coach sees a few chips their format wouldn't have offered, which is strictly
// safer than a board that silently loses tags.
//
// NOTE ON CASE: `ilike` with no wildcards is a case-INSENSITIVE exact match.
// teams.sport / videos.sport are free text and have drifted ('Basketball' vs
// 'basketball'); an `eq` filter silently returned zero sport tags for the mis-cased
// ones. Verified against live data: ilike returns identical counts to eq for every
// correctly-cased sport.

export type TagScope = {
  /** Sport of the content being tagged (video sport, falling back to the team's). */
  sport?: string | null;
  /** Team that owns the content — NOT necessarily the user's active team. */
  teamId?: string | null;
  /** That team's format ('5v5' | '7v7' | '11v11'). Null/unknown = full vocabulary. */
  format?: string | null;
};

/**
 * The argument for `supabase.from('tags').or(...)`.
 *
 * With no format set this returns exactly the string these screens used before
 * formats existed, so a null-format team's behavior is byte-identical.
 */
export function buildTagScopeFilter({ sport, teamId, format }: TagScope): string {
  const clauses: string[] = ['scope.eq.global'];
  if (sport) clauses.push(`or(sport.is.null,sport.ilike.${sport})`);
  // Only narrow by format when we actually resolved one (fail open — see header).
  if (format) clauses.push(`or(format.is.null,format.eq.${format})`);

  const globalBranch = clauses.length === 1 ? clauses[0] : `and(${clauses.join(',')})`;
  return teamId
    ? `${globalBranch},and(scope.eq.team,team_id.eq.${teamId})`
    : globalBranch;
}
