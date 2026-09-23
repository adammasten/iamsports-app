// Background-upload recovery. The gap this closes: a multipart upload could be fully
// paid for — every part sitting in S3 — and still never become a video, because the
// only copy of its uploadId lived in a React ref. App dies, ref dies, and there is no
// way left to ask "what landed?" or to finalize. The parts leak, the coach sees
// nothing, and the next attempt re-uploads the whole game.
//
// So: persist the few fields needed to resume, and on launch reconcile against the
// server's ListParts — which is the authoritative record of what actually landed. We
// deliberately do NOT persist ETags: the Edge Function's 'complete' action rebuilds
// them from ListParts, so {key, uploadId} is genuinely all that has to survive.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import BackgroundUpload from '@/modules/background-upload';
import { supabase } from '@/supabase';
import { completeMultipart, listParts, signParts, abortMultipart, createMultipart } from './background-upload';
import { optimizeVideoInBackground } from './optimize';

const RECORD_KEY = 'bgupload:active';

export type UploadRecoveryRecord = {
  key: string;          // storage object key — also the native module's job id
  uploadId: string;     // S3 multipart upload id (server-issued; unrecoverable if lost)
  fileUri: string;      // DURABLE staged source (Documents, not Caches)
  partSize: number;
  numParts: number;
  videoId: string;      // the videos row to finish — without it a resumed upload is orphaned
  startedAt: number;
};

export async function saveRecoveryRecord(r: UploadRecoveryRecord): Promise<void> {
  try { await AsyncStorage.setItem(RECORD_KEY, JSON.stringify(r)); }
  catch (e) { console.warn('[bg-recovery] save failed:', e); }
}

export async function loadRecoveryRecord(): Promise<UploadRecoveryRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(RECORD_KEY);
    return raw ? (JSON.parse(raw) as UploadRecoveryRecord) : null;
  } catch (e) { console.warn('[bg-recovery] load failed:', e); return null; }
}

export async function clearRecoveryRecord(): Promise<void> {
  try { await AsyncStorage.removeItem(RECORD_KEY); }
  catch (e) { console.warn('[bg-recovery] clear failed:', e); }
}

