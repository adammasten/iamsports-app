# IamSports — Upload, Donate-to-Team & Permissions Design Spec

**Date captured:** July 8, 2026
**Status:** DESIGN / NOT BUILT. This is a whiteboard capture to start the next session from — decisions are directional, not final code instructions. Nothing here is built yet.

**Why this exists:** The home feed is done and committed. The next major project is the app's content-creation spine: how footage gets uploaded, how parents hand footage to coaches, who can tag it, and the team-membership/permissions foundation all of it sits on. This session designed a large chunk of that model by talking through the real workflow. This doc captures it so the thinking isn't lost.

---

## Core principle established this session

**Parents film; coaches break down.** The realistic workflow is that MOST video is shot by parents, and coaches do the tagging/editing/posting. The app wins if it nails that hand-off. Everything below serves that reality.

---

## 1. Upload ≠ Post (locked)

- **Uploading** = getting footage into the **Film Room** (the workbench / "My Work"). That's all it does.
- **The Film Room is where ALL work happens:** editing, tagging, building reels, and posting to walls.
- **Posting to a wall is a separate, deliberate act** done later, from the Film Room. Uploading something does NOT make it appear on any wall.
- Consequence: a parent's raw upload never auto-appears on a team wall. It sits in the Film Room until someone deliberately posts it.

## 2. Upload-first, attach-later (locked)

- A video can come in with **just a label** and nothing else (this minimal flow already exists on the current Upload screen: "Video selected ✓", a LABEL field, an Upload button).
- Attachment to a team / game / kid is **optional and layered on later** — not required at upload time.
- Loose/unattached footage lives in the Film Room ("My Work") as the uploader's own raw material. This is intended behavior, not a bug. (This is also the likely resolution of the "tester / not a game yet" orphan — once the model is clear, loose footage is a feature, not an error.)

## 3. The upload flow itself (what the "+" create flow should offer)

Same general shape as the current "New Game" flow, reachable from the "+" button, offering:
- **Label** (every upload — exists today).
- **Quick loose upload** — label + upload, auto-stamp date/time, no other info. (Exists; keep it.)
- **Create a GAME** — holds multiple videos (e.g. quarters), with fields:
  - Opponent, with **"vs" / "at"** prefix. **Default to "vs"**; "at" is optional/future (for programs with a home court). Build the field, don't over-invest now.
  - Game date.
  - **Tournament** (see §7 — tournaments are their own editable/mergeable entity, not free text).
- **Multiple videos per game** (quarters, halves) — the game concept already supports several videos.

### Practice / event types (design note, workaround OK for now)
- Long-term: footage containers should have a **type field** (game / practice / tournament / skills / scrimmage). "Game" is just the most common type; game-only fields (opponent, vs/at) show conditionally when type = game.
- **For now:** the "call a practice a game" workaround is acceptable to ship. But flag it — build toward a real type field so practice isn't fighting game-specific logic later.

## 4. The Donate / "Send to team" model (core new mechanism)

The mechanism for parent→coach hand-off:

