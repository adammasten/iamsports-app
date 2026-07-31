# IamSports — Sharing Model Lock + Next Slices (handoff)

*Paste as the first message of a fresh chat to continue. Workflow unchanged: architecture/decisions in Claude chat; execution in Claude Code (CC) in the Mac terminal / VS Code panel; SQL only via Supabase SQL Editor (never CC); VS Code for editing. One terminal command per code block. One step at a time with confirmation. Honest pushback wanted.*

---

## DONE & VERIFIED THIS SESSION (June 22)

**The My Work visibility slice is built, tested, and committed locally as `a92e833`** (NOT yet pushed — see "Open: push" below).

What it does:
- New shared component `app/components/VisibilityPicker.tsx` — a **multi-select** (checkbox) bottom-sheet: **Only me / Friends & Family / Public / Team wall**. "Only me" is mutually exclusive; the other three can combine. Team-wall reveals a team chooser when >1 team, auto-picks when exactly 1, hidden when 0. A "Post" button (disabled until something's selected) returns the full selection set.
- `app/my-work.tsx` rewired: posting a reel to a kid now opens this picker (after the existing kid-selection Alert) and writes **one `post_to_wall` row per selection**:
  - **Only me** → no row ("Kept private")
  - **Friends & Family** → `audience='player'` (family-only — NEVER 'public')
  - **Public** → `audience='public'`
  - **Team wall** → `audience='team'` + `p_team_id`
- `Destination` type gained `{ kind:'player'; kidName }`; `renderBadges` shows a slate "On {kid}'s wall" badge; `loadReels` now reads `audience='player'` rows as wall placements (previously ignored) so badges persist across reloads.

**VERIFIED at the database level:** a test post of "Friends & Family" wrote a `shares` row with `audience = player` (timestamp 2026-06-22 19:24), target_player_id = the kid, team_id NULL. The old open-web hole (hardcoded `audience='public'` for a kid) is closed and proven. No new `public` row is written unless Public is explicitly checked.

Typecheck clean throughout (only the 3 known pre-existing `lib/native/` errors).

---

## THE BIG MODEL DECISION LOCKED THIS SESSION

**You post to your OWN wall. You SEND to others — it lands in their inbox — and they choose whether to put it on their wall. Nobody can post directly to someone else's wall, ever.**

This reconciles a tension that ran through the session. Concretely:
- **Your own wall (your own kid):** you post directly and pick visibility (Only me / Friends & Family / Public / Team). The `post_to_wall` RPC enforces this — it requires the caller be a *linked parent* of the target player. This is what My Work does today. ✅
- **Someone else's kid (a teammate, another family):** you CANNOT post to their wall. You **send** it → it lands in **their** "Shared with you" inbox → the recipient family decides if/how it goes on their wall. *(This "send to another person" path is NOT built yet.)*
- **"Shared with you" (inbox):** is where things other people sent **you** land. It is NOT auto-on-your-wall. From the inbox, **you** deliberately choose to post it to your wall (using the same VisibilityPicker), at the visibility you pick.

This matches the locked `sharing_access_model.md`: *"A coach shares content → it lands in the family's inbox. That is the coach's ONLY power over a kid's wall."* Inbox ≠ wall; promoting inbox→wall is a deliberate act by the wall owner.

---

## NEXT SLICES (in order)

### 1. `kid.tsx` "Shared with you" inbox — bring to parity with My Work
- **Swap its old "Save to wall" picker** (currently Public/Team-only, inline Modal) → reuse the shared `VisibilityPicker` component (Only me / Friends & Family / Public / Team). Same multi-select behavior.
- **Add a dismiss/delete action** on inbox items = **remove it from MY inbox** ("I don't want this thing someone sent me"). This is distinct from "take off my wall" (a separate wall-side action). The inbox dismiss is the one to build here.
- Note: `kid.tsx`'s picker is a separate inline Modal today — the cleanest path is to delete that and render `<VisibilityPicker>` like my-work does. Confirm its `doPost`/`pickerStage` logic maps onto the new component's `onSelect(VisibilitySelection)` shape.

### 2. "Who shared it" on wall/inbox cards
- Wall and inbox cards don't show the sharer. Add sharer name/attribution. (Adam flagged this looking at Lars's wall.)

### 3. Wall-side visibility control
- On the wall, tapping a post's badge → change where it lives later (e.g. family promotes a private post to Public). This is the "make public after the fact" control. Also covers "take off my wall."

### 4. The "send to another person" path (the Model-B half not yet built)
- A way to send a reel/clip to someone else's kid → lands in THEIR inbox (not their wall). Needs the send UI + confirming `post_to_wall`/share semantics for a non-own target (RLS currently requires linked-parent, so sending to a non-own kid needs a different path — design before building).

### Later / queued
- Coach force-private (`hidden_by_family` + role check — RPC surgery; coach can't even call `post_to_wall` today due to linked-parent gate).
- Thumbnails (auto poster-frame from Railway FFmpeg → `thumbnail_path` → signed URL).
- "Only me" vs "Family" as truly distinct levels (enum has no "just me, not even family" today; currently Only-me = no row).
- Coaches' Board (`audience='coaches'`), tags-travel-onto-posts for sorting, tournament names, "Reels" not "Highlights", duplicate-clip flag.

---

## OPEN: THE PUSH (do this when convenient)
- Commit `a92e833` is **made locally** but **not pushed** — GitHub auth is broken. The terminal SSH key returns `Permission denied (publickey)`, and `gh` CLI isn't installed, and VS Code's Sync/Push hung on auth.
- The work is safe locally regardless. To get it (and future commits) pushing again, fix GitHub auth — either re-add an SSH key to the GitHub account, or install/auth `gh`, or complete VS Code's GitHub sign-in. ~10-min side task; do it before the next push.

## ONE-LINE STATUS
My Work multi-select visibility picker is built, tested (DB-verified `audience='player'`), and committed locally as `a92e833` (push blocked on GitHub auth — work is safe). Model locked: post to your own wall, send to others' inboxes, recipients choose. Next: bring `kid.tsx` "Shared with you" to parity (same picker + inbox dismiss), then sharer attribution, then wall-side visibility control, then the send-to-others path.
