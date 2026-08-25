// Paid Tagger workflow — RN-agnostic data layer (iOS + Web).
// The job spine + grants + state machine live in Postgres (migration_tagger_jobs_*);
// these are thin wrappers over the SECURITY DEFINER RPCs. UI stays platform-specific.
import { supabase } from '@/supabase';

export type TaggingJobStatus =
  | 'new' | 'in_progress' | 'review' | 'changes_requested' | 'complete' | 'canceled' | 'declined';

export type JobRole = 'owner' | 'tagger';

export type TaggingJob = {
  id: string; gameId: string; teamId: string; status: TaggingJobStatus;
  role: JobRole; counterpartName: string; gameTitle: string; teamName: string;
  instructions: string | null; dueAt: string | null; requestedAt: string;
  taggerCompletedAt: string | null; finalizedAt: string | null; releasedAt: string | null;
  revisions: number; videoCount: number;
};

export type Tagger = { userId: string; displayName: string; linkedAt: string };
export type JobMessage = { id: string; body: string; authorName: string; isMine: boolean; createdAt: string };
export type GameVideo = { id: string; label: string | null; url: string | null; sortOrder: number | null };
export type CoachGame = { id: string; title: string; date: string | null; teamId: string; teamName: string };

export const STATUS_LABEL: Record<TaggingJobStatus, string> = {
  new: 'New', in_progress: 'In progress', review: 'In review',
  changes_requested: 'Changes requested', complete: 'Complete', canceled: 'Canceled', declined: 'Declined',
};
// A job is "active" on the tagger's queue until it's finalized/canceled/declined or auto-released.
export const ACTIVE_STATUSES: TaggingJobStatus[] = ['new', 'in_progress', 'review', 'changes_requested'];

const mapJob = (r: any): TaggingJob => ({
  id: r.id, gameId: r.game_id, teamId: r.team_id, status: r.status,
  role: r.role, counterpartName: r.counterpart_name, gameTitle: r.game_title, teamName: r.team_name,
  instructions: r.instructions, dueAt: r.due_at, requestedAt: r.requested_at,
  taggerCompletedAt: r.tagger_completed_at, finalizedAt: r.finalized_at, releasedAt: r.released_at,
  revisions: r.revisions ?? 0, videoCount: r.video_count ?? 0,
});

export async function listMyTaggingJobs(): Promise<TaggingJob[]> {
  const { data, error } = await supabase.rpc('list_my_tagging_jobs');
  if (error) throw error;
  return (data ?? []).map(mapJob);
}

// ── Owner identity + "My Taggers" address book ──────────────────────────────
export async function getMyTaggerCode(): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_my_tagger_code');
  if (error) throw error;
  return (data as string) ?? null;
}
export async function generateTaggerCode(): Promise<string> {
  const { data, error } = await supabase.rpc('generate_tagger_code');
  if (error) throw error;
  return data as string;
}
export async function listMyTaggers(): Promise<Tagger[]> {
  const { data, error } = await supabase.rpc('list_my_taggers');
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ userId: r.tagger_user_id, displayName: r.display_name, linkedAt: r.linked_at }));
}
export async function addTaggerByCode(code: string): Promise<{ taggerUserId: string; displayName: string }> {
  const { data, error } = await supabase.rpc('redeem_tagger_code', { p_code: code.trim() });
  if (error) throw error;
  return { taggerUserId: (data as any).tagger_user_id, displayName: (data as any).display_name };
}
export async function removeTagger(taggerUserId: string): Promise<void> {
  const { error } = await supabase.from('tagger_links').delete().eq('tagger_user_id', taggerUserId);
  if (error) throw error;
}

// ── Create + lifecycle transitions ──────────────────────────────────────────
export async function createTaggingJob(opts: {
  gameId: string; taggerUserId: string; dueAt?: string | null; instructions?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc('create_tagging_job', {
    p_game_id: opts.gameId, p_tagger_user_id: opts.taggerUserId,
    p_due_at: opts.dueAt ?? null, p_instructions: opts.instructions ?? null,
  });
  if (error) throw error;
  return data as string;
}

async function callVoid(fn: string, jobId: string) {
  const { error } = await supabase.rpc(fn, { p_job: jobId });
  if (error) throw error;
}
export const startJob       = (id: string) => callVoid('tagger_start_job', id);
export const declineJob     = (id: string) => callVoid('tagger_decline_job', id);
export const completeJob     = (id: string) => callVoid('tagger_complete_job', id);
export const requestChanges = (id: string) => callVoid('owner_request_changes', id);
export const finalizeJob    = (id: string) => callVoid('owner_finalize_job', id);
export const cancelJob      = (id: string) => callVoid('cancel_tagging_job', id);

// ── Thread ──────────────────────────────────────────────────────────────────
export async function listJobMessages(jobId: string): Promise<JobMessage[]> {
  const { data, error } = await supabase.rpc('list_job_messages', { p_job: jobId });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ id: r.id, body: r.body, authorName: r.author_name, isMine: r.is_mine, createdAt: r.created_at }));
}
export async function postJobMessage(jobId: string, body: string): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) throw new Error('Not signed in');
  const { error } = await supabase.from('tagging_job_messages').insert({ job_id: jobId, author_user_id: uid, body: body.trim() });
  if (error) throw error;
}

// ── For "Start tagging" (the game's videos) + the owner's game picker ────────
export async function listGameVideos(gameId: string): Promise<GameVideo[]> {
  const { data, error } = await supabase.from('videos').select('id, label, url, sort_order')
    .eq('game_id', gameId).order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ id: r.id, label: r.label, url: r.url, sortOrder: r.sort_order }));
}
export async function listCoachGames(teamIds: string[]): Promise<CoachGame[]> {
  if (!teamIds.length) return [];
  const { data, error } = await supabase.from('games').select('id, title, game_date, team_id, teams(name)')
    .in('team_id', teamIds).order('game_date', { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ id: r.id, title: r.title, date: r.game_date, teamId: r.team_id, teamName: r.teams?.name ?? '' }));
}
