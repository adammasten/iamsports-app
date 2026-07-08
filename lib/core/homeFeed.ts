import { supabase } from '@/supabase';

// ============================================================
// Feed logic — the SINGLE source of truth for both feed surfaces. There are
// intentionally NO other copies of this query/dedup logic:
//   • loadMergedFeed()  → HOME (app/select-team.tsx): everything I'm attached to
//                          and allowed to see — ALL my teams + ALL my kids.
//   • loadTeamWall()    → TEAM PAGE (app/(tabs)/index.tsx): ONLY that one team's
//                          own wall (team-audience shares for that team_id).
// Both share resolveAndDedup(). RN-agnostic (Supabase + plain JS) → lib/core.
// ============================================================

// Generous per-query row cap. Real users have far fewer feed items than this; the
// explicit high limit just guarantees the newest-first window is large enough that
// rows collapsed later (dupes) can't crowd genuine content out of it.
export const FEED_FETCH_LIMIT = 500;

const SELECT = 'id, content_type, content_id, audience, team_id, target_player_id, created_at, teams ( name )';

// One card per piece of content (a game/reel), deduped across every wall it's
// posted to. `sources` collects the wall labels it lives on ("Warriors", "Family")
// so the card can show "Team · Family". `shareId` is one representative share (any
// works — they resolve to the same content); `key` doubles as the FilterBar item id.
export type WallPost = {
  key: string; shareId: string; contentType: string; contentId: string; createdAt: string;
  title: string; storagePath: string | null;
  startTime: number | null; endTime: number | null;
  sources: string[]; teamId: string; teamName: string;
};

// Per-stage counts + the (otherwise-swallowed) Postgres errors, so a blank feed
// can be read as "errored" vs "genuinely empty" on-screen instead of guessing.
export type FeedDebug = {
  q1Rows: number; q1Err: string | null;
  q2Rows: number; q2Err: string | null;
  ptErr: string | null; final: number;
};

// Minimal shapes the merge needs from context — kept local so this module stays
// context-agnostic (callers pass plain arrays of ids).
type TeamRef = { team_id: string };
type KidRef = { player_id: string };

