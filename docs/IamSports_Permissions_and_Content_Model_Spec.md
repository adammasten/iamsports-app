# IamSports — Permissions, Onboarding & Content Model Spec

**Date captured:** July 8, 2026
**Status:** DESIGN / NOT BUILT. Whiteboard capture to start the next build session from. Decisions are directional (product logic Adam has decided); mechanics depend on what already exists in code — see "Next-session plan" at the end. Nothing here is built yet.

**Sequencing rule (locked):** Permissions/membership is the FOUNDATION and gets built BEFORE the upload flow. Almost every upload question is really a permissions question. Build the foundation first; then upload just asks the permission system "can this person do this?"

---

## PART A — The permissions model

### A1. The permissions grid (coach's control screen)

A matrix. This UI doubles as the data model — every cell is a stored `(user, team, permission, allowed)` value.

- **Rows** = the team's members (players/parents), shown by the kid's name (e.g. "Lars Masten", "Conrad Masten"). All players on the team appear as rows.
- **Columns** = the toggleable permissions (see A2).
- **Cells** = on/off toggles (radial dots). Coach taps to grant/revoke per person.
- **"All players (default)" row** at the top of each team's grid = the team-wide default for each column. Set once; individual rows below can override it.
- **Multi-team coaches:** each team is a **collapsible dropdown**. Collapsed = just the team name + expand chevron. Expanded = that team's roster + permission grid. (Adam has Centex2026 6th Grade + Centex Attack Boys.)
- **"+ Add coach"** button lives at the top of this screen (see A4 — coaches are managed separately from the per-player grid).

### A2. The permission columns (FINAL list, with defaults + descriptions)

| # | Permission | Default | Description (shown to coach) |
|---|-----------|---------|------------------------------|
| 1 | Post to team wall | ON | Share videos and reels to the team's wall for everyone to see. |
| 2 | Upload video | ON | Add video files into the app. |
| 3 | Tag videos/games | ON* | Mark plays and moments in a video for highlights and breakdown. |
| 4 | Send / donate to team | ON | Give your footage to the coach's Film Room to use. |
| 5 | Create / donate games | ON | Set up a game (opponent, date) and add videos to it for the team. |
| 6 | Edit / build reels | ON | Combine clips into highlight reels. |
| 7 | Delete content | **OFF** | Remove videos, games, or reels. |
| 8 | Manage roster | **OFF** | Add or remove players and coaches, and approve join requests. |

