# Export/Download Quality Picker (Standard / Maximum) — Spec

**Status:** Spec / not built. Decided 2026-08-30; grounded against live data 2026-08-31.
**Why:** Every export/download today renders from the **720p** streaming copy, so downloaded
clips can't be zoomed in ("filmed far away → can't see the kids"). The **4K master** exists but
is never used for output. Let the user pick the quality they want, per download.

---

## What the investigation found (makes this easy)

- **`videos.original_url` already stores the 4K master's object key.** Populated on 15/16 of the
  test account's videos; it differs from `videos.url` (the 720p copy) in every case.
- **Masters persist** — 15/15 optimized videos still have their master in storage (~**3.7 GB** avg).
  So Maximum works for **existing** videos, not just new ones. No backfill needed.
- **Today's render** (`app/export.tsx` → Railway `/export`, and `lib/core/render-reel.ts`) posts
  clips as `{ url: <object key>, start_time, end_time }` where `url = deriveStoragePath(video.url)`
  — i.e. the **720p** copy. That single choice is the whole quality story.

**Net:** the picker UI is trivial; "Maximum" is mostly "render from `original_url` instead of `url`."

---

## The decision (locked)

A **two-tier quality picker on export/download**, labeled by *purpose*:

- **Standard** — 720p, faster, smaller. For quick shares + in-app/informational viewing. **Default.**
- **Maximum** — full master resolution (up to 4K), slower + bigger. For showcase reels, big screens,
  and zooming in. Renders from `videos.original_url`.

Show the trade-off (rough size/time), and remember each user's last pick (so quality-first users
default to Maximum). No middle "1080p" tier for now.

---

## Technical design

### Source selection (the core change)
When building the clip list to send to Railway, choose the object key by tier:
- **Standard:** `deriveStoragePath(video.url)` (720p copy) — unchanged from today.
- **Maximum:** `deriveStoragePath(video.original_url)` (4K master) — **new**.

Everything else in the render request (`start_time`, `end_time`, clip order) is identical. This
lives in the clip-assembly code in `app/export.tsx` and the shared `lib/core/render-reel.ts`
(add a `quality: 'standard' | 'maximum'` param), and any single-video download path
(`downloadGame` in `app/my-work.tsx`, and the download action in `app/game-detail.tsx`).

### Railway `/export`
- It cuts each clip (`start_time`→`end_time`) from the source and concats. With a 4K master as the
  source it will naturally encode the clip at 4K. **Only the clip's seconds are encoded** — a 48 s
  clip encodes 48 s, even at 4K, so this is a light job, NOT the heavy "transcode the whole 15 GB
  game" case.
- **Output must stay faststart** (`-movflags +faststart`) — the concat step already does this; keep it.
- ⚠️ **Verify (Railway is a separate codebase):** cutting a clip out of a **large, non-faststart 4K
  master** may be slow, because ffmpeg has to locate the `moov` atom at the end of a ~16 GB file to
  seek. Confirm seek+cut performance; if it's bad, options are (a) input-seek with `-ss` before `-i`,
  or (b) a one-time faststart remux of the master. Do NOT re-encode the whole master.

### Data
- **No schema change** — `original_url` already exists and is populated. Just read it.
- **Edge case — no master:** ~1/16 videos had `original_url` null (old/loose/pending upload, or a
  master that was never kept). For those, **Maximum is unavailable** → either hide the Maximum option
  or show it disabled with "4K not available for this video."

---

## Surfaces (where the picker appears)
1. **Coach export wizard** — `app/export.tsx` (the review/render step). Primary.
2. **Parent highlight flow** — `app/make-highlight.tsx`.
3. **Single-video / game download** — `downloadGame` (`app/my-work.tsx`), download in `app/game-detail.tsx`.
4. Shared render entry — `lib/core/render-reel.ts` gains the `quality` param that all of the above pass.

---

## Edge cases / decisions to make
- **Multi-clip reels spanning videos with mixed master availability** (some clips have a master, some
  don't). Two choices — pick one:
  - **Graceful (recommended):** render each clip from its master when available, else its 720p copy.
    One reel, best-available per clip. (Note: mixing 4K + 720p sources in one concat means Railway
    must normalize to a common output resolution — verify it handles mixed inputs.)
  - **Gate:** Maximum only offered when *every* clip in the reel has a master; otherwise Standard only.
- **Default tier + remember-last** — Standard default, persist last choice per user. (Confirm.)
- **Big-screen in-app playback** — out of scope here; the picker is for export/download. A separate
  "HD" toggle on the in-app player is a later, optional add.

---

## Cost / performance (opt-in only)
- 4K clip output is bigger (a 48 s 4K clip ≈ 100–200 MB vs ~30 MB at 720p) → more Railway CPU, a
  bigger download, and a bigger stored `exports/` object. All acceptable because Maximum is **opt-in**.
- Storage of masters is already being paid for (they persist today); this just *uses* them.

---

## Phasing
1. **Phase 1 (the feature):** add the picker to `app/export.tsx`; thread `quality` through
   `lib/core/render-reel.ts`; Maximum → `original_url`; confirm Railway encodes the clip at source res
   + faststart. Disable/hide Maximum when `original_url` is null.
2. **Phase 2 (polish):** remember last choice; mixed-master reel handling per the decision above;
   extend the picker to the single-video download paths and `make-highlight`.

## Open questions
1. Mixed-master reels: **graceful** vs **gate** (recommend graceful).
2. Railway: does it seek+cut efficiently from a large non-faststart 4K master, and does it handle a
   concat of mixed-resolution inputs? (Both need a quick Railway-side check before Phase 1 ships.)
3. Any cap on Maximum output (e.g. downscale 4K → 1440p) to bound file size, or true passthrough 4K?
