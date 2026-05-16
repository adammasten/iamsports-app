# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

**IamSports** (slug `iamsports`, bundle `com.masten32.iamsports`) — Expo / React Native app for tagging sports videos and exporting highlight reels. The repo dir is `hoops-app` but the product is "IamSports". Supabase handles auth, data, and video storage; a separate Railway-hosted ffmpeg service (`https://web-production-1bf7f.up.railway.app`) renders the highlight reels.

## Commands

```bash
npm run start    # or: npx expo start — Metro dev server
npm run ios      # expo start --ios
npm run android  # expo start --android
npm run web      # expo start --web
npm run lint     # expo lint (eslint-config-expo, flat config)
```

There is no test runner configured. Builds are driven by EAS — see `eas.json` for `development` / `preview` / `production` profiles.

Path alias `@/*` maps to the repo root, so `@/supabase`, `@/context`, `@/components/...` etc. resolve from `tsconfig.json`. TypeScript runs in `strict` mode and Expo Router `typedRoutes` is enabled, so route params are typed.

## High-level architecture

### Navigation & auth flow

`app/_layout.tsx` is the root. On mount it calls `supabase.auth.getSession()` and routes to `/login` if there's no session, otherwise `/select-team`. An `onAuthStateChange` subscription mirrors this on session changes. All screens are mounted under a single `Stack`, with the tab navigator at `(tabs)`.

The session is unwrapped in two stages before any "real" screen renders:
1. `/login` — email/password against Supabase Auth.
2. `/select-team` — pick a **profile** (the player), then a **team**. Calling `setTeamContext(...)` from `@/context` populates the `TeamProvider` and replaces to `/` with the same values in route params.

`useTeamContext()` (`context.tsx`) is the global handle for `{ profileId, profileName, teamId, teamName }`. **Important sentinel:** `teamId === 'all'` means "across all of this profile's teams" — most queries branch on it (see `app/(tabs)/index.tsx` and `app/(tabs)/tags.tsx`).

### Data model (Supabase Postgres)

- `profiles` — a "player" owned by an auth user.
- `teams` — owned by a profile.
- `games` — owned by a team. Title is `vs {opponent}`.
- `videos` — owned by a game. `url` points at the `Videos` storage bucket public URL.
- `clips` — `{ video_id, start_time, end_time, is_starred, note }`.
- `tags` — `{ name, category, sort_order, scope, profile_id?, team_id? }`. `category` is one of `offense | defense | plays | players` (hardcoded everywhere — adding a category means updating the `CATEGORIES` arrays in `app/tagging.tsx`, `app/(tabs)/tags.tsx`, and `app/export.tsx`). `scope` is one of `global | player | team`.
- `clip_tags` — join table `{ clip_id, tag_id, bundle_number }`. **This is the key contract — see "Bundles" below.**

### Tag scoping

The same Supabase `.or(...)` filter pattern appears in `app/tagging.tsx` and `app/(tabs)/tags.tsx`. A given player/team combo sees:
- all `scope='global'` tags, plus
- `scope='player'` tags where `profile_id` matches the current profile, plus
- `scope='team'` tags where `team_id` matches the current team (only when `teamId !== 'all'`).

When you add a tag-fetching screen, replicate this filter exactly — getting the OR-of-ANDs syntax wrong silently leaks tags across players or teams.

### Bundles (clip-level tags vs bundles)

`clip_tags.bundle_number` is the heart of the tagging model:
- `bundle_number = 0` → **clip-level** tag (applies to the whole play).
- `bundle_number = 1, 2, 3, …` → tags grouped together in a **bundle** (e.g., one bundle says "Player A + Assist", another says "Player B + Made Shot").

This matters in `app/export.tsx` (`clipMatchesGroup`): a filter group of N tags matches a clip iff **all** of those tags are in the clip-level set, OR **all** are in `clip-level ∪ some single bundle`. Tags across two different bundles do NOT combine. If you change how tags are saved or filtered, preserve this semantics — it's how the app supports "show me clips where Player A made a shot" without also matching clips where A defended and B scored.

