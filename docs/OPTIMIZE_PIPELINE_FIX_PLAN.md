# Optimize pipeline — decisions + fix plan

**Status:** DECIDED, NOT BUILT. No code has been written. Invariant 7 (the loop) applies:
each step needs a pre-code report and Adam's paste-approval before any code.

**Date:** 2026-09-21
**Inputs:** `docs/OPTIMIZE_PIPELINE_DIAGNOSIS.md` (the brief sent out) + three external reviews in
`docs/video-ai-responses/` (`gemini-`, `chatgpt-`, `perplexity-optimize-pipeline.md`) + a direct
audit of the Railway source (`~/iamsports-server/index.js`) and the live database.

---

## 1. The problem, one paragraph

Upload → playable film is the product's core promise. Today optimize is kicked off by a **single
fire-and-forget `fetch`** from the phone (`lib/native/optimize.ts:17`), and `upload.tsx:271` flips
the row to `upload_status='ready'` **in the same breath** — before optimize confirms it even
started. If that one request dies (backgrounding, network change, Railway cold start, Railway
restart), nothing retries and nothing notices. `ready` lies, the video never plays on web, and the
miss is **silent and permanent**. This is a job-orchestration bug, not an ffmpeg bug.

---

## 2. Facts verified this session (not assumptions)

These were checked against the Railway source and the live DB. Several contradict the brief that
was sent to the external AIs.

| # | Fact | Evidence |
|---|---|---|
| F1 | **`/optimize` is NOT idempotent.** `processOptimize` has no pre-check — it downloads, transcodes and uploads unconditionally. No dedupe by key. | `~/iamsports-server/index.js:487` |
| F2 | The DB write is `.eq('url', key)` — an **accidental compare-and-swap**. A duplicate job can't corrupt the row; the loser throws "No videos row found". Cost of a duplicate = wasted CPU + an orphan `-720` object + a false `failed`. | same, step 4 |
| F3 | **The job registry is in-memory** (`const jobs = {}`) plus a TTL cleaner. A Railway redeploy/restart kills an in-flight job silently AND makes `GET /job/:id` 404. | `index.js:15` |
| F4 | **Railway already writes Postgres directly** with the service-role key (`original_url`, `url`, `upload_bytes`, then `thumbnail_path`). | `index.js` processOptimize step 4–5 |
| F5 | `pg_cron 1.6.4` + `pg_net 0.20.0` are **already installed**, and 3 cron jobs already `net.http_post` to Edge Functions (`purge-deleted-daily`, `process-notifications`, `snack-reminders`). The pattern is proven in production here. | live DB, `cron.job` |
| F6 | `videos.upload_status` **column default is `'ready'`** — a row is *born* ready, it isn't only set early. | `information_schema.columns` |
| F7 | Live counts (26 videos): **21** optimized OK, **1** already-720 but `original_url` NULL, **3** `upload_status='failed'` (background-upload experiments), **1** genuine straggler ("Shot vid clip 1…", Jun 26, `ready` + raw). | live DB |
| F8 | `/optimize-all` selects on `original_url is null` with **no** status filter → on live data it matches 5 rows of which only 1 should be touched. It would re-transcode the already-720 row and **overwrite `original_url` with the 720p key, destroying the master reference**. | `index.js:183` + F7 |

**Correction to the diagnosis:** "the server was healthy, therefore the original request never
reached Railway" does **not** follow — ChatGPT and Perplexity both flagged it, correctly. It only
proves *no durable successful optimize job existed*. F3 supplies a concrete alternative: a Railway
restart could have eaten an accepted job. The fix must cover both.

---

## 3. Decisions

### D1 — Status model: separate column now, ChatGPT's semantics later. **(Gemini + Perplexity, 2-1)**
Add `optimize_status`; leave the `upload_status` enum alone for now.

ChatGPT argued for adding `processing` to the existing enum so `ready` finally means "playable" and
every existing query becomes correct for free. It is the more elegant end state, and its rule —
*only Railway may transition to ready* — is the right principle. **Rejected for now on evidence
neither AI had:** installed native builds both *read* `upload_status='ready'` **and write it**
(`app/upload.tsx:271`). Under the enum model an old TestFlight build makes every new upload
invisible for ~18 minutes *and* keeps writing a premature `ready` — re-creating the lie. Under a new
column, old builds can't touch the new truth. That is invariant 4 (additive-first). Perplexity
independently named the same risk: "videos will disappear from existing listings during optimization."

**Beyond what any reviewer proposed:** enforce the rule in Postgres, not by convention — a trigger
that refuses to mark a row playable without evidence of a real optimized object. That holds for
every client, current and future.

### D2 — No Railway → Supabase completion webhook. **(ChatGPT, against Gemini + Perplexity)**
Per F4, Railway already updates Postgres. Setting the status is **one more field in an UPDATE that
already runs**. A webhook would add a signing secret, an HMAC handler, a retry ladder, and an events
table — plus a missed-webhook failure class — to buy something already working. Perplexity's real
concern underneath ("don't expose the service-role key outside Railway") is legitimate but is a
**separate security item**, not part of this fix.

