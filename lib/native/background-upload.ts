// Background multipart-upload orchestration (JS side). Talks to the `multipart-upload`
// Edge Function (create / sign / list / complete / abort) and drives the native
// `BackgroundUpload` module. The native module owns the transfer + rolling slice window;
// this owns the plan + finalize. See docs/BACKGROUND_UPLOAD_PLAN.md.
//
// Flow (see startBackgroundMultipart):
//   create → sign all parts (cheap: just URLs) → native uploads with a rolling slice
//   window → module fires onComplete → completeMultipart() finalizes from ListParts.
// A part 403 (URL expired) or failure comes back via the module's onError; re-sign those
// parts with retryParts() (e.g. on next foreground) and re-run — S3 overwrites the part.
//
// NOTE: native-only. On web / Expo Go the module is null; callers must handle that.

import BackgroundUpload, { type UploadPart } from '@/modules/background-upload';
import { supabase } from '@/supabase';

// Keep in step with the Edge Function's MAX_SIGN_BATCH.
const SIGN_BATCH = 64;

async function callFn(body: Record<string, unknown>): Promise<any> {
  const { data, error } = await supabase.functions.invoke('multipart-upload', { body });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
  return data;
}

export type CreatedUpload = { uploadId: string; key: string; partSize: number; numParts: number };

// Start the multipart upload server-side. Parts are signed separately (on demand).
export function createMultipart(key: string, fileSize: number, partSizeMB?: number): Promise<CreatedUpload> {
  return callFn({ action: 'create', key, fileSize, partSizeMB });
}

// Presign UploadPart URLs for the given part numbers, batched to the Edge Function cap.
export async function signParts(key: string, uploadId: string, partNumbers: number[]): Promise<UploadPart[]> {
  const out: UploadPart[] = [];
  for (let i = 0; i < partNumbers.length; i += SIGN_BATCH) {
    const batch = partNumbers.slice(i, i + SIGN_BATCH);
    const data = await callFn({ action: 'sign', key, uploadId, partNumbers: batch });
    out.push(...((data?.parts ?? []) as UploadPart[]));
  }
  return out;
}

// The authoritative record of which parts actually landed (for reconciliation on resume).
export function listParts(key: string, uploadId: string): Promise<{ parts: { partNumber: number; etag: string; size: number }[] }> {
  return callFn({ action: 'list', key, uploadId });
}

// Finalize from ListParts (server truth); refuses a partial upload when expectedParts is given.
export function completeMultipart(key: string, uploadId: string, expectedParts: number): Promise<{ ok: boolean; key: string; etag: string | null }> {
  return callFn({ action: 'complete', key, uploadId, expectedParts });
}

export function abortMultipart(key: string, uploadId: string): Promise<{ ok: boolean }> {
  return callFn({ action: 'abort', key, uploadId });
}

export type StartedUpload = { uploadId: string; key: string; partSize: number; numParts: number; fileUri: string };

// Kick off a background multipart upload. Signs every part up front (URLs are cheap to hold
// — the DISK cost is the part FILES, which the native module stages a few at a time), then
// hands the URLs to the native rolling-slice uploader. Resolves once enqueued; the transfer
// continues in the background. Caller finalizes on the module's onComplete via completeMultipart.
export async function startBackgroundMultipart(opts: {
  key: string; fileUri: string; fileSize: number; partSizeMB?: number;
}): Promise<StartedUpload> {
  if (!BackgroundUpload) throw new Error('Background upload needs a dev/TestFlight build (native module unavailable here).');
  const { key, fileUri, fileSize, partSizeMB } = opts;
  const created = await createMultipart(key, fileSize, partSizeMB);
  const partNumbers = Array.from({ length: created.numParts }, (_, i) => i + 1);
  const parts = await signParts(key, created.uploadId, partNumbers);
  // The native module's job id is `key` (unique per upload); events come back keyed by it.
  await BackgroundUpload.startMultipartUpload(key, fileUri, created.partSize, parts);
  return { uploadId: created.uploadId, key, partSize: created.partSize, numParts: created.numParts, fileUri };
}

// Re-sign + re-enqueue specific parts after a 403/expiry or a dropped part (typically on the
// next foreground). Same uploadId — S3 overwrites the part. The module's onComplete fires when
// THIS batch finishes; the caller should still finalize via completeMultipart(expectedParts),
// which reconciles against ListParts (the whole upload), not just this batch.
export async function retryParts(started: StartedUpload, partNumbers: number[]): Promise<void> {
  if (!BackgroundUpload) throw new Error('Background upload native module unavailable.');
  if (partNumbers.length === 0) return;
  const parts = await signParts(started.key, started.uploadId, partNumbers);
  await BackgroundUpload.startMultipartUpload(started.key, started.fileUri, started.partSize, parts);
}
