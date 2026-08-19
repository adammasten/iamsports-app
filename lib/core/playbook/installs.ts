// Playbook data access — read installs + their plays from Supabase. RN-agnostic
// (uses the shared client), so the viewer works on web and, later, native.
//
// RLS does the security: fetchInstalls only returns PUBLISHED installs for teams
// the caller belongs to; fetchInstallDetail's play_versions read is gated by the
// same install visibility (the read DAG installs → install_plays → play_versions).

import { supabase } from '@/supabase';
import type { PlayDoc } from './playDoc';

export type InstallSummary = {
  id: string;
  title: string;
  note: string | null;
  teamId: string;
  teamName: string | null;
  publishedAt: string | null;
  playCount: number;
};

export type InstallPlay = {
  playId: string;
  version: number;
  sortOrder: number;
  installNote: string | null;   // the per-install caption for this play
  doc: PlayDoc | null;          // null if the version row wasn't readable
};

export type InstallDetail = {
  id: string;
  title: string;
  note: string | null;
  teamName: string | null;
  publishedAt: string | null;
  plays: InstallPlay[];
};

export async function fetchInstalls(teamId?: string): Promise<InstallSummary[]> {
  let q = supabase
    .from('installs')
    .select('id, title, note, team_id, published_at, teams(name), install_plays(count)')
    .eq('status', 'published');
  if (teamId) q = q.eq('team_id', teamId);
  const { data, error } = await q.order('published_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    title: r.title,
    note: r.note,
    teamId: r.team_id,
    teamName: r.teams?.name ?? null,
    publishedAt: r.published_at,
    playCount: r.install_plays?.[0]?.count ?? 0,
  }));
}

// Every play a team runs — the cumulative library across all installs. One row
// per play (installs reference plays, so weeks don't duplicate them). RLS: a
// coach sees all the team's plays; a member sees those in a published install.
export type TeamPlay = { playId: string; name: string; doc: PlayDoc | null; tags: string[] };

export async function fetchTeamPlays(teamId: string): Promise<TeamPlay[]> {
  const { data, error } = await supabase
    .from('plays')
    .select('id, name, doc, tags')
    .eq('team_id', teamId)
    .order('name');
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    playId: r.id,
    name: r.name,
    doc: (r.doc ?? null) as PlayDoc | null,
    tags: Array.isArray(r.tags) ? r.tags : [],
  }));
}

export async function fetchInstallDetail(installId: string): Promise<InstallDetail> {
  const { data: inst, error: e1 } = await supabase
    .from('installs')
    .select('id, title, note, published_at, teams(name)')
    .eq('id', installId)
    .single();
  if (e1) throw e1;

  const { data: rows, error: e2 } = await supabase
    .from('install_plays')
    .select('play_id, play_version, sort_order, note')
    .eq('install_id', installId)
    .order('sort_order');
  if (e2) throw e2;

  const playIds = (rows ?? []).map((r: any) => r.play_id);
  let versions: any[] = [];
  if (playIds.length) {
    const { data: vs, error: e3 } = await supabase
      .from('play_versions')
      .select('play_id, version, doc')
      .in('play_id', playIds);
    if (e3) throw e3;
    versions = vs ?? [];
  }

  const plays: InstallPlay[] = (rows ?? []).map((r: any) => {
    const v = versions.find(x => x.play_id === r.play_id && x.version === r.play_version);
    return {
      playId: r.play_id,
      version: r.play_version,
      sortOrder: r.sort_order,
      installNote: r.note,
      doc: (v?.doc ?? null) as PlayDoc | null,
    };
  });

  const i = inst as any;
  return {
    id: i.id,
    title: i.title,
    note: i.note,
    teamName: i.teams?.name ?? null,
    publishedAt: i.published_at,
    plays,
  };
}
