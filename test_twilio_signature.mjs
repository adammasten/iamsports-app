// ============================================================
// test_twilio_signature.mjs — regression test for the Twilio webhook auth gate on
// sms-inbound and sms-status.
//
// WHY THIS FILE EXISTS
//   The old gate was `if (SECRET && ...)`, which FAILED OPEN when
//   TWILIO_WEBHOOK_SECRET was unset — and it was unset in production, so both
//   webhooks accepted any caller. This test pins the replacement: Twilio-native
//   X-Twilio-Signature, failing CLOSED.
//
// HOW TO RUN
//   node test_twilio_signature.mjs
//   Exit code 0 = all pass. No network, no Twilio account, no SMS, deterministic.
//
// WHAT IT PROVES, AND WHAT IT DOES NOT
//   PART A asserts the ALGORITHM against Twilio's OWN published test vector, so the
//     construction cannot silently drift into a home-made scheme. Negative controls
//     included (altered URL / altered body / altered token must all fail).
//   PART B asserts the REAL source of both Edge Functions — it greps the actual
//     index.ts files rather than a copy, so the test fails if the shipped gate is
//     weakened, reordered, or the fail-open pattern returns.
//   PART B is a source assertion, NOT an execution of the Deno handler. Executing the
//     handler needs the Deno runtime (not installed here) or a deployed function. The
//     end-to-end "a genuinely Twilio-signed request is accepted" check therefore has
//     to run against a deployment that has TWILIO_AUTH_TOKEN set — see the report.
// ============================================================

import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

// The construction under test, mirroring the shipped functions exactly:
// HMAC-SHA1(token, signedUrl + concat(key+value for params sorted by key)) -> base64
function twilioSignature(token, signedUrl, params) {
  const entries = [...Object.entries(params)].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const canonical = signedUrl + entries.map(([k, v]) => k + v).join('');
  return createHmac('sha1', token).update(canonical, 'utf8').digest('base64');
}

console.log('\n=== PART A — algorithm vs Twilio\'s published test vector ===');

// Twilio docs, "Validating Signatures from Twilio".
const VEC_URL = 'https://mycompany.com/myapp.php?foo=1&bar=2';
const VEC_PARAMS = {
  CallSid: 'CA1234567890ABCDE',
  Caller: '+14158675309',
  Digits: '1234',
  From: '+14158675309',
  To: '+18005551212',
};
const VEC_TOKEN = '12345';
const VEC_EXPECTED = 'RSOYDt4T1cUTdK1PDd93/VVr8B8=';

const got = twilioSignature(VEC_TOKEN, VEC_URL, VEC_PARAMS);
ok('A1 matches Twilio\'s own expected signature', got === VEC_EXPECTED, `got ${got}`);

// Negative controls — each must produce a DIFFERENT signature, or the scheme is not
// actually binding that input.
ok('A2 different URL yields a different signature (URL is bound)',
  twilioSignature(VEC_TOKEN, VEC_URL.replace('myapp', 'other'), VEC_PARAMS) !== VEC_EXPECTED);
ok('A3 altered form field yields a different signature (body is bound)',
  twilioSignature(VEC_TOKEN, VEC_URL, { ...VEC_PARAMS, Digits: '9999' }) !== VEC_EXPECTED);
ok('A4 added form field yields a different signature',
  twilioSignature(VEC_TOKEN, VEC_URL, { ...VEC_PARAMS, Extra: 'x' }) !== VEC_EXPECTED);
ok('A5 wrong token yields a different signature (keyed on the auth token)',
  twilioSignature('not-the-token', VEC_URL, VEC_PARAMS) !== VEC_EXPECTED);
ok('A6 dropped query string yields a different signature (query is bound)',
  twilioSignature(VEC_TOKEN, 'https://mycompany.com/myapp.php', VEC_PARAMS) !== VEC_EXPECTED);
// Key order must not matter: sorting is what makes it canonical.
const shuffled = Object.fromEntries([...Object.entries(VEC_PARAMS)].reverse());
ok('A7 param insertion order is irrelevant (keys are sorted)',
  twilioSignature(VEC_TOKEN, VEC_URL, shuffled) === VEC_EXPECTED);

console.log('\n=== PART B — shipped source of both Edge Functions ===');

