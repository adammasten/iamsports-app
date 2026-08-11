// Auto-optimize-on-upload. iPhone games are big non-faststart .mov files (the index
// atom is at the END), so a raw multi-GB upload WON'T stream — the player can't reach
// the index to start (this is the "crossed-out play" a coach would hit at launch).
//
// After a video's bytes finish uploading, we fire this at the Railway ffmpeg server's
// /optimize endpoint. The server (service-role) remuxes to faststart + transcodes a
// 720p H.264 STREAM copy, repoints videos.url to it, and keeps the full-res original in
// videos.original_url (for export/download). Idempotent server-side (skips already-
// optimized rows), so a duplicate call is a no-op.
//
// FIRE-AND-FORGET by design: optimize takes minutes, must NOT block the upload UI, and
// its failure must NOT break the upload — the raw video still exists and can be
// optimized later (manual /optimize or /optimize-all). We only kick off the job.

const SERVER_URL = 'https://web-production-1bf7f.up.railway.app';

export function optimizeVideoInBackground(key: string): void {
  fetch(`${SERVER_URL}/optimize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  })
    .then(async (r) => {
      const body = await r.json().catch(() => null);
      console.log(`[optimize] kicked off for ${key} → job ${body?.jobId ?? '(no id)'} (HTTP ${r.status})`);
    })
    .catch((e) => console.warn(`[optimize] kickoff failed for ${key} (non-fatal):`, e));
}
