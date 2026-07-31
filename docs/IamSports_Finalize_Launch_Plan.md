# IamSports — Finalize / Launch Plan

**Date:** July 8, 2026
**Target:** Public App Store release.
**Method:** Audit → build ONE master punch list → triage → work top-down, one item at a time, commit each. No tangents: catalog everything first, fix in priority order, never mix a fix-session across priority tiers.

---

## LOCKED PRIORITY ORDER (triage the punch list through this lens)

**Tier 1 — CORE FEATURES (the app's whole reason to exist). Do FIRST.**
- **Upload works** — the "+" button upload flow (already designed: upload lands in Film Room, attach-later optional). Currently NOT working. This is the #1 priority — the app is a video tool; if video can't get in, nothing else matters.
- **Export / Create-Highlight works** — from the Film Room. (Rename "Export" → "Create Highlight" / "Create Reel" — cosmetic part is Tier 5, but the FUNCTION is Tier 1.) If highlights can't get out, the app doesn't do its job.

**Tier 2 — ACCESS / ONBOARDING BLOCKERS.**
- Invite people to a team (invite link + the request/approve flow from the permissions spec).
- Claim an existing child (a parent finding/claiming a player already in the system).
- Without these, real families can't get into the app even if upload/export are perfect.

**Tier 3 — COMPLIANCE BLOCKERS (Apple review — can run in PARALLEL with Tier 1/2).**
- Privacy policy + data-handling disclosure (stricter for minors' data/video).
- In-app account deletion (Apple mandates this).
- Content reporting / blocking / moderation (users post content others see → usually required).
- Age rating for a youth app.
- These don't improve the app for users, but Apple will REJECT submission without them. Must be done before submit; not before upload/export.

**Tier 4 — BROKEN-BUT-SURVIVABLE.**
- Search functions that don't search (multiple screens).
- Sort/filter that doesn't sort (Home reels: All/Lars/Highlights/Sent, etc.).
- Annoying, but app is usable for a beta without them.

**Tier 5 — COSMETIC / POLISH (truly last).**
- Rename "Export" → "Create Highlight"/"Create Reel" (function is Tier 1; the label is Tier 5).
- Fix the permissions grid layout ("hot garbage" — text wrapping vertically).
- Other labels, spacing, visual cleanup.

---

## KNOWN ITEMS ALREADY IDENTIFIED (seed the punch list)
- "+" upload not working (Tier 1).
- Export/create-highlight from Film Room not working; also needs renaming (Tier 1 function / Tier 5 label).
- No way to invite people to a team (Tier 2).
- No way to claim an existing child (Tier 2).
- Search doesn't work on multiple screens (Tier 4).
- Home reel sort/filter (All/Lars/Highlights/Sent) doesn't work (Tier 4).
- Permissions grid layout ugly (Tier 5).

## FEATURE IDEAS (LATER — not finalize items; don't let them jump the queue)
- Tags applied to clips carry through to reels, so you can SEARCH/QUEUE by tag ("all of Lars's made 3s"). Valuable (AI-moat / searchable highlights) but it's a feature, not a launch blocker. Post-finalize.

## STILL-OPEN FROM PERMISSIONS BUILD (verify later)
- Permission toggles WRITE correctly (proven). But whether they actually GATE real actions (does "tag off" truly stop tagging?) is NOT yet verified — enforcement test pending.
- Org layer (central admins over many teams) — designed, deferred, its own project.
- Extended Family / viewer tier + Editor (paid tagger) — designed, deferred.

---

## THE PROCESS (how to actually execute without tangents)
1. **Audit (read-only):** CC catalogs every screen — works / broken / missing / placeholder — plus a compliance section. Adam does his own walkthrough for UX things CC's code-read misses. Merge into ONE master punch list.
2. **Triage:** sort every item into Tiers 1–5 above.
3. **Work top-down, one item at a time:** investigate read-only → fix → verify on device → commit → next. Never bundle. Never mix tiers in one session.
4. **Cleanup rule (permanent):** when changing/migrating anything, search the whole codebase + DB for references to the old thing, rewire/remove all, PROVE zero orphans with counts before calling it done. No breadcrumbs.
5. **Investigate-before-proposing (permanent):** any bug → CC reads the actual code and reports where it breaks BEFORE proposing a fix.
