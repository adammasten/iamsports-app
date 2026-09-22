# Perplexity — optimize pipeline review (2026-09-21)

Responding to `docs/OPTIMIZE_PIPELINE_DIAGNOSIS.md`.

## Verdict
Diagnosis substantially correct: the primary failure is **treating a best-effort mobile network
request as the durable handoff for a critical backend workflow**. Safest simple design: Postgres
owns job state; a server-side dispatcher enqueues/starts Railway work; Railway reports completion;
a periodic reconciliation sweep is retained as the repair path.

**Correction:** "the original request never reached Railway" is very plausible but **not strictly
proven** by a later successful re-POST. It could have reached an earlier Railway instance and failed
before durable job creation/observability. Either way the architecture must make request acceptance
and video state durable in Postgres, not infer success from a client `fetch()`.

**Bottom line:** do not make the phone responsible for kicking off processing, and do not make the
client wait for the 18-minute operation. *The completed optimized asset — not the original upload —
is the definition of ready.*

## Two gaps to add to the root cause
1. **No durable "intent to optimize."** The only record of the need to process lives implicitly in
   `videos.url` being raw. A sweep can work off that, but it records no attempts, next retry time,
   job identifier, last error, or operator action trail.
2. **No terminal-failure policy or alerting.** Retrying transient failures forever isn't enough.
   Corrupt media, unsupported codecs, storage permission errors and resource failures need a visible
   `failed` state, a reason, and a retry/repair path.

Also: `upload_status='ready'` right after raw upload is worse than a wording problem — it lets
downstream pages make an incorrect product promise, so a browser playback failure is experienced as
a *player bug* rather than a pipeline state.

## Ownership model
| Component | Responsibility | Must NOT own |
|---|---|---|
| Client | Upload bytes, create/update row, show status, optionally request retry | Starting or supervising the canonical job |
| Postgres/Supabase | Durable truth: desired state, attempts, job IDs, leases, errors, retries | The 18-minute ffmpeg process |
| Dispatcher Edge Function | Find eligible rows, request Railway job creation | Holding the transcode open |
| Railway | Download, optimize, upload, durably track job, atomically finalize, notify | Deciding whether a raw upload should exist |
| Reconciler | Repair missed dispatches, stale leases, missed completions | Normal per-video progress polling |

## Ranking the options
1. **Durable DB-backed job state + scheduled dispatcher — best fit.** The database state *is* the
   queue — not pg_net, not the client. High reliability, moderate complexity, 1–5 min latency
   (near-immediate if the client also pings a dispatcher), excellent recovery, best solo-dev fit.
2. **Railway completion webhook — strongly recommended but not sufficient alone.** Use for timely
   authoritative completion. A webhook can be lost after success, so the reconciler must detect
   "Railway says done but DB says processing" or inspect the known output object and repair.
   Preferable to client polling of `GET /job/:id` — clients should read status from Supabase
   (Realtime/polling of the video row), not become a job-control plane.
3. **Storage/DB webhook → Edge Function — useful fast path, not the reliability anchor.** A
   resumable/TUS upload can produce intermediate events or timing ambiguity; object creation alone
   may lack `video_id`/team/dedupe context. Prefer an explicit DB transition after raw-object
   verification over a raw Storage event.
4. **A real queue (Supabase Queues/PGMQ) — correct at higher scale, optional now.** Don't adopt a
   queue to avoid a 50-line dispatcher if you then have to build dead-lettering, retry limits and
   worker semantics around it anyway.

Do **not** run or await ffmpeg in an Edge Function — documented background-task limits are far below
an 18-minute job. Use `pg_cron` + `pg_net` only to *wake* an Edge Function; `pg_net` is asynchronous
and its responses are retained only temporarily, so it is not a durable job system.

## Status model without breaking filters
Do **not** immediately repurpose `upload_status='ready'` when many reads depend on it. Add a separate
processing contract, then migrate callers deliberately.

