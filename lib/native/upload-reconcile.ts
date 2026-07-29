import { supabase } from '@/supabase';
import { getSignedVideoUrl } from './video-url';

// Resolve videos left in 'uploading' by an upload that was killed or backgrounded
// before it could flip itself to 'ready'. Runs once on app open.
//
// COMPLETENESS, not existence: a row flips to 'ready' only when the finalized
// storage object's content-length EQUALS the expected upload_bytes. Supabase
// stages in-progress bytes in storage.s3_multipart_uploads and only writes a
// storage.objects row on finalization, so a partial upload has no object to HEAD
// (404 -> null) — and even if a truncated object somehow existed, the size check
// would reject it. A truncated video is never marked ready.
//
// Rows that aren't complete AND are older than the stale window become 'failed'
// (visible + retryable in Film Room), never a silent orphan (invariant 5).
//
// PHASE 1 ASSUMPTION: uploads are foreground-only (the JS chunked loop) and cannot
// survive an app relaunch, so any 'uploading' row seen at launch is already
// finished-or-dead. The stale window is a safety margin. Phase 3 (background
// uploads) MUST revisit this: a background upload can legitimately still be in
// flight at launch, so "not complete yet" won't mean "dead" — completeness will
// need the native uploader's progress or a multipart-state check, not just age.
const STALE_AFTER_MS = 30 * 60 * 1000; // 30 min

async function headContentLength(url: string): Promise<number | null> {
  try {
    const resp = await fetch(url, { method: 'HEAD' });
    if (!resp.ok) return null;
    const len = resp.headers.get('content-length');
    const n = len ? parseInt(len, 10) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export async function reconcilePendingUploads(): Promise<{ ready: number; failed: number }> {
  // Local session read (no network round trip) — reconciliation is a launch-time
  // housekeeping pass, not an auth check. No session -> nothing to reconcile.
  const { data: { session } } = await supabase.auth.getSession();
  const uid = session?.user?.id;
  if (!uid) return { ready: 0, failed: 0 };

  const { data: rows, error } = await supabase
    .from('videos')
    .select('id, url, upload_bytes, created_at')
    .eq('uploaded_by_user_id', uid)
    .eq('upload_status', 'uploading');
  if (error) {
    console.warn('[upload-reconcile] query failed:', error.message);
    return { ready: 0, failed: 0 };
  }
  if (!rows?.length) return { ready: 0, failed: 0 };

  let ready = 0;
  let failed = 0;
  for (const r of rows) {
    // Verify completeness by size. No expected size (legacy row) -> can't verify,
    // so fall through to the age check rather than guessing 'ready'.
    let complete = false;
    if (r.upload_bytes != null && r.url) {
      const signed = await getSignedVideoUrl(r.url);
      if (signed) {
        const size = await headContentLength(signed);
        complete = size != null && size === Number(r.upload_bytes);
      }
    }

    if (complete) {
      const { error: e } = await supabase.from('videos')
        .update({ upload_status: 'ready' }).eq('id', r.id);
      if (!e) ready++;
      else console.warn('[upload-reconcile] ready flip failed:', e.message);
      continue;
    }

    const ageMs = Date.now() - new Date(r.created_at as string).getTime();
    if (ageMs > STALE_AFTER_MS) {
      const { error: e } = await supabase.from('videos')
        .update({ upload_status: 'failed' }).eq('id', r.id);
      if (!e) failed++;
      else console.warn('[upload-reconcile] failed flip failed:', e.message);
    }
    // Younger than the window and not yet complete: leave 'uploading' for a later pass.
  }

  if (ready || failed) console.log(`[upload-reconcile] ready=${ready} failed=${failed}`);
  return { ready, failed };
}
