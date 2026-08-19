// Film ↔ play linkage — the moat (PLAYBOOK_V2_CONVERGED.md §6). Connects a
// diagrammed play to the game clips of the team running it. Reuses the existing
// clips + videos + sign-media playback; play_clips is the join, hardened so a
// clip only ever surfaces to members of the FILM's team.

import { supabase } from '@/supabase';
import type { PlayDoc } from './playDoc';

export type PlayFull = { id: string; teamId: string; name: string; doc: PlayDoc | null; tags: string[]; latestVersion: number };

export async function fetchPlay(playId: string): Promise<PlayFull> {
  const { data, error } = await supabase
    .from('plays')
    .select('id, team_id, name, doc, tags, latest_version')
    .eq('id', playId)
    .single();
  if (error) throw error;
  const r = data as any;
  return { id: r.id, teamId: r.team_id, name: r.name, doc: (r.doc ?? null) as PlayDoc | null, tags: Array.isArray(r.tags) ? r.tags : [], latestVersion: r.latest_version ?? 1 };
}

// A clip ready to play: storagePath is the video object key (sign-media signs it).
export type TeamClip = { id: string; title: string; storagePath: string | null; start: number; end: number; note: string | null; createdAt: string };

export async function fetchTeamClips(teamId: string): Promise<TeamClip[]> {
  const { data, error } = await supabase
    .from('clips')
    .select('id, start_time, end_time, note, created_at, videos ( url, label )')
    .eq('team_id', teamId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: any) => {
    const v = Array.isArray(r.videos) ? r.videos[0] : r.videos;
    return { id: r.id, title: (v?.label || r.note || 'Clip') as string, storagePath: v?.url ?? null, start: Number(r.start_time), end: Number(r.end_time), note: r.note ?? null, createdAt: r.created_at };
  });
}

export type LinkType = 'exemplar' | 'execution' | 'mistake';
export const LINK_TYPE_LABEL: Record<LinkType, string> = {
  exemplar: 'How it should look',
  execution: 'Us running it',
  mistake: 'What went wrong',
};

export type PlayClip = { linkId: string; linkType: LinkType; clipId: string; title: string; storagePath: string | null; start: number; end: number };

export async function fetchPlayClips(playId: string): Promise<PlayClip[]> {
  const { data, error } = await supabase
    .from('play_clips')
    .select('id, link_type, clip_id, clips ( start_time, end_time, note, videos ( url, label ) )')
    .eq('play_id', playId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: any) => {
    const c = Array.isArray(r.clips) ? r.clips[0] : r.clips;
    const v = c ? (Array.isArray(c.videos) ? c.videos[0] : c.videos) : null;
    return { linkId: r.id, linkType: r.link_type as LinkType, clipId: r.clip_id, title: (v?.label || c?.note || 'Clip') as string, storagePath: v?.url ?? null, start: Number(c?.start_time ?? 0), end: Number(c?.end_time ?? 0) };
  });
}

export async function linkClip(opts: { playId: string; playVersion: number; clipId: string; teamId: string; linkType: LinkType; userId: string }): Promise<void> {
  const { playId, playVersion, clipId, teamId, linkType, userId } = opts;
  const { error } = await supabase
    .from('play_clips')
    .insert({ play_id: playId, play_version: playVersion, clip_id: clipId, team_id: teamId, link_type: linkType, created_by: userId });
  if (error) throw error;
}

export async function unlinkClip(linkId: string): Promise<void> {
  const { error } = await supabase.from('play_clips').delete().eq('id', linkId);
  if (error) throw error;
}
