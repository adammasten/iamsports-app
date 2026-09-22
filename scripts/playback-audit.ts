/**
 * scripts/playback-audit.ts — READ-ONLY playback diagnostic.
 *
 * For every `videos` row your session can see (RLS-scoped), it:
 *   1. calls the `sign-media` Edge Function to mint a signed URL (records sign_ok / error),
 *   2. does a `Range: bytes=0-1` request against that URL (records HTTP status + Content-Range;
 *      the total in Content-Range gives the object size),
 *   3. fetches bytes 0-8192 and walks the MP4 atoms to record whether `moov` precedes `mdat`
 *      (faststart) — the thing a browser needs at the FRONT to stream.
 *
 * It writes scripts/playback-audit.csv and prints a summary. It NEVER uploads, deletes,
 * or writes anything — only reads, sign-media calls, and range fetches.
 *
 * Run:
 *   SUPA_JWT="<paste>" npx tsx scripts/playback-audit.ts
 *
 * Getting SUPA_JWT: DevTools → Application → Local Storage → the `sb-...-auth-token` value.
 * Paste it whole — this script accepts the raw access_token (eyJ...), the JSON object, or the
 * `base64-...` wrapper and extracts the access_token itself.
 */

import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';

// Public, committed values (same as supabase.js).
const SUPABASE_URL = 'https://wscfpkaltajnrhiusoze.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_CEXx7MDP_EMAExvLDHcdAg_Z5Cs_dvv';
const OUT = 'scripts/playback-audit.csv';

function extractJwt(input: string): string {
  let raw = input.trim();
  if (raw.startsWith('base64-')) {
    try { raw = Buffer.from(raw.slice(7), 'base64').toString('utf8'); } catch { /* keep raw */ }
  }
  try {
    const o = JSON.parse(raw);
    return o.access_token || o.currentSession?.access_token || o?.[0] || raw;
  } catch {
    return raw; // already a bare JWT
  }
}

