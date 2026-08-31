// @ts-nocheck — Deno Edge Function (typechecked by Deno, not the RN tsconfig).
//
// multipart-upload — the server helper for background uploads.
// Holds the S3 access key SERVER-SIDE (never reaches the phone) and hands the app
// signed "permission slips" for parts of an S3 multipart upload, then finalizes.
// Gated behind a valid session. See docs/BACKGROUND_UPLOAD_PLAN.md ("Locked decisions").
//
// ROLLING-WINDOW protocol (do NOT presign every part up front — a 50 GB file is ~400
// parts and they'd all share one expiry). The native uploader asks for URLs a few parts
// at a time as its rolling window advances, and re-asks when one 403s (expired):
//
//   • 'create'   { key, fileSize, partSizeMB? }
//        → CreateMultipartUpload. Returns { uploadId, key, partSize, numParts }.
//          NO presigned parts here — the module fetches them via 'sign' as it goes.
//   • 'sign'     { key, uploadId, partNumbers:number[] }
//        → presign an UploadPart URL for each requested part number (the rolling window,
//          and the single-part refresh on a 403). Returns { parts:[{partNumber,url}] }.
//   • 'list'     { key, uploadId }
//        → ListParts (paginated). The AUTHORITATIVE record of what actually landed.
//          Returns { parts:[{partNumber,etag,size}] }.
//   • 'complete' { key, uploadId, expectedParts? }
//        → build the completion from ListParts (server truth, not client ETags); if
//          expectedParts is given, refuse unless every part is present. Returns
//          { ok, key, etag }.
//   • 'abort'    { key, uploadId } → AbortMultipartUpload (cleanup).
//
// The finished object is a normal 'Videos' object — playback still goes through
// sign-media, storage lockdown untouched. Presigned URLs are write-only UploadPart URLs
// for one uploadId; redact them from logs.
//
// Deploy:  supabase functions deploy multipart-upload
// Secrets (set once):  supabase secrets set S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=...
//   Optional: S3_REGION (default us-east-1), S3_ENDPOINT (default derived from project).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  ListPartsCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from 'https://esm.sh/@aws-sdk/client-s3@3';
import { getSignedUrl } from 'https://esm.sh/@aws-sdk/s3-request-presigner@3';

const BUCKET = 'Videos';
const DEFAULT_PART = 128 * 1024 * 1024; // 128 MiB (>= S3's 5 MiB floor; ~120 parts @ 15 GB)
const PART_URL_TTL = 60 * 60 * 12;      // 12 h per 'sign' call; the module refreshes on a 403.
const MAX_SIGN_BATCH = 64;              // cap URLs per 'sign' call (a rolling window is small)

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

function s3Client() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;               // https://<ref>.supabase.co
  const ref = new URL(supabaseUrl).hostname.split('.')[0];
  const endpoint = Deno.env.get('S3_ENDPOINT')
    ?? `https://${ref}.storage.supabase.co/storage/v1/s3`;
  return new S3Client({
    endpoint,
    region: Deno.env.get('S3_REGION') ?? 'us-east-1',
    credentials: {
      accessKeyId: Deno.env.get('S3_ACCESS_KEY_ID')!,
      secretAccessKey: Deno.env.get('S3_SECRET_ACCESS_KEY')!,
    },
    forcePathStyle: true,
  });
}

// Presign UploadPart URLs for a specific set of part numbers (rolling window / refresh).
async function signParts(s3: any, key: string, uploadId: string, partNumbers: number[]) {
  const parts: { partNumber: number; url: string }[] = [];
  for (const partNumber of partNumbers) {
    const url = await getSignedUrl(
      s3,
      new UploadPartCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId, PartNumber: partNumber }),
      { expiresIn: PART_URL_TTL },
    );
    parts.push({ partNumber, url });
  }
  return parts;
}

