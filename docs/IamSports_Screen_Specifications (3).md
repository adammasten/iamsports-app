# IamSports — Screen Specifications

**Purpose of this document:** The canonical, page-by-page definition of what every screen in IamSports does, what each function should do, and which roles can do what. This is the source of truth. A new build session should be able to read the relevant screen section and know exactly what to build without re-explaining anything.

**Status:** Working spec, V1. Derived from annotated screen printouts. Sections marked **Open Questions** still need a decision before that part is built; everything else is settled.

---

## Global concepts (read first — these apply across every screen)

These definitions are settled and used consistently throughout the app and this document.

### Vocabulary
- **Clip** — a single tagged moment. A clip is what you create when you tag a video. Clips are the raw building blocks; users work with them during tagging, but "Clips" is **not** a top-level user-facing destination.
- **Reel** — multiple tagged clips put together and exported into one finished video. **"Reel" is the primary user-facing term.** Anywhere the UI currently says "Export," "Highlights" (as a noun for the output), or "Clips folder," it should move toward "Reel"/"Reels."
- **Highlight** — a *particular kind* of reel (e.g. a star/highlight-flagged reel). Highlight is a **subcategory under Reels**, not a synonym to delete. The ★ Highlight flag still exists at the clip/tag level.
- **Video** — a raw uploaded file (full game, a half, a quarter, a single play). A video is what gets uploaded; it is **not** a clip. Clips are created *from* a video by tagging.
- **Game** — the container that holds the uploaded video(s) for a matchup. A game carries the tagging-status indicator (see below).

### "Pick a wall" = the universal sharing model
**Sharing always means choosing which wall to put something on.** There is no separate "share" concept — *picking a wall is the share.* This applies everywhere in the app and to multiple content types:
- You can share a **raw video** to a wall (e.g. at upload time).
- You can share a finished **reel** to a wall (after export).

One sharing system serves both videos and reels — it is not two separate mechanisms.

**The walls (these are the ONLY walls — there is no parent/personal wall):**
- **Kid's (player's) wall** — a specific player's wall. Kids have profiles and walls; **parents do not.** A parent is not a profile and has no wall of their own.
- **Team wall** — a specific team's wall (this is also the team's home feed, see screen 10).
- **Coaches' Board** — a team's coaches-only space.

> **IMPORTANT CORRECTION:** There is **NO personal/parent wall.** Earlier drafts incorrectly listed a "personal wall." A parent posts content to a **kid's wall, a team wall, or the coaches' board** — never to a wall of their own, because parents are not profiles. Any "post to public/personal wall" path is wrong and should not be built or used.

**Who can post where — INITIAL BUILD (hardcoded defaults):**

| Wall | Who can post (now) | Configurable later? |
|---|---|---|
| Kid's wall | The kid + their **linked parents** + **coaches** (coach posts are forced private — see below) | Possibly, via future Admin Panel |
| Team wall | **Coaches only** (admin / head_coach / coach) — default | **Yes — future Admin Panel** sets the rule |
| Coaches' Board | **Coaches only** — permanent | **No — never configurable** |

**Kid's wall — public vs. private visibility (child-safety rule):**
A kid's wall has both public and private posts. Each post carries a visibility, and the rule is: **the family controls public exposure of the kid.**
- **Kid or linked parent posts → they choose** public or private. The family decides what gets shown off publicly vs. kept family-only.
- **Coach posts → forced private (family-only).** A coach may contribute to a kid's wall, but **cannot make a post about a minor public.** Only the kid/linked parents can make something on that kid's wall public.
- Rationale: outsiders (coaches) can never broadcast a minor; only the family can. This is a deliberate child-safety default.

**Decided rules:**
- **Coaches' Board is permanently coaches-only.** It is never configurable and never opens to parents — it is the protected coaching workspace. (A parent gets in only by holding a coach role.) The Coaches' Board is also a **reserved future dev area** — more coach-collaboration functionality is planned here later — but its access rule (coaches only) is permanent regardless of what gets built into it.
- **Team wall posting is coach-controlled in the future.** The *configurable* rule ("who may post to this team's wall") will live in a future **Admin Panel** (see below). Until then, the team wall default is **Coaches only**, and the team administrator can open it up once the Admin Panel exists.
- **Default posture is locked, then opened deliberately.** New teams start at the most restrictive setting (Coaches only); openness is opt-in. This is a child-safety-conscious default.

**Two distinct meanings of "admin" — do not conflate:**
- **Team administrator** = a *person/role.* The individual who administers a team. Admin (and likely head_coach) hold these rights. This is who is allowed into the Admin Panel.
- **Admin Panel** = a *screen/section* (future build). The place the team administrator goes to control team-level settings. The team administrator is the one with access to it.

