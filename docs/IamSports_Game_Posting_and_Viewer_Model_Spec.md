# IamSports — Game Posting & Viewer Model Spec

*Decisions locked across the post-to-wall sessions (late June – early July 2026). This is a spec, not code. Build slice by slice, verify on device between each.*

---

## Where we are now

Job #1 shipped and pushed — commit `1e7539d`. Film Room's post-to-wall handlers are generalized off hardcoded `'reel'` onto a generic `Postable` type (`{ contentType, contentId, title }`). Reels behave exactly as before; the path is now content-type-agnostic. Clip-posting was deliberately tabled (the reel export already covers the "share one clip" case — export the single clip as a one-clip reel).

The one real remaining gap is **game posting**, plus the **viewer experience** that hasn't been built yet.

---

## Decision 1 — Games post as a real content type (Fork A)

A game is **not** one playable file — it's a folder of N videos in a set order. Two ways to post it were considered:

- **Fork A (chosen):** make `'game'` a real content type. One post = one game card. Clean data model, one share = one card, easy to un-post. Requires a SQL migration + a wall-render decision.
- **Fork B (rejected):** fan out the individual videos as `content_type: 'video'` tagged with the game_id. No migration, but the wall's grouping logic gets messy and un-posting means managing N shares instead of 1.

**Chosen: Fork A.** A game posts as a single game card.

---

## Decision 2 — How a posted game renders on a wall

A game card shows as **one card**, and its videos are listed **underneath in folder order** (`sort_order` — the same order they appear in the game folder in Film Room), as an expandable dropdown list.

- NOT a merged/stitched Hudl-style playlist.
- NOT a "pick one video" prompt.
- One game card → tap/expand → videos listed in order → tap a video to play it.

This is the reason Fork A needs a wall-render slice: a game share can't hand the player a single file, so the wall renderer needs a game-card branch.

---

## Decision 3 — The viewer experience (grandparent / friends & family)

A viewer follows a **kid**, not a team. That relationship drives everything.

- **Viewer's home = the kid's wall.** The personal stuff — reels and clips the kid chose to post. This is what a viewer opens to first.
- **Team wall = one step over.** The shared feed — whole games, team-wide highlights. Reachable from the kid, but not the front door.
- **Coaches' Corner = never visible to viewers.** Coaches-only, always. A grandparent must never see it.

**Content decides the room:**
- A **whole game** → posts to the **team wall** (it's team content).
- A **kid's personal reel** → posts to the **kid's wall** (it's the kid's content, the kid's call).

A viewer naturally sees content in **both** places because they follow a kid who's on a team — kid's wall for the personal stuff, team wall for the games/team stuff. That's correct, not duplication.

**Child-safety constraints (already locked, carry forward):**
- A coach posting about a minor can never choose Public.
- Coaches' Corner is always coaches-only.

**Open edge case to resolve later:** if a viewer's kid is on two teams (e.g. club + school), does "home = the kid" still hold cleanly, or does the team-wall step need to disambiguate which team? Not blocking; flag for the viewer-build slice.

---

## Build order (locked — do not reorder)

The migration must exist before anything can post or render a game. Build the button first and it errors on the enum; build the render first and there's nothing to render.

### Slice 1 — SQL migration *(Supabase SQL Editor, never CC)*
- Add `'game'` to the `share_content` enum.
- Add a game branch to `resolve_shared_content` that returns the game + its videos ordered by `sort_order`.
- **Prerequisite:** run the read-only CC investigation first to capture the exact current shape of `resolve_shared_content`, the enum, and the games/videos schema (order column + game FK), so the migration matches reality instead of guessing.

### Slice 2 — Game "Post to wall" button *(CC, app-only)*
- Add a "Post to wall" entry point on the game (Film Room / the game→video Alert).
- Opens the existing `VisibilityPicker` (multi-select).
- Posts `content_type: 'game'`, `content_id: game.id` through the already-generalized handlers.

### Slice 3 — Wall render *(CC, app-only)*
- Game-card branch in the wall renderer: one card, videos listed underneath in `sort_order`, expandable, tap a video to play.

### Slice 4 — Viewer experience *(separate surface, later)*
- Kid's wall as viewer home; team wall one step over; Coaches' Corner never visible.
- Games land on team wall; kid reels on kid wall.
- Resolve the two-teams edge case here.

---

## Separate, still-outstanding (NOT part of this feature)

- **Launch-blocking:** video storage uses a **public** `videos` bucket + `getPublicUrl` in 7 places, embedded in post_to_wall shares and public reel tokens. Zero `storage.objects` policies. Needs its own dedicated, fresh session: make bucket private → add policies → convert 7 sites to signed URLs → solve how public reel share links reach a private file. This is the #1 pre-launch security item — above the game feature in priority, but its own job.
- Leaked Supabase `service_role` key rotation — still outstanding.
- Three always-ignored typecheck errors in `lib/native/` (video-cache.ts:250, video-upload.ts:84, video-upload.ts:205).
- `www.drugtrends.us` invalid config — needs a Vercel redirect rule (different project).
