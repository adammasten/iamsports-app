import { supabase } from '@/supabase';
import { filterModerated, loadModeration } from './moderation';

// ============================================================
// Feed logic (RN-agnostic: Supabase + plain JS → lib/core). Two surfaces:
//   • loadContentFeed() → HOME (app/select-team.tsx): newest videos + reels
//                          across ALL my teams + kids (the "everything going on"
//                          content feed). Defined at the bottom of this file.
//   • loadTeamWall()    → TEAM PAGE (app/(tabs)/index.tsx): ONLY that one team's
//                          own wall (team-audience shares for that team_id).
// loadTeamWall uses resolveAndDedup() below.
// ============================================================

// Generous per-query row cap. Real users have far fewer feed items than this; the
// explicit high limit just guarantees the newest-first window is large enough that
// rows collapsed later (dupes) can't crowd genuine content out of it.
export const FEED_FETCH_LIMIT = 500;

const SELECT = 'id, content_type, content_id, audience, team_id, target_player_id, shared_by_user_id, created_at, note, teams ( name )';

// One card per piece of content (a game/reel), deduped across every wall it's
// posted to. `sources` collects the wall labels it lives on ("Warriors", "Family")
// so the card can show "Team · Family". `shareId` is one representative share (any
// works — they resolve to the same content); `key` doubles as the FilterBar item id.
export type WallPost = {
  key: string; shareId: string; contentType: string; contentId: string; createdAt: string;
  title: string; storagePath: string | null;
  startTime: number | null; endTime: number | null;
  sources: string[]; teamId: string; teamName: string;
  // Who posted it — drives the block filter + the "Block this person" action.
  sharedByUserId: string | null;
  note: string | null; // the sharer's per-share note (RLS-scoped to this audience)
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
      sharedByUserId: (r.shared_by_user_id as string) ?? null,
      note: (r.note as string) ?? null,
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
        sharedByUserId: r.sharedByUserId,
        note: r.note,
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
    .eq('visible', true) // moderation takedown
    .order('created_at', { ascending: false })
    .limit(FEED_FETCH_LIMIT);

  const resolved = await resolveAndDedup(data || []);
  const posts = filterModerated(resolved, await loadModeration());
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

// ============================================================
// HOME CONTENT FEED — the social-style "everything going on" list: newest raw
// VIDEOS + finished REELS across every team you're on and every kid you're
// linked to, regardless of who uploaded them. This is the "see it all without
// clicking team-by-team" surface (app/select-team.tsx) — the HOME feed. (It
// replaced an older shares/wall merged feed, since removed.)
//
// Access is still enforced by RLS on each table (videos_read / highlight_reels_
// read): a team MEMBER sees the team's footage; a pure parent who is NOT a team
// member is limited until the Door-2 read authorizers extend parent read access.
// We surface any query error rather than silently showing an empty feed.
// ============================================================
// ONE card per piece of content. A game's quarters collapse into a single
// 'game' item (dedup); loose uploads and reels stay individual. `kidPlayerIds`
// is which of MY kids this belongs to — via videos.player_id attribution AND/OR
// a player-audience share to that kid's wall — so the Player filter can match it.
export type FeedItem = {
  key: string;              // dedup + list key: 'game:<id>' | 'video:<id>' | 'reel:<id>'
  kind: 'game' | 'video' | 'reel';
  contentId: string;        // game_id / video_id / reel_id
  title: string;
  teamId: string;
  createdAt: string;
  storagePath: string | null;    // playback key (a game's newest video / video url / reel path)
  durationSeconds: number | null;
  kidPlayerIds: string[];
  eventType: string | null;
  seasonId: string | null; seasonName: string | null;
  tournamentId: string | null; tournamentName: string | null;
};
export type ContentFeedDebug = {
  videoRows: number; videoErr: string | null;
  reelRows: number;  reelErr: string | null;
  kidShareRows: number; kidShareErr: string | null;
  items: number;
};

export async function loadContentFeed(
  userId: string,
  userTeams: TeamRef[],
  userKids: KidRef[],
): Promise<{ items: FeedItem[]; debug: ContentFeedDebug }> {
  const myTeamIds = [...new Set(userTeams.map(t => t.team_id))];
  const myKidIds  = [...new Set(userKids.map(k => k.player_id))];

  // 1) Which of MY kids' WALLS each piece of content is ON — i.e. player-audience
  //    shares a guardian has PUT on the wall (on_wall=true, the approval step).
  //    Content merely shared *with* the kid still sitting in "Shared with you"
  //    (on_wall=false) is NOT on the wall, so it's excluded. Family-wide: any
  //    guardian's wall placement counts (no shared_by filter). Mirrors kid.tsx's
  //    loadWall. Keyed 'game:<id>' / 'reel:<id>' / 'video:<id>' → set of kid ids.
  const kidWalls = new Map<string, Set<string>>();
  let kidShareRows = 0;
  let kidShareErr: string | null = null;
  if (myKidIds.length) {
    const { data, error } = await supabase
      .from('shares')
      .select('content_type, content_id, target_player_id')
      .eq('audience', 'player')
      .eq('visible', true)
      .eq('on_wall', true)
      .in('target_player_id', myKidIds);
    kidShareErr = error?.message ?? null;
    kidShareRows = (data || []).length;
    for (const s of (data || []) as any[]) {
      const key = `${s.content_type}:${s.content_id}`;
      if (!kidWalls.has(key)) kidWalls.set(key, new Set());
      kidWalls.get(key)!.add(s.target_player_id);
    }
  }
  const wallKids = (key: string): string[] => [...(kidWalls.get(key) ?? [])];

  // 2) VIDEOS — team footage OR kid-attached footage. Collapse a game's quarters
  //    into ONE 'game' item; game-less "loose" uploads stay individual.
  let videoErr: string | null = null;
  const gameItems = new Map<string, FeedItem>();
  const looseItems: FeedItem[] = [];
  const vParts: string[] = [];
  if (myTeamIds.length) vParts.push(`team_id.in.(${myTeamIds.join(',')})`);
  if (myKidIds.length)  vParts.push(`player_id.in.(${myKidIds.join(',')})`);
  if (vParts.length) {
    const { data, error } = await supabase
      .from('videos')
      .select('id, label, url, created_at, event_type, team_id, player_id, game_id, upload_status, games ( title, team_id, season_id, tournament_id, seasons ( name ), tournaments ( name ) )')
      .or(vParts.join(','))
      .order('created_at', { ascending: false })
      .limit(FEED_FETCH_LIMIT);
    videoErr = error?.message ?? null;
    for (const v of (data || []) as any[]) {
      // Only finalized videos belong in the feed — an 'uploading'/'failed' row has
      // no playable object (would 404 at sign-media). Rows are newest-first, so a
      // game item takes its newest READY quarter; a game with no ready video drops out.
      if (v.upload_status !== 'ready') continue;
      const teamId = (v.team_id as string) ?? (v.games?.team_id as string) ?? '';
      if (v.game_id) {
        const key = `game:${v.game_id}`;
        const existing = gameItems.get(key);
        if (!existing) {
          gameItems.set(key, {
            key, kind: 'game', contentId: v.game_id,
            title: v.games?.title ?? v.label ?? 'Game',
            teamId, createdAt: v.created_at,
            storagePath: v.url ?? null,   // rows are newest-first → this is the newest quarter
            durationSeconds: null,
            kidPlayerIds: [...new Set([...(v.player_id ? [v.player_id] : []), ...wallKids(key)])],
            eventType: v.event_type ?? null,
            seasonId: v.games?.season_id ?? null,
            seasonName: v.games?.seasons?.name ?? null,
            tournamentId: v.games?.tournament_id ?? null,
            tournamentName: v.games?.tournaments?.name ?? null,
          });
        } else if (v.player_id && !existing.kidPlayerIds.includes(v.player_id)) {
          existing.kidPlayerIds.push(v.player_id);   // another quarter attributed to a kid
        }
      } else {
        const key = `video:${v.id}`;
        looseItems.push({
          key, kind: 'video', contentId: v.id,
          title: v.label ?? 'Video',
          teamId, createdAt: v.created_at,
          storagePath: v.url ?? null,
          durationSeconds: null,
          kidPlayerIds: [...new Set([...(v.player_id ? [v.player_id] : []), ...wallKids(key)])],
          eventType: v.event_type ?? null,
          seasonId: null, seasonName: null, tournamentId: null, tournamentName: null,
        });
      }
    }
  }

  // 3) REELS — team reels OR reels I created.
  let reelErr: string | null = null;
  const reelItems: FeedItem[] = [];
  const rParts: string[] = [`created_by_user_id.eq.${userId}`];
  if (myTeamIds.length) rParts.push(`team_id.in.(${myTeamIds.join(',')})`);
  {
    const { data, error } = await supabase
      .from('highlight_reels')
      .select('id, name, storage_path, duration_seconds, created_at, team_id')
      .or(rParts.join(','))
      .order('created_at', { ascending: false })
      .limit(FEED_FETCH_LIMIT);
    reelErr = error?.message ?? null;
    for (const r of (data || []) as any[]) {
      const key = `reel:${r.id}`;
      reelItems.push({
        key, kind: 'reel', contentId: r.id,
        title: r.name,
        teamId: (r.team_id as string) ?? '',
        createdAt: r.created_at,
        storagePath: r.storage_path ?? null,
        durationSeconds: r.duration_seconds != null ? Number(r.duration_seconds) : null,
        kidPlayerIds: wallKids(key),
        eventType: null, seasonId: null, seasonName: null, tournamentId: null, tournamentName: null,
      });
    }
  }

  // 4) Merge + newest-first. Dedup is inherent: a game's quarters collapse to one
  //    'game:<id>' item, whether they arrived as team footage or a kid-wall share.
  const items = [...gameItems.values(), ...looseItems, ...reelItems]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return {
    items,
    debug: {
      videoRows: gameItems.size + looseItems.length, videoErr,
      reelRows: reelItems.length, reelErr,
      kidShareRows, kidShareErr,
      items: items.length,
    },
  };
}