`app/tagging.tsx` is where bundles get authored — `activeSection` is either `'clip'` (clip-level) or a numeric bundle index. All rows for a clip are inserted in a single batch when the user saves.

### Video upload pipeline

`app/game.tsx` uploads directly to Supabase Storage's TUS resumable endpoint at `https://wscfpkaltajnrhiusoze.storage.supabase.co/storage/v1/upload/resumable`. There are **two different code paths** and recent commits show this has been thrashed — be careful editing it:

- **Web** uses `tus-js-client` with a Blob.
- **Mobile** uses a hand-rolled chunked PATCH loop (`uploadVideoMobile` + `patchChunk`), reading 15 MB chunks via `expo-file-system/legacy`'s `readAsStringAsync({ encoding: Base64, position, length })` and decoding to bytes. `tus-js-client`'s native streaming was abandoned (see commits `c3838b9`, `5f356cc`, `b1fd23f`).
- Access tokens are refreshed mid-upload via `getFreshToken(forceRefresh)` — refresh when < 5 minutes remain, or on every retry attempt. Long uploads will outlive the original JWT, so always go through this helper rather than caching a token.

After upload, the public URL is grabbed via `supabase.storage.from('Videos').getPublicUrl(...)` and inserted into the `videos` table.

### Highlight export

`app/export.tsx` is a 3-step wizard: **games → tag groups → review**. On submit it `POST`s a JSON array of `{ url, start_time, end_time }` to the Railway server's `/export` endpoint, then polls `/job/{id}` every 5 s for `progress` / `status`. On `status === 'done'`, it downloads the result via `FileSystem.downloadAsync` and saves it to the camera roll with `expo-media-library`. The matching logic that picks which clips to include is the bundle-aware `clipMatchesGroup` described above.

## Supabase client

`supabase.js` (JS, not TS) hardcodes the project URL and anon key — there is no `.env` wiring. Auth persists via `AsyncStorage` on native and the default web storage on the web. Don't introduce a separate Supabase client; import the singleton: `import { supabase } from '@/supabase'`.

## Conventions worth keeping

- All Supabase errors surface through `Alert.alert('Error', error.message)` — keep that pattern in new screens.
- Tap = primary action, long-press = delete (consistent across games, videos, clips, tags).
- `formatTime(seconds)` is reimplemented in several files (`tagging.tsx`, `clips.tsx`, `export.tsx`); if you find yourself touching it in more than one place, consider hoisting — otherwise leave duplicates alone.
- The `expo-router` `typedRoutes` experiment is on; prefer `router.push({ pathname: '/foo', params: {...} })` over string paths so types stay accurate.
- New architecture (`newArchEnabled: true`) and React Compiler (`reactCompiler: true`) are both on — don't disable them without a reason.

## Product context

