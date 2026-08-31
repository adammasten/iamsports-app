# Background Upload for IamSports — Design Brief for External Review

*Paste this whole doc to another AI. It has no repo access, so everything it needs is here. We want you to **pressure-test the chosen architecture** below — not start from scratch.*

## What we're building
**IamSports** is an **Expo (SDK 54) React Native + Supabase** app for youth-sports coaches. They upload **full game videos**, then tag the film.

**File sizes are LARGE and growing.** The normal source is now an **XbotGo Falcon** auto-tracking AI camera that outputs **~15 GB per game**. **Assume 15 GB+ is the standard upload, not an edge case** — the design must be comfortable with 15–25 GB files, often over **flaky tournament-gym wifi**.

**The goal:** true **background upload** — a coach starts an upload, then switches to email / other apps / locks the phone, and the upload **keeps going and finishes** (potentially over many hours / across app relaunches). Today it does **not**: leaving the app suspends the JS runtime and the transfer stalls.

## Current upload pipeline (what exists today)
- **Web:** `tus-js-client` against Supabase's resumable (TUS) endpoint, 6 MB chunks. *(Web is fine; it stays as-is.)*
- **iOS/mobile:** a **hand-rolled chunked PATCH loop** against Supabase's TUS resumable endpoint. 15 MB chunks, read via **base64** (`expo-file-system readAsStringAsync`) → decoded to bytes **in JS** → PATCHed **sequentially** (one in flight). JWT is refreshed mid-upload. After upload, the storage **object key** is written to `videos.url`; playback later mints a signed URL via a **`sign-media`** Edge Function (service role).
- This whole loop runs on the **JS thread**, so backgrounding the app **stalls** it. That's the problem. (At 15 GB it's also painfully slow — base64 + sequential.)

## Hard constraints (any proposal must respect these)
1. **Supabase Storage, private bucket.** Clients **never** read storage directly — the ONLY path to a media URL is the `sign-media` Edge Function (service-role, entitlement-checked). No `getPublicUrl` anywhere. This closed a **child-safety storage read-leak** and must not reopen it.
2. **Every viewable video must be faststart** (moov atom at front) for web streaming. Uploads are auto-optimized to a 720p H.264 faststart **streaming copy** by a **separate server-side transcode**, so the uploaded **master can stay byte-for-byte original**.
3. **Transfer speed is a product requirement.** Coaches abandon on slow uploads. No quality trade (resolution/bitrate) without explicit human sign-off.
4. **Supabase TUS chunk size is LOCKED at exactly 6 MB** (documented, "do not change").
5. **iOS backgrounding reality:** only a **background `URLSession`** keeps transfers alive while the app is suspended. JS-driven background tasks get ~30 s watchdog windows (`0x8badf00d`).
6. **Uploads are LONG (new, load-bearing at 15 GB).** 15 GB on 1–3 Mbps gym wifi is a **~12–34 hour** transfer. Supabase **auto-aborts an incomplete multipart upload after 24 h**, so a single slow upload can **outlive the window**. The design must survive that — resume/re-presign the same upload or detect the abort and restart cleanly — not assume one-session completion.
7. **Phone disk is finite.** A 15 GB source plus *copied* parts could need **+15 GB free**. Parts should be **byte-range slices streamed from the original file**, not full copies, to avoid doubling on-device storage.

## The architecture we've chosen (pressure-test this)
A **native Expo module** driving an **iOS background `URLSession`**, uploading **presigned Supabase S3-multipart parts** (Supabase exposes an S3-compatible API). **NOT TUS in the background.**