**Future — Admin Panel (NOT a now-build):**
A future **Admin Panel**, accessible to the team administrator (and likely head_coach), holds team-level rules. The **first** rule it governs is team-wall posting permission, with options:
- Coaches only (default)
- Coaches + linked parents
- Anyone on the team

The Admin Panel is the natural home for additional future team-level toggles (team-wall visibility/public, whether parents may post to kids' walls, etc.). Named and reserved now; built later.

### Tagging status indicator (red / yellow / green) — lives on each GAME
Every **game** carries a tagging-progress status, shown wherever games are listed (team feed, Coaches Corner, game lists):
- 🔴 **Red** — not tagged at all.
- 🟡 **Yellow** — tagging has started (auto-detected: flips from red to yellow when the first clip/tag is created on that game).
- 🟢 **Green** — tagging finished. **Cannot be auto-detected** — the user must explicitly mark it done.

Mechanics:
- Red → Yellow is **automatic** (first tag triggers it).
- Yellow → Green requires a deliberate user action — a **"Complete tagging"** control (e.g. hold/long-press a game → "Complete tagging").
- Green is **reversible / editable** — marking a game "done" does **not** lock it. A user can re-open a completed game and keep tagging afterward; status can move back to yellow or be re-completed.

### Roles (used by "Pick a wall" gating and Coaches Corner access)
- **Coach-level roles:** admin, head_coach, coach. These are the roles that can act as a coach (attach team ownership, post to team/coaches walls, access Coaches Corner).
- **Parent:** can manage their linked kids, upload, and post to walls they're permitted to (their **linked kid's wall**; a team wall only if they also hold a coach role) — but has **no wall of their own** and **no Coaches Corner access** unless they also hold a coach role.

### Recurring requirements (wanted on essentially every reel/list screen)
- **Named reels** — every reel has an editable name.
- **Thumbnails** — every reel has a thumbnail. Baseline: auto-generated. Better (target): user can scrub the reel and set a chosen keyframe as the thumbnail. Thumbnails should be editable/adjustable.
- **Attribution + date** — show who a reel was shared by (source user, e.g. "Lars from Deep") and the date it was made.
- **Sort + search** — list screens should support sorting and searching.

---

## 01 — Home Page (the Feed)

**Purpose:** The user's main landing feed. Shows reels/content relevant to the user, filterable by chips. Functions as the primary feed of the app.

**Functions:**
- **Add team logo** — ability to add a logo for teams (shown in the YOUR TEAMS area / team avatars).
- **Filter chips** across the top of the feed:
  - **All** — the entire feed.
  - **[Player name] (e.g. "Lars")** — shows all reels (including highlights and games) where that player has been **shared with** or **tagged**, plus content for teams the player is attached to.
  - **Highlights → rename to "Reels"** — the user's own reels, plus reels shared by teams they're associated with or follow. Respects role-based visibility (sees private + public according to role). Also surfaces followed players' public posts.
  - **Sent** — content shared *by* the player (things this user/player has sent out).

**Roles:** All users see their own feed; chip results are scoped by the user's relationships (tagged-in, shared-with, teams attached to) and role-based visibility.

**Open Questions:**
- Final label for the per-player chip when multiple kids exist (one chip per kid, or a single switch?).
- Exact visibility rules for "followed players' public posts" vs. attached-team content.

---

## 02 — Player Profile

**Purpose:** A player's profile showing their info and their reels/content, with tabs (Wall, Games, Clips, Sports/Spo…). Entry point for uploading to that player and sharing to their wall.

**Functions:**
- **Layout fix** — put the relevant header elements on the same line ("make on same line").
- **Reels** — reels in the viewer's circle / players they follow. A reel appears here when the **player is tagged in it.**
- **Shared content that isn't a reel/highlight** — something may have been shared to the player even if it isn't a formal reel/highlight (someone just shared it). This raises the sharing question, answered globally: **sharing = pick a wall**, and who may share is role-gated (coach/admin and linked parents).
- **Thumbnails** — reel/content cards on the profile (e.g. the "Lars from Deep" card) need thumbnails.
- **Attribution + date** — cards show who shared it and when it was created (the "Lars from Deep · From [user] · 6/10/2026" pattern is correct and should stay).
- **Save to wall** — action present on shared content cards.

**Roles:** Linked parents and coaches can upload to / share to this player per the global wall-gating rules.

**Open Questions:**
- None blocking. (Confirm whether the "Clips" tab on this profile stays as a tab or is folded into Reels per the global vocabulary direction.)

---

## 03 — Player Profile Edit

**Purpose:** Edit a player's core info and team associations.

