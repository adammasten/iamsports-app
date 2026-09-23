#!/usr/bin/env node
/**
 * Preflight: is the critical video backend actually configured?
 *
 * Run this BEFORE a TestFlight/production release. It answers one question that
 * static config review cannot: can the deployed multipart service really
 * authenticate to S3 right now?
 *
 * It does that by asking the deployed Edge Function to create a multipart upload
 * under a throwaway key and immediately abort it. Nothing is written, nothing is
 * left behind, and no credential is ever printed.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/preflight-video-backend.mjs
 *
 * The service-role key is read from the environment and never logged. Get it from
 * Supabase Dashboard -> Project Settings -> API. Do not paste it into a chat.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wscfpkaltajnrhiusoze.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RAILWAY_URL = process.env.RAILWAY_URL || 'https://web-production-1bf7f.up.railway.app';

const ok = (m) => console.log(`  \x1b[32mPASS\x1b[0m  ${m}`);
const bad = (m) => console.log(`  \x1b[31mFAIL\x1b[0m  ${m}`);
const info = (m) => console.log(`        ${m}`);

let failures = 0;

async function checkMultipart() {
  console.log('\nS3 multipart (background upload)');
  if (!SERVICE_KEY) {
    bad('SUPABASE_SERVICE_ROLE_KEY not set in this shell — cannot run the smoke test.');
    info('SUPABASE_SERVICE_ROLE_KEY=... node scripts/preflight-video-backend.mjs');
    failures++; return;
  }
  let res, body;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/multipart-upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ action: 'preflight' }),
    });
    body = await res.json();
  } catch (e) {
    bad(`could not reach multipart-upload: ${e.message}`); failures++; return;
  }

  if (body?.ok) {
    ok(`S3 create+abort succeeded on bucket "${body.bucket}" — credentials valid`);
    return;
  }
  if (body?.code === 'S3_CONFIGURATION_MISSING') {
    bad(`S3_CONFIGURATION_MISSING — missing: ${(body.missing || []).join(', ')}`);
    info('Set them (names only shown here, never values):');
    info('  npx supabase secrets set S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=...');
    info('Create the key pair: Dashboard -> Project Settings -> Storage -> S3 Access Keys');
    failures++; return;
  }
  if (body?.code === 'S3_AUTH_FAILED') {
    bad(`S3 rejected the credentials: ${body.error ?? '(no message)'}`);
    info('The secrets exist but are wrong, revoked, or scoped to another project.');
    failures++; return;
  }
  bad(`unexpected response (HTTP ${res.status}): ${JSON.stringify(body).slice(0, 300)}`);
  failures++;
}

async function checkOptimizer() {
  console.log('\nTranscode service (720p optimize)');
  try {
    const res = await fetch(`${RAILWAY_URL}/`, { signal: AbortSignal.timeout(20000) });
    const body = await res.json();
    if (!body?.supabaseConnected) { bad('Railway reports supabaseConnected=false — SUPABASE_SERVICE_ROLE_KEY missing there'); failures++; return; }
    ok(`Railway up (optimize: ${body.optimize}, faststart: ${body.faststart})`);
  } catch (e) { bad(`could not reach Railway: ${e.message}`); failures++; }
}

console.log('Preflight — critical video backend');
console.log('(no credentials are printed by this script)');
await checkMultipart();
await checkOptimizer();

console.log(`\n${failures === 0 ? '\x1b[32mPASS\x1b[0m — video backend is configured.' : `\x1b[31mFAIL\x1b[0m — ${failures} check(s) failed. Do not ship until resolved.`}\n`);
process.exit(failures === 0 ? 0 : 1);
