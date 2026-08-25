// Shared video-metadata logic used by BOTH the upload flow and the "Edit details"
// flow, so the two can never diverge. A `games` row is a generic EVENT CONTAINER
// (no type of its own) — the kind of event (game/practice/scrimmage/skills/…) lives
// on the VIDEO's event_type, which is fully editable after upload.
import { supabase } from '@/supabase';
import { gameTitle, type EventTypeKey } from '@/lib/core/upload-meta';

export type VideoMeta = {
  id: string;
  label: string;
  eventType: EventTypeKey;
  eventDate: string | null;        // YYYY-MM-DD
  teamId: string | null;
  gameId: string | null;
  playerId: string | null;
  sport: string | null;
  visibility: string;
  uploadedByUserId: string | null;
};

export async function loadVideoMeta(videoId: string): Promise<VideoMeta> {
  const { data, error } = await supabase
    .from('videos')
    .select('id, label, event_type, event_date, team_id, game_id, player_id, sport, visibility, uploaded_by_user_id')
    .eq('id', videoId)
    .single();
  if (error) throw error;
  const r = data as any;
  return {
    id: r.id, label: r.label ?? '', eventType: (r.event_type ?? 'game') as EventTypeKey,
    eventDate: r.event_date, teamId: r.team_id, gameId: r.game_id, playerId: r.player_id,
    sport: r.sport, visibility: r.visibility, uploadedByUserId: r.uploaded_by_user_id,
  };
}

// Is this video posted to a wall (a direct video share exists)? Used to block a
// team move on published content — you unpost first, then move it.
export async function isVideoPosted(videoId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from('shares')
    .select('id', { count: 'exact', head: true })
    .eq('content_type', 'video')
    .eq('content_id', videoId);
  if (error) return false;
  return (count ?? 0) > 0;
}

// Create the team EVENT CONTAINER (games row) for this date and return its id.
// Mirrors upload's game insert exactly (coach-gated by games_insert RLS).
async function createEventContainer(teamId: string, eventType: EventTypeKey, eventDate: string): Promise<string> {
  const d = new Date(eventDate + 'T00:00:00');
  const { data, error } = await supabase
    .from('games')
    .insert({ team_id: teamId, title: gameTitle('', 'vs', eventType, d), game_date: eventDate })
    .select('id')
    .single();
  if (error) throw error;
  return (data as any).id as string;
}

// Save all editable video metadata in ONE video update (plus, when attaching to a
// team, one event-container insert first). Attach/detach is driven by teamId vs
// prevTeamId so we never touch team_id/game_id/visibility unless the team changed.
export async function saveVideoMeta(opts: {
  videoId: string;
  label: string;
  eventType: EventTypeKey;
  eventDate: string;               // YYYY-MM-DD
  teamId: string | null;           // '' / null = personal
  playerId: string | null;
  sport: string | null;
  prevTeamId: string | null;
}): Promise<void> {
  const { videoId, label, eventType, eventDate, teamId, playerId, sport, prevTeamId } = opts;
  const patch: Record<string, any> = {
    label: label.trim() || null,
    event_type: eventType,
    event_date: eventDate,
    player_id: playerId || null,
    sport: sport || null,
  };

  if (teamId && teamId !== prevTeamId) {
    // Attaching to a (different) team → create its event container, link, team-gate it.
    const gameId = await createEventContainer(teamId, eventType, eventDate);
    patch.team_id = teamId;
    patch.game_id = gameId;
    patch.sort_order = 0;
    patch.visibility = 'team';       // subject to the team-membership gate; NOT auto-posted
  } else if (!teamId && prevTeamId) {
    // Detaching → back to personal / loose footage. Any now-empty game is left in
    // place for v1 (no cascade delete).
    patch.team_id = null;
    patch.game_id = null;
    patch.visibility = 'private_to_creator';
  }
  // else: team unchanged → metadata-only update.

  const { error } = await supabase.from('videos').update(patch).eq('id', videoId);
  if (error) throw error;
}
