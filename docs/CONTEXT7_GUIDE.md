# context7 — when and how we use it

A practical guide for IamSports (app + website). context7 is one of the three
MCP servers wired into this project (`.mcp.json`, alongside **supabase** and
**playwright**).

## What it is (one line)

context7 fetches **live, version-accurate documentation and real source code**
for external libraries and frameworks — so answers come from the *current* docs
for the *installed version*, not from a model's training data (which has a
cutoff and drifts on fast-moving libraries like Expo).

## Why it matters here

This app rides fast-moving libraries: **Expo SDK 54**, React Native, Expo
Router, expo-video, expo-notifications, Supabase, and (post-launch) RevenueCat.
These change APIs between versions. context7 is the antidote to a confident-but-
outdated API call — the kind of bug that wastes a build cycle.

## How it works — the two-step flow

You (Adam) don't call it directly; you ask Claude to, or Claude reaches for it
on its own. Under the hood it's always two steps:

1. **resolve-library-id** — turn a name ("expo-video") into a Context7 ID
   (`/expo/expo`) and see which **versions/branches** exist (e.g. `sdk-54`).
2. **query-docs** — ask ONE specific question against that ID, ideally
   **version-pinned** (`/expo/expo/__branch__sdk-54`).

### Real example we ran

Resolving `expo-video` returned `/expo/expo` with an **`sdk-54` branch** (our
exact version). Querying "VideoView contentFit + fullscreen + web" returned the
actual SDK-54 source showing:

- on web, `VideoView` renders a native `<video>` element,
- `contentFit` maps to CSS `objectFit`,
- `fullscreenOptions={{ enable: true }}` controls the fullscreen affordance.

That's precisely the detail behind our "every video plays the same way
(fill + center + fullscreen)" standard — pulled from the live source, not memory.

## When to USE it

Reach for context7 whenever we're about to touch an **external library's API**
and want to be *certain* it matches the installed version:

- **API signatures / props / config keys** — "what props does `VideoView` take
  in SDK 54," "what's the current `expo-notifications` permission API."
- **Setup / integration steps** — wiring a new library, a config plugin, an
  Edge Function client, a native capability.
- **Migration / breaking changes** — "what changed in this API between SDK
  versions," "is this method still supported."
- **"Does this exist / how do I do X"** for a specific library — before writing
  the call, not after it errors.
- **On the website** (other window) — Vite, React, any package we add there.

Rule of thumb: **if the answer lives in a library's official docs, use
context7. If unsure whether an API is current, use it rather than guess.**

## When NOT to use it

- **Our own business logic / debugging our code** — that's reading the repo.
- **The database (schema, rows, RLS)** — that's the **supabase** MCP.
- **Driving/testing the live web app** — that's the **playwright** MCP.
- **General programming concepts** (how does a `for` loop work) — no library
  doc needed.
- **GitHub** — that's the `gh` CLI + git, not an MCP.

## How to invoke it (what Adam types)

You don't run the tool; you prompt Claude. Any of these work:

- "Check the current Expo docs for how to enable push notifications on iOS."
- "Use context7 to confirm the RevenueCat RN setup before we build it."
- "What's the SDK-54 API for `<Switch>` / the toggle — pull the real docs."
- Or just: "Look this up in context7: <question>."

Claude will resolve the library, pin the version when possible, and query.

## Tips for good results

- **One concept per query.** Ask about "expo-notifications iOS permissions"
  *or* "scheduling a local notification" — not both in one query.
- **Pin the version.** Prefer the `sdk-54` branch so answers match what's
  installed, not the latest unreleased API.
- **Name the library precisely.** "Expo Router" beats "the router";
  "RevenueCat" beats "the payments thing."
- There's a **3-calls-per-question** cap on each tool — so we scope questions
  tightly rather than spraying.

## Where we should use it RIGHT NOW (current + near-term work)

Tied to what's actually on the board for IamSports:

| Task (status) | context7 lookup that de-risks it |
|---|---|
| **Push activation** (built, not enabled — launch prereq) | `expo-notifications` SDK-54: iOS permission request, `aps-environment`/entitlement, getting a push token, config-plugin setup. |
| **Schedule team-settings screen** (in progress) | React Native `Switch` API; Expo Router typed-route params for the new screen. |
| **Video playback standard** (ongoing) | `expo-video` `VideoView` props per platform (already demoed) — reuse when adding any new video surface. |
| **RevenueCat subscriptions** (post-launch) | `react-native-purchases` current install + configure + entitlement-check flow, before we build any of it. |
| **Background upload** (planned) | Expo `FileSystem` / native URLSession background-upload APIs for the SDK we're on. |
| **Website** (other window) | Vite config, React 18/19 APIs, any package we pull in there. |

## The three MCPs at a glance

| MCP | Use it for |
|---|---|
| **context7** | External **library/framework docs** (this guide). |
| **supabase** | The live **database** — schema, RLS, migrations, data. |
| **playwright** | A real **browser** — drive/test/screenshot the web app. |

_Last written 2026-08-26. Update the "right now" table as tasks ship._