- Solo-developer project by Adam Masten. Self-described vibe-coder — beginner-to-intermediate React Native, not a professional engineer.
- Target users: AAU and youth basketball coaches in Adam's personal network. TestFlight beta target ≈ 50 paying users sourced from that network.
- Pricing post-App-Store launch: $9.99/mo individual subscription (~$5 net after Apple's cut).
- Long-term goal is side income, not a 40 hr/wk job — **default to shipping over polish**.
- Subscription/payment work uses **RevenueCat** when it begins, which is **post-App-Store launch, NOT before**. Includes affiliate/referral tracking via per-coach codes.

## Working style

- Adam uses **VS Code exclusively**. Never suggest `nano`, `vim`, TextEdit, or any other editor.
- When suggesting terminal commands, put **each command in its own code block**, one per block — even in multi-step instructions. Adam copies them one at a time.
- Development rhythm: tag real games → find worst friction → fix it → repeat. Real-user friction beats theoretical priorities; resist refactor-for-refactor's-sake suggestions.

## What we're working on now (May 2026)

Active project: **V2 overlay** — a transparent, full-screen landscape tagging UI (Concept B). The current `app/tagging.tsx` is portrait with controls below the video; the overlay rebuild moves everything on top of full-screen landscape video.

Design intent:
- Video 100% full-screen in landscape orientation
- All controls (Mark Start, Mark End, Save Clip, tag bubbles, back button) float transparently over the video
- Tag bubbles at the bottom, semi-transparent; selected tags glow brighter
- Tap the video to hide/show controls
- Save Clip top right, Back top left
- Gradient darkening at the bottom for tag readability

This is V2 milestone #1. The next two V2 milestones — **tag tree browse view** and **frame-accurate video scrubber with thumbnail previews** — are queued but **do not start them without explicit go-ahead from Adam**.

## Operational knowledge

### Critical IDs

| Thing | Value |
|---|---|
| Bundle ID | `com.masten32.iamsports` |
| EAS Project ID | `ff1f3af9-f645-4ac5-9411-7ba489daea92` |
| Apple Team ID | `CAUQR2A8KW` |
| Supabase Project ID | `wscfpkaltajnrhiusoze` |
| App Store Connect API Key ID | `W2VGU58N39` |
| ASC Issuer ID | `a5304c77-d367-498e-8478-104da9bc056f` |
| ASC API Key path (local) | `~/Downloads/AuthKey_W2VGU58N39.p8` |

### EAS builds

- EAS builds require **API key authentication**. Password-based auth does not work — don't try it.
- The build invocation depends on three environment variables: `EXPO_ASC_API_KEY_PATH`, `EXPO_ASC_KEY_ID`, `EXPO_ASC_ISSUER_ID`.
- Currently on Expo Starter plan ($19/mo) for priority build queues.

### Storage bucket

- Bucket name is **`Videos`** with a capital V. Get the case wrong and uploads fail silently.
- Exports are written to the `exports/` subfolder of the same bucket.
- Supabase Pro plan ($25/mo) is required for files >50 MB. Bucket file-size limit has been raised manually to 10 GB.

### Schema cache trap

After modifying Supabase tables, PostgREST sometimes serves a stale schema and inserts fail with "column not found" even though the column exists. Fix it with this SQL in the Supabase SQL editor:

```sql
NOTIFY pgrst, 'reload schema';
```

This bit us when adding `clip_tags.bundle_number`. If a recently-added column appears missing to the client, run this before debugging anything else.

## "Don't relitigate" decisions

These are settled. Don't change them without an explicit conversation with Adam first.

- **RLS is `allow_all` (expression `true`) on every table.** Intentional for the MVP / pre-public-launch phase. Real RLS goes in before public App Store launch, NOT before TestFlight. Don't "fix" it.
- **Web uploads use `tus-js-client`. Mobile uses the hand-rolled chunked PATCH loop.** Don't unify them — the split is the point.
- **15 MB chunk size for mobile TUS uploads is tuned.** Smaller chunks generate too many requests; larger chunks cause memory pressure on older iPhones.
- **`getFreshToken(forceRefresh)` for mid-upload auth refresh is required, not optional.** Long uploads outlive the original JWT. Never cache the token across an upload.
- **The Railway ffmpeg server's `fps=30` filter + `-fps_mode cfr` flag is the VFR fix.** Variable-frame-rate phone video breaks concatenation without these. Don't remove them from the server's ffmpeg invocations.

## Upload stability is the #1 quality signal

A colleague (Bobby) flagged upload crashes as a professionalism / quality concern before TestFlight go-live. The chunked TUS rebuild largely addressed it, but upload stability remains the highest-stakes area of the codebase for beta-user perception. Any change near `app/game.tsx`'s upload paths or `getFreshToken()` is high-stakes — diff carefully and test with both a small (<100 MB) and a large (>500 MB) video before merging.