// ListParts is the authoritative record of what actually landed. Paginated (even though
// 120–400 parts fits in fewer pages than the 1000-part page size — cheap insurance).
async function listAllParts(s3: any, key: string, uploadId: string) {
  const parts: { partNumber: number; etag: string; size: number }[] = [];
  let marker: number | undefined = undefined;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res: any = await s3.send(new ListPartsCommand({
      Bucket: BUCKET, Key: key, UploadId: uploadId, PartNumberMarker: marker as any,
    }));
    for (const p of res.Parts ?? []) {
      parts.push({ partNumber: p.PartNumber, etag: p.ETag, size: p.Size });
    }
    if (res.IsTruncated) marker = res.NextPartNumberMarker;
    else break;
  }
  parts.sort((a, b) => a.partNumber - b.partNumber);
  return parts;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim();
    if (!jwt) return json({ error: 'Not authenticated' }, 401);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: who, error: whoErr } = await admin.auth.getUser(jwt);
    if (whoErr || !who?.user) return json({ error: 'Invalid session' }, 401);

    const body = await req.json().catch(() => ({}));
    const action = body?.action;
    const s3 = s3Client();

    // --- create: start the multipart upload; parts are signed on demand via 'sign'. ---
    if (action === 'create') {
      const { key, fileSize } = body;
      if (!key || typeof key !== 'string') return json({ error: 'Missing key' }, 400);
      if (!Number.isFinite(fileSize) || fileSize <= 0) return json({ error: 'Missing/invalid fileSize' }, 400);
      const partSize = Math.max(5 * 1024 * 1024, (Number(body.partSizeMB) * 1024 * 1024) || DEFAULT_PART);
      const numParts = Math.ceil(fileSize / partSize);

      const created = await s3.send(new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: key }));
      return json({ uploadId: created.UploadId, key, partSize, numParts });
    }

    // --- sign: presign URLs for specific part numbers (rolling window + 403 refresh). ---
    if (action === 'sign') {
      const { key, uploadId } = body;
      const partNumbers = body?.partNumbers;
      if (!key || !uploadId) return json({ error: 'Missing key/uploadId' }, 400);
      if (!Array.isArray(partNumbers) || partNumbers.length === 0) return json({ error: 'Missing partNumbers' }, 400);
      if (partNumbers.length > MAX_SIGN_BATCH) return json({ error: `Too many parts (max ${MAX_SIGN_BATCH})` }, 400);
      const clean = partNumbers.map((n: any) => Number(n)).filter((n: number) => Number.isInteger(n) && n >= 1);
      if (clean.length === 0) return json({ error: 'No valid part numbers' }, 400);
      const parts = await signParts(s3, key, uploadId, clean);
      return json({ parts });
    }

    // --- list: ListParts — the authoritative record for reconciliation. ---
    if (action === 'list') {
      const { key, uploadId } = body;
      if (!key || !uploadId) return json({ error: 'Missing key/uploadId' }, 400);
      const parts = await listAllParts(s3, key, uploadId);
      return json({ parts });
    }

    // --- complete: build from ListParts (server truth), not the client's ETags. ---
    if (action === 'complete') {
      const { key, uploadId } = body;
      if (!key || !uploadId) return json({ error: 'Missing key/uploadId' }, 400);
      const landed = await listAllParts(s3, key, uploadId);
      if (landed.length === 0) return json({ error: 'No parts uploaded' }, 409);

      // If the caller tells us how many parts to expect, refuse a partial completion.
      const expected = Number(body?.expectedParts);
      if (Number.isInteger(expected) && expected > 0) {
        if (landed.length !== expected) {
          const have = new Set(landed.map(p => p.partNumber));
          const missing = [];
          for (let n = 1; n <= expected; n++) if (!have.has(n)) missing.push(n);
          return json({ error: 'Missing parts', expected, got: landed.length, missing }, 409);
        }
      }

      const Parts = landed.map(p => ({ ETag: p.etag, PartNumber: p.partNumber }));
      const done = await s3.send(new CompleteMultipartUploadCommand({
        Bucket: BUCKET, Key: key, UploadId: uploadId, MultipartUpload: { Parts },
      }));
      return json({ ok: true, key, etag: done.ETag ?? null, parts: landed.length });
    }

    // --- abort: clean up an abandoned multipart upload. ---
    if (action === 'abort') {
      const { key, uploadId } = body;
      if (!key || !uploadId) return json({ error: 'Missing key/uploadId' }, 400);
      await s3.send(new AbortMultipartUploadCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId }));
      return json({ ok: true });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