- **Any approved team member can "Send to team."** Being an approved member of the team IS the permission to send (the coach already approved them onto the team; that's the gate). No separate per-parent grant needed for v1.
- **Sent footage lands in the COACH's Film Room**, in a **dedicated separate section/filter** (e.g. "Sent to team" / "Donations") — kept separate from the coach's own footage so it's sortable/triageable. (Same principle as the "Unsorted" bucket idea.)
- **The coach can DELETE** anything sent to them. Donated footage is a *suggestion*, not a mandate — this keeps the coach's workspace from filling with junk and keeps them in control.
- **The sender keeps their own copy** in their My Work. Donating shares it; it doesn't take it away. Footage can live in both places.
- **No accept/approval step for v1** — sent footage just appears in the coach's "Sent to team" section and the coach deletes what they don't want. (Lower friction; appropriate for high-trust youth teams. Add an approval gate later only if abused.)
- Only **teammates** (approved members) can send to a team.

**Open (fine to leave open):** whether sent footage goes to a shared team pool the coach reads, vs. specifically the coach's inbox. Leaning: a section in the coach's Film Room. Also open: whether the coach gets a notification ("3 new videos sent to Centex2026") — recommended so donations don't pile up invisibly.

## 5. Tagging rights — "who can tag?" (ties to existing locked spec)

**Existing locked decision (from IamSports_Access_Control_Spec.md):** Tagging is a GRANTED RIGHT per video. The uploader picks who can tag; default = uploader only. Watching ≠ tagging. There's a planned `video_tagging_rights` table.

**Resolution of "coach designates taggers" vs "uploader controls tagging":** ownership determines who holds tagging keys.
- Parent uploads to their **own kid** → parent controls tagging (it's their footage).
- Footage **sent/donated to the team** → tagging control transfers to the **coach**. The act of donating hands over the workbench rights. The coach then designates who can tag team footage (self, assistant coach, or a specific parent).
- So "send to team" = also handing tagging control to the coach.

This lets the coach "designate who tags," which Adam wants, without contradicting the uploader-default rule — because donating transfers ownership of the workbench rights.

## 6. Sharing / visibility of sent footage

- Coach can **share with multiple people / share with everyone** from the Film Room (this is the post-to-wall / share step, still deliberate and coach-controlled).
- Who can then tag it flows from §5 (ownership → coach for team footage).

## 7. Tournaments as an entity (design note)

- Tournaments should NOT be free-text typed fresh each time (that produces "Summer Slam" / "summer slam" / "Summer Slam 2026" as three different things).
- Tournaments should be a **real object**: pick from a list, create if new, and **edit / merge** to clean up duplicates/misspellings after the fact.
- Small but real: tournaments are their own entities, not just a string field on a game.

## 8. New-user onboarding (identified as a needed piece)

For the whole model to work, new users need a flow to:
- Log in → **find their team** → **request to join / get attached** → get attached to the team's games.
- This is effectively the front-end of the permissions/membership system.
- Coach is the gatekeeper for join requests (consistent with earlier decisions; the request function was previously deferred — this is where it gets built).

---

## THE BIG SEQUENCING DECISION (locked this session)

**Permissions / membership must be built BEFORE upload.**

Rationale: nearly every upload question is actually a permissions question in disguise (which kid can I attach to? can a parent donate to a team? who can tag? who can post to a wall? how does a new user join?). Building upload on top of a non-existent permissions system means hardcoding assumptions that get ripped out later. Build the foundation first; then upload just asks the permission system "can this person do this?"

### Roles to define (the permissions spine)
- **Admin** — top of a team/org; can grant coach/parent rights.
- **Coach** — edits, tags, posts to walls, controls tagging rights on team footage, deletes donated footage, gatekeeps join requests.
- **Parent (account-holder)** — ownership of their kid's account; uploads, controls their own footage's tagging, can "send to team," keeps own copies. (Tier 1 of the viewer model.)
- **Player** — the subject; visibility rules per earlier locked specs.
- **Viewer (grandparent / family)** — granted, narrow access: sees ONLY their linked kid's own games + reels, nothing else from the team. Attached to the kid, not the team. (Tier 2 of the viewer model.)

### This foundation ALSO unlocks two already-designed systems
Permissions/membership is the shared foundation for:
1. **The two-tier viewer model** (account-holder parent vs. granted grandparent/family viewer).
2. **The career-vault** (games auto-attach to the players on the roster AT upload/post time via game_lineups snapshot, so footage survives a team folding — parent/grandparent keep access because access flows through the PLAYER link, not team membership). Phase 0 cascade-protection fix for this is ALREADY DONE (game_lineups.player_id → SET NULL, verified in Supabase July 8).

So this isn't three separate projects — it's ONE foundation (membership + permissions) that unlocks upload, the viewer tiers, AND the vault.

---

## Recommended next-session plan

1. **Read-only investigation first** (per the standing debugging protocol): have CC map what roles / memberships / permissions / tagging-rights ALREADY EXIST in the code and DB today (team_memberships, players, parent_player_links, the planned video_tagging_rights table, any role field). Establish the real starting point before designing on top of it. Every finding cites real files; assumptions marked "NOT VERIFIED."
2. **Then design the permissions model** deliberately (roles + what each can do), using this spec as the input.
3. **Then build membership/onboarding** (join a team, roles).
4. **Then build the donate/send-to-team + tagging-rights flow.**
5. **Then the upload "+" flow** on top of the finished permissions system.

Each step: small, read-code-first, verify on device, one reviewable diff at a time. Keep the __DEV__-gated debug panels until the model is second nature.

---

## Parked / not in this project
- Export relocation (Adam will specify where he wants Export later).
- The "tester" orphan — expected to resolve once the ownership/attachment model is clear; revisit if it persists.
- "at" vs "vs" home/away — field exists, default vs, refine later.
