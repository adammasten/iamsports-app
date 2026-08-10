// ============================================================
// THROWAWAY SPIKE — Phase 0a of background-upload (docs/BACKGROUND_UPLOAD_PLAN.md).
// Delete this file after Phase 0b. NOT app code, NOT imported anywhere.
//
// Proves the transport theory end-to-end WITHOUT any native code or dev build:
//   1. CreateMultipartUpload           (what our future Edge Function does)
//   2. presign an UploadPart URL/part  (what the Edge Function hands the phone)
//   3. PUT each part to its presigned URL with PLAIN fetch, NO AWS creds
//        ^ this is the load-bearing proof: the "phone" uploads holding zero secrets
//   4. CompleteMultipartUpload         (Edge Function assembles the object)
//   5. HeadObject                      (confirm it landed + size matches)
//   6. DeleteObject                    (clean up — leaves no trace)
//
// Parts are read as byte-ranges from a file on disk (mirrors iOS file-backed parts
// and stays memory-safe for large FILE_SIZE_MB throughput tests).
//
// Storage-lockdown / sign-media playback is already proven by code (sign-media signs
// via the service role keyed on videos.url, owner-agnostic — see the plan doc), so
// this spike deliberately does NOT touch the videos table or RLS.
//
// SETUP:
//   npm i -D @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
// RUN (fill in your S3 access key from Supabase → Storage → S3 Connection):
//   SUPABASE_S3_REGION=<your-project-region> \
//   SUPABASE_S3_ACCESS_KEY_ID=<key-id> \
//   SUPABASE_S3_SECRET_ACCESS_KEY=<secret> \
//   node scripts/spike-s3-multipart.mjs
//
// Optional env: PART_SIZE_MB (default 8), FILE_SIZE_MB (default 25), KEEP=1 (skip
// cleanup), BUCKET (default Videos), SUPABASE_S3_ENDPOINT (default this project).
// ============================================================

import { createWriteStream } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const ENDPOINT = process.env.SUPABASE_S3_ENDPOINT
  ?? 'https://wscfpkaltajnrhiusoze.storage.supabase.co/storage/v1/s3';
const REGION = process.env.SUPABASE_S3_REGION;
const ACCESS_KEY_ID = process.env.SUPABASE_S3_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.SUPABASE_S3_SECRET_ACCESS_KEY;
const BUCKET = process.env.BUCKET ?? 'Videos';
const PART_SIZE = (Number(process.env.PART_SIZE_MB) || 8) * 1024 * 1024;
const FILE_SIZE = (Number(process.env.FILE_SIZE_MB) || 25) * 1024 * 1024;
const KEEP = process.env.KEEP === '1';

const KEY = `spike/phase0a-${Date.now()}.bin`; // TEST key — not a real video

const ok = (m) => console.log(`\x1b[32m✓\x1b[0m ${m}`);
const info = (m) => console.log(`  ${m}`);
const fail = (m) => console.log(`\x1b[31m✗ ${m}\x1b[0m`);

if (!REGION || !ACCESS_KEY_ID || !SECRET_ACCESS_KEY) {
  fail('Missing env. Set SUPABASE_S3_REGION, SUPABASE_S3_ACCESS_KEY_ID, SUPABASE_S3_SECRET_ACCESS_KEY.');
  info('Find all three in Supabase dashboard → Storage → S3 Connection (region is shown next to the endpoint).');
  process.exit(1);
}

const s3 = new S3Client({
  endpoint: ENDPOINT,
  region: REGION,
  credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
  forcePathStyle: true, // Supabase S3 requires bucket-in-path, not subdomain
});

// --- 0. Stage a test file on disk (streamed; memory-safe for big FILE_SIZE_MB) ---
const filePath = join(tmpdir(), `spike-${Date.now()}.bin`);
async function stageFile() {
  await new Promise((resolve, reject) => {
    const ws = createWriteStream(filePath);
    let written = 0;
    const CH = 4 * 1024 * 1024;
    (function pump() {
      while (written < FILE_SIZE) {
        const n = Math.min(CH, FILE_SIZE - written);
        written += n;
        if (!ws.write(randomBytes(n))) { ws.once('drain', pump); return; }
      }
      ws.end();
    })();
    ws.on('finish', resolve);
    ws.on('error', reject);
  });
  ok(`Staged ${(FILE_SIZE / 1048576).toFixed(0)} MB test file → ${filePath}`);
}

