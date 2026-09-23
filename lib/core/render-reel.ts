// RN-agnostic reel render engine (iOS + web), extracted so the parent
// "Make a highlight" flow and the coach export can share ONE renderer.
// (app/export.tsx still has its own inline copy for now — migrate it here later.)
import { supabase } from '@/supabase';

const SERVER_URL = 'https://web-production-1bf7f.up.railway.app';

export type RenderClip = { url: string; start_time: number; end_time: number };

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Bare storage object key from a finished-job URL. videos/reels store the object
// KEY (path within the private 'Videos' bucket), not a URL. Mirrors app/export.tsx.
export function deriveStoragePath(url: string): string {
  const marker = '/Videos/';
  const idx = url.indexOf(marker);
  const afterBucket = idx >= 0 ? url.slice(idx + marker.length) : url;
  return afterBucket.split('?')[0];
}

// POST the clips to the Railway render server, then poll until the reel is done.
// Returns the finished reel's (directly downloadable) URL. Throws on failure.
export async function renderReel(
  clips: RenderClip[],
  opts?: { fileName?: string; onProgress?: (pct: number, label?: string) => void },
): Promise<string> {
  if (clips.length === 0) throw new Error('No clips to render.');
  const res = await fetch(`${SERVER_URL}/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clips, outputFileName: opts?.fileName ?? 'iamsports-highlight.mp4' }),
  });
  const data = await res.json().catch(() => ({} as any));
  if (!res.ok || !data.jobId) throw new Error(data.error || 'Could not start the render.');

  // Poll every 3s until done/failed.
  for (;;) {
    await delay(3000);
    const jr = await fetch(`${SERVER_URL}/job/${data.jobId}`);
    const job = await jr.json().catch(() => ({} as any));
    opts?.onProgress?.(job.progress || 0, job.label);
    if (job.status === 'done') return job.url as string;
    if (job.status === 'failed') throw new Error(job.error || 'The render failed.');
  }
}

// ── RESERVE → RENDER → FINALIZE ──────────────────────────────────────────────
// The reel row is created BEFORE the render so the database, not the UI, decides
// whether these clips may be reeled: highlight_reels' WITH CHECK runs
// may_reel_clip() over source_clip_ids and REJECTS the insert otherwise. A render
// that never starts cannot leak a clip a parent was not entitled to.
//
// The row is reserved at status='rendering' with storage_path NULL, so it is never
// mistakable for a finished reel, and reel listings filter to status='ready'.
// Callers MUST finish with finalizeReel() on success or discardReel() on failure.

export class ReelNotAllowedError extends Error {
  constructor(message?: string) {
    super(message ?? 'Some of those clips aren’t available for a highlight.');
    this.name = 'ReelNotAllowedError';
  }
}

// Reserve the reel and authorize its clips. Returns the new reel id.
// Throws ReelNotAllowedError when the server rejects the clip set.
export async function reserveReel(params: {
  clipIds: string[];
  name: string;
  teamId?: string | null;
  durationSeconds?: number | null;
}): Promise<string> {
  const { clipIds, name, teamId, durationSeconds } = params;
  if (clipIds.length === 0) throw new Error('No clips to render.');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('You’re signed out — sign in and try again.');

  const { data: inserted, error } = await supabase.from('highlight_reels').insert({
    created_by_user_id: user.id,
    team_id: teamId || null,
    name,
    storage_path: null,
    source_clip_ids: clipIds,
    duration_seconds: durationSeconds ?? null,
    overlay_mode: 'clean',
    status: 'rendering',
  }).select('id').single();

  // A WITH CHECK violation is how the positive-only rule is enforced. Surface it
  // as a clear product message rather than a raw Postgres error.
  if (error || !inserted?.id) {
    const code = (error as any)?.code;
    if (code === '42501' || /row-level security/i.test(error?.message ?? '')) {
      throw new ReelNotAllowedError();
    }
    throw new Error(error?.message || 'Could not start the reel.');
  }
  return inserted.id;
}

// Mark a reserved reel finished. Guarded on status='rendering' so a retry cannot
// produce a second completed record for the same reservation.
export async function finalizeReel(
  reelId: string,
  fields: { storagePath: string; durationSeconds?: number | null },
): Promise<void> {
  const { error } = await supabase.from('highlight_reels')
    .update({
      storage_path: fields.storagePath,
      duration_seconds: fields.durationSeconds ?? null,
      status: 'ready',
    })
    .eq('id', reelId)
    .eq('status', 'rendering');
  if (error) throw error;
}

// Remove a reservation whose render never produced a file, so the Film Room never
// shows a reel that does not exist. Best-effort: a cleanup failure must not mask
// the original render error (and the status='ready' listing filter hides it anyway).
export async function discardReel(reelId: string): Promise<void> {
  try {
    await supabase.from('highlight_reels').delete().eq('id', reelId).eq('status', 'rendering');
  } catch {
    /* listings filter on status='ready', so a stray reservation stays invisible */
  }
}

// Persist a finished reel as a highlight_reels row (+ copy the source clips' tags
// onto it, best-effort) so it becomes a findable reel in My Work. Returns the new
// reel id, or null if it couldn't be saved.
export async function saveHighlightReel(params: {
  videoUrl: string;
  clips: { id: string; start_time: number; end_time: number; tagIds?: string[] }[];
  name: string;
  teamId?: string | null;
}): Promise<string | null> {
  const { videoUrl, clips, name, teamId } = params;
  if (clips.length === 0) return null;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const durationSeconds = clips.reduce((s, c) => s + Math.max(0, (c.end_time ?? 0) - (c.start_time ?? 0)), 0);
  const { data: inserted, error } = await supabase.from('highlight_reels').insert({
    created_by_user_id: user.id,
    team_id: teamId || null,
    name,
    storage_path: deriveStoragePath(videoUrl),
    source_clip_ids: clips.map((c) => c.id),
    duration_seconds: durationSeconds,
    overlay_mode: 'clean',
    status: 'ready',
  }).select('id').single();
  if (error || !inserted?.id) return null;

  // Auto-attach the source clips' tags onto the reel (best-effort).
  try {
    const tagIds = [...new Set(clips.flatMap((c) => c.tagIds || []))];
    if (tagIds.length > 0) {
      await supabase.from('reel_tags').insert(tagIds.map((tag_id) => ({ reel_id: inserted.id, tag_id })));
    }
  } catch {}
  return inserted.id;
}
