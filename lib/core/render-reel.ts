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
