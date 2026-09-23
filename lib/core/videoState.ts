// Is a video actually PLAYABLE yet?
//
// An upload finishing is not the same as a video being watchable. The raw file a
// phone uploads is a big non-faststart .mov: a browser refuses to stream it, so
// the player just sits blank. It only becomes watchable once Railway has written
// the 720p faststart copy. `upload_status='ready'` does NOT mean that — it is set
// the moment the bytes land (and it is the column's DEFAULT), so it says 'ready'
// on a video no one can watch.
//
// This derives the real state instead of adding another status column, because
// the truth is already in the row:
//   • original_url is set ONLY by Railway, ONLY after the optimized file exists
//     and videos.url has been repointed at it. So it is a reliable "done" marker.
//   • optimize_attempts is bumped ONLY by the sweep (sweep_stalled_optimizes),
//     which gives up at MAX_OPTIMIZE_ATTEMPTS. Hitting the cap means retrying is
//     not going to fix it — a human needs to look.
//
// Deliberately NOT keyed off the '-720' suffix in the url: that is a filename
// convention, not proof of an optimized asset, and legacy rows exist where the
// url contains -720 while original_url is NULL. LEGACY_720 below handles those.

/** Matches the sweep's own give-up threshold in migration_optimize_sweep.sql. */
export const MAX_OPTIMIZE_ATTEMPTS = 5;

export type VideoPlaybackState = 'ready' | 'processing' | 'failed';

/** The row fields this needs. Anything with these can be passed in. */
export type VideoStateRow = {
  url?: string | null;
  original_url?: string | null;
  optimize_attempts?: number | null;
  upload_status?: string | null;
};

/**
 * LEGACY: a row whose url is already an optimized key even though original_url
 * was never filled in (a duplicate row pointed at an existing optimized object).
 * Such a video IS playable — treating it as unprocessed would show a bogus
 * "Preparing…" forever on a video that plays fine.
 */
function isLegacyOptimized(row: VideoStateRow): boolean {
  return typeof row.url === 'string' && /-720\d*\.mp4$/i.test(row.url);
}

export function videoPlaybackState(row: VideoStateRow): VideoPlaybackState {
  // An upload that never finished is not a processing problem — leave that to
  // upload_status, which the upload screens already surface.
  if (row.upload_status === 'failed') return 'failed';

  if (row.original_url || isLegacyOptimized(row)) return 'ready';

  return (row.optimize_attempts ?? 0) >= MAX_OPTIMIZE_ATTEMPTS ? 'failed' : 'processing';
}

export function isVideoPlayable(row: VideoStateRow): boolean {
  return videoPlaybackState(row) === 'ready';
}

/** User-facing copy. Kept here so every surface says the same thing. */
export function videoStateLabel(state: VideoPlaybackState): string | null {
  if (state === 'processing') return 'Preparing video for playback…';
  if (state === 'failed') return "This video couldn't be prepared for playback.";
  return null;
}

/** The columns a query must select for videoPlaybackState() to be accurate. */
export const VIDEO_STATE_COLUMNS = 'url, original_url, optimize_attempts, upload_status';
