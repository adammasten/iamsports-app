// test_background_upload_durability.ts
//
// THE RULE (Adam, 2026-09-27):
//   NO NATIVE BACKGROUND UPLOAD MAY START WITHOUT A VERIFIED DURABLE RECOVERY RECORD.
//
// WHY. Production video 23a1e14b, Build 71: multipart create succeeded, ZERO UploadPart
// PUTs followed, 0 bytes landed. On relaunch the recovery record was absent, so
// reconcileBackgroundUpload() returned {state:'none'} without ever contacting the server
// (proved: no new Edge Function boot), and the legacy stale pass marked the video
// 'failed'. The record is the only thread connecting a started upload to any recovery,
// and it was written by a helper that swallowed its own exception — so the existing
// unwind could not fire and the upload started with no way home.
//
// The decision logic lives in lib/core/upload-recovery-contract.ts and is asserted here
// DIRECTLY — never re-implemented. lib/native/upload-recovery.ts imports React Native,
// AsyncStorage and the native module, so it cannot be imported into node; its wiring is
// asserted against its SOURCE, the same approach test_export_ecosystem_contract.ts uses
// for app/export.tsx. Replicating the rules in the test instead would be the exact
// anti-pattern that let the web colour map drift.
//
// Run: npx tsx test_background_upload_durability.ts
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  recoveryRecordMismatch, classifyNativeUploadError,
  VERIFIED_RECOVERY_FIELDS, type RecoveryRecordShape,
} from './lib/core/upload-recovery-contract';

const ROOT = dirname(fileURLToPath(import.meta.url));
const REC_SRC = readFileSync(join(ROOT, 'lib/native/upload-recovery.ts'), 'utf8');
const RECONCILE_SRC = readFileSync(join(ROOT, 'lib/native/upload-reconcile.ts'), 'utf8');

// Scope onError assertions to the HANDLER ITSELF. abandonBackgroundUpload() contains a
// byte-identical failed-flip line, so a whole-file regex can anchor on the wrong one and
// pass for the wrong reason — which it did on first run.
function onErrorHandler(src: string): string {
  const start = src.indexOf("addListener('onError'");
  if (start < 0) throw new Error('onError handler not found');
  const end = src.indexOf('}),', start);
  if (end < 0) throw new Error('onError handler end not found');
  return src.slice(start, end);
}
const ON_ERROR = onErrorHandler(REC_SRC);

let pass = 0, fail = 0;
const failures: string[] = [];
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; const m = `FAIL  ${name}${detail ? `\n        ${detail}` : ''}`; failures.push(m); console.log(m); }
}
const H = (s: string) => console.log(`\n── ${s} ──`);

const REC: RecoveryRecordShape = {
  key: 'team-abc-123-0.mp4', uploadId: 'S3UPLOADID', fileUri: 'file:///Documents/bg-uploads/team-abc-123-0.mp4',
  partSize: 33554432, numParts: 1, videoId: 'vid-1', startedAt: 1790529826000,
};

// ── 1. AsyncStorage write throws ──────────────────────────────────────────────
H('1. write throws → fail closed, native never called, existing unwind runs');
ok('saveRecoveryRecord no longer swallows its exception',
   !/setItem\(RECORD_KEY[\s\S]{0,120}?catch/.test(REC_SRC) &&
   /export async function saveRecoveryRecord[\s\S]{0,220}?await AsyncStorage\.setItem\(RECORD_KEY, JSON\.stringify\(r\)\);\s*\n\}/.test(REC_SRC),
   'a try/catch around setItem would re-open the silent path');
// ORDER is the whole guarantee: verify must precede the native handoff.
const verifyIdx = REC_SRC.indexOf('await saveAndVerifyRecoveryRecord(');
const startIdx  = REC_SRC.indexOf('await BackgroundUpload.startMultipartUpload(');
ok('saveAndVerifyRecoveryRecord runs BEFORE startMultipartUpload',
   verifyIdx > 0 && startIdx > 0 && verifyIdx < startIdx, `verify@${verifyIdx} start@${startIdx}`);
