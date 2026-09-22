# Gemini — optimize pipeline review (2026-09-21)

Responding to `docs/OPTIMIZE_PIPELINE_DIAGNOSIS.md`.

## 1. Critique of Root-Cause Analysis
Root-cause analysis is spot on. Conflating upload completion with optimization readiness is
the architectural sin.
- **Why it fails:** treating a fire-and-forget client fetch as reliable delivery on mobile
  networks is a classic trap. Phones drop connections, lock screens, or switch Wi-Fi to
  cellular the moment a large upload hits 100%, killing trailing async tasks.
- **Structural flaw:** the database tells a lie (`upload_status='ready'`), breaking the
  downstream promise that "ready = playable everywhere (including web)."

## 2. Answers to the 5 questions

**Q1 — Most reliable trigger/tracking for a 15–20 min external job?**
Hybrid winner: Storage Webhook / DB insert trigger → Railway (async) + `pg_cron` sweep as
safety net. Since the phone cannot be trusted, the database or storage layer must be the
orchestrator, not the client. Ranking:
1. DB/Storage trigger calling Railway (or via Edge Function) + `pg_cron` reconciliation — virtually bulletproof
2. Railway→Supabase completion webhook (status updates)
3. Client-side polling (fragile, ties up the app)
4. Message queues (SQS/RabbitMQ) — overkill for a solo dev; Postgres is your queue

**Q2 — Should Railway push a completion webhook?**
Yes, but keep it simple. Railway POSTs a Supabase Edge Function (or updates Postgres directly
via service role) when transcoding finishes.
- *Failure mode:* if the webhook drops, the video stays stuck in `processing`.
- *Antidote:* this is precisely why the reconciliation sweep (A) is mandatory — an hourly/nightly
  `pg_cron` job catches it, checks Railway via API, or re-triggers.

**Q3 — Status modeling without breaking existing code?**
Add a separate `optimize_status` enum (`pending|processing|completed|failed`) alongside
`upload_status` rather than polluting the existing enum.
- *Why safe:* `upload_status='ready'` keeps meaning "bytes are safely in storage" (existing
  upload UI logic unaffected); web/tagger playback queries change to require BOTH
  `upload_status='ready'` AND `optimize_status='completed'` — or create a Postgres view
  `playable_videos`.

**Q4 — Idempotency & concurrency?**
Railway's `/optimize` is already idempotent (skips already-optimized keys). Make the DB side
race-safe with a unique constraint or conditional update — optimistic locking:
`UPDATE videos SET optimize_status='completed' WHERE id=x AND optimize_status != 'completed'`.

**Q5 — MVP this week vs. long-term?**
- **MVP:** a `pg_cron` job (or scheduled Edge Function) every 15 minutes that finds rows where
  `upload_status='ready'` and `optimize_status` is null/pending, and re-fires `POST /optimize`.
  Either stop setting `ready` globally until optimization is handled, or just let the cron sweep
  be the async safety net so unoptimized videos auto-recover within 15 minutes.
- **Long-term:** DB insert trigger / Storage webhook fires optimization automatically; Railway
  calls a Supabase webhook on completion; `pg_cron` sweep as the ultimate dead-letter fallback.

## 3. Recommended action plan
1. **Add an `optimize_status` column** (`pending|processing|completed|failed`) to `videos` —
   decouple raw upload from transcode state.
2. **Implement the cron safety net** — lightweight `pg_cron` job querying for unoptimized
   videos and re-triggering Railway's endpoint.
3. **Update web playback filters** — web + tagger queries require `optimize_status='completed'`
   before streaming, preventing browser errors on raw `.mov` files.
