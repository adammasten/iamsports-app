// ============================================================
// test_process_notifications_auth.mjs — regression test for the cron auth gate on the
// process-notifications Edge Function.
//
// WHY THIS FILE EXISTS
//   process-notifications ran verify_jwt=false with NO gate — its handler did not even
//   read the request — so anyone on the internet could trigger privileged work
//   (service-role writes, Expo/web-push HTTP, and the SMS sender once Twilio is
//   configured). This pins the replacement: a Vault-held cron secret, failing closed.
//
// HOW TO RUN
//   node test_process_notifications_auth.mjs                 # source assertions only
//   PN_LIVE=1 node test_process_notifications_auth.mjs       # also probe production
//
//   The live probes are harmless: they assert that an unauthenticated and a
//   wrong-secret POST are REJECTED, so by construction they cannot reach the handler,
//   cannot send a push, and cannot send an SMS. They never send a correct secret,
//   because this test must not hold one.
//
// WHAT IT PROVES, AND WHAT IT DOES NOT
//   PART A asserts the REAL source of supabase/functions/process-notifications/index.ts
//     — it greps the actual file, so the test fails if the gate is removed, reordered,
//     or made fail-open, or if the business logic below it is disturbed.
//   PART B (PN_LIVE=1) asserts production rejects unauthenticated callers.
//   The correct-secret accept path is NOT covered here by design: the secret lives only
//   in Vault, and a test file is the wrong place for it. That path is verified by the
//   real cron run succeeding — see the deploy report / cron.job_run_details.
// ============================================================

import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

const PATH = 'supabase/functions/process-notifications/index.ts';
const src = readFileSync(PATH, 'utf8');
// Strip comments so prose describing the OLD un-gated handler cannot satisfy a check
// about the new gate (the file deliberately documents what it replaced).
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

console.log(`\n=== PART A — shipped source of ${PATH} ===`);

// The gap itself: the handler must no longer ignore the request.
ok('A1 handler receives the request (no longer ignores it)',
  /Deno\.serve\(async \(req\)/.test(code) && !/Deno\.serve\(async \(\)/.test(code));

// The gate.
ok('A2 reads the gate secret via the Vault-backed RPC',
  /rpc\(\s*["']get_process_notifications_secret["']\s*\)/.test(code));
ok('A3 FAILS CLOSED when the gate secret is unavailable',
  /if\s*\(\s*secretErr\s*\|\|\s*!expected\s*\)/.test(code) && /status:\s*500/.test(code));
ok('A4 rejects a request whose Authorization does not match',
  /timingSafeEqual\(\s*req\.headers\.get\(\s*["']Authorization["']\s*\)/.test(code)
  && /status:\s*401/.test(code));
ok('A5 expects a Bearer token shape',
  /`Bearer \$\{expected\}`/.test(code));
ok('A6 compares in constant time',
  /function timingSafeEqual/.test(code) && /diff\s*\|=/.test(code));

// The gate must run BEFORE any work. Order is the whole point.
const gateIdx = code.indexOf('get_process_notifications_secret');
const expandIdx = code.search(/const expanded = await expand\(\)/);
ok('A7 the gate runs BEFORE expand/dispatch', gateIdx > -1 && expandIdx > gateIdx,
  `gate@${gateIdx} expand@${expandIdx}`);

// It must not have silently become a service-role-key check, or reused an unrelated secret.
ok('A8 does not gate on the service-role key',
  !/Authorization[^\n]*SECRET_KEY/.test(code) && !/SECRET_KEY\s*===/.test(code));
ok('A9 does not reuse the purge secret',
  !/get_purge_secret/.test(code));
ok('A10 no hardcoded secret literal in source',
  !/[0-9a-f]{64}/.test(code));

// Secret material must never be logged.
const logs = code.match(/console\.(log|warn|error)\([^\n]*/g) || [];
ok('A11 never logs the gate secret or the supplied token',
  !logs.some((l) => /expected|Authorization|Bearer/i.test(l)),
  logs.filter((l) => /expected|Authorization|Bearer/i.test(l)).join(' | '));

console.log('\n=== PART A2 — notification business logic must be untouched ===');
ok('B1 expand() still upserts idempotently on dedupe_key',
  /onConflict:\s*["']dedupe_key["']/.test(code) && /ignoreDuplicates:\s*true/.test(code));
ok('B2 push dispatch still claims rows atomically',
  /\.eq\("status", "queued"\)\.select\(/.test(code));
ok('B3 quiet-hours logic still present', /QUIET_START/.test(code) && /QUIET_END/.test(code));
ok('B4 send_after gating still present', /lte\("send_after"/.test(code));
ok('B5 web-push channel still present', /webpush/.test(code) && /VAPID_CONFIGURED/.test(code));
ok('B6 SMS stays SKIPPED while Twilio is unconfigured',
  /no_sms_config/.test(code) && /if\s*\(!SID\s*\|\|\s*!TOKEN\s*\|\|\s*!FROM\)/.test(code));
ok('B7 outbox rows still marked processed', /processed_at/.test(code));

// ---- NEGATIVE CONTROL: would PART A have caught the vulnerable version? ----
console.log('\n=== NEGATIVE CONTROL — the pre-fix handler must FAIL these ===');
const OLD = `Deno.serve(async () => {
  const expanded = await expand();
  const dispatched = await dispatchPush();
  const sms = await dispatchSms();
  return new Response(JSON.stringify({ expanded, dispatched, sms }), {});
});`;
const oldChecks = [
  ['handler receives the request', /Deno\.serve\(async \(req\)/.test(OLD) && !/Deno\.serve\(async \(\)/.test(OLD)],
  ['reads the gate secret',        /rpc\(\s*["']get_process_notifications_secret["']\s*\)/.test(OLD)],
  ['fails closed',                 /if\s*\(\s*secretErr\s*\|\|\s*!expected\s*\)/.test(OLD)],
  ['rejects bad Authorization',    /timingSafeEqual\(/.test(OLD)],
];
let caught = 0;
for (const [name, passed] of oldChecks) {
  if (!passed) caught++;
  console.log(`  old handler: ${name} -> ${passed ? 'passes (BAD)' : 'FAILS as it should'}`);
}
ok(`NC all ${oldChecks.length} guards reject the pre-fix handler`, caught === oldChecks.length);

// ---- PART B: live production probes (opt-in) ----
if (process.env.PN_LIVE === '1') {
  console.log('\n=== PART B — live production (harmless: rejections only) ===');
  const URL_ = 'https://wscfpkaltajnrhiusoze.supabase.co/functions/v1/process-notifications';
  const post = async (headers) => {
    const r = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{}' });
    return { status: r.status, body: (await r.text()).slice(0, 60) };
  };
  const anon = await post({});
  ok('C1 anonymous POST rejected (401)', anon.status === 401, `got ${anon.status} ${anon.body}`);
  const wrong = await post({ Authorization: 'Bearer definitely-not-the-cron-secret' });
  ok('C2 wrong secret rejected (401)', wrong.status === 401, `got ${wrong.status} ${wrong.body}`);
  const malformed = await post({ Authorization: 'not-even-bearer-shaped' });
  ok('C3 malformed Authorization rejected (401)', malformed.status === 401, `got ${malformed.status} ${malformed.body}`);
  ok('C4 rejections leak no secret material',
    ![anon, wrong, malformed].some((r) => /[0-9a-f]{64}/.test(r.body)));
} else {
  console.log('\n(PART B skipped — set PN_LIVE=1 to probe production)');
}

console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
process.exit(fail === 0 ? 0 : 1);