ok('the verified write is inside the block whose catch unwinds',
   /try \{[\s\S]*?await saveAndVerifyRecoveryRecord\([\s\S]*?\} catch \(e\) \{\s*\n\s*await deleteStagedSource\(durableUri\);\s*\n\s*await clearRecoveryRecord\(\);\s*\n\s*try \{ await abortMultipart\(key, created\.uploadId\); \}/.test(REC_SRC));
ok('unwind is the EXISTING one — no parallel cleanup was invented',
   (REC_SRC.match(/await deleteStagedSource\(durableUri\);/g) ?? []).length === 1 &&
   (REC_SRC.match(/abortMultipart\(key, created\.uploadId\)/g) ?? []).length === 2);
ok('beginBackgroundUpload still rethrows so upload.tsx marks the video failed',
   /\} catch \(e\) \{[\s\S]{0,300}?throw e;\s*\n\s*\}\s*\n\}/.test(REC_SRC));

// ── 2. write succeeds, read-back null ─────────────────────────────────────────
H('2. read-back returns null → same fail-closed behaviour');
ok('mismatch reported when record absent', recoveryRecordMismatch(REC, null) === 'record absent on read-back');
ok('undefined treated as absent', recoveryRecordMismatch(REC, undefined) === 'record absent on read-back');
ok('read-back uses the SAME loader relaunch uses',
   /await saveRecoveryRecord\(r\);\s*\n\s*const readBack = await loadRecoveryRecord\(\);/.test(REC_SRC));
