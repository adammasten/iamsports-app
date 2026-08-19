// The coach's PERSONAL library (PLAYBOOK_V2_CONVERGED.md §5) — plays that belong
// to the coach, not a team. Cross-team, season-surviving. RLS: owner_user_id =
// auth.uid(). Attaching instantiates an independent team copy (diagram + tags,
// NEVER film — clips stay team-scoped).

import { supabase } from '@/supabase';
import type { PlayDoc } from './playDoc';

export type LibraryPlay = { id: string; name: string; doc: PlayDoc | null; tags: string[] };

export async function fetchLibraryPlays(userId: string): Promise<LibraryPlay[]> {
  const { data, error } = await supabase
    .from('library_plays')
    .select('id, name, doc, tags')
    .eq('owner_user_id', userId)
    .order('name');
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ id: r.id, name: r.name, doc: (r.doc ?? null) as PlayDoc | null, tags: Array.isArray(r.tags) ? r.tags : [] }));
}

// Distinct tags the coach has already used across their library — so custom tags
// they invented once resurface in the tag picker forever after.
export async function fetchCoachTags(userId: string): Promise<string[]> {
  const { data, error } = await supabase.from('library_plays').select('tags').eq('owner_user_id', userId);
  if (error) throw error;
  const set = new Set<string>();
  (data ?? []).forEach((r: any) => (Array.isArray(r.tags) ? r.tags : []).forEach((t: string) => set.add(t)));
  return Array.from(set).sort();
}

export async function fetchLibraryPlay(id: string): Promise<LibraryPlay> {
  const { data, error } = await supabase.from('library_plays').select('id, name, doc, tags').eq('id', id).single();
  if (error) throw error;
  const r = data as any;
  return { id: r.id, name: r.name, doc: (r.doc ?? null) as PlayDoc | null, tags: Array.isArray(r.tags) ? r.tags : [] };
}

export async function saveLibraryPlay(opts: { doc: PlayDoc; tags: string[]; userId: string }): Promise<string> {
  const { doc, tags, userId } = opts;
  const { data, error } = await supabase
    .from('library_plays')
    .insert({ owner_user_id: userId, sport: 'basketball', name: doc.name ?? 'Untitled play', doc, tags })
    .select('id')
    .single();
  if (error) throw error;
  return (data as any).id as string;
}

// Instantiate a library play onto a team: an independent team `plays` row +
// its first version, carrying provenance (library_play_id). Film is NOT copied.
// RLS: requires is_team_coach(teamId).
export async function attachToTeam(opts: { libraryPlayId: string; doc: PlayDoc; tags: string[]; teamId: string; userId: string }): Promise<string> {
  const { libraryPlayId, doc, tags, teamId, userId } = opts;
  const { data: play, error } = await supabase
    .from('plays')
    .insert({ team_id: teamId, sport: 'basketball', name: doc.name ?? 'Untitled play', doc, tags, latest_version: 1, created_by: userId, library_play_id: libraryPlayId })
    .select('id')
    .single();
  if (error) throw error;
  const playId = (play as any).id as string;
  const { error: e2 } = await supabase.from('play_versions').insert({ play_id: playId, version: 1, doc, created_by: userId });
  if (e2) throw e2;
  return playId;
}
