# IamSports — video "optimize" pipeline failure: full diagnosis for external review

**Goal of this doc:** hand it to other AI assistants for a second opinion on the fix.
It is self-contained — you do **not** need the codebase to reason about it. Please
critique the root-cause analysis, poke holes, and propose the most robust-yet-simple
solution for a solo developer.

---

## 1. Product + stack (so you can reason without the code)

- **IamSports**: a youth-sports film app. Coaches upload full game videos from a phone,
  tag plays, cut highlight reels, share to team/parent walls.
- **Client:** Expo / React Native (iOS-first) + a React-Native-Web build (the web app).
- **Backend:** Supabase (Postgres + Storage + Edge Functions, Deno). RLS enforced.
- **Media processing:** a **separate Railway-hosted ffmpeg service** (its own codebase).
- **The core promise of the whole product:** *upload a game → it becomes watchable and
  taggable film.* If that breaks, the app doesn't work.

## 2. Why an "optimize" step exists

iPhone game videos are large `.mov` files that are **not "faststart"** — the moov index
atom sits at the *end* of the file. Consequences:
- **Web browsers refuse to STREAM a non-faststart MP4** (they'd have to download the whole
  multi-GB file before playing). So a raw upload **will not play in the web app.**
- Native players tolerate non-faststart, so it *may* play on the phone but not the browser.

So after upload, the app must produce a **720p H.264, yuv420p, `-movflags +faststart`**
copy for streaming. That's the "optimize" step.

## 3. The data contract (Postgres `videos` table)

- `url` — the **storage object key** (NOT a URL) that playback signs and streams.
- `original_url` — set to the **raw** object key once optimize runs (kept for export/download).
- `upload_status` — enum: `uploading` | `ready` | `failed`.
- Healthy/optimized row: `url` points at the optimized copy (key contains a `-720…` suffix),
  `original_url` = the raw key, `upload_status='ready'`.
- Raw/unoptimized row: `url` = raw key (e.g. `…-0.mp4`), `original_url` = NULL.

## 4. How the pipeline is SUPPOSED to work

1. Client uploads the raw bytes to Supabase Storage (resumable/TUS on web; a chunked loop
   on mobile). Inserts a `videos` row (`url` = raw key, `upload_status='uploading'`).
2. On upload completion, the client fires a request at the Railway server:
   `POST https://…railway.app/optimize` with body `{ "key": "<raw object key>" }`.
3. **Railway (using the service-role key)** downloads the raw file, remuxes/transcodes to
   720p faststart, uploads the optimized copy, **repoints `videos.url`** to it, and sets
   `videos.original_url` = the raw key. It is **idempotent** (skips already-optimized keys)
   and exposes `GET /job/<jobId>` → `{ status, stage, progress }`
   (`downloading` → `transcoding` → `uploading` → `done`).
4. The client flips `upload_status` to `ready`.

This works ~90% of the time (19 of 22 videos in the DB are correctly optimized).

## 5. The actual incident (what broke)

A coach uploaded a full flag-football game ("V Steelers") from a phone. It was marked
`upload_status='ready'`, but **3+ hours later it was still raw** (`url` = raw `…-0.mp4`,
`original_url` = NULL). It would not play in the web app / tagger.

**Key evidence:** re-firing the **identical** `POST /optimize` request (same key) later
returned a `jobId` and HTTP 200 immediately, and the job completed normally in ~18 min
(≈4 min download + ~11 min transcode + ~2 min upload). So **the Railway server was healthy
the whole time.** That means the *original* request from the phone **never reached the
server** — and nothing ever retried or noticed.

Across the whole library: ~2 of 22 videos are stuck in this raw-but-`ready` state (rare,
but it's the core promise, and there is zero visibility when it happens).

## 6. The current implementation (verbatim)

The optimize kickoff — a **single fire-and-forget `fetch`, no retry, no confirmation**:

```ts
// lib/native/optimize.ts  (comment says: "FIRE-AND-FORGET by design … its failure must
// NOT break the upload — the raw video still exists and can be optimized later")
export function optimizeVideoInBackground(key: string): void {
  fetch(`${SERVER_URL}/optimize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  })
    .then(async (r) => { /* just logs the jobId */ })
    .catch((e) => console.warn(`[optimize] kickoff failed for ${key} (non-fatal):`, e));
}
```

The upload flow — flips to `ready` **in the same breath** it fires optimize, *before*
optimize finishes or even confirms it started:

```ts
// app/upload.tsx  (and app/game.tsx add-to-game is identical)
await uploadVideoToBucket(fileName, files[i], setProgress, bytes);
optimizeVideoInBackground(fileName);                 // fire-and-forget
await supabase.from('videos')
  .update({ upload_status: 'ready' }).eq('id', vid); // <-- "ready" set here