### D3 — Ordering is part of the decision: **idempotency before the sweep.**
No reviewer sequenced this, and every one of their plans is unsafe as written. Per F1, a ready-but-raw
row looks identical whether it is abandoned or 12 minutes into a healthy 18-minute transcode. Ship a
sweep first and it fires a second ffmpeg pass on the same container every cycle — the server's own
`/optimize-all` comment says "never two CPU-heavy transcodes at once."

### D4 — The sweep filter is evidence-based and status-aware, never filename-only.
Perplexity: "do not equate an optimized filename with an optimized asset." F7/F8 prove it on live
data. The filter must exclude `failed` and `deleted_at`, exclude already-720 rows, and respect an age
/ attempt / lease guard. `/optimize-all`'s filter must not be reused as-is.

### D5 — Backfill in the same migration as the column.
Nobody spelled this out. Add `optimize_status` defaulting to `pending`, gate playback on it, and
**all 21 working videos vanish** until backfilled. Backfill by evidence, same transaction.

### D6 — Sweep cadence: every 5 minutes (after D3 lands).
Gemini said 15, Perplexity 2–5, ChatGPT 1–2. Moot until dedupe exists; 5 min after.

### D7 — Keep ffmpeg on Railway; Edge Function dispatch only.
Edge Functions cap ~400s vs. an 18-minute job. Supabase = state/coordination, Railway = heavy worker.
`pg_cron` + `pg_net` only *wake* the dispatcher; `pg_net` is not the durable store (unlogged tables).

### D8 — Progress UX reads the DB column, not `GET /job/:id`.
Per F3 the registry is volatile and 404s after a redeploy. Perplexity is right that
"Downloading / Optimizing / Preparing for playback" beats a fake percentage.

---

## 4. Settled by all three reviewers (no further debate needed)

1. Durable truth lives in Postgres; the client `fetch` is a **latency hint only**.
   *"The fact that work needs to happen must be durable. The HTTP call telling somebody to do the
   work does not need to be durable."* — ChatGPT
2. The reconciliation sweep is **permanent infrastructure**, not a workaround — it also covers
   Railway restarts, deploys mid-kickoff, lost job records, and future bugs.
3. Railway must claim atomically per `video_id + source_key` and return the existing jobId for
   duplicates. At-least-once triggers, exactly-once logical outcome.
4. The UI must show Processing / Failed / Retry.
5. Terminal failures need a visible `failed` state, a reason, and a repair path (Perplexity) — retry
   forever is not a policy.

---

## 5. The plan

| Order | Change | Touches | New app build? |
|---|---|---|---|
| 1 | Railway: claim-by-key, return existing jobId for duplicates, verify output before repointing | Railway only | No |
| 2 | `pg_cron` sweep → dispatch Edge Function; evidence-based filter (D4); backoff + lease | Supabase only | No |
| 3 | `optimize_status` column + evidence backfill + `playable` view + DB guard trigger | Migration | No |
| 4 | Railway sets the status in the UPDATE it already performs (F4) | Railway only | No |
| 5 | "Processing… check back shortly" + Failed/Retry UI | App + web | Yes |

**Steps 1–4 remove the silent-permanent-failure class without shipping a new app build** — which
matters, because anything in front of installed builds is where the regressions come from.

Deferred to a later phase if volume warrants: a real `optimize_jobs` table or Supabase Queues/pgmq
with leases, dead-lettering and admin observability; a durable outbox; `processing_generation` to
stop an old job's completion clobbering a newer reprocess.

---

## 6. Open items

- [ ] **Send the corrected addendum to the AIs.** The brief they answered states `/optimize` is
      idempotent (false, F1). Gemini leaned on it hardest. Also worth giving them F3, F4, F7.
- [ ] **The June straggler** ("Shot vid clip 1 qtrlars from derp in SA", `fe509b21-…`) is still raw
      and `ready` — a genuine manual re-optimize target.
- [ ] **The already-720 / `original_url` NULL row** needs eyeballing before any sweep runs (F7/F8).
- [ ] **Pre-code report for step 1** — blast radius, consumers, baseline, adversarial pass ×2.
- [ ] Upload speed (separate media-path concern, parked).
- [ ] Railway service-role blast radius (Perplexity's security note, separate from this fix).

## 7. Related docs
- `docs/OPTIMIZE_PIPELINE_DIAGNOSIS.md` — the brief sent to the external AIs (contains the F1 error)
- `docs/BACKEND_HEALTH_DASHBOARD.md` — manual health checks ("run the backend health checks")
- `docs/video-ai-responses/{gemini,chatgpt,perplexity}-optimize-pipeline.md` — the three full reviews