Notes:
- **"Create games" and "Donate games" are the SAME action** — a parent creating a game IS donating it to the team. Merged into one column (#5).
- **Delete content (#7) and Manage roster (#8) start OFF** — they're destructive/structural, so a coach must deliberately grant them. Safety default.
- *#3 Tag: shown ON in the grid default above, BUT note the existing locked spec (IamSports_Access_Control_Spec.md) says tagging is a granted right, default = uploader only. Reconcile at build time — see B4. The grid default and the per-video tagging-right may be two layers; confirm the intended interaction.
- Each column shows its one-line description so the coach knows what they're granting (tooltip, info icon, or subtext).

### A3. Team-wide defaults vs. per-person overrides
- The "All players (default)" row sets the column default for the whole team.
- Any individual player row can override the default (e.g. wall-posting ON for the team, but OFF for one problem parent).
- This makes the "can parents post to the team wall at all?" decision a coach-controlled toggle: default ON + coach moderates, or coach flips the column default OFF for a locked-down coach-only wall.

### A4. Coaches are separate from the player grid
- The grid rows are **players/parents** — it grants *parents* specific extra abilities.
- **Coaches/admins get their powers from their ROLE**, not from grid toggles. They shouldn't be crammed into the per-player grid.
- There's a **"Coaches" area** (managed by "+ Add coach") showing who has coach-level access, separate from the permission grid.

---

## PART B — Content lifecycle (upload → donate → tag → post)

### B1. Upload ≠ Post (locked)
- Uploading = getting footage into the **Film Room** (workbench / "My Work"). That's all.
- The **Film Room is where ALL work happens**: editing, tagging, building reels, and posting to walls.
- **Posting to a wall is a separate, deliberate act**, done later, from the Film Room. Uploading never auto-posts to any wall.

### B2. Upload-first, attach-later (locked)
- A video can come in with just a **label** and nothing else (minimal flow already exists on the Upload screen).
- Attaching to a team/game/kid is **optional, layered on later** — not required at upload.
- Loose/unattached footage lives in the Film Room as the uploader's own raw material. Intended behavior, not a bug. (Likely resolves the "tester / not a game yet" orphan.)

### B3. The upload "+" create flow (fields)
Reachable from the "+" button. Offers:
- **Label** (every upload).
- **Quick loose upload** — label + upload, auto-stamped date/time.
- **Create a GAME** holding multiple videos (quarters/halves), with:
  - Opponent with **"vs"/"at"** prefix — **default "vs"**; "at" optional/future.
  - Game date.
  - **Tournament** — its own editable/mergeable entity, NOT free text (so "Summer Slam" / "summer slam" don't become duplicates; allow edit/merge to clean up).
- **Practice/type note:** long-term add a `type` field (game/practice/tournament/skills/scrimmage) with game-only fields shown conditionally. For now, the "call a practice a game" workaround is acceptable to ship — but design toward a real type field.

### B4. Donate / "Send to team"
- **Any team member with the "Send to team" permission** can send footage to a team.
- Sent footage lands in the **coach's Film Room**, in a **dedicated "Sent to team / Donated" section/filter**, separate from the coach's own footage.
- **The coach can DELETE** anything sent (donation is a suggestion, not a mandate — keeps the workspace clean, coach in control).
- **The sender keeps their own copy** in My Work. Donating shares it, doesn't remove it.
- **No accept step for v1** — sent footage appears in the coach's section; coach deletes what they don't want. (Add approval later only if abused.)
- Recommended: notify the coach ("3 new videos sent to Centex2026") so donations don't pile up invisibly.

### B5. Tagging rights — who can tag
- Existing locked rule: tagging is a **granted right per video**; default = uploader controls it.
- **Ownership determines who holds tagging keys:**
  - Parent uploads to their **own kid** → parent controls tagging.
  - Footage **donated to the team** → tagging control transfers to the **coach**. The coach then designates taggers (self, assistant coach, specific parent).
- So "send to team" also hands tagging control to the coach — resolving "coach designates taggers" vs. "uploader controls tagging" without conflict.
- Reconcile the per-video tagging right with the grid's "Tag" column at build time (they may be two layers: the grid grants a *general* ability; the per-video right controls a *specific* video).

---

## PART C — Onboarding: how people get on a team

**Two roads in, one road out.**

### C1. Road in #1 — Invite link (the frictionless path)
- A coach/admin generates and shares an **invite link** (e.g. drop in team GroupMe/text).
- Anyone who taps the link is **auto-approved** onto the team — having the link IS the approval (the coach vouched by sending it).
- Onboards a whole team in one message. No manual per-person approval.

### C2. Road in #2 — Search + request (for stragglers)
- A new user can **search for their team by name** and tap **"Request to join."**
- **Anyone with "Manage roster"** (coach or admin — not limited to one person) can **approve or decline** the request.
- A **"Requests" section** (near roster management) shows pending requests: "[Name] wants to join [Team] — Approve / Decline."
- Approve → they're on the roster, appear in the permissions grid, get the default permissions.

### C3. Road out — Remove
- Anyone with **"Manage roster"** can **remove/delete** a member.
- This is the backstop even for link-joined members: auto-approve by link, but the coach can always kick someone who shouldn't be there.

### C4. New-user flow summary
Log in → find your team (via invite link OR search) → get on the roster (auto via link, or approved request) → appear in the permissions grid with default permissions → get attached to the team's games.

---

## PART D — How this connects to already-designed systems

This permissions/membership foundation is the SAME foundation that unlocks two things already designed and shelved:

### D1. Viewer model (grandparent / family) — CORRECTED July 8

**Key distinction — two different "team walls":**
- **Team wall** = members-only. Only people ON the team can see it (the private team feed).
- **Public team wall** = posted for the world. Anyone can see it (content a coach deliberately makes public).
These are different surfaces and the viewer model depends on the difference.

**Tier 1 — Account-holder (parent):** owns their kid's account. This is the permissions-grid rows. A player/parent profile canNOT view other kids' highlights unless those highlights are public.

**Tier 2 — Viewer profile (grandparent / family / anyone who wants to follow a kid):** attached to a specific kid, granted access. A viewer sees:
1. Anything **public on the child's own wall** (the kid's own public content).
2. The **PUBLIC team wall** (world-facing team content) — NOT the private members-only team wall.
3. The **kid's games** (the most important thing to them; sits behind the paid/membership tier — visibility rule and payment rule are separate layers).

A viewer NEVER sees: the private (members-only) team wall, or other kids' non-public content. So the viewer's window is "their kid + whatever is already public" — no private access to other families' children. Child-safety line held.

**Parent controls viewer invites (the parent's own radial dials):**
- The **parent** — not the coach — controls who can follow their own kid. The parent has their OWN set of permission dials (a mini version of the coach's grid) to invite and manage grandparent/viewer access to their kid.
- Control lives where ownership lives: the parent owns the kid's account, so the parent decides who follows that kid. The coach never has to manage grandparents.

**Control hierarchy summary:**
- **Coach/admin** → manages team roster + team-level permissions (the grid in Part A).
- **Parent (account-holder)** → manages who follows THEIR kid (grandparent/viewer invites, via their own dials).
- **Grandparent/viewer** → sees their kid's public content + the public team wall + the kid's games (paid). Never the private team wall, never other kids' private content.

**Open item (revisit):** whether a coach can OPTIONALLY open the full private team wall to viewers as a coach-controlled, off-by-default toggle. Adam's current direction leans toward viewers NOT getting the private team wall at all (only public team wall) — so this opt-in may be unnecessary. Keep narrow unless a coach explicitly wants it.

### D2. Career vault (footage survives a team ending)
- When a game is posted/created for a team, it auto-attaches to the players on the roster **at that moment** (frozen snapshot via `game_lineups`).
- Access flows through the **player link** (parent_player_links), NOT team membership — so a parent/grandparent keeps access to their kid's history even after the team folds or the kid leaves.
- **Phase 0 already done (July 8):** `game_lineups.player_id` → SET NULL (verified in Supabase), so history can't be cascade-deleted.

So permissions + membership + onboarding + the viewer tiers + the vault are ONE interconnected system, not five projects.

**Build implication:** the parent needs their OWN permission/invite surface (a mini grid) to add and control grandparent/viewer follows for their kid — mirroring the coach's grid but scoped to one kid and controlled by the parent. Design the permission system generally enough that both the coach grid (team-scoped) and the parent grid (kid-scoped) are the same underlying mechanism at different scopes.

---

## Next-session plan

1. **Read-only investigation FIRST** (per debugging protocol): have CC read the actual code + DB and report what ALREADY EXISTS — roles, team_memberships, players, parent_player_links, the planned video_tagging_rights table, any existing permission/role fields, any invite/request mechanism. Every finding cites real files; assumptions marked "NOT VERIFIED." Establish the true starting point before designing on top of it.
2. **Reconcile this spec with reality** — what's already there vs. net-new.
3. **Design the permissions data model** — the grid = a `(user, team, permission, allowed)` store, plus team-wide defaults, plus a roles concept for coaches.
4. **Build in small, device-verifiable steps, read-code-first, one reviewable diff at a time.** Likely order: roles/membership data model → the permissions grid UI → onboarding (invite link + request/approve) → wire each app action (upload, post, tag, send, create-game, delete, manage-roster) to check the permission system → then the upload "+" flow on top.
5. Keep `__DEV__`-gated debug panels until the model is second nature.

## Parked / not in this project
- Export relocation (Adam will specify where he wants Export later).
- The "tester" orphan — expected to resolve once ownership/attachment is clear; revisit if it persists.
- "at" vs "vs" home/away — field exists, default vs, refine later.
- Practice as a first-class type — workaround (call it a game) OK for now; real type field later.