```

A reconciliation runs on app launch, but it **only size-verifies the raw upload** and flips
`ready` — it does **not** check for or re-trigger a missed optimize. No cron job, DB
trigger, or storage webhook re-optimizes anything.

## 7. Root cause — three compounding gaps

1. **`upload_status='ready'` conflates "uploaded" with "playable."** It's set at raw-upload
   completion, before optimize runs. So the status can (and does) say `ready` on an
   unplayable video.
2. **The optimize trigger is a single, unverified, un-retried client request.** If that one
   `fetch` fails, it's swallowed as "non-fatal." Likely failure causes for the incident:
   the phone dropping/switching networks right after a long upload, the app being
   backgrounded/locked the instant the upload finished (killing the in-flight request), or
   Railway being cold and the single request timing out.
3. **There is no recovery.** Nothing reconciles or re-fires a missed optimize. The miss is
   **silent and permanent** until a human manually re-runs it.

Net: the app's single most important flow has a **single point of failure with no retry and
no visibility**, and it violates the product's stated "never fail silently" rule.

## 8. Constraints any fix must respect

- **Mobile-first, hostile networks:** coaches upload multi-GB games on gym/tournament wifi;
  phones background/lock right after a long upload. The client **cannot be relied on to stay
  alive** to babysit a 15–20 min job.
- **Optimize is long** (~15–20 min for a full game) and **must stay async** — it must never
  block the upload UI.
- **Web requires faststart**; native tolerates raw. So "playable everywhere" == optimized.
- **Railway is a separate service** already doing the transcode and writing results back to
  the DB via the service-role key. It offers `POST /optimize {key} → {jobId}` and
  `GET /job/{id}` (idempotent; skips already-optimized keys). We can change the Railway code
  too if needed (e.g., add a completion webhook).
- **Supabase primitives available:** Postgres (triggers, and `pg_cron` / `pg_net` on Pro),
  Storage with object events/webhooks, Edge Functions (Deno, schedulable), Auth/RLS.
- **Existing rows/queries** filter on `upload_status='ready'` in many places — a status-model
  change must not silently break those.
- **Solo developer:** prefer robust-but-simple; minimal moving parts; idempotent and safe to
  retry. (A separate native background-**upload** module exists but is out of scope here.)

## 9. Candidate solutions (please critique / improve / pick)

**A. Reconcile sweep (safety net).** A scheduled job (Supabase `pg_cron` calling an Edge
Function via `pg_net`, or an Edge Function on a schedule) that periodically finds
`ready`-but-raw videos and re-fires `/optimize`. *Pros:* catches every miss regardless of
cause; tiny; idempotent. *Cons:* interval latency; doesn't by itself stop `ready` from lying.

**B. Durable client kickoff.** Retry the POST with backoff; only mark `ready` after a
`200 + jobId`; otherwise leave the row in a non-ready state for the sweep to handle. *Pros:*
fixes most misses at the source. *Cons:* still dies if the phone backgrounds/leaves.

**C. Server-side trigger.** Fire optimize from a **Supabase Storage event / DB trigger /
Edge Function** when the video row (or storage object) is created, instead of from the
client. *Pros:* decoupled from the phone; can be retried server-side. *Cons:* need a
reliable Supabase→Railway trigger; more infra.

**D. Honest status + completion callback.** Add a real `processing` state (or derive one);
have **Railway call back a Supabase Edge Function webhook on job completion** (instead of us
polling) to flip `processing → ready`. Store the `jobId` on the row so the UI can show
`GET /job/{id}` progress ("Processing… 45%"). *Pros:* status stops lying; enables the
"still optimizing" UX the product wants; single source of truth. *Cons:* touches client,
DB, and Railway.

*(These combine: e.g. C or D as the primary path + A as the always-on safety net.)*

## 10. Specific questions for the reviewer

1. What is the **most reliable Supabase-native way** to trigger and track a **15–20 min
   external job** when the initiating client (a phone) cannot be relied on to stay alive?
   Rank: `pg_cron` sweep vs. Storage webhook → Edge Function vs. Railway→Supabase completion
   webhook vs. a real queue.
2. Should **Railway push a completion webhook** to a Supabase Edge Function, rather than the
   app polling `/job/{id}`? What are the failure modes (missed webhook, retries, auth)?
3. How should we **model the status** so `ready` never means "unplayable," **without breaking**
   the many existing `upload_status='ready'` filters? (New enum value? A separate
   `optimize_status`/`playable` boolean? A derived view?)
4. **Idempotency & concurrency:** how to guarantee we never double-optimize and that retries
   (sweep + kickoff + webhook all firing) are safe?
5. What's the **minimum viable version** that removes the silent-failure risk for a solo dev
   this week, vs. the "correct" long-term architecture?

---

### Appendix — quick facts for grounding
- ~90% success today (19/22 optimized); ~2 stuck raw. One stuck video was repaired manually
  by re-POSTing `/optimize` and polling `/job/{id}` to completion.
- Measured optimize time for a full flag game: **~18 minutes**.
- The manual repair proves the server + endpoints are healthy; the gap is entirely in
  **triggering reliably + tracking + surfacing**, not in the transcode itself.