async function run() {
  console.log(`\n=== Phase 0a spike: presigned S3 multipart → ${BUCKET}/${KEY} ===`);
  info(`endpoint=${ENDPOINT}  region=${REGION}  partSize=${(PART_SIZE / 1048576).toFixed(0)}MB\n`);
  await stageFile();

  let uploadId;
  const fh = await open(filePath, 'r');
  try {
    // --- 1. CreateMultipartUpload (the Edge Function's job) ---
    const created = await s3.send(new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: KEY }));
    uploadId = created.UploadId;
    ok(`CreateMultipartUpload → uploadId ${uploadId?.slice(0, 16)}…`);

    // --- 2–3. Per part: presign, then PUT with plain fetch (NO creds) ---
    const numParts = Math.ceil(FILE_SIZE / PART_SIZE);
    info(`Uploading ${numParts} parts, each via a freshly presigned URL (no AWS creds on the PUT):`);
    const completed = [];
    for (let i = 0; i < numParts; i++) {
      const partNumber = i + 1;
      const offset = i * PART_SIZE;
      const length = Math.min(PART_SIZE, FILE_SIZE - offset);

      // (2) Edge Function presigns this part's URL...
      const signedUrl = await getSignedUrl(
        s3,
        new UploadPartCommand({ Bucket: BUCKET, Key: KEY, UploadId: uploadId, PartNumber: partNumber }),
        { expiresIn: 3600 },
      );

      // (3) ...the "phone" reads the byte-range from disk and PUTs it — creds-free.
      const buf = Buffer.alloc(length);
      await fh.read(buf, 0, length, offset);
      const resp = await fetch(signedUrl, { method: 'PUT', body: buf });
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`Part ${partNumber} PUT failed: HTTP ${resp.status} ${resp.statusText}\n${body.slice(0, 400)}`);
      }
      const etag = resp.headers.get('etag');
      if (!etag) throw new Error(`Part ${partNumber} PUT returned no ETag (needed for Complete)`);
      completed.push({ ETag: etag, PartNumber: partNumber });
      info(`  part ${partNumber}/${numParts}  (${(length / 1048576).toFixed(0)}MB)  ETag ${etag}`);
    }
    ok(`All ${numParts} parts uploaded via presigned URLs — creds never left the "server"`);

    // --- 4. CompleteMultipartUpload (Edge Function assembles) ---
    const done = await s3.send(new CompleteMultipartUploadCommand({
      Bucket: BUCKET, Key: KEY, UploadId: uploadId,
      MultipartUpload: { Parts: completed },
    }));
    ok(`CompleteMultipartUpload → object assembled (ETag ${done.ETag})`);
    uploadId = null; // completed — no abort needed

    // --- 5. HeadObject: confirm it exists + full size ---
    const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: KEY }));
    if (head.ContentLength !== FILE_SIZE) {
      throw new Error(`Size mismatch: expected ${FILE_SIZE}, got ${head.ContentLength}`);
    }
    ok(`HeadObject → ${head.ContentLength} bytes (matches). Object is a real ${BUCKET} object.`);

    // --- 6. Cleanup ---
    if (KEEP) {
      info(`KEEP=1 → leaving ${BUCKET}/${KEY} in place.`);
    } else {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: KEY }));
      ok(`DeleteObject → test object removed. No trace left.`);
    }

    console.log('\n\x1b[32m=== PASS ===\x1b[0m Presigned S3 multipart works end-to-end. Transport theory proven.');
    console.log('Next: Phase 0b (native background URLSession lifecycle) — needs the native module + dev build.\n');
  } catch (e) {
    fail(`FAILED: ${e.message}`);
    if (uploadId) {
      try {
        await s3.send(new AbortMultipartUploadCommand({ Bucket: BUCKET, Key: KEY, UploadId: uploadId }));
        info('Aborted the incomplete multipart upload (cleanup).');
      } catch {}
    }
    process.exitCode = 1;
  } finally {
    await fh.close().catch(() => {});
    await unlink(filePath).catch(() => {});
  }
}

run();
