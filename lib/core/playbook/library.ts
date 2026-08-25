// The coach's PERSONAL library (PLAYBOOK_V2_CONVERGED.md §5) — plays that belong
// to the coach, not a team. Cross-team, season-surviving. RLS: owner_user_id =
// auth.uid(). Attaching instantiates an independent team copy (diagram + tags,
// NEVER film — clips stay team-scoped).

import { supabase } from '@/supabase';
import { isFootballSport } from '@/lib/core/upload-meta';
import type { PlayDoc } from './playDoc';

export type LibraryPlay = { id: string; name: string; doc: PlayDoc | null; tags: string[] };

export async function fetchLibraryPlays(userId: string): Promise<LibraryPlay[]> {
  const { data, error } = await supabase
    .from('library_plays')
    .select('id, name, doc, tags')
    .eq('owner_user_id', userId)
    .eq('curated', false)   // curated Vault seeds live only in The Vault, not your library
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

// ── The Vault: the community bank (visibility='community') ──────────────
export type VaultPlay = LibraryPlay & { sport: string; saveCount: number; ownerUserId: string };

export async function fetchVaultPlays(sport?: string): Promise<VaultPlay[]> {
  let q = supabase.from('library_plays').select('id, name, doc, tags, sport, save_count, owner_user_id')
    .eq('visibility', 'community').order('save_count', { ascending: false }).order('name');
  if (sport) q = q.eq('sport', sport);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ id: r.id, name: r.name, doc: (r.doc ?? null) as PlayDoc | null, tags: Array.isArray(r.tags) ? r.tags : [], sport: r.sport, saveCount: r.save_count ?? 0, ownerUserId: r.owner_user_id }));
}

// Am I a super admin? Gates moderation controls (e.g. deleting others' Vault plays).
// RLS still enforces the real rule (library_plays_all: owner OR is_super_admin()).
export async function amISuperAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('am_i_super_admin');
  if (error) return false;
  return data === true;
}

// Remove a play from the Vault. RLS permits only the play's owner or a super admin,
// so a normal user can only ever delete a play they published themselves.
export async function deleteVaultPlay(id: string): Promise<void> {
  const { error } = await supabase.from('library_plays').delete().eq('id', id);
  if (error) throw error;
}

// Copy a community play into MY library (server-side deep copy; bumps save_count).
export async function grabPlay(sourceId: string): Promise<string> {
  const { data, error } = await supabase.rpc('grab_play', { p_source: sourceId });
  if (error) throw error;
  return data as string;
}

export async function setPlayVisibility(id: string, visibility: 'private' | 'community'): Promise<void> {
  const { error } = await supabase.from('library_plays').update({ visibility }).eq('id', id);
  if (error) throw error;
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
    .insert({ owner_user_id: userId, sport: doc.sport, side: doc.side ?? 'offense', name: doc.name ?? 'Untitled play', doc, tags })
    .select('id')
    .single();
  if (error) throw error;
  return (data as any).id as string;
}

export async function updateLibraryPlay(opts: { id: string; doc: PlayDoc; tags: string[] }): Promise<void> {
  const { id, doc, tags } = opts;
  const { error } = await supabase
    .from('library_plays')
    .update({ name: doc.name ?? 'Untitled play', doc, tags })
    .eq('id', id);
  if (error) throw error;
}

// Deleting a library play leaves any attached TEAM copies intact (their
// library_play_id just goes null) — teams keep running what they were given.
export async function deleteLibraryPlay(id: string): Promise<void> {
  const { error } = await supabase.from('library_plays').delete().eq('id', id);
  if (error) throw error;
}

// Push a library edit out to every team copy derived from it: updates the team
// play's current diagram + tags and appends a NEW version. Published installs
// keep their pinned older version (immutability), so history stays intact while
// the live team playbook reflects the edit. Returns how many teams were updated.
export async function propagateToTeams(opts: { libraryPlayId: string; doc: PlayDoc; tags: string[]; userId: string }): Promise<number> {
  const { libraryPlayId, doc, tags, userId } = opts;
  const { data: teamPlays, error } = await supabase
    .from('plays')
    .select('id, latest_version')
    .eq('library_play_id', libraryPlayId);
  if (error) throw error;
  let n = 0;
  for (const tp of (teamPlays ?? []) as any[]) {
    const newV = (tp.latest_version ?? 1) + 1;
    const { error: e1 } = await supabase.from('plays').update({ name: doc.name ?? 'Untitled play', doc, tags, latest_version: newV }).eq('id', tp.id);
    if (e1) throw e1;
    const { error: e2 } = await supabase.from('play_versions').insert({ play_id: tp.id, version: newV, doc, created_by: userId });
    if (e2) throw e2;
    n++;
  }
  return n;
}

// Instantiate a library play onto a team: an independent team `plays` row +
// its first version, carrying provenance (library_play_id). Film is NOT copied.
// RLS: requires is_team_coach(teamId).
export async function attachToTeam(opts: { libraryPlayId: string; doc: PlayDoc; tags: string[]; teamId: string; userId: string }): Promise<string> {
  const { libraryPlayId, doc, tags, teamId, userId } = opts;
  // Guard: a play can only be deployed to a team of the SAME sport — never mix a
  // football play onto a basketball team (or vice versa). teams.sport is a
  // capitalized label ('Football'); doc.sport is lowercase ('football').
  const { data: team, error: te } = await supabase.from('teams').select('sport').eq('id', teamId).single();
  if (te) throw te;
  if (team?.sport) {
    // Football plays deploy to any football-family team (Football / 7-on-7 / Flag);
    // otherwise the sport must match exactly.
    const compatible = doc.sport === 'football'
      ? isFootballSport(team.sport as string)
      : (team.sport as string).toLowerCase() === doc.sport;
    if (!compatible) throw new Error(`This is a ${doc.sport} play — it can’t be added to a ${team.sport} team.`);
  }
  const { data: play, error } = await supabase
    .from('plays')
    .insert({ team_id: teamId, sport: doc.sport, side: doc.side ?? 'offense', name: doc.name ?? 'Untitled play', doc, tags, latest_version: 1, created_by: userId, library_play_id: libraryPlayId })
    .select('id')
    .single();
  if (error) throw error;
  const playId = (play as any).id as string;
  const { error: e2 } = await supabase.from('play_versions').insert({ play_id: playId, version: 1, doc, created_by: userId });
  if (e2) throw e2;
  return playId;
}