**Functions:**
- **Edit name / grad class** (existing fields).
- **Edit teams attached to** — manage which teams the player is attached to.
- **Show a count (#) for each team** the player is on.
- **List teams attached to** the player.

**Roles:** The managing user (linked parent / coach with rights) edits the player.

**Open Questions:** None.

---

## 04 — Upload from Player Profile

**Purpose:** Upload a **video** (or partial video — a quarter, a half, a full game) to a player, optionally attach it to a team / mark it as a game, title it, and optionally share it to a wall right from upload.

> **Note:** What is uploaded here is a **video**, not a clip. Clips are created later by tagging this video.

**Functions:**
- **Attach to a team** — ability to attach the uploaded video to a team, **if the coach role allows.** Real use case: a coach videotaping games uploads a video and tags the team ("this is Centex Attack"). Role-gated to coaches.
- **"My Upload" fallback** — if there is no team to attach, the video needs a **"My Upload"** destination/tag so it still has a home.
- **Title the video** — free-text title (e.g. "First Quarter," "vs Apex — 2nd Half"). Good baseline function.
- **Mark as a game** — ability to designate the upload as a game, same as the team-profile game flow; can be attached to a team later. (Marking-as-game and attaching-a-team are independent choices.)
- **Share at upload ("Pick a wall")** — from this screen, share the video to a wall:
  - A kid sharing to their own wall.
  - A parent sharing a good video to their linked kid's wall.
  - Posting to a kid's wall (a linked kid), a team wall (if coach), or the coaches' board (if coach).
  This is the same "pick a wall" model used app-wide; the thing being shared here is a **raw video** (vs. a finished reel elsewhere).

**Roles:**
- **Coach:** may attach the video to a team / mark as that team's game.
- **Linked parent / kid:** may upload and share to permitted walls (own wall, linked kid's wall). No team attach unless coach.

**Open Questions:**
- Confirm: for a parent sharing to a kid's wall at upload — **linked parent only** (assumed yes, matching existing wall rules).
- Confirm whether "attach to team" auto-creates a Game under that team or is a separate explicit toggle.

---

## 10 — Team Page Home  → restructured as a feed

**Purpose:** The team's home screen. **The team page IS the team wall**, presented as a feed (like the home page feed). Everything the user wants for that team is on one page — no separate "Team Wall" destination to tap into.

**Structural change (important):**
- **Before:** team page = header + large "Create Reel"/"+ New Game" buttons + a separate **"Team Wall"** button you tap to reach the wall.
- **After (target):** team page = slim "Create Reel"/"+ New Game" buttons at top + **the wall/feed itself rendered on the page**, with sort chips and search. The standalone "Team Wall" button goes away because the wall **is** the page.

**Functions:**
- **"Export" → rename to "Create Reel."**
- **"Switch team"** → shorter label.
- **"Create Reel" and "+ New Game" buttons** → make them **smaller** (less tall/thick) so they don't dominate.
- **Team feed (the page body):** functions like the home feed but scoped to this team — a feed of the team's content with:
  - **Sort chips** at the top (e.g. All / Reels / Games).
  - **Search** function on the same page.

**Roles:** Team members see the team feed; coaches get create/new-game actions.

**Open Questions:**
- Exact chip set for the team feed — assumed **All / Reels / Games** for now; revisit whether Players/Sent belong here.

---

## 12 — New Game

**Purpose:** Create a new game for a team — set opponent, date, optional tournament — then upload the first video.

**Functions:**
- **Opponent name** + **Game date** (existing).
- **Add Tournament name** — new field; should be **searchable throughout the site** (so you can find all games from a given tournament).
- **Empty-state copy fix** — replace "No videos yet. Upload your first one!" with copy that explains what can be added, e.g. about adding a **Clip, Video, or Half of the game** (reword the empty state to guide the user on what an upload can be).

**Roles:** Coach-level (creating games for a team).

**Open Questions:**
- Tournament as free text vs. a selectable/searchable entity (affects how "searchable throughout site" is implemented).

---

## 13 — Team Export — Step 1 (Pick games)

**Purpose:** First step of building a reel — pick which games to include. (Part of the Create Reel flow.)

**Functions:**
- **Rename "Export Highlights" → "Reels"** (the output is a Reel, not "Highlights").
- **Add a Sort function** to the game list.
- **Add a Search function** to the game list.
- "Next: Build Tag Groups →" proceeds to Step 2.

**Roles:** Coach-level / reel creator.

**Open Questions:** None blocking.

---

## 14 — Team Export — Step 2 (Build Tag Groups)

**Purpose:** Second step of building a reel — build tag groups that define what goes into the reel (Offense/Defense/Highlights/Emphasis/Players categories).

**Functions:**
- **★ Highlight and !POE on the SAME ROW** — put the ★ Highlight toggle and the !POE (point of emphasis) toggle on one row together.
- **Suggested Tags** — provide some suggested tags to help the user build groups (so they're not staring at a blank slate).
- "+ Add Group" and "Next: Review Clips →" (existing flow).

**Roles:** Coach-level / reel creator.

**Open Questions:**
- What the suggested-tags set is, and whether it's sport-aware (multi-sport platform — suggestions should not be basketball-only).

---

## 15 — Team Export — Step 3 (Review Clips)

**Purpose:** Final step — review the clips that will be included before exporting the reel.

**Functions:**
- **Larger list of tags per clip** — each clip row should show more tag detail (e.g. ★, "Lars 3 made," "Assist Lander") so the user understands what each clip is.
- **Highlight duplicate clips** — flag when the same moment/clip appears more than once so the user can spot and remove dupes.
- "Export N Clips" produces the reel.

**Roles:** Coach-level / reel creator.

**Open Questions:**
- Duplicate detection rule — what counts as a "duplicate" (same source video + overlapping time range? identical tag set?).

---

## 20 — Reels Folder (formerly "Clips Folder")

**Purpose:** The master reels library / browser. **Rename "Clips folder" → "Reels Folder."** Clips are removed from here entirely — this screen is reels only.

**Contents (groupings):**
- **Saved Reels** — reels the user has saved → **future feature** (placeholder now, not built yet).
- **My Reels** — reels the user has made / shared.
- **Team reels** — reels living on the walls of teams the user (or the player) is **attached to** (attached, not "followed").

**Per-reel requirements:**
- **Named reels** — editable name.
- **Thumbnails** — editable/adjustable (auto-generated baseline; scrub-to-set-keyframe target).
- **Shared-by** — who shared the reel.
- **Made/created date.**

**Sorting (top bar):**
- A sort/filter bar at the top to slice through reels (e.g. "see all Centex reels," filter by team).
- Start with sort by **Team / My Shares / Liked**; expand over time.

**Roles:** Shows the user's own reels + reels from their attached teams; saved reels later.

**Relationship to My Work (30):** **Reels Folder = the broad library** (mine + my teams' reels + saved later). **My Work = my personal working area** (what I made) + Coaches Corner. They are intentionally different; do not merge without an explicit decision.

**Open Questions:**
- Saved Reels mechanics when built (copy vs. protected reference).
- Final top-bar sort set beyond Team / My Shares / Liked.

---

## 30 — My Work / My Workspace

**Purpose:** The user's **personal** reels working area — the reels *they* made — plus, for coaches, a per-team shared **Coaches Corner.**

**Functions (My Work — personal):**
- List the user's own reels (name · duration · date) with where-it-lives badges, play, rename, delete, search, and sort.
- **Add sort by Games** (in addition to existing Newest / A–Z / Longest sorts).

**Functions (Coaches Corner — per team, coaches only):**
- For **each team the user is a coach on**, there is a **Coaches Corner**: a shared workspace for that team's coaching staff.
- **Shared state, not live co-editing.** Completed work syncs and is visible to all coaches of that team: when a reel is made it shows up there; when a tag is saved it's there. No real-time collaborative editing, no shared cursors — just "completed information lives here and everyone can see it."
- Coaches can collaboratively: **edit, tag videos, make reels, view video breakdowns,** and **see whether a game has been clipped/tagged** (uses the red/yellow/green game status).

**Roles:**
- **My Work (personal):** the individual user.
- **Coaches Corner:** **coach-level roles only** (admin / head_coach / coach). **No parents** — a parent gets access only if they become a coach.

**Distinction recap:**
- **My Work** = mine, personal (what I made).
- **Coaches Corner** (inside My Work, one per team) = shared with my co-coaches (team working space, shared state).
- **Reels Folder (20)** = broad library (mine + attached-teams' reels + saved later).

**Open Questions:**
- Whether Coaches Corner is a section *within* My Work vs. its own route reachable from My Work.
- How a game's "breakdown" view is presented inside Coaches Corner.

---

## Cross-screen open items (track these globally)

- **Sharing / "Pick a wall" model is now specced** (see Global concepts). The connective tissue for many screens (upload-share, reel posting, player/team/coaches walls). Posting permissions and the now-vs-future split are decided. Remaining *implementation* dependencies: the post-to-wall path must handle a target appropriately for reels (not only kid-centric), and reel content must resolve/render when posted (so a posted reel plays rather than showing "content unavailable").

  **User-facing term: "Post to wall"** (not "publish"). The action of putting a reel or video on a wall is called *posting* throughout the UI. The internal Supabase function is named `publish_reel` — that is internal plumbing only and keeps its name; users never see it.
- **Thumbnails** (auto + scrub-to-set) recur on 02, 20, 30 — build once, reuse.
- **Multi-sport:** the platform is **not basketball-specific.** Suggested tags, categories, and any future automation must be sport-agnostic or sport-aware, never basketball-only.
- **Save Reels** appears as a deferred "future feature" (20). Decide copy-vs-reference when it's scheduled.

---

*End of V1. Update per-screen sections as decisions are made; move items out of "Open Questions" once settled.*
