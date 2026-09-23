# Production required secrets

One source of truth for the credentials production depends on. **Names only — never
values.** Nothing in this file is a secret; it exists so a missing one is obvious before
it becomes a mystery.

> **Why this file exists.** The native background uploader was built, reviewed, shipped
> behind a flag and sent to TestFlight — and had never once worked, because
> `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` were never set. Every failure surfaced to
> the user as *"nothing was saved."* Nothing in the repo recorded that those secrets were
> required. (2026-09-23)

## Check it in one command

```
SUPABASE_SERVICE_ROLE_KEY=... npm run preflight
```

Creates a throwaway S3 multipart upload and immediately aborts it — proving the deployed
service can really authenticate, not merely that a variable is non-empty. Leaves no data
behind and prints no credentials. **Run it before every TestFlight / production release.**

## Supabase Edge Functions
Set with `npx supabase secrets set NAME=...`. All server-only.

| Variable | Feature that breaks without it | Server-only |
|---|---|---|
| `S3_ACCESS_KEY_ID` | `multipart-upload` → **all background/native uploads**. Create key pair: Dashboard → Project Settings → Storage → S3 Access Keys | yes |
| `S3_SECRET_ACCESS_KEY` | same as above | yes |
| `S3_REGION` *(optional)* | defaults to `us-east-1` | yes |
| `S3_ENDPOINT` *(optional)* | defaults to the project's storage endpoint | yes |
| `SUPABASE_URL` | every Edge Function (auto-provided) | yes |
| `SUPABASE_SERVICE_ROLE_KEY` | every Edge Function (auto-provided) | yes |
| `purge_secret` *(Vault)* | `purge-deleted` cron authorization | yes |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | web push | yes |

## Railway (ffmpeg transcode service)

| Variable | Feature that breaks without it | Server-only |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | **everything** — `/optimize`, `/export`, `/faststart`, `/concat-game`, thumbnails. Without it Railway cannot read storage or repoint `videos.url`, so uploads never become playable | yes |
| `SUPABASE_URL` | as above (falls back to the hardcoded project URL) | yes |
| `PORT` | provided by Railway | yes |

`GET /` reports `supabaseConnected` — the preflight checks it.

## App / Vercel

No server-side secrets. `supabase.js` embeds the project URL and the **anon** key by
design (safe to ship; RLS is the boundary). There is no `.env`.

---

## RULE: adding a new required credential

Whenever server code starts depending on a new environment variable or credential:

1. **Add it to this file** — name, the service it must exist in, what breaks without it,
   whether it is server-only. Never the value.
2. **Fail fast where it is used.** Validate at the top of the code path and return an
   explicit, sanitized error naming the *missing variable* — see `missingS3Config()` in
   `supabase/functions/multipart-upload/index.ts`, which returns
   `S3_CONFIGURATION_MISSING` with the missing names. Never let an SDK fail later with a
   vague error.
3. **Extend the preflight** if the credential gates a core product flow (upload,
   playback, export, tagging) — `scripts/preflight-video-backend.mjs`. Prefer a real
   round trip that proves authentication over an existence check.

A config error should name itself. If a developer has to read a stack trace to learn a
secret is missing, the fail-fast step was skipped.
