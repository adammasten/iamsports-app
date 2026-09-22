# Backend Health Dashboard — spec + manual checks

A single place Adam can look to see whether the **backend is actually doing its job** —
uploads landing, videos becoming playable, reels rendering, playback working. Today
this is a **spec + a set of manual SQL checks** (Claude can run any of them on request
via the Supabase MCP). Later it becomes a real admin screen (a `/admin` page, super-admin
only) that runs these same checks and shows red/green.

> **Why this exists:** the app's core promise is *upload → watchable film*. When a step
> silently fails, nothing surfaces it today — a video can show `ready` while being
> unplayable (see Check 1). This dashboard is how we catch that before a coach does.
> (Aligns with the "never fail silently" invariant.)

---

## How to read a check

Each check has: **What it catches · Signal (SQL) · Why it matters · Current status.**
Green = zero rows. Any rows = investigate. The queries are safe (read-only).

---

## Check 1 — Optimization not working (video `ready` but still raw / unplayable)

**What it catches:** a video whose upload finished (`upload_status = 'ready'`) but whose
720p faststart copy was never produced — so `videos.url` still points at the raw file.
On web these **won't stream**. This is exactly what happened to "V Steelers" (2026-09-21).

**Signal (SQL):**
```sql
select id, label, team_id, created_at,
       upload_status, (original_url is not null) as optimized,
       right(url, 45) as url_tail
from public.videos
where deleted_at is null
  and upload_status = 'ready'
  and original_url is null                         -- optimize never repointed
  and (url not ilike '%-720%' and url not ilike '%-fs%')  -- url still serving raw
  and created_at < now() - interval '30 minutes';  -- give fresh uploads time to process
```
(30-min grace so a video that's *legitimately still processing* isn't flagged. Note: one
known false-positive class is old demo-account rows whose `url` is optimized but
`original_url` is null — eyeball `url_tail`.)

**Why it matters:** this is the #1 core-loop failure. A stuck video = a coach who can't
tag or watch, with **no error shown**.

**Fix when found (manual, until the durable fix ships):** re-fire the optimize job —
`POST https://web-production-1bf7f.up.railway.app/optimize` with body
`{"key":"<videos.url object key>"}`, then poll `GET /job/<jobId>` until `status:"done"`,
then confirm the row repointed (`url` gains a `-720…` suffix, `original_url` = raw).

**Root cause (confirmed 2026-09-21):** optimize is kicked off by a **single fire-and-forget
client `fetch`** (`lib/native/optimize.ts:17` → Railway `/optimize`) right after upload, and
`upload_status` is flipped to `ready` in the same breath (`app/upload.tsx:271`,
`app/game.tsx:133`) — *before* optimize completes or even confirms it started. If that one
request fails (phone drops wifi / app backgrounded / Railway cold start), the code logs
`"non-fatal"` and moves on. **Nothing retries, nothing reconciles the optimize step, and the
status says `ready`.** `reconcilePendingUploads` only verifies the raw upload, not optimize.

**Prevention (options, not yet built — decide later):**
1. **Reconcile sweep** (cheapest safety net): a periodic job (cron / edge function, or on
   app open) that runs Check 1's query and re-fires `/optimize` for any hit. Catches every
   miss regardless of cause.
2. **Durable kickoff:** retry the `/optimize` POST with backoff, and only mark `ready` once
   Railway returns a `jobId` (200); otherwise leave the video `processing` for the sweep.
3. **Server-side trigger:** fire optimize from a Supabase DB/storage webhook instead of the
   client, so it doesn't depend on the phone staying alive.
4. **Split the status:** add a real `processing` state; only `ready` when the optimized copy
   exists — so the UI never shows a green "ready" on a raw video (see the "Processing…" UX
   note below).

**Current status:** ⚠️ known-fragile. V Steelers repaired manually 2026-09-21.

---

## Check 2 — Uploads not working (failed or stuck)

**What it catches:** uploads that failed outright, or rows stuck mid-upload (app died,
network died) and never reconciled.

**Signal (SQL):**
```sql
select id, label, team_id, created_at, upload_status
from public.videos
where deleted_at is null
  and ( upload_status = 'failed'
     or (upload_status = 'uploading' and created_at < now() - interval '2 hours') )
order by created_at desc;
```

**Why it matters:** a failed/stuck upload = the coach's film never made it. `failed` rows
are (by design) visible + deletable in Film Room, but a **cluster** of them signals a
broader problem (storage, token refresh, Railway, a bad build).

**Current status:** (run to populate).

---

## Backlog — checks to add

- **Reel render failures** — `highlight_reels.status` stuck/errored, or `storage_path`
  null long after creation.
- **Playback / entitlement errors** — spikes in `sign-media` 403/404 (needs function logs,
  not just DB).
- **Background upload failures** — once the native background uploader is wired in.
- **Non-faststart reels** — reels that skipped the faststart concat pass.
- **Signups / activity pulse** — new users/day, teams created, videos uploaded, reels made
  (engagement, not errors — but useful on the same screen).
- **Orphans** — empty games (no videos), shares whose content no longer resolves.

---

## "Processing…" UX (separate from this dashboard — research parked)

Today, while a video optimizes (~15–20 min for a full game: ~4 min download + ~11 min
transcode + ~2 min upload, measured on V Steelers), the app shows a **blank/failed player**
because it tries to play a raw file marked `ready`. We want a visible **"Processing… check
back in a few minutes"** state instead. The Railway `/job/<id>` endpoint already reports
`stage` + `progress` (downloading/transcoding/uploading/%), so the app *could* show real
progress if it stored the `jobId` on the video row and polled it — or, minimally, derive a
generic "Processing…" banner from the row still being raw. Design later.

---

## Notes

- Manual checks run via the Supabase MCP (read-only SQL). Ask Claude to "run the backend
  health checks" any time.
- A real admin screen is the eventual home for these — super-admin gated (`is_super_admin()`),
  read-only, one row per check with a count + the offending rows on tap.