// Walk MP4 boxes in the first chunk; return which of moov/mdat comes first.
function faststartVerdict(buf: Buffer): string {
  let off = 0, firstMoov = -1, firstMdat = -1;
  while (off + 8 <= buf.length) {
    let size = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'moov' && firstMoov < 0) firstMoov = off;
    if (type === 'mdat' && firstMdat < 0) firstMdat = off;
    if (size === 1) { // 64-bit largesize follows the type
      if (off + 16 > buf.length) break;
      size = Number(buf.readBigUInt64BE(off + 8));
    }
    if (size < 8 || !Number.isFinite(size)) break; // guard against garbage / loop
    off += size;
  }
  if (firstMoov >= 0 && (firstMdat < 0 || firstMoov < firstMdat)) return 'faststart';
  if (firstMdat >= 0 && (firstMoov < 0 || firstMdat < firstMoov)) return 'not-faststart(mdat-first)';
  return 'unknown(moov not in first 8KB)';
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  const jwtInput = process.env.SUPA_JWT || process.argv[2];
  if (!jwtInput) {
    console.error('Missing JWT. Run:  SUPA_JWT="<paste>" npx tsx scripts/playback-audit.ts');
    process.exit(1);
  }
  const jwt = extractJwt(jwtInput);

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  // Confirm the JWT resolves to a user.
  const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    console.error('JWT did not resolve to a session:', userErr?.message ?? 'no user');
    process.exit(1);
  }
  console.log(`Authenticated as ${userData.user.email ?? userData.user.id}`);

  // Every videos row RLS lets this session read.
  const { data: videos, error: vErr } = await supabase
    .from('videos')
    .select('id, url, team_id, sport, created_at, game_id, deleted_at')
    .order('created_at', { ascending: false });
  if (vErr) { console.error('videos read failed:', vErr.message); process.exit(1); }
  console.log(`Visible videos: ${videos?.length ?? 0}`);

  // Team names (best-effort; RLS may hide some).
  const teamIds = [...new Set((videos ?? []).map(v => v.team_id).filter(Boolean))] as string[];
  const teamName = new Map<string, string>();
  if (teamIds.length) {
    const { data: teams } = await supabase.from('teams').select('id, name').in('id', teamIds);
    for (const t of teams ?? []) teamName.set(t.id, t.name);
  }

  const header = ['video_id', 'team', 'sport', 'created_at', 'url_key', 'size_mb', 'sign_ok', 'range_status', 'faststart_bytes', 'notes'];
  const rows: string[] = [header.join(',')];

  for (const v of videos ?? []) {
    const base: Record<string, unknown> = {
      video_id: v.id,
      team: v.team_id ? (teamName.get(v.team_id) ?? v.team_id) : '(none)',
      sport: v.sport ?? '',
      created_at: v.created_at,
      url_key: v.url ?? '',
      size_mb: '', sign_ok: '', range_status: '', faststart_bytes: '', notes: '',
    };
    const notes: string[] = [];
    if (v.deleted_at) notes.push('videos.deleted_at set');

    if (!v.url) {
      base.sign_ok = 'n/a'; base.notes = ['no url on row', ...notes].join('; ');
      rows.push(header.map(h => csvCell(base[h])).join(','));
      continue;
    }

    // 1) sign-media
    let signedUrl: string | null = null;
    try {
      const { data, error } = await supabase.functions.invoke('sign-media', {
        body: { key: v.url },
        headers: { Authorization: `Bearer ${jwt}` },
      });
      if (error) { base.sign_ok = 'false'; notes.push(`sign-media error: ${error.message}`); }
      else if (data?.url) { base.sign_ok = 'true'; signedUrl = data.url as string; }
      else { base.sign_ok = 'false'; notes.push(`sign-media returned: ${JSON.stringify(data)}`); }
    } catch (e) {
      base.sign_ok = 'false'; notes.push(`sign-media threw: ${(e as Error).message}`);
    }

    if (signedUrl) {
      // 2) Range probe
      try {
        const r = await fetch(signedUrl, { headers: { Range: 'bytes=0-1' } });
        base.range_status = r.status;
        const cr = r.headers.get('content-range');
        const ar = r.headers.get('accept-ranges');
        if (cr) notes.push(`Content-Range: ${cr}`);
        if (ar) notes.push(`Accept-Ranges: ${ar}`);
        if (r.status !== 206) notes.push('NOT 206 — server did not honor Range');
        const total = cr?.split('/')?.[1];
        if (total && /^\d+$/.test(total)) base.size_mb = Math.round(Number(total) / 1048576);
        try { await r.arrayBuffer(); } catch { /* drain */ }
      } catch (e) {
        notes.push(`range fetch threw: ${(e as Error).message}`);
      }

      // 3) faststart check (first 8KB)
      try {
        const r = await fetch(signedUrl, { headers: { Range: 'bytes=0-8192' } });
        const buf = Buffer.from(await r.arrayBuffer());
        base.faststart_bytes = faststartVerdict(buf);
        if (base.size_mb === '') {
          const cr = r.headers.get('content-range');
          const total = cr?.split('/')?.[1];
          if (total && /^\d+$/.test(total)) base.size_mb = Math.round(Number(total) / 1048576);
        }
      } catch (e) {
        base.faststart_bytes = 'error';
        notes.push(`faststart fetch threw: ${(e as Error).message}`);
      }
    }

    base.notes = notes.join('; ');
    rows.push(header.map(h => csvCell(base[h])).join(','));
    console.log(`${base.sign_ok === 'true' ? 'OK ' : 'ERR'} ${String(base.team).slice(0, 18).padEnd(18)} ${String(base.range_status).padStart(3)} ${String(base.faststart_bytes).padEnd(28)} ${v.url}`);
  }

  writeFileSync(OUT, rows.join('\n'));
  console.log(`\nWrote ${OUT} (${(videos?.length ?? 0)} videos).`);
}

main().catch(e => { console.error(e); process.exit(1); });