```sql
alter table videos
  add column optimize_status text not null default 'pending',   -- pending|dispatching|processing|succeeded|failed
  add column optimize_job_id text,
  add column optimize_attempts integer not null default 0,
  add column optimize_next_attempt_at timestamptz,
  add column optimize_lease_until timestamptz,
  add column optimize_last_error text,
  add column optimize_started_at timestamptz,
  add column optimize_completed_at timestamptz,
  add column optimized_url text;
```
Derive readiness rather than overloading a flag:
```sql
is_playable := optimize_status = 'succeeded'
               and original_url is not null
               and url <> original_url;
```
Make `optimized_url` explicit even if `url` stays the canonical playback key — it makes migration,
validation and incident debugging far easier.

**Compatibility plan:** (1) add `optimize_status` + backfill — optimized rows → `succeeded`, raw
`ready` rows → `pending`, terminal-known → `failed`; (2) create a `playable_videos` view / RPC so new
code queries `is_playable` instead of silently changing every old query at once; (3) migrate the
playback/tagger queries FIRST — they must filter `succeeded`, render "Processing video — check back
shortly" for pending/processing, and a retry path for failed; (4) eventually retire `upload_status`
into `upload_state: uploading|uploaded|failed` + `processing_state` + derived `playable`.

**On the single-enum alternative** (`uploading → processing → ready`): semantically clean, but
because `upload_status='ready'` filters are widespread it is a **potentially breaking rollout —
videos will disappear from existing listings during optimization.** If that's acceptable it's the
cleanest long-term design; otherwise use the two-axis model first. A boolean alone is insufficient:
pending, active, temporarily retrying and terminal failure are materially different for UX and ops.

## Completion webhook design (if adopted)
Treat it as **at-least-once**; never make correctness depend on one callback arriving.
Payload carries `event_id`, `event_type`, `occurred_at`, `video_id`, `job_id`, `source_key`,
`optimized_key`, `output_bytes`, `duration_ms`, `attempt` (failures add `error_code`, `retryable`,
`message`). Auth: **HMAC over the raw body** + timestamp + event id; secret in Railway and Edge
Function secrets; reject stale timestamps (>5 min); constant-time compare. Store `event_id` in a
`video_processing_events` table with a unique constraint — duplicate delivery returns 2xx and does
nothing. **Never trust a caller-provided `optimized_key` alone** — verify it matches the expected
deterministic key for that video/source, ideally HEAD the object before finalizing. Railway retries
non-2xx with backoff (immediate, 30s, 2m, 10m, 1h) reusing the same `event_id`, then marks
`callback_pending` for the reconciler.

Handler does a conditional, idempotent update:
```sql
update videos set url=:optimized_key, optimized_url=:optimized_key,
  original_url=coalesce(original_url,:source_key), optimize_status='succeeded',
  optimize_completed_at=now(), optimize_last_error=null, upload_status='ready'
where id=:video_id and (optimize_status <> 'succeeded' or optimized_url = :optimized_key);
```
Tighten in production: source key must match the row's known raw key; job id must match the current
job; a previous valid success must never be overwritten by an older job's callback.

## Idempotency and concurrency
Aim for **at-least-once triggers, exactly-once logical outcome**. Stable logical identity:
`optimize:<video_id>:<raw_key>:<raw_size>:<raw_checksum>` sent as `idempotencyKey`; Railway puts a
**unique index** on it — first request creates the job, concurrent duplicates return the original
jobId, a post-completion request returns the completed job, a new raw version is a new generation.

> **Do not use only the suffix test ("contains -720") as your idempotency guarantee.** It's a useful
> quick check but doesn't protect against a partially uploaded output, a wrong output for a different
> source revision, or duplicate concurrent work.

Atomic claim in the dispatcher:
```sql
with candidate as (
  select id from videos
  where optimize_status in ('pending','dispatching')
    and coalesce(optimize_next_attempt_at, now()) <= now()
    and (optimize_lease_until is null or optimize_lease_until < now())
  order by created_at for update skip locked limit 1
)
update videos v set optimize_status='dispatching',
  optimize_attempts=optimize_attempts+1,
  optimize_lease_until=now()+interval '10 minutes', optimize_last_error=null
from candidate where v.id=candidate.id returning v.*;
```
Call Railway *outside* the transaction; on accept → `processing` + job id + 30-min lease; on failure
→ back to `pending` with backoff and the error recorded.

