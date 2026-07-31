# Designated Tagger, cross-team access, and tag editing — design

Status: **design only, nothing built.** Grounded against live Supabase + repo on
2026-07-30. This is the "someone tags games for a coach" feature plus the tag
review/fix workflow it forces us to finally build.

---

## TL;DR — the one insight

The primitive already exists and is **100% unwired**: `video_tagging_rights`, a
per-video grant table sitting live in the DB with coach-gated RLS and **zero app
code**. A "designated tagger" is **not a new role** — it's a grant on top of this
table plus a workspace to use it. Because it's a grant and not a role, "anyone
can be a tagger, and also be a coach/parent" composes for free.

Two real builds hang off it:
1. **Wire the grant** (authz + a tagger workspace + a coach grant screen).
2. **Build tag editing / untagging / review** — which the app has essentially
   none of today, and which a tagger-for-hire makes non-optional.

---

## Ground truth (verified this session)

**`video_tagging_rights`** (live columns): `id, video_id, granted_to_user_id,
granted_by_user_id, can_tag (default true), names_hidden (default false),
status (grant_status enum, default 'active'), expires_at, created_at`.
- RLS: coach-of-the-video's-team can insert/update/delete; the grantee can read
  their own grants. All correct and already installed.
- **Zero references in `app/` or `lib/`.** Nothing reads or writes it, and — the
  important part — **no clips/clip_tags/tags policy consults it.** It is a
  reserved scaffold.

**Roles:** `membership_role` = admin, head_coach, coach, parent, player,
follower. **No "tagger" role, and we don't want one** — the grant model is right.

**`tag_videos` permission** exists in the 8-permission grid (`has_team_permission`),
but that engine is **enforced in no RLS policy** and `tag_videos` is **checked
nowhere in the app.** It's a client-side UX gate that fails open. Not our
enforcement path — RLS + the grant table is.

**How tagging is authorized today (the wall a cross-team tagger hits):**
- `clips_insert` WITH CHECK: `is_super_admin() OR is_team_member(team_id) OR
  (team_id IS NULL AND created_by = me)`.
- `clip_tags_insert` WITH CHECK: clip creator **or `is_team_member(clip.team_id)`**.
- `tags_read`: `scope='global' OR is_team_member(team_id)`.
- `clips_update`/`clips_delete`: creator **or** team coach.
- `clip_tags_delete`: **team coach only** (NOT the creator — see gap below).
- Video playback (`sign-media` → `authorize_video_playback`): team-membership based.

So a non-member tagger currently **cannot** read the team's tag vocabulary, get a
signed URL to watch the video, create a clip, or attach a tag. Every one of those
is gated on `is_team_member`. Wiring the grant means teaching each of those checks
to also accept "has an active tagging grant on this video."

**Tag editing today — essentially nonexistent:**
- **No clip re-timing anywhere** — `clips.start_time/end_time` are write-once at
  insert. There is no `.update()` on `clips` in the entire codebase.
- **No per-tag edit** — no `clip_tags` update and no per-row delete. You cannot
  remove one wrong tag, move a tag between bundles, or re-attribute an assist.
- **Only affordance:** whole-clip delete via **long-press** in `app/clips.tsx`
  (deletes all `clip_tags` then the clip).
- `app/clips.tsx` is the only clip-review list. Its card says "Tap to preview"
  but has **no `onPress`** — dead. You can't jump from a listed clip to the video
  at its timestamp.
- **No comments.** `clips.note` exists, is shown read-only, and is **always
  written as `''`** — never editable. `content_reports` is abuse moderation, not
  commenting.

**Seek plumbing already exists** (just unwired from the review list):
`shared-viewer.tsx` takes `startTime/endTime`; `tagging-overlay.tsx` takes
`startAt` and has a `watch` mode that hides the tag panel. So "open this clip at
its timestamp for review" is a wiring job, not new plumbing.

---

## The model

### 1. Designation = a grant, not a role
A tagger is a user who holds one or more `video_tagging_rights` rows. No schema
role, no new membership. This is why it composes: a head coach of Team A can be
granted tagging on Team B's game and nothing about their Team A role changes.

### 2. Grant at the **game** level, store at the **video** level
Coaches think in games ("tag my Saturday game"), but a game is several videos
(quarters/halves). The table is per-video. Resolve UX→storage:
- Coach grants a **tagger** access to a **game** → app writes a
  `video_tagging_rights` row for each of that game's videos.
- **Decision needed:** when a coach adds a new video to an already-granted game
  later, do we auto-extend the grant? Recommend **yes** (a DB trigger, or the
  add-video flow copies active grants). Otherwise the tagger silently can't see
  Q4. (Invariant 5: never fail silently.)

### 3. Who can be a tagger + the subscription
Being *granted* access is free and coach-controlled. **Using** the tagging
capability is the paid part — the ~$4.99 "tagger" SKU. Open question: is the
$4.99 required to tag *at all* (including a coach tagging their own team), or only
for a standalone tagger who isn't already covered by a household/team pass?
Recommend: **tagging your own team = included; the $4.99 SKU is the standalone
"I tag other people's games" capability.** Deferred — don't build payment now,
just don't design anything that assumes it's free forever. Entitlement will be a
RevenueCat check gating the *workspace*, not the RLS (RLS enforces the grant;
payment is a capability gate on top).

### 4. Coach grant screen (Roster-adjacent or on the game)
From a game (or the Roster tab), a coach:
- enters the tagger's identity (email/handle → user lookup, or a share-code the
  tagger redeems — mirror the join-code pattern so no email hunting),
- picks scope (this game / this video),
- toggles **Hide player names** (`names_hidden`) — on by default when the tagger
  isn't a member of the team, so they tag "#12 assist" not "Jordan assist,"
