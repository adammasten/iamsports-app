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

// Teams the user can author plays for (coach/admin/head_coach). Used by the
// editor's team picker. RLS on plays enforces is_team_coach on save regardless.
export type CoachTeam = { id: string; name: string };

export async function fetchCoachTeams(userId: string): Promise<CoachTeam[]> {
  const { data, error } = await supabase
    .from('team_memberships')
    .select('team_id, role, teams(name)')
    .eq('user_id', userId)
    .eq('status', 'confirmed')
    .in('role', ['admin', 'head_coach', 'coach']);
  if (error) throw error;
  const seen = new Map<string, string>();
  (data ?? []).forEach((r: any) => { if (r.team_id && !seen.has(r.team_id)) seen.set(r.team_id, r.teams?.name ?? 'Team'); });
  return Array.from(seen, ([id, name]) => ({ id, name }));
}

// Create a new play: inserts the play row + its first append-only version.
// RLS: both inserts require is_team_coach(teamId).
export async function savePlay(opts: { teamId: string; doc: PlayDoc; tags: string[]; userId: string }): Promise<string> {
  const { teamId, doc, tags, userId } = opts;
  const { data: play, error } = await supabase
    .from('plays')
    .insert({ team_id: teamId, sport: doc.sport, side: doc.side ?? 'offense', name: doc.name ?? 'Untitled play', doc, latest_version: 1, created_by: userId, tags })
    .select('id')
    .single();
  if (error) throw error;
  const playId = (play as any).id as string;
  const { error: e2 } = await supabase
    .from('play_versions')
    .insert({ play_id: playId, version: 1, doc, created_by: userId });
  if (e2) throw e2;
  return playId;
}

// Log that the caller opened this install (binary event — NO duration, ever).
// Fire-and-forget: a receipt failure must never block viewing.
export async function logInstallView(installId: string, userId: string): Promise<void> {
  try {
    await supabase.from('install_receipts').insert({ install_id: installId, user_id: userId, event_type: 'install_viewed' });
  } catch { /* ignore */ }
}

// Who has opened this install. RLS scopes it: a COACH sees every viewer; a parent
// sees only themselves / their child. Binary "opened", deduped to latest per user.
export type Receipt = { userId: string; name: string; lastViewed: string };

export async function fetchInstallReceipts(installId: string): Promise<Receipt[]> {
  const { data, error } = await supabase
    .from('install_receipts')
    .select('user_id, created_at')
    .eq('install_id', installId)
    .eq('event_type', 'install_viewed')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const latest = new Map<string, string>();
  (data ?? []).forEach((r: any) => { if (!latest.has(r.user_id)) latest.set(r.user_id, r.created_at); });
  const ids = Array.from(latest.keys());
  if (!ids.length) return [];
  const { data: profs } = await supabase.from('user_profiles').select('user_id, display_name').in('user_id', ids);
  const nameById = new Map<string, string>((profs ?? []).map((p: any) => [p.user_id, p.display_name || 'A member']));
  return ids.map(id => ({ userId: id, name: nameById.get(id) ?? 'A member', lastViewed: latest.get(id)! }));
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
