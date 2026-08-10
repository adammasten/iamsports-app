# Background Upload — Architecture Plan (read-only, pre-build)

**Status:** Decided direction, not yet built. Launch prerequisite (per CLAUDE.md).
**Decision:** Native Expo module driving an iOS **background `URLSession`**, uploading
**presigned Supabase S3-multipart parts** (NOT TUS — see the pivot below).
**Confidence:** Four reviews (Claude, Gemini, Grok, ChatGPT). All four agree on the
foundation (native module + background URLSession + file-backed tasks). ChatGPT
correctly overturned the transport (TUS → S3 multipart); its critique was verified
against Supabase docs and adopted.

---

## The transport pivot (why NOT TUS)

Earlier drafts said "native module wrapping TUSKit." That's wrong for the background
requirement, for two **verified** reasons:

1. **Supabase TUS chunk size is locked at exactly 6 MB** ("must be set to 6MB, do not
   change it" — Supabase resumable-uploads docs). A 3 GB game = ~512 sequential 6 MB
   PATCHes.
2. A background `URLSession` keeps **already-enqueued tasks** alive; it does **not**
   keep a TUS state machine executing. TUS is strictly sequential (each PATCH must
   finish before the next offset is known), and iOS **rate-limits scheduling new
   background work** after each task completes → 512 throttled wake→schedule cycles →
   it stalls. TUSKit itself uses `chunkSize: 0` in its background example and
   discourages chunking in the background.

Also: the "catch the 401, refresh token, resume" design (Gemini/Grok) is **broken as
written** — you can't mutate headers on a completed task and resume it; you must create
a *new* task, hitting the same background rate limit.

**S3 multipart with presigned part URLs fixes all of it** (Supabase supports it and
recommends it for max throughput):

| | TUS-in-background | **Presigned S3 multipart (chosen)** |
|---|---|---|
| Tasks for 3 GB | ~512 sequential | **~24** (128 MB parts), independent |
| Scheduling | new task after each → iOS rate-limited | **all enqueued up front**; iOS owns them |
| Order | strictly sequential | **any order / parallel** (S3 allows it) |
| Token refresh | required, hard, broken-as-designed | **NONE — presigned URLs are self-signed** |
| Speed | sequential + base64 (today) | parallel, file-backed, no base64 |
| Resumability | per-chunk, automatic | reconstructed via `ListParts` (24 h window) |

---

## Rejected paths (unchanged)

- **A — `FileSystem.uploadAsync` + BACKGROUND:** deprecated SDK 54; large-file
  failures; whole-file single-PUT = the 4.75 GB EPROTO wall; the ripped-out commit
  `5f356cc`.
- **C — `expo/fetch` in an Expo background task:** ~30 s watchdog windows
  (`0x8badf00d`); JS-driven; still needs a background `URLSession` underneath.
- **TUS-in-background (incl. TUSKit):** see the pivot above. Keep TUS only as the
  **foreground / interim fallback** and for **web** (tus-js-client — the intentional
  web/mobile split holds).

---

## Architecture — presigned S3 multipart

**Flow:**
1. App requests an "upload plan" from a new backend Edge Function.
2. Edge Function (holds **server-only** S3 keys — they bypass RLS, must never reach the
   client): validates the coach/team/intended object key → `CreateMultipartUpload` →
   returns `{ uploadId, objectKey, partSize, presigned UploadPart URLs }`.
3. Native module slices the source into **file-backed parts** on disk — no base64, no JS
   byte handling.
4. Native enqueues all part `PUT` tasks on the background session **while foregrounded**;
   iOS then owns them (parallel, any order).
5. Native records each part's **ETag** from the response.
6. When all parts are in, the Edge Function `ListParts` (authoritative) →
   idempotent `CompleteMultipartUpload`.
7. `videos.url` gets the object key exactly as today; playback signs via **`sign-media`**
   unchanged. Master is byte-for-byte the original.

**Session config:**
```swift
let cfg = URLSessionConfiguration.background(withIdentifier: "com.masten32.iamsports.upload")
cfg.isDiscretionary = false           // start ASAP; don't wait for wifi+power
cfg.sessionSendsLaunchEvents = true   // relaunch to finish on completion
cfg.waitsForConnectivity = true       // ride out gym-wifi drops
```

**Part size:** start at **128 MiB** (24 tasks @ 3 GB, 40 @ 5 GB); A/B against 64 & 256
MiB under deliberately bad wifi; **2–3 concurrent** transfers. (Not the TUS 6 MB floor —
that's the resumable endpoint's rule, not S3 multipart's.)

---

## Two things the spike MUST verify (load-bearing)

1. **Supabase presigned `UploadPart` mechanics** — that presigned part URLs accept the
   `PUT` from a background task, return usable ETags, and `CompleteMultipartUpload`
   assembles them. (Supabase S3 compat is documented; the exact presign flow is the
   unknown.)
2. **Storage-lockdown compatibility (child-safety invariant — never risk this).** Objects
   created via server-side S3 keys **bypass RLS**. Confirm the finished object (a) slots
   into `videos.url` + `sign-media` playback exactly as today, and (b) does **NOT** land
   with permissions that reintroduce a broad storage read-leak. Clients still read only
   via `sign-media` (service role), so this *should* be clean — verify, don't assume.

---

## No token refresh (the big simplification)

Presigned part URLs carry their own signature in the query string → the `PUT` needs **no
`Authorization` header** → **no mid-upload JWT problem at all.** Presign URLs to live
near the multipart session's lifetime; Supabase auto-aborts incomplete multipart uploads
after **24 h**, which is the real upper bound. Presigned URLs are bearer credentials:
**redact from logs**, use **unique immutable object keys** (no `x-upsert`).

---

## Force-quit / resume / native lifecycle (always build)

Force-quit from the App Switcher cancels background tasks (Apple-documented). Make the
**native uploader the system of record**:
- One stable background-session identifier; **recreate the session on native launch,
  before RN spins up.**
- Forward `application(_:handleEventsForBackgroundURLSession:completionHandler:)`; call
  the completion handler only after `urlSessionDidFinishEvents` **and** state is
  persisted.
- Store plans, task IDs, part numbers, ETags, failures in **native SQLite** (not just
  AsyncStorage). Expose `getUploads()` to JS; treat native events as optional live
  updates.
- **Keep the original source file until the completed Supabase object is verified.**
- On relaunch: reopen plan → backend `ListParts` → regenerate only missing part files →
  fresh presigned URLs → re-enqueue missing parts. If the 24 h session expired, surface
  an explicit **expired** state (not a generic failure) and restart the multipart upload.
- Reconciliation = local state (what we scheduled) ∩ `URLSession.getAllTasks()` (what iOS
  still owns) ∩ Supabase `ListParts` (what actually landed) — so a lost success callback
  doesn't cause a needless re-upload.

---

## JS interface (platform-agnostic — Android slots in later)

```ts
interface BackgroundUploader {
  startUpload(opts: {
    fileUri: string;
    planEndpoint: string;             // our Edge Function that presigns parts
    metadata?: Record<string, string>;// team / game / object key inputs
    partSize?: number;                // default 128 MiB; spike-tuned
  }): Promise<{ uploadId: string }>;
  pause(uploadId: string): Promise<void>;
  resume(uploadId: string): Promise<void>;
  cancel(uploadId: string): Promise<void>;
  getUploads(): Promise<Array<{ uploadId: string; progress: number; state: string }>>;
  addListener(event: 'progress'|'completed'|'error'|'expired', cb: (d: any) => void): { remove(): void };
}
```
JS owns orchestration + progress UI only; native owns transfer + state.
**Android later:** same interface + same cross-platform "upload plan" (uploadId, object
key, part size/count, completed-part map, presign expiry, finalize status). Use Android
**User-Initiated Data Transfer** jobs (Android 14+, system priority, quota-exempt) with
WorkManager/foreground-service as the older-Android fallback. Backend protocol stays
identical across platforms.

---

## Speed & quality accounting (per CLAUDE.md media rules)

- **Per-byte:** native file-backed parts **delete** today's base64 read + JS-decode →
  per-byte speedup.
- **Parallelism:** 2–3 concurrent parts fill the pipe better than today's sequential
  loop → likely faster wall-clock, not slower.
- **Round trips:** a handful of presign calls to our Edge Function; negligible vs the
  bytes. Phone uploads **directly** to Supabase (presign adds no per-byte cost).
- **Quality:** **none traded.** Byte-for-byte master; 720p streaming copy stays a
  separate server-side transcode — unchanged.

---

## iOS 26 accelerator (optional, not the foundation)

`BGContinuedProcessingTask` (iOS 26) can keep local part-prep moving after backgrounding,
but it's user-visible and cancelable and doesn't cover older iOS — use as an accelerator,
never the correctness foundation.

---

## Phased build

0a. **✅ PASSED (2026-08-10)** — verified end-to-end against the live project
   (`wscfpkaltajnrhiusoze`, region us-east-1): CreateMultipartUpload → presign 4 parts
   → PUT each with plain fetch and NO AWS creds → CompleteMultipartUpload (ETag
   `…-4`) → HeadObject confirmed 26214400 bytes. Creds never left the "server" side.
   Transport theory proven. Script: `scripts/spike-s3-multipart.mjs` (throwaway).

   **Transport spike (no native code, no dev build)** — a throwaway Node script:
   `CreateMultipartUpload` → presign `UploadPart` URLs → `PUT` parts with plain fetch
   (mimicking the phone; no AWS creds on the PUT) → `CompleteMultipartUpload`. Upload a
   test file to a TEST key, confirm it lands and **plays through `sign-media`**, then
   clean up. Proves load-bearing item #1 and, by playing it back, item #2. Needs only a
   Supabase **S3 access key** (dashboard → Storage → S3 Access Keys). Cannot touch
   production (test key, no `videos` row, no code/RLS/sign-media changes).
   - *Pre-verified from code:* item #2 (storage-lockdown compat) is already answered —
     `sign-media` signs via the service role keyed on `videos.url`, owner-agnostic, and
     the lockdown already tolerates `owner=NULL` objects (40/96 today). 0a just confirms
     it end-to-end.
0b. **Background-lifecycle spike (native)** — presigned S3 multipart, 128 MiB parts (vs
   64/256), 2–3 parallel, full lifecycle (foreground → background → lock → wifi↔cellular
   → force-quit → relaunch) on a real device + 2–5 GB file. Needs the native module + a
   custom dev build.
1. **Backend Edge Function** — validate + `CreateMultipartUpload` + presign parts +
   `ListParts` + `CompleteMultipartUpload` (idempotent). Server-only S3 keys.
2. **Native module skeleton** — background session (recreated on launch) + start/progress/
   complete/error events + `getUploads()` + the JS interface.
3. **Part slicing + enqueue** — file-backed parts, capacity check, stage-one-at-a-time,
   ETag capture, disk cleanup.
4. **Persistence + resume** — native SQLite state, `ListParts` reconciliation,
   force-quit/relaunch recovery, explicit 24 h-expired state.
5. **Integration** — swap `app/upload.tsx` + `app/game.tsx` onto the new uploader behind
   the same call sites; keep the foreground TUS path for small files / web.
6. **Test matrix** — old devices, low battery, airplane-mode toggles, wifi↔cellular, lock,
   app-switch, force-quit + relaunch; confirm `sign-media` playback + no storage leak.

Do NOT code past Phase 0 until the spike confirms presigned `UploadPart` + storage-lockdown
compatibility.