// ── Durable source file ────────────────────────────────────────────────────────
// expo-image-picker hands back a URI in the CACHE directory, which iOS is free to
// purge under storage pressure — precisely when a 15 GB video is sitting there. Move
// it to Documents so it survives until the upload finishes.
//
// This is a MOVE, not a copy: same app container, same volume, so it is a metadata
// rename — instant, and zero additional bytes. (The picker already made one full-size
// copy when it handed us the cache URI; we are not adding a second.)
export async function stageSourceForDurableUpload(srcUri: string, key: string): Promise<string> {
  const dir = `${FileSystem.documentDirectory}bg-uploads/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  const dest = `${dir}${key}`;
  try {
    await FileSystem.moveAsync({ from: srcUri, to: dest });
  } catch (e) {
    // Cross-volume or already-moved: fall back to the original URI rather than
    // duplicating tens of GB. Less durable, but never a surprise disk blow-up.
    console.warn('[bg-recovery] stage move failed, using original URI:', e);
    return srcUri;
  }
  try { await BackgroundUpload?.excludeFromBackup(dest); } catch { /* best effort */ }
  return dest;
}

export async function deleteStagedSource(fileUri: string): Promise<void> {
  if (!fileUri.includes('/bg-uploads/')) return;   // never delete a picker/original path
  try { await FileSystem.deleteAsync(fileUri, { idempotent: true }); }
  catch (e) { console.warn('[bg-recovery] staged cleanup failed:', e); }
}

// ── Finish the handoff ─────────────────────────────────────────────────────────
// Identical to what the foreground uploader does after its bytes land, so playback,
// sign-media, export and the taggers cannot tell which uploader produced the file.
export async function finalizeUploadedVideo(rec: UploadRecoveryRecord): Promise<void> {
  await supabase.from('videos').update({ upload_status: 'ready' }).eq('id', rec.videoId);
  optimizeVideoInBackground(rec.key);
  await deleteStagedSource(rec.fileUri);
  await clearRecoveryRecord();
}

export type ReconcileOutcome =
  | { state: 'none' }
  | { state: 'completed'; key: string }
  | { state: 'resumed'; key: string; missing: number; alreadyDone: number }
  | { state: 'needs-wifi'; key: string; missing: number; alreadyDone: number }
  | { state: 'expired'; key: string }
  | { state: 'error'; message: string };

// Run at launch. Returns what happened so the UI can say something truthful.
export async function reconcileBackgroundUpload(opts?: { forceResume?: boolean }): Promise<ReconcileOutcome> {
  const rec = await loadRecoveryRecord();
  if (!rec) return { state: 'none' };

  let parts: { partNumber: number; etag: string; size: number }[];
  try {
    const res = await listParts(rec.key, rec.uploadId);
    parts = res.parts ?? [];
  } catch (e: any) {
    // NoSuchUpload: expired or aborted server-side. Nothing to resume — say so
    // instead of silently re-uploading the whole game.
    const msg = String(e?.message ?? e);
    if (/NoSuchUpload|404|not found/i.test(msg)) {
      await supabase.from('videos').update({ upload_status: 'failed' }).eq('id', rec.videoId);
      await deleteStagedSource(rec.fileUri);
      await clearRecoveryRecord();
      return { state: 'expired', key: rec.key };
    }
    return { state: 'error', message: msg };
  }

  const done = new Set(parts.map(p => p.partNumber));
  const missing: number[] = [];
  for (let n = 1; n <= rec.numParts; n++) if (!done.has(n)) missing.push(n);

  console.log(`[bg-recovery] ${rec.key}: uploadId=${rec.uploadId} server parts=${done.size}/${rec.numParts} missing=${missing.length}`);

  // Everything landed while we were gone — this is the case that used to strand
  // uploads forever. Finalize from server truth.
  if (missing.length === 0) {
    await completeMultipart(rec.key, rec.uploadId, rec.numParts);
    await finalizeUploadedVideo(rec);
    console.log(`[bg-recovery] ${rec.key}: COMPLETED from recovery (no bytes re-sent)`);
    return { state: 'completed', key: rec.key };
  }

  // Partial. Resuming means sending only what is missing — but on a metered network
  // that could still be many GB, so ask first unless the caller already has consent.
  const expensive = await BackgroundUpload?.isExpensiveNetwork().catch(() => false);
  if (expensive && !opts?.forceResume) {
    return { state: 'needs-wifi', key: rec.key, missing: missing.length, alreadyDone: done.size };
  }

  const signed = await signParts(rec.key, rec.uploadId, missing);
  await BackgroundUpload?.startMultipartUpload(rec.key, rec.fileUri, rec.partSize, signed);
  console.log(`[bg-recovery] ${rec.key}: RESUMED — re-sending ${missing.length} of ${rec.numParts} parts, keeping ${done.size}`);
  return { state: 'resumed', key: rec.key, missing: missing.length, alreadyDone: done.size };
}

// Give up on the persisted upload and release the server-side multipart.
export async function abandonBackgroundUpload(): Promise<void> {
  const rec = await loadRecoveryRecord();
  if (!rec) return;
  try { await abortMultipart(rec.key, rec.uploadId); } catch { /* best effort */ }
  await supabase.from('videos').update({ upload_status: 'failed' }).eq('id', rec.videoId);
  await deleteStagedSource(rec.fileUri);
  await clearRecoveryRecord();
}

// ── Native completion listeners (production path) ──────────────────────────────
// The spike screen wired these itself. In production nobody is guaranteed to be on
// the upload screen when the transfer finishes, so the listeners live at app scope.
// Returns an unsubscribe function.
export function installBackgroundUploadListeners(): () => void {
  if (!BackgroundUpload) return () => {};

  const subs = [
    BackgroundUpload.addListener('onComplete', async (e: any) => {
      // Multipart finish: the module reports per-part ETags, but we finalize from
      // ListParts (server truth) rather than trusting the client's view.
      if (!e?.parts) return;
      const rec = await loadRecoveryRecord();
      if (!rec || rec.key !== e.uploadId) return;   // native job id IS the object key
      try {
        await completeMultipart(rec.key, rec.uploadId, rec.numParts);
        await finalizeUploadedVideo(rec);
        console.log(`[bg-upload] ${rec.key}: completed + finalized (${rec.numParts} parts)`);
      } catch (err: any) {
        // Not fatal and NOT silent: the record stays, so the next launch reconciles.
        console.warn(`[bg-upload] ${rec.key}: finalize failed, leaving for reconcile:`, err?.message ?? err);
      }
    }),

    BackgroundUpload.addListener('onError', async (e: any) => {
      // A part 403 means its presigned URL expired; re-signing is handled by the next
      // reconcile pass rather than racing it here.
      console.warn(`[bg-upload] error on ${e?.uploadId} part=${e?.part} status=${e?.status}: ${e?.error ?? ''}`);
    }),
  ];

  return () => { for (const s of subs) { try { s.remove(); } catch { /* noop */ } } };
}

// ── Starting an upload, in an order that cannot leak ───────────────────────────
// ORDER MATTERS. The first version staged the file (a 5.7 GB move into Documents)
// BEFORE asking the server to create the multipart upload. When create failed — which
// it did every time, because the S3 secrets were never set — the staged file was left
// behind with no recovery record to track it, so nothing ever cleaned it up. Two failed
// attempts stranded ~11.4 GB on the device, invisibly.
//
// Now: create first (cheap, and the thing most likely to fail), stage only once the
// server has committed, and unwind the staging if anything after it goes wrong.
export async function beginBackgroundUpload(opts: {
  key: string; fileUri: string; fileSize: number; videoId: string; partSizeMB?: number;
}): Promise<{ uploadId: string; numParts: number; partSize: number; fileUri: string }> {
  const { key, fileUri, fileSize, videoId, partSizeMB } = opts;
  if (!BackgroundUpload) throw new Error('Background upload needs a dev/TestFlight build (native module unavailable here).');

  // 1. Server first. Nothing has been moved yet, so a failure here costs nothing.
  const created = await createMultipart(key, fileSize, partSizeMB);

  // 2. Only now make the source durable.
  let durableUri = fileUri;
  try {
    durableUri = await stageSourceForDurableUpload(fileUri, key);
  } catch (e) {
    try { await abortMultipart(key, created.uploadId); } catch { /* best effort */ }
    throw e;
  }

  // 3. Sign + hand to the native uploader, and persist the record. Any failure past
  //    staging unwinds BOTH the staged file and the server-side multipart.
  try {
    const partNumbers = Array.from({ length: created.numParts }, (_, i) => i + 1);
    const parts = await signParts(key, created.uploadId, partNumbers);
    await saveRecoveryRecord({
      key, uploadId: created.uploadId, fileUri: durableUri,
      partSize: created.partSize, numParts: created.numParts, videoId, startedAt: Date.now(),
    });
    await BackgroundUpload.startMultipartUpload(key, durableUri, created.partSize, parts);
    return { uploadId: created.uploadId, numParts: created.numParts, partSize: created.partSize, fileUri: durableUri };
  } catch (e) {
    await deleteStagedSource(durableUri);
    await clearRecoveryRecord();
    try { await abortMultipart(key, created.uploadId); } catch { /* best effort */ }
    throw e;
  }
}

// ── Orphan cleanup ─────────────────────────────────────────────────────────────
// A staged source is only legitimate while a recovery record points at it. Anything
// else in bg-uploads/ is dead weight from a failed start — and at game sizes that is
// gigabytes. Runs at launch, before reconciliation, and never touches the file the
// active record names.
export async function cleanupOrphanedStagedFiles(): Promise<{ removed: number; bytes: number }> {
  const dir = `${FileSystem.documentDirectory}bg-uploads/`;
  const info = await FileSystem.getInfoAsync(dir).catch(() => null);
  if (!info?.exists) return { removed: 0, bytes: 0 };

  const rec = await loadRecoveryRecord();
  const keep = rec?.fileUri ?? null;

  let names: string[] = [];
  try { names = await FileSystem.readDirectoryAsync(dir); }
  catch (e) { console.warn('[bg-recovery] could not list staged files:', e); return { removed: 0, bytes: 0 }; }

  let removed = 0, bytes = 0;
  for (const name of names) {
    const uri = `${dir}${name}`;
    if (keep && (keep === uri || keep.endsWith(`/${name}`))) {
      console.log(`[bg-recovery] keeping staged source for active upload: ${name}`);
      continue;
    }
    const fi = await FileSystem.getInfoAsync(uri).catch(() => null);
    const size = fi?.exists && 'size' in fi ? Number((fi as any).size ?? 0) : 0;
    try {
      await FileSystem.deleteAsync(uri, { idempotent: true });
      removed++; bytes += size;
      console.log(`[bg-recovery] removed orphaned staged file ${name} (${(size / 1048576).toFixed(0)} MB)`);
    } catch (e) { console.warn(`[bg-recovery] could not remove ${name}:`, e); }
  }
  if (removed > 0) {
    console.log(`[bg-recovery] reclaimed ${(bytes / 1073741824).toFixed(2)} GB from ${removed} orphaned staged file(s)`);
  }
  return { removed, bytes };
}