for (const fn of ['sms-inbound', 'sms-status']) {
  const path = `supabase/functions/${fn}/index.ts`;
  const src = readFileSync(path, 'utf8');
  console.log(`\n  --- ${path} ---`);

  // Strip comments so prose describing the OLD gate cannot satisfy a check about the
  // new one (the files deliberately document the removed pattern).
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  ok(`${fn}: fail-open shared-secret gate is GONE`,
    !/if\s*\(\s*SECRET\s*&&/.test(code));
  ok(`${fn}: no longer authenticates on a ?secret query param`,
    !/searchParams\.get\(\s*["']secret["']\s*\)/.test(code));
  ok(`${fn}: TWILIO_WEBHOOK_SECRET is not read for auth`,
    !/TWILIO_WEBHOOK_SECRET/.test(code));

  ok(`${fn}: reads TWILIO_AUTH_TOKEN`,
    /Deno\.env\.get\(\s*["']TWILIO_AUTH_TOKEN["']\s*\)/.test(code));
  ok(`${fn}: fails CLOSED when the token or base URL is absent`,
    /if\s*\(\s*!TWILIO_AUTH_TOKEN\s*\|\|\s*!PUBLIC_BASE\s*\)/.test(code));
  ok(`${fn}: rejects a request with no X-Twilio-Signature`,
    /X-Twilio-Signature/i.test(code) && /if\s*\(\s*!signature\s*\)/.test(code));
  ok(`${fn}: rejects an invalid signature`,
    /if\s*\(\s*!\(await\s+twilioSignatureValid\(/.test(code));

  ok(`${fn}: uses HMAC with SHA-1`,
    /name:\s*["']HMAC["']/.test(code) && /hash:\s*["']SHA-1["']/.test(code));
  ok(`${fn}: base64-encodes the digest`, /btoa\(/.test(code));
  ok(`${fn}: sorts params by key before concatenating`,
    /\.sort\(/.test(code) && /map\(\(\[k,\s*v\]\)\s*=>\s*k\s*\+\s*v\)/.test(code));
  ok(`${fn}: compares in constant time`,
    /timingSafeEqual\(/.test(code) && /diff\s*\|=/.test(code));

  // The signed URL must come from deployment config, not from the proxied request host.
  ok(`${fn}: derives the signed host from config, not req.url`,
    /TWILIO_WEBHOOK_BASE_URL/.test(code) && /SUPABASE_URL/.test(code)
    && /PUBLIC_BASE\s*\+\s*SIGNED_PATH/.test(code));
  ok(`${fn}: signs the correct function path`,
    new RegExp(`SIGNED_PATH\\s*=\\s*["']/functions/v1/${fn}["']`).test(code));
  // Query string must still be included, since Twilio signs it.
  ok(`${fn}: includes the request query string in the signed URL`,
    /new URL\(req\.url\)\.search/.test(code));

  // Body must be read once as text: formData() would consume the stream.
  ok(`${fn}: reads the body once as text (formData would consume it)`,
    /await req\.text\(\)/.test(code) && !/req\.formData\(\)/.test(code));

  // Secret material must never be logged.
  const logs = code.match(/console\.(log|warn|error)\([^\n]*/g) || [];
  ok(`${fn}: never logs token or signature material`,
    !logs.some((l) => /TWILIO_AUTH_TOKEN|signature|canonical|expected/i.test(l)),
    logs.filter((l) => /TWILIO_AUTH_TOKEN|signature|canonical|expected/i.test(l)).join(' | '));

  // Business logic below the gate must be intact.
  if (fn === 'sms-inbound') {
    ok(`${fn}: HELP behavior preserved`, /word === "HELP"/.test(code));
    ok(`${fn}: STOP opt-out write preserved`,
      /STOP\.has\(word\)/.test(code) && /sms_opt_outs/.test(code) && /opted_out_at/.test(code));
    ok(`${fn}: START re-subscribe write preserved`,
      /START\.has\(word\)/.test(code) && /opted_back_in_at/.test(code));
    ok(`${fn}: reads From and Body from the parsed params`,
      /params\.get\("From"\)/.test(code) && /params\.get\("Body"\)/.test(code));
  } else {
    ok(`${fn}: provider_message_id lookup preserved`,
      /\.eq\("provider_message_id", sid\)/.test(code));
    ok(`${fn}: delivered rows still protected from regression`,
      /\.neq\("status", "delivered"\)/.test(code));
    ok(`${fn}: status mapping preserved`,
      /status === "delivered"/.test(code) && /"undelivered"/.test(code) && /21610/.test(code));
    ok(`${fn}: reads MessageSid/MessageStatus from the parsed params`,
      /params\.get\("MessageSid"\)/.test(code) && /params\.get\("MessageStatus"\)/.test(code));
  }
}

console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
process.exit(fail === 0 ? 0 : 1);