**Why NOT TUS in the background:**
- 6 MB locked chunk → **~2,560 sequential PATCHes** for a 15 GB file.
- A background `URLSession` keeps **already-enqueued tasks** alive but does **not** keep a **TUS state machine executing**. TUS is strictly sequential (the next byte offset is unknown until the prior PATCH completes), and iOS **rate-limits scheduling *new* background work** after each task finishes → thousands of throttled wake→schedule cycles → it **stalls**.
- Mid-upload **token refresh** on a completed background task is effectively impossible (you can't mutate headers and resume a finished task; you must create a *new* task → back into the rate limit).

**Why presigned S3 multipart fixes it:**
- Independent part tasks, **all enqueued up front while foregrounded**; iOS then owns them (parallel, any order). Part sizing for 15 GB: 128 MiB → ~120 parts; **256 MiB → ~60 parts; 512 MiB → ~30 parts.** (S3 multipart allows **5 MiB–5 GiB per part, up to 10,000 parts, 5 TB object** — 15 GB is comfortably inside. Fewer/bigger parts = fewer tasks but a dropped part costs more to retry — a real tradeoff to spike.)
- Presigned part URLs carry their **own signature in the query string** → the `PUT` needs **no `Authorization` header** → **no mid-upload JWT problem at all**. (But see constraint #6: presign lifetime and the 24 h multipart window are the real bounds for a 15 GB upload.)
- **File-backed / byte-range parts** → no base64, no JS byte handling → per-byte speedup, plus **2–3 concurrent** parts fill the pipe better than today's sequential loop.

**Flow:**
1. App asks a new `multipart-upload` Edge Function for an "upload plan."
2. Edge Function (holds **server-only** S3 keys — never sent to the client): validates coach/team/intended object key → `CreateMultipartUpload` → returns `{ uploadId, objectKey, partSize, presigned UploadPart URLs }`.
3. Native slices the source into **byte-range parts** (streamed from the original, not copied), enqueues all part `PUT`s on the background session while foregrounded.
4. Native records each part's **ETag** from its response.
5. When all parts land, the Edge Function `ListParts` (authoritative) → idempotent `CompleteMultipartUpload`.
6. `videos.url` gets the object key exactly as today; `sign-media` playback is unchanged; the master is the original bytes.

**Background session config:** `background(withIdentifier:)`, `isDiscretionary=false`, `sessionSendsLaunchEvents=true`, `waitsForConnectivity=true`.

**Lifecycle / resume (native is the system of record):** recreate the session on **native launch before RN starts**; forward `handleEventsForBackgroundURLSession`; persist plans / task IDs / part numbers / ETags in **native SQLite**; keep the **original file until the finished object is verified**; on relaunch reconcile **local state ∩ `URLSession.getAllTasks()` ∩ Supabase `ListParts`**, regenerate only **missing** parts with fresh presigned URLs; surface an explicit **"expired"** state if the multipart window lapsed. Force-quit from the App Switcher cancels tasks (Apple-documented) → resume on relaunch.

## What's validated so far
- **Phase 0a PASSED** (live Supabase project, us-east-1): `CreateMultipartUpload` → presign 4 parts → `PUT` each with plain fetch and **no AWS creds** → `CompleteMultipartUpload` → `HeadObject` confirmed the assembled bytes. Creds never left the server side. **Transport proven** (on a small test file — NOT yet at 15 GB).
- **Phase 0b BUILT, on-device result not yet signed off:** a native `background-upload` module + the `multipart-upload` Edge Function + a dev test harness exist; the full foreground→background→lock→wifi↔cellular→force-quit→relaunch lifecycle on a real device with a **15 GB** file hasn't been confirmed passing.

## What we want from you
1. **Is presigned-S3-multipart-over-background-`URLSession` the right call** for **15–25 GB** uploads that must survive app-switch / lock / **force-quit** and possibly **many hours** on iOS? What failure mode are we missing at this size?
2. **The 24 h window vs a multi-hour 15 GB upload (biggest worry).** If a single upload can't finish inside Supabase's 24 h incomplete-multipart auto-abort, what's the right pattern — periodically re-presign and resume the **same** `uploadId`, detect the abort and cleanly restart from `ListParts`, or something else? Any way to extend/avoid the window? Does presign-URL expiry need to be decoupled from the multipart lifetime?
3. **Part size + concurrency for 15 GB on flaky wifi.** Sweet spot between 64 / 128 / 256 / 512 MiB and 2–3 concurrent — balancing throughput, retry cost of a dropped big part, and the number of background tasks (~30 vs ~120).
4. **Byte-range parts without 2× disk.** Best way to feed a background `URLSession` upload task a **range** of a 15 GB file without copying each part to a temp file (avoid needing +15 GB free)? Range reads, body streams, `uploadTask(withStreamedRequest:)`, etc.
5. **Background `URLSession` pitfalls at scale:** enqueuing ~30–120 part tasks up front, concurrency caps, `handleEventsForBackgroundURLSession` / relaunch correctness, avoiding the iOS "schedule new work" rate-limit trap.
6. **Is there a simpler path** that still truly survives backgrounding for 15 GB (a maintained library, a different Supabase/S3 primitive) we should weigh before building and maintaining a native module?
7. **Worth a pre-upload compress?** Uploading a pristine 15 GB master is slow. Is a client-side downscale/transcode before upload worth the (sign-off-required) quality trade to cut hours off transfer — or keep the master pristine and let the server transcode the streaming copy (current stance)?
8. **Android sanity check (later):** same Edge Function protocol + Android 14+ **User-Initiated Data Transfer** jobs, with WorkManager / foreground-service as the older-Android fallback. Any objection at 15 GB?

**Non-negotiables for any answer:** never reopen the storage read-leak (all reads go through `sign-media`); don't trade upload speed for video quality silently; web stays on `tus-js-client`.
