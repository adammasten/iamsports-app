// test_edge_key_migration.ts
//
// GUARD: no Edge Function may read the LEGACY Supabase API-key env vars directly.
//
// WHY. A `service_role` JWT for this project is committed in the PUBLIC history of
// github.com/adammasten/iamsports-server (commit f3bda34, 2026-05-01) and does not expire
// until ~2036. Removing it from the working tree did not un-publish it. The only real
// remedy is retiring the legacy API-key system — which requires every Edge Function to read
// the NEW key vars instead. This test stops a function silently regressing to a legacy read
// and re-blocking that retirement.
//
// The new vars are JSON objects keyed by key NAME, not plain strings:
//     JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')!)['default']
// and Supabase adds them ALONGSIDE the legacy vars without repointing the legacy ones, so
// a function that still reads the legacy var keeps working today and breaks the moment
// legacy keys are deactivated. That is exactly the failure this guard prevents.
//
// Run: npx tsx test_edge_key_migration.ts
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const FN_DIR = join(ROOT, 'supabase', 'functions');

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; }
  else { fail++; const m = `  FAIL  ${name}\n          got:  ${JSON.stringify(got)}\n          want: ${JSON.stringify(want)}`; failures.push(m); console.log(m); }
}
function ok(name: string, cond: boolean) { check(name, !!cond, true); }

// The ONE documented, deliberate exception: multipart-upload's /preflight smoke test
// compares the caller's bearer token against the secret key, and accepts the legacy value
// too so the preflight tool works whichever key the operator has exported. Narrow this to
// SECRET_KEY only when legacy keys are deactivated, then delete this allowance.
const TRANSITIONAL_ALLOWED: Record<string, number> = { 'multipart-upload': 1 };

const LEGACY_DIRECT = /Deno\.env\.get\(\s*['"]SUPABASE_(SERVICE_ROLE_KEY|ANON_KEY)['"]\s*\)/g;
// A read INSIDE the resolver is how the zero-downtime fallback works; it is not a direct read.
const RESOLVER_LINE = /return Deno\.env\.get\(legacyEnv\)/;

const fns = existsSync(FN_DIR)
  ? readdirSync(FN_DIR, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('_')).map(d => d.name).sort()
  : [];

console.log('=== A. every Edge Function is migrated to the new key vars ===');
ok('found Edge Functions to check', fns.length > 0);
check('expected function count', fns.length, 13);

for (const fn of fns) {
  const file = join(FN_DIR, fn, 'index.ts');
  ok(`${fn}: index.ts exists`, existsSync(file));
  if (!existsSync(file)) continue;
  const src = readFileSync(file, 'utf8');

  // Count DIRECT legacy reads, excluding the resolver's own fallback line.
  const directReads = src.split('\n')
    .filter(l => !RESOLVER_LINE.test(l))
    .join('\n')
    .match(LEGACY_DIRECT)?.length ?? 0;
  check(`${fn}: direct legacy env reads`, directReads, TRANSITIONAL_ALLOWED[fn] ?? 0);

  // If it needs a privileged key at all, it must resolve it through the new var.
  const needsPrivileged = /createClient\(/.test(src);
  if (needsPrivileged) {
    ok(`${fn}: reads SUPABASE_SECRET_KEYS`, src.includes('"SUPABASE_SECRET_KEYS"') || src.includes("'SUPABASE_SECRET_KEYS'"));
    // The new vars are JSON objects — a plain-string read would silently produce garbage.
    ok(`${fn}: parses the new var as JSON`, /JSON\.parse\(\s*raw\s*\)/.test(src) || /JSON\.parse\(Deno\.env\.get\(/.test(src));
    ok(`${fn}: selects the 'default' named key`, /\?\.default|\['default'\]|\["default"\]/.test(src));
  }

  // No function may ever contain a literal key.
  ok(`${fn}: contains no literal JWT`, !/eyJ[A-Za-z0-9_-]{20,}\./.test(src));
  ok(`${fn}: contains no literal sb_secret_ key`, !/sb_secret_[A-Za-z0-9_-]{10,}/.test(src));
}

console.log('=== B. acting-as-the-user clients use the PUBLISHABLE key, not a secret ===');
for (const fn of fns) {
  const file = join(FN_DIR, fn, 'index.ts');
  if (!existsSync(file)) continue;
  const src = readFileSync(file, 'utf8');
  // Any createClient that overrides Authorization is acting as the caller. It must not be
  // handed the SECRET key as its apikey — that ships a secret on a request that does not
  // need one, and the platform may reject a secret sent on an Authorization bearer.
  for (const m of src.matchAll(/createClient\(([^;]{0,220}?)\{\s*\n?\s*global:\s*\{\s*headers:\s*\{\s*Authorization/g)) {
    const args = m[1];
    ok(`${fn}: as-user client does not use SECRET_KEY`, !/\bSECRET_KEY\b/.test(args));
  }
}

console.log('=== C. no client-side code holds a secret key ===');
for (const dir of ['app', 'lib', 'components']) {
  const base = join(ROOT, dir);
  if (!existsSync(base)) continue;
  const stack = [base];
  const offenders: string[] = [];
  while (stack.length) {
    const d = stack.pop()!;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') stack.push(p); continue; }
      if (!/\.(ts|tsx|js|jsx)$/.test(e.name)) continue;
      const src = readFileSync(p, 'utf8');
      if (/sb_secret_[A-Za-z0-9_-]{10,}/.test(src)) offenders.push(p);
      if (/SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEYS?\b/.test(src)) offenders.push(p);
      if (/x-operator-secret|OPERATOR_SECRET/.test(src)) offenders.push(p);
    }
  }
  check(`${dir}/ holds no secret or operator credential`, offenders.map(o => o.replace(ROOT + '/', '')), []);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail) { console.log('\nFAILURES:\n' + failures.join('\n')); process.exit(1); }