ok('a non-null mismatch throws rather than warning',
   /if \(mismatch\) \{\s*\n\s*throw new Error\(/.test(REC_SRC));

// ── 3. read-back wrong uploadId / key ─────────────────────────────────────────
H('3. read-back mismatched → same fail-closed behaviour');
for (const f of VERIFIED_RECOVERY_FIELDS) {
  const corrupted: any = { ...REC };
  corrupted[f] = typeof REC[f] === 'number' ? (REC[f] as number) + 1 : `${REC[f]}-WRONG`;
  const r = recoveryRecordMismatch(REC, corrupted);
  ok(`${f} mismatch is caught`, r !== null && r.startsWith(`${f} mismatch`), `got ${r}`);
}
ok('uploadId is a verified field (unrecoverable if lost)', VERIFIED_RECOVERY_FIELDS.includes('uploadId' as any));
ok('videoId is a verified field (resume would be orphaned)', VERIFIED_RECOVERY_FIELDS.includes('videoId' as any));
ok('staged fileUri is a verified field', VERIFIED_RECOVERY_FIELDS.includes('fileUri' as any));
ok('startedAt is NOT verified (diagnostic only)', !VERIFIED_RECOVERY_FIELDS.includes('startedAt' as any));

// ── 4. durable record verified → upload starts ────────────────────────────────
H('4. verified record → no mismatch, upload proceeds');
ok('exact round-trip passes', recoveryRecordMismatch(REC, { ...REC }) === null);
ok('differing startedAt still passes', recoveryRecordMismatch(REC, { ...REC, startedAt: 999 }) === null);
ok('extra unknown fields tolerated', recoveryRecordMismatch(REC, { ...REC, extra: 'x' } as any) === null);

// ── 5. terminal native onError for the ACTIVE upload ──────────────────────────
H('5. terminal native error → video leaves "uploading", nothing swallowed');
ok('job-level error (no part) is terminal',
   classifyNativeUploadError(REC, { uploadId: REC.key, error: 'File not found: /x' }) === 'terminal');
ok('"Empty file / bad part size / no parts" is terminal',
   classifyNativeUploadError(REC, { uploadId: REC.key, error: 'Empty file / bad part size / no parts' }) === 'terminal');
ok('onError marks the video failed on terminal',
   /update\(\{ upload_status: 'failed' \}\)\.eq\('id', rec\.videoId\)/.test(ON_ERROR));
ok('the failed-flip is the ONLY DB write in the handler',
   (ON_ERROR.match(/supabase\.from\(/g) ?? []).length === 1);
ok('onError still logs the raw native error for diagnosis',
   /console\.warn\(`\[bg-upload\] error on \$\{e\?\.uploadId\} part=\$\{e\?\.part\} status=\$\{e\?\.status\}/.test(ON_ERROR));
ok('the raw log happens BEFORE any early return (always captured)',
   ON_ERROR.indexOf('console.warn(`[bg-upload] error on') < ON_ERROR.indexOf("if (kind !== 'terminal'"));
ok('record is KEPT on terminal (retry/diagnosis info survives)',
   !/clearRecoveryRecord\(/.test(ON_ERROR));
ok('terminal path does NOT auto-abort the multipart',
   !/abortMultipart\(/.test(ON_ERROR));
ok('handler never deletes the staged source',
   !/deleteStagedSource\(/.test(ON_ERROR));

// ── 6. onError for a stale/different upload ───────────────────────────────────
H('6. stale/foreign native error → active upload untouched');
ok('different key is not ours',
   classifyNativeUploadError(REC, { uploadId: 'some-other-key.mp4', error: 'boom' }) === 'not-ours');
ok('missing uploadId is not ours', classifyNativeUploadError(REC, { error: 'boom' }) === 'not-ours');
ok('no active record → not ours', classifyNativeUploadError(null, { uploadId: REC.key, error: 'boom' }) === 'not-ours');
ok('null event → not ours', classifyNativeUploadError(REC, null) === 'not-ours');
ok('a stale TERMINAL-shaped error for another job is still not-ours',
   classifyNativeUploadError(REC, { uploadId: 'old-upload.mp4' }) === 'not-ours');
ok('per-part failure stays transient (reconcile re-signs, not a failure)',
   classifyNativeUploadError(REC, { uploadId: REC.key, part: 1, status: 403 }) === 'transient-part');
ok('part 0 is still a part (falsy-number trap)',
   classifyNativeUploadError(REC, { uploadId: REC.key, part: 0, status: 500 }) === 'transient-part');
ok('onError returns early for non-terminal without touching the DB',
   /if \(kind !== 'terminal' \|\| !rec\) \{[\s\S]{0,260}?return;\s*\n\s*\}/.test(ON_ERROR));
ok('the early return precedes the only DB write',
   ON_ERROR.indexOf('return;') < ON_ERROR.indexOf('supabase.from('));

// ── 7 + 8. reconciliation unchanged ───────────────────────────────────────────
H('7 + 8. reconciliation behaviour preserved');
ok('still lists server parts',        /const res = await listParts\(rec\.key, rec\.uploadId\);/.test(REC_SRC));
ok('still computes missing parts',    /for \(let n = 1; n <= rec\.numParts; n\+\+\) if \(!done\.has\(n\)\) missing\.push\(n\);/.test(REC_SRC));
ok('zero parts → all parts missing → re-signed and re-enqueued',
   /const signed = await signParts\(rec\.key, rec\.uploadId, missing\);\s*\n\s*await BackgroundUpload\?\.startMultipartUpload\(rec\.key, rec\.fileUri, rec\.partSize, signed\);/.test(REC_SRC));
ok('all parts present → finalize from server truth, no bytes re-sent',
   /if \(missing\.length === 0\) \{\s*\n\s*await completeMultipart\(rec\.key, rec\.uploadId, rec\.numParts\);/.test(REC_SRC));
ok('metered-network guard intact',    /if \(expensive && !opts\?\.forceResume\)/.test(REC_SRC));
ok('resume replays the PERSISTED partSize (never recomputed)',
   /startMultipartUpload\(rec\.key, rec\.fileUri, rec\.partSize, signed\)/.test(REC_SRC));
ok('32 MiB part size unchanged',      /export const BACKGROUND_PART_SIZE_MB = 32;/.test(REC_SRC));
ok('ownership guard in the legacy reconciler intact',
   /if \(bgOwnedVideoId && r\.id === bgOwnedVideoId\)/.test(RECONCILE_SRC));
ok('native job id is still the object key (ownership contract)',
   /rec\.key !== e\.uploadId/.test(REC_SRC));

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
