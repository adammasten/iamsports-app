# ChatGPT — optimize pipeline review (2026-09-21)

Responding to `docs/OPTIMIZE_PIPELINE_DIAGNOSIS.md`.

## Verdict on the diagnosis
Core finding is right: this is **not an FFmpeg bug**, it is a job-orchestration /
state-management bug. The design lets the only optimize request disappear, immediately marks
the video `ready`, and has nothing durable saying "this video still needs work."

## Corrections to the diagnosis
1. **Soften the causal claim.** "The manual repair proves the server was healthy, therefore the
   original request never reached Railway" does not follow. It proves a *later* identical request
   succeeded. The original could have: never left the phone; reached Railway's edge but not the
   app; reached the app and failed before a durable job record existed; **created an in-memory job
   that disappeared on restart**; started then failed; or completed ingress while a later state
   update failed. Evidence establishes "there was no durable successful optimize job," not "the
   POST never arrived." The fix must protect against all of these.
2. **moov-at-end nuance.** It does not universally mean a browser must download the whole file —
   behavior depends on byte-range serving and player behavior. The faststart derivative is still
   the right design requirement.

## Architecture recommended
Treat the DB row as the video's **boarding pass**: once the raw upload exists, the phone can
vanish and the rest still happens.

```
PHONE → SUPABASE STORAGE → VIDEOS ROW (upload_status='processing', original_url=raw key)
   ├── optional immediate kickoff ──► RAILWAY /optimize
   └── periodic reconciliation ─────► RAILWAY /optimize
                                          → download → ffmpeg → upload optimized
                                          → DB: url=optimized key, upload_status='ready',
                                                optimized_at=now()
```

**The rule:** *only Railway may transition `processing → ready`, and only after the optimized
object is uploaded and the DB points at it.* That single rule eliminates the false-ready state.
Current code violates it by firing optimize and marking `ready` immediately after.

## Answers to the 5 questions
| Q | Recommendation |
|---|---|
| 1. Trigger/track a 15–20 min job | **Durable DB state first**, then retryable server-side dispatch. A real Supabase Queue (pgmq) is strongest for a formal queue, but at this scale the `videos` table + a reconciliation job is plenty. |
| 2. Railway completion webhook? | **No, not yet.** Railway already writes Supabase. Have Railway make the final `ready` update itself. An Edge Function callback between Railway and the same DB adds a hop and a failure mode without buying much. |
| 3. Status model | **Add `processing` to the existing enum:** `uploading → processing → ready`. Existing `ready` filters then automatically become safer/correct. |
| 4. Idempotency/concurrency | Every trigger calls the same `ensureOptimize(videoId, rawKey)`. Railway must **atomically claim** one job per video/raw object and return the existing jobId for duplicates. |
| 5. MVP this week | Add `processing`, stop the client setting `ready`, add a scheduled reconciliation sweep, make Railway set `ready`. Most of the reliability benefit without a full queue. |

## Detail
**Keep the 18-minute work on Railway.** Don't let an Edge Function babysit FFmpeg — Edge Functions
cap at ~400s wall clock on paid plans. Supabase = state/coordination; Railway = heavy worker. The
cron/Edge invocation should live ~200ms: POST Railway, receive jobId, save jobId, done.

**Why the enum beats a second column.** You said many queries already use `upload_status='ready'`.
Keep them — they will finally mean what you always thought: *show me playable videos*. Only screens
that should show an uploaded-but-not-playable game change, to
`upload_status in ('processing','ready')` rendering "Processing video… 45%". Introducing
`optimize_status` while still setting `upload_status='ready'` leaves all those old `ready` queries
as land mines. Split into `processing_status` later only if the state machine gets complicated.

**Stop using `original_url IS NULL` as a hidden processing flag.** Set `original_url = rawKey` as
soon as the raw upload finishes; after Railway succeeds, `url = optimizedKey`, `original_url`
unchanged, `upload_status='ready'`. Fields should describe what they are.

**Idempotency over exactly-once.** Don't try to guarantee one request is ever sent — want the
opposite: *requests may happen repeatedly; processing must be safe when they do.* Client, cron
sweep, admin repair button and any future webhook should all be able to shout "OPTIMIZE VIDEO 123!"
at once without three FFmpeg processes. Give the job a stable identity (`video_id + source_key`
preferred, in case a video is ever replaced), and have Railway do:
```
already optimized? → return done
job already running? → return existing jobId
no active job? → atomically claim, start, return jobId
```
A unique constraint on (video_id, source_key) plus an atomic claim/lease makes duplicate kickoffs
harmless — far stronger than hoping the network delivers exactly one POST.

**The sweep deserves more credit than the doc gives it.** It is not merely a workaround for flaky
mobile networking — it protects against bugs not yet invented: client kickoff failed, Railway
restart, deployment during kickoff, job record lost, unexpected exception, manual DB change, future
webhook failure, processing timeout. Every minute it asks "are there videos claiming to be
processing with no successful optimized result?" → `ensureOptimize(video)`. Excellent self-healing.
Run it **every 1–2 minutes**.

**Ranking by responsibility (not interchangeable):**
1. Durable DB state / queue = truth about work that must happen
2. Railway direct DB completion update = authoritative completion
3. Cron reconciliation sweep = permanent safety net
4. Immediate client kickoff = latency optimization only
5. DB/storage webhook event = optional future speed optimization

**Do not use `pg_net` as the durable queue itself** — Supabase docs note its HTTP request/response
storage uses **unlogged tables not preserved through crashes**. Hence: *the fact that work needs to
happen must be durable; the HTTP call telling somebody to do it does not.*

## Ship this week
```
1. Add upload_status = 'processing'
2. Raw upload completes → upload_status='processing', original_url=rawKey
3. Keep optimizeVideoInBackground() but treat it strictly as a fast-path hint
4. REMOVE: client → upload_status='ready'
5. Railway succeeds → url=optimizedKey, upload_status='ready', optimized_at=now()
6. Reconciliation every 1–2 min: find processing rows where optimized result is absent
   and no recent optimize attempt exists → POST /optimize
7. Railway /optimize becomes strongly idempotent per video/raw-object identity
8. UI: processing → "Processing video…"; ready → player/tagger; failed → retry/error
```
Phase two if volume warrants: a proper `optimize_jobs` table or Supabase Queue with attempt counts,
leases, errors, progress, dead-letter behavior and admin visibility.

**Closing:** for the product's core promise (upload → watchable/taggable film), "fire and forget" is
the wrong primitive. "Record durably and retry forever until terminal success/failure" is the right one.