- optional expiry,
- and can **revoke** (rotate/expire) — reuse the revocable-code muscle we just
  built.

### 5. The tagger workspace (a separate surface)
A dedicated screen ("Tagging jobs" / "Tag for a coach") that lists the games the
tagger has active grants on **across all teams**, including teams they're not a
member of. Tap a game → the existing `tagging-overlay` opens on its videos, but:
- the tag vocabulary shown is **the granting team's tags** (their kids, plays,
  defense) — this is the whole point,
- names are hidden if `names_hidden`,
- everything they create is a normal clip/clip_tag on that team, owned by the
  team (survives the tagger leaving — consistent with team-owned content).

### 6. Tag review + editing + untagging (the real build)
This is the "someone screwed up the tags, how do I fix them" answer. Upgrade
`app/clips.tsx` from a read-only list into a **review & fix** surface:
- **Wire the dead `onPress`** → open the clip in `tagging-overlay` in an edit mode
  at `startAt = clip.start_time`.
- **Re-time** a clip (nudge/drag start & end). Covered by existing RLS for the
  clip's creator; a coach fixing someone else's clip is covered by the coach
  branch. Just needs UI + the first-ever `clips.update()`.
- **Remove a tag** from a clip (long-press the tag chip). Since `clip_tags` has no
  surrogate key and no UPDATE, "edit" = delete the row + insert the corrected one.
- **Re-attribute** (assist → different player) = remove the wrong player tag,
  add the right one, same bundle_number so the bundle stays intact
  (`clipMatchesGroup` contract in `export.tsx` must be preserved).
- **Move a tag between bundles** = delete + reinsert with a new `bundle_number`.
- **Jump-to-timestamp** from a coach's comment (see §7) straight to the clip.

**RLS gap to fix for this:** `clip_tags_delete` is **coach-only** today — the
clip's own creator can't remove a tag off their own clip. A tagger correcting
their own work needs `clip_tags_delete` to also allow the clip creator **and** an
active grant-holder on the video. Add that branch.

### 7. Comments / review threads
New lightweight table, e.g. `clip_comments`:
`id, clip_id, author_user_id, body, target_tag_id? (nullable — comment on a
specific tag), needs_review (bool), resolved (bool), created_at`.
- Coach leaves "check #110 here" or "is this assist right?" on a clip (or a
  specific tag). Tagger sees it, jumps to the clip, fixes, marks resolved.
- Tagger can flag their own clip `needs_review` ("unsure about this one").
- RLS: readable/writable by team coaches + active grant-holders on the clip's
  video. Keep it small; this is a work-coordination thread, not social comments.
- **This is distinct from share-wall notes** (parked separately) — this is a
  private production/QA thread between coach and tagger, not viewer-facing.

### 8. RLS wiring checklist (what "wire the grant" actually touches)
A SECURITY DEFINER helper `can_tag_video(video_id)` = "I have an active,
unexpired `video_tagging_rights` row with `can_tag` on this video." Then add an
`OR can_tag_video(...)` branch to:
- `videos_read` (or `authorize_video_playback` in `sign-media`) → tagger can
  fetch a signed URL and watch.
- `tags_read` → tagger can read the granting team's tag vocabulary.
- `clips_insert` / `clips_update` / `clips_delete` → tagger can create & fix
  their clips on that team.
- `clip_tags_insert` / `clip_tags_delete` → attach & remove tags.
- `clip_comments` (new) policies.
Everything stays enforced in RLS; the subscription gates the *workspace UI*, not
the data. `names_hidden` is applied in the read layer (return jersey, null the
name) when the caller's access is via a `names_hidden` grant.

### 9. Multi-role composition
Because tagger = grant, a user can simultaneously be: a paying household adult, a
coach on Team A, a granted tagger on Teams B and C. Nothing conflicts. The
workspace just unions "games I coach" + "games I'm granted." No enum gymnastics.

---

## Open decisions for Adam
1. **Grant scope unit:** game-level grant (recommended, auto-extends to new
   videos) vs strict per-video.
2. **Subscription boundary:** is $4.99 required to tag your *own* team, or only to
   tag *others'* games? (Recommend: own team free, standalone tagging = the SKU.)
3. **Tagger identity/handoff:** invite by email lookup vs a redeemable
   tagger-code (recommend code — matches everything else we built).
4. **`names_hidden` default:** on whenever the tagger isn't a team member?
   (Recommend yes.)
5. **Comment surface depth:** clip-level only, or comment-on-a-specific-tag too?
   (Recommend allow `target_tag_id` — it's cheap and it's exactly the "verify the
   assist at 4:10" case.)
6. **Where the workspace lives:** its own top-level entry, or folded into an
   existing screen? (It spans teams, so it probably wants to be its own entry, not
   under a single team.)

## Build order when we do this (risky/irreversible last)
1. `can_tag_video()` helper + `clip_comments` table + repo migration (additive,
   reversible).
2. Tag **review/edit** surface (`clips.tsx` upgrade + first `clips.update()` +
   per-tag remove/re-attribute + `clip_tags_delete` creator/grant branch). This is
   valuable **even without the tagger feature** — coaches need to fix their own
   tags today.
3. Wire `video_tagging_rights` into the RLS branches above.
4. Coach grant screen (+ revoke).
5. Tagger workspace + `names_hidden` read-layer handling.
6. Comments UI.
7. Subscription/entitlement gate (post-launch, RevenueCat).

Note: **step 2 stands alone** — the tag review/fix surface is the highest-value
piece and unblocks coaches regardless of the tagger role. Consider shipping it
first, independent of the rest.