**A stale lease is a recovery mechanism, not proof Railway stopped.** Before relaunching an expired
`processing` lease, query Railway by idempotency key / stored jobId: already running → renew lease;
completed → finalize; only launch again if Railway confirms no active/completed job.

**Output finalization:** write to a temp key → verify existence/content-type/size (ideally probe) →
promote to the deterministic final key → record success → only then repoint `videos.url`. Never leave
a window where `url` points at an incomplete object.

**Duplicate completion ordering:** add `processing_generation` (or source-version identity); every job
carries it; completion updates only when the row's generation matches; re-upload/manual reprocess
increments it; stale-generation events are rejected as harmless successes.

## Minimum viable fix this week
1. **Add processing fields** (`optimize_status`, `optimize_job_id`, `optimize_attempts`,
   `optimize_last_error`, `optimize_next_attempt_at`) and **backfill** — optimized → `succeeded`,
   raw ready → `pending`, confirmed terminal → `failed`.
2. **Change upload behavior:** set `optimize_status='pending'` (keep `upload_status='ready'` as
   temporary compatibility only), then call a `dispatch-video-optimize` Edge Function as a
   best-effort low-latency hint. Fine if that client call dies — the sweep does the same thing. Do
   not let the client move canonical state to `processing` unless the server claimed the job.
3. **Add a scheduled sweep** every 2–5 min: pending rows; stale `dispatching`/`processing` leases;
   inspect the deterministic output; call Railway with the idempotency key; record job id / error /
   attempt; bounded exponential backoff; mark `failed` only when Railway says non-retryable.
4. **Fix browser UX immediately:** `succeeded` → player/tagger; pending/dispatching/processing →
   "Preparing video for web playback"; `failed` → clear failure + retry for coaches/admins.
5. **Add visibility:** an admin list (video, team, uploader, raw + optimized key, status, attempts,
   job id, last error, age in state, "Retry optimization"). **Alert** when a row sits in
   pending/processing >45–60 min, exceeds 3–5 attempts, hits terminal failure, or when the count of
   legacy raw+ready rows is nonzero after migration.

## Long-term
Optional **durable outbox** (`video_processing_outbox` with idempotency key, attempts,
`next_attempt_at`, `locked_until`, last error) written in the same transaction that marks the video
pending — solves the dual-write problem ("marked pending, crashed before invoking Railway"), which
the sweep already survives but the outbox makes explicit and auditable.

**Railway job persistence:** a `jobs` table with `idempotency_key UNIQUE`, video id, generation,
status, stage, progress, source/output keys, error code/message, callback state/attempts, timestamps.
On `POST /optimize`: validate, insert-or-return by idempotency key, return **202 Accepted** with the
stable jobId — *never return acceptance before the job record is durable.*

**Progress model:** keep `GET /job/:id` but clients should read from Supabase. Don't overbuild exact
progress — "Downloading / Optimizing / Preparing for playback" is enough; ffmpeg percentages are
unreliable. The product statement is "the upload finished and the video is being prepared for web
playback," not an artificial 45%.

## Implementation cautions
- Don't let a storage event blindly launch work — confirm the final raw object is fully present.
- Don't expose Railway's service-role key outside Railway; reduce its blast radius where feasible.
- Don't make callback success depend on a single HTTP response.
- **Don't equate an optimized filename with an optimized asset** — verify the object exists and is usable.
- Don't delete raw originals until the optimized copy is verified and export/download policy is satisfied.
- Don't let a retry overwrite a newer upload generation.
- Don't rely solely on Database Webhooks / `pg_net` for retries.

## Suggested decision
**Adopt B + A now, then evolve to D + A**, with an optional lightweight server-dispatch fast path.
- B alone: not enough — still fails in exactly the described mobile conditions.
- A alone: eliminates permanence, but leaves avoidable delay and dishonest readiness.
- C alone: better than client kickoff, but must still be backed by state + reconciliation.
- D alone: fixes semantics and visibility, but doesn't guarantee job creation if the start event is missed.
- **D + A: the essential durable pair.** DB-backed dispatch/outbox + Railway idempotency + D + A = robust end state.

> In one sentence: write "this video needs optimization" durably to Postgres, dispatch it server-side
> with an idempotency key, let Railway report its durable outcome, and continuously reconcile anything
> that does not converge.
