# IamSports — "My Work" & the Publishing Model

*Locked on a design walk. This is the north star for the folder ("My Work"), the boards/walls, and how content gets created once and published to many audiences. When we build, it's execution — the decisions are made.*

---

## THE CORE IDEA (the thing that ties it all together)

**You create something once. It lives in "My Work." You publish it to one or more audiences. Each wall is just a filtered view of "things published to that audience." "My Work" is the unfiltered master list of everything YOU made — each item badged with where it currently lives.**

- Content is created once (a reel).
- "Publish" is an *action* — it sends the item to an audience (coaches / team / public / a specific kid).
- Walls/boards don't own separate copies. They're audience-filtered views.
- "My Work" mirrors everything you made and shows a status badge per item.
- **Nothing is duplicated.** One item → multiple publish targets → one master list (My Work) that reflects it all.

---

## THE UNIT: REELS (not "clips," not "highlight reels")

- **Clips are raw material.** A game has hundreds. A flat list of raw clips is low-value noise — nobody scrolls 400 clips. (This was the realization that killed the "Clips library.")
- **A REEL is the made thing** — clips you assembled and exported into a video. Reels carry the value.
- Not all reels are highlights — so the word is just **"reels,"** not "highlight reels."
- **Anything you create/export becomes a reel record.**

### Keystone dependency (the thing everything needs)
Today an export renders to the **camera roll only** — no record persists in the app. So there is nothing for "My Work" to list, nothing to badge, nothing to publish. **The foundation is: an export must ALSO save a `reels` record.** Owner can delete it when they don't want it anymore.

`reels` table (shape):
- `id`, `created_by_user_id`, `team_id` (nullable), `storage_path` (Supabase storage), `source_clip_ids[]`, `title`, `created_at`
- Visibility/where-it's-published is derived from its **share rows** (the existing `shares` table), so a reel can be published to several audiences at once and My Work reads those rows to show badges.
- Deletable by owner.
- Reels render to Supabase storage (cloud export) → become listable, replayable, shareable. (This is the "cloud export" July milestone — same build.)

---

## THE SPACES (five distinct surfaces, no duplication)

### 1. My Work (the folder / file icon)
- **What:** Everything YOU have created. The master list. Your command center / home base.
- **NOT a "private bucket"** — it's the view of *all* your work, regardless of share state.
- Each item shows a **status badge** indicating where it lives:
  - "Not shared" (just yours)
  - "Shared with Lars" (a kid's wall)
  - "On Centex team wall"
  - "On coaches' board"
  - "Public"
  - (an item can have several — it's published to multiple audiences)
- **Team chips at top** (multi-select — select multiple teams at once; deselect to remove). Already the right pattern.
- **Filter/sort** (see below).
- Tap → play.
- Good name: **"My Work"** (working name; "My Library" alt).

### 2. Coaches' Board
- **What:** A board just for coaches/admins. NOT public. If you're not a coach or admin, you can't see it.
- **Audience = `coaches`** (this value ALREADY exists in the share_audience enum — scoped months ago).
- Pick **which team's** coaches' board (per-team).
- Coaches curate what other coaches see — publish selected reels here from My Work.
- This is where coach-to-coach sharing happens (edits-in-progress, scout work, etc.).

### 3. Team Wall
- **What:** The team's wall. Holds BOTH:
  - **Team-only** items (`audience='team'`) — private to the team (coaching notes, full game film, "what we're working on").
  - **Public** items (`audience='public'`, same `team_id`) — visible to everyone on the wall.
- So the public stuff on the team wall is visible to all; the team-only stuff just to the team. Same wall, two visibility levels. (Already supported: `audience='team'` vs `'public'`, both carry `team_id`.)
- Coach controls full-game / team-only gating (don't leak film to followers/competitors).

### 4. Kid's Wall
- **Public** posts (everyone) AND a **private side** (just the kid — their own stuff to look at / curate for themselves).
- Family controls it; coach has no control over a kid's personal wall (coach shares land in the family's inbox; family decides).

### 5. Feed
- Everyone's **public** content, from people you follow (and maybe discovery later).
- TikTok-style (full-screen vertical). **Deferred / worry about later.**

---

## THE UNIFYING PRINCIPLE

**Audience is a dial on a single item.** `coaches` / `team` / `public` / a specific `kid`.
- Create once (reel in My Work).
- Publish to one or more audiences (via the existing `post_to_wall` action).
- Each wall = filtered view of "items at that audience."
- My Work = the union of everything you made, badged.

This is the SAME create→publish loop already built for parents (inbox → save-to-wall picker). Coaches' Board just adds the `coaches` audience (already in the enum). **No new sharing concept needed.**

---

## WHAT SHOWS UP IN "MY WORK"? (decision pending — leaning reels-first)
- **Option 1 (focused):** Just reels (exports) for now.
- **Option 2:** Reels + games you created (games already exist as records; badge them the same way).
- **Option 3 (fullest):** Reels + games + any single clip you explicitly saved.

*(Recommendation: start with reels — the keystone — then fold in games since they already persist. Single saved clips last.)*

---

## DESIGN PROBLEMS TO FIX (flagged on the walk)

⚠️ **The folder/library screen currently looks weak.** Only shows about half a page of clips; feels sparse and "suspect." It needs to:
- **Show more per screen** — denser layout, fill the page, not a short list floating in space.
- Look like a real library/grid, not a stub. (Reference: Instagram profile grid, Hudl library.)
- Strong empty states that don't look broken.
- This is part of the broader **design-system unification** problem: the legacy light-themed screens (games/export/clips) vs. the dark modern screens (home/kid/team) look like two different apps. The library should match the modern dark aesthetic and feel substantial.

---

## BUILD ORDER (marching orders)

1. **`reels` table + export-saves-a-record (cloud export).** THE KEYSTONE — My Work, the coaches' board, and every "share a finished video" path all need it. Without it there's nothing to list/badge/publish.
2. **"My Work" folder** — lists YOUR reels, team chips (multi-select) + filter, status badges per item (read from share rows), tap-to-play. (The screen we already built is ~80% of this — repoint from raw `clips` → `reels`, add badges, fix the density/design.)
3. **Coaches' Board** — the wall pattern at `audience='coaches'`, per-team, publish-from-My-Work.
4. **Publish-from-My-Work** — extend the existing `post_to_wall` to accept `coaches` audience + reels as a content type; the badge reflects it.

---

## FILTER / SORT (catch-all power tool on My Work)
Top of My Work: **team chips** (multi-select). Plus a **filter/sort** (most apps have both):
- Filter by: **highlights / games / reels / by tag / by creator** (I made it / a coach made it / a team made it).
- This makes My Work the catch-all that parents AND coaches both use (parent scopes to their kid's stuff; coach to their teams').
- Sort by: date, team, type.

---

## STATUS / NAMING NOTES
- "Reels" (not "highlight reels"). "My Work" (working name for the folder).
- `coaches` audience already in the enum — no migration for that value.
- Reels persisting as records = the same thing as the cloud-export milestone.
- The current "Clips library" screen is being **repurposed** into "My Work" (reels), not thrown away.

---

*End of spec. The keystone is the `reels` table + export-saves-a-record. Everything else is views on top.*
