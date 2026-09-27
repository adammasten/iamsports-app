// Background-upload durability rules. PURE and RN-agnostic (no AsyncStorage, no native
// module, no Supabase) so the real decision logic is directly testable instead of being
// re-implemented in a test — which is how drift starts.
// Sole consumer: lib/native/upload-recovery.ts.
//
// WHY THIS FILE EXISTS. Production, 2026-09-27, video 23a1e14b: multipart create
// succeeded, ZERO UploadPart PUTs followed, and on relaunch the recovery record was
// absent — so reconcileBackgroundUpload() returned {state:'none'} without ever asking
// the server, and the legacy stale pass later marked the video 'failed'. The record is
// the ONLY thread connecting a started upload to any recovery, and it was being written
// by a helper that swallowed its own failure. An upload that starts without a verified
// durable record is unrecoverable by construction, so it must not start at all.

/** The persisted record, structurally. Mirrors UploadRecoveryRecord in lib/native. */
export type RecoveryRecordShape = {
  key: string;        // storage object key — ALSO the native module's job id
  uploadId: string;   // S3 multipart id; server-issued and unrecoverable if lost
  fileUri: string;    // durable staged source
  partSize: number;
  numParts: number;
  videoId: string;    // the videos row to finish
  startedAt: number;
};

// Fields whose round-trip must be byte-exact. `startedAt` is deliberately excluded: it
// is diagnostic, and a resumed upload never depends on it. Everything here is something
// a resume genuinely cannot proceed without.
export const VERIFIED_RECOVERY_FIELDS = [
  'key', 'uploadId', 'fileUri', 'partSize', 'numParts', 'videoId',
] as const;

/**
 * Compare a record we just wrote against what the RELAUNCH read path actually returns.
 * Returns null when the round-trip is sound, otherwise a reason safe to put in an Error.
 *
 * Covers both production possibilities: the write never landed (actual == null), and the
 * write landed but comes back wrong/unparseable (caller passes null on a parse failure).
 */
export function recoveryRecordMismatch(
  expected: RecoveryRecordShape,
  actual: RecoveryRecordShape | null | undefined,
): string | null {
  if (!actual) return 'record absent on read-back';
  for (const f of VERIFIED_RECOVERY_FIELDS) {
    const want = expected[f];
    const got = (actual as Record<string, unknown>)[f];
    if (got !== want) return `${f} mismatch (wrote ${JSON.stringify(want)}, read ${JSON.stringify(got)})`;
  }
  return null;
}

/** A native `onError` payload. `uploadId` carries the native JOB id, which IS the key. */
export type NativeUploadErrorEvent = {
  uploadId?: string | null;
  part?: number | null;
  status?: number | null;
  error?: string | null;
};

export type NativeErrorKind =
  /** Belongs to a different//stale upload — must never touch the active one. */
  | 'not-ours'
  /** One part failed (e.g. 403 expired URL). Reconcile re-signs it; NOT terminal. */
  | 'transient-part'
  /** Job-level failure before/outside any part (bad file, bad params). Unrecoverable. */
  | 'terminal';

/**
 * Decide what a native error means for the CURRENTLY active upload.
 *
 * Ownership first: the native job id is the object key, so an event only concerns us
 * when it matches the active record's key. A late error from an abandoned upload must
 * not mark a newer video failed — that would turn one stalled upload into two.
 *
 * Then terminality: an event naming a PART is the ordinary per-part failure the rolling
 * window already handles (reconcile re-signs and re-enqueues). An event with no part
 * came from startMultipart's own guards — "File not found", "Empty file / bad part size
 * / no parts" — which no amount of retrying fixes, and which is exactly the class of
 * error that previously left a row on 'uploading' forever.
 */
export function classifyNativeUploadError(
  rec: Pick<RecoveryRecordShape, 'key'> | null | undefined,
  e: NativeUploadErrorEvent | null | undefined,
): NativeErrorKind {
  if (!rec || !e) return 'not-ours';
  if (!e.uploadId || e.uploadId !== rec.key) return 'not-ours';
  return typeof e.part === 'number' ? 'transient-part' : 'terminal';
}
