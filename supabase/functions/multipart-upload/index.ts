// @ts-nocheck — Deno Edge Function (typechecked by Deno, not the RN tsconfig).
//
// multipart-upload — the server helper for background uploads (Phase 0b → real).
// Holds the S3 access key SERVER-SIDE (never reaches the phone) and hands the app
// signed "permission slips" for each part of an S3 multipart upload, then finalizes.
// Mirrors the proven scripts/spike-s3-multipart.mjs flow, gated behind a valid session.
//
// Actions (POST body { action, ... }):
//   • 'create'   { key, fileSize, partSizeMB? } → CreateMultipartUpload + presign each
//                  UploadPart URL. Returns { uploadId, key, partSize, parts:[{partNumber,url}] }.
//   • 'complete' { key, uploadId, parts:[{partNumber, etag}] } → CompleteMultipartUpload.
//   • 'abort'    { key, uploadId } → AbortMultipartUpload (cleanup).
//
// The phone PUTs each part directly to its presigned URL (creds never leave here),
// collects ETags, then calls 'complete'. The finished object is a normal 'Videos'
// object — playback still goes through sign-media, storage lockdown untouched.
//
// Deploy:  supabase functions deploy multipart-upload
// Secrets (set once):  supabase secrets set S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=...
//   Optional: S3_REGION (default us-east-1), S3_ENDPOINT (default derived from project).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from 'https://esm.sh/@aws-sdk/client-s3@3';
import { getSignedUrl } from 'https://esm.sh/@aws-sdk/s3-request-presigner@3';

const BUCKET = 'Videos';
const DEFAULT_PART = 128 * 1024 * 1024; // 128 MiB (>= S3's 5 MiB floor; ~24 parts @ 3 GB)
const PART_URL_TTL = 60 * 60 * 12;      // 12 h — long uploads on bad wifi (< S3's 24 h abort)

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

    if (action === 'create') {
      const { key, fileSize } = body;
      if (!key || typeof key !== 'string') return json({ error: 'Missing key' }, 400);
      if (!Number.isFinite(fileSize) || fileSize <= 0) return json({ error: 'Missing/invalid fileSize' }, 400);
      const partSize = Math.max(5 * 1024 * 1024, (Number(body.partSizeMB) * 1024 * 1024) || DEFAULT_PART);
      const numParts = Math.ceil(fileSize / partSize);

      const created = await s3.send(new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: key }));
      const uploadId = created.UploadId;

      const parts = [];
      for (let partNumber = 1; partNumber <= numParts; partNumber++) {
        const signedUrl = await getSignedUrl(
          s3,
          new UploadPartCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId, PartNumber: partNumber }),
          { expiresIn: PART_URL_TTL },
        );
        parts.push({ partNumber, url: signedUrl });
      }
      return json({ uploadId, key, partSize, numParts, parts });
    }

    if (action === 'complete') {
      const { key, uploadId, parts } = body;
      if (!key || !uploadId || !Array.isArray(parts) || parts.length === 0) {
        return json({ error: 'Missing key/uploadId/parts' }, 400);
      }
      // S3 requires parts sorted ascending with matching ETags.
      const Parts = parts
        .map((p: any) => ({ ETag: p.etag, PartNumber: p.partNumber }))
        .sort((a: any, b: any) => a.PartNumber - b.PartNumber);
      const done = await s3.send(new CompleteMultipartUploadCommand({
        Bucket: BUCKET, Key: key, UploadId: uploadId, MultipartUpload: { Parts },
      }));
      return json({ ok: true, key, etag: done.ETag ?? null });
    }

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