// Resolve each share row → its content, then dedup by (content_type, content_id).
// Rows MUST already be sorted newest-first (the first sighting of a content id is
// its newest share and becomes the representative; later sightings just merge
// their source label on). Shared by both feed surfaces.
async function resolveAndDedup(rows: any[]): Promise<WallPost[]> {
  // Resolve kid NAMES for any player-audience (family-wall) shares, so the source
  // label shows WHICH kid's wall the item came from (e.g. "Lars") instead of a
  // generic "Family". One batched query, no N+1. Names are subject to players_read
  // RLS, so a kid I can't see resolves to nothing → falls back to "Family".
  const playerIds = [...new Set(rows.map((r: any) => r.target_player_id).filter(Boolean))];
  const playerNames = new Map<string, string>();
  if (playerIds.length > 0) {
    const { data } = await supabase.from('players').select('id, name').in('id', playerIds);
    (data || []).forEach((p: any) => playerNames.set(p.id, p.name));
  }

  const resolved = await Promise.all(rows.map(async (r: any) => {
    const { data: res } = await supabase.rpc('resolve_shared_content', { p_share_id: r.id });
    const c = Array.isArray(res) ? res[0] : null;
    return {
      shareId: r.id, contentType: r.content_type, contentId: r.content_id, createdAt: r.created_at,
      title: c?.title ?? (r.content_type === 'game' ? 'Shared game' : '(content unavailable)'),
      storagePath: c?.storage_path ?? null,
      startTime: c?.start_time ?? null, endTime: c?.end_time ?? null,
      teamId: (r.team_id as string) ?? '',
      teamName: r.team_id ? (r.teams?.name ?? 'Team') : '',
      // The wall label this share lives on: the team name for a team wall, or the
      // KID'S NAME for a family/player wall (falls back to "Family" if the kid
      // isn't resolvable — e.g. RLS-hidden).
      sourceLabel: r.team_id
        ? (r.teams?.name ?? 'Team')
        : (playerNames.get(r.target_player_id) ?? 'Family'),
    };
  }));

  const byKey = new Map<string, WallPost>();
  for (const r of resolved) {
    const key = `${r.contentType}:${r.contentId}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        key, shareId: r.shareId, contentType: r.contentType, contentId: r.contentId,
        createdAt: r.createdAt, title: r.title, storagePath: r.storagePath,
        startTime: r.startTime, endTime: r.endTime,
        teamId: r.teamId, teamName: r.teamName, sources: [r.sourceLabel],
      });
    } else {
      if (!existing.sources.includes(r.sourceLabel)) existing.sources.push(r.sourceLabel);
      // If the representative had no team (kid-only) but this share does, adopt
      // it so the Team filter can still catch this content.
      if (!existing.teamId && r.teamId) { existing.teamId = r.teamId; existing.teamName = r.teamName; }
    }
  }
  return [...byKey.values()];
}

// HOME feed — the merged "everything I'm attached to and allowed to see" list,
// scoped to ALL my teams + ALL my kids. No single team selected.
export async function loadMergedFeed(
  userTeams: TeamRef[],
  userKids: KidRef[],
): Promise<{ posts: WallPost[]; debug: FeedDebug }> {
  // My access scope for PUBLIC content. RLS makes public shares world-readable,
  // so the "only teams/players I can access" gate must be applied HERE in the
  // query, not by RLS. My teams come from userTeams; the players I can access
  // are my linked kids PLUS every player on my teams (teammates' kids).
  const myTeamIds = userTeams.map(t => t.team_id);
  let accessiblePlayerIds = userKids.map(k => k.player_id);
  let ptErr: string | null = null;
  if (myTeamIds.length > 0) {
    const { data: pt, error: ptE } = await supabase.from('player_teams').select('player_id').in('team_id', myTeamIds);
    ptErr = ptE?.message ?? null;
    accessiblePlayerIds = [...new Set([...accessiblePlayerIds, ...(pt || []).map((r: any) => r.player_id)])];
  }

  // 1) Team + kid walls I'm entitled to — RLS scopes these (member / parent).
  //    The audience filter MUST stay in the query: without it RLS would return
  //    the whole platform's public content (public is world-readable). Coaches
  //    audience is NEVER queried → stays exclusive to Coaches' Corner.
  const { data: teamPlayerRows, error: q1Err } = await supabase
    .from('shares').select(SELECT)
    .in('audience', ['team', 'player'])
    .order('created_at', { ascending: false })
    .limit(FEED_FETCH_LIMIT);

  // 2) Public content, but ONLY on teams/players I can access. Skip entirely if
  //    I have neither team nor accessible player (nothing to scope to).
  let publicRows: any[] = [];
  let q2Err: string | null = null;
  const publicScope: string[] = [];
  if (myTeamIds.length > 0) publicScope.push(`team_id.in.(${myTeamIds.join(',')})`);
  if (accessiblePlayerIds.length > 0) publicScope.push(`target_player_id.in.(${accessiblePlayerIds.join(',')})`);
  if (publicScope.length > 0) {
    const { data, error: q2E } = await supabase
      .from('shares').select(SELECT)
      .eq('audience', 'public').eq('visible', true)
      .or(publicScope.join(','))
      .order('created_at', { ascending: false })
      .limit(FEED_FETCH_LIMIT);
    q2Err = q2E?.message ?? null;
    publicRows = data || [];
  }

  // Merge both sets, exclude coaches AFTER the fetch (defensive — the queries
  // above never fetch it, but this guarantees Coaches' Corner content can never
  // reach the feed even if a query later broadens), then sort newest-first.
  const rows = [...(teamPlayerRows || []), ...publicRows]
    .filter((r: any) => r.audience !== 'coaches')
    .sort((a: any, b: any) => (a.created_at < b.created_at ? 1 : -1));

  const posts = await resolveAndDedup(rows);
  return {
    posts,
    debug: {
      q1Rows: (teamPlayerRows || []).length, q1Err: q1Err?.message ?? null,
      q2Rows: publicRows.length, q2Err,
      ptErr, final: posts.length,
    },
  };
}

// TEAM PAGE feed — STRICTLY this one team's own wall: team-audience shares posted
// to this team_id. No public, no player/family, no other teams, no merge. This is
// the pre-merge team-wall scope, restored so a team page shows only its own stuff.
export async function loadTeamWall(
  teamId: string,
): Promise<{ posts: WallPost[]; debug: FeedDebug }> {
  const { data, error } = await supabase
    .from('shares').select(SELECT)
    .eq('team_id', teamId)
    .eq('audience', 'team')
    .order('created_at', { ascending: false })
    .limit(FEED_FETCH_LIMIT);

  const posts = await resolveAndDedup(data || []);
  return {
    posts,
    // Reuse the FeedDebug shape; a team wall has no public/player-scope stage, so
    // q2/pt stay zero/null. q1Rows is this team's wall row count.
    debug: {
      q1Rows: (data || []).length, q1Err: error?.message ?? null,
      q2Rows: 0, q2Err: null, ptErr: null, final: posts.length,
    },
  };
}
