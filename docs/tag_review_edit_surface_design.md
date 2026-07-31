# Tag review & fix surface — design

Status: **design, pre-build.** Pulled forward from
`tagger_role_and_tag_editing_design.md` §6 because it's standalone, high value,
and coaches need it for their OWN tags regardless of the tagger role. Grounded on
live code (`app/clips.tsx`, `app/tagging-overlay.tsx`) + web UX research
2026-07-31.

## The problem
Today there is **no way to fix a tag.** `app/clips.tsx` lists a video's clips
(start→end, tag names, ★/POE, read-only note) but its "Tap to preview" is dead
(no `onPress`), and the only edit is whole-clip delete via long-press. You cannot:
re-time a clip, remove a wrong tag, re-attribute an assist, edit the note, or jump
to a clip. And soon **many people will tag the same video**, so review + fix +
attribution is core, not polish.

## Design principles (from research, adapted — NOT copied from Hudl)
- **List ⇄ video, always both visible.** Tap a clip row → the player seeks to it.
  No separate "editor window." (Video-review tools converge on video + notes on
  one screen.)
- **Big touch targets.** Trim/nudge controls need hit areas ~2× their visual size
  on mobile.
- **Edit in place.** Add / remove / re-attribute a tag from the clip itself; a
  short-press acts, a long-press destroys — matches the app's existing convention.
- **Our differentiator is the bundle model** (player+action attribution), which
  generic annotation tools don't have. Lean into it; don't flatten to a plain
  tag list.

## Architecture — reuse `tagging-overlay`, don't build a second editor
`tagging-overlay.tsx` already has the player, scrubber, the full tag vocabulary
panel, and the bundle UI. Building a separate edit screen would duplicate all of
it and risk drift (we just deleted one orphan twin — don't make another).

**Two surfaces:**

### A. `clips.tsx` = the review list (entry: Film Room → View Clips)
Upgrade it into a real review surface:
- **Wire the dead `onPress`** → seek-and-play this clip (open `tagging-overlay`
  in `watch` mode at `startAt = clip.start_time`, or an inline mini-player). Tap
  = watch; a clear **Edit** affordance on the row = open in edit mode.
- **Each card shows:** time range, tag chips (grouped by bundle), ★/POE, note,
  and **who created it** (`created_by_user_id` → initials) — attribution matters
  once many people tag.
- **Sort + filter** (yes, worth it — a game can be 50+ clips):
  - Sort: chronological (default) · starred first · by player.
  - Filter chips: by category (offense/defense/plays/players), by specific
    player, and **by tagger** ("only my clips" / "Coach X's clips").
  - Optional text search on tag name — v2 if the chips prove enough.

### B. `tagging-overlay` in **edit mode** = the fix surface
Open it seeded with an existing clip's `start_time`/`end_time` + current tags:
- **Re-time.** v1: scrub the playhead and tap **Set In** / **Set Out**, plus fine
  **±0.5s nudge** buttons (precise, mobile-friendly, far less build than a
  drag-handle timeline). v2 polish: draggable trim handles with big hit areas +
  grooves + ghost-outline at the footage limits (the img.ly pattern).
  → writes `clips.start_time/end_time` (first-ever `clips.update()`).
- **Tags.** Toggle in the existing panel. On save, **diff** against the clip's
  current `clip_tags` and INSERT added / DELETE removed (clip_tags has no UPDATE
  and no surrogate key, so edit = delete+insert). Re-attribute = remove wrong
  player tag + add right one in the **same `bundle_number`** so the bundle stays
  intact. Move between bundles = delete+reinsert with a new `bundle_number`.
  **Preserve the `clipMatchesGroup` contract** (`export.tsx`) — off-by-one on
  bundle_number silently breaks export attribution.
- **Note.** Make `clips.note` editable here (it exists, is shown read-only, and is
  always written `''` today).

## The one RLS fix required
`clip_tags_delete` is **coach-only** today — a clip's own creator can't remove a
tag off their own clip. Add the creator branch (and later the tagging-grant
branch) so a tagger can fix their own work:
```
clip_tags_delete USING: is_super_admin()
  OR EXISTS (clips c WHERE c.id = clip_id AND (c.created_by_user_id = auth.uid()
             OR is_team_coach(c.team_id)))
```
`clips_update`/`clips_delete` already allow creator-or-coach, so re-timing needs
no policy change. `clip_tags_insert` already allows creator-or-member.

## Multi-tagger reality (many people tag one video)
- **Attribution everywhere** — every clip and its edit history should read as
  "who." v1: show creator initials on each clip card.
- **No hard write conflict** — clips are independent rows; two taggers tagging the
  same play just make two clips. Surface that as **possible-duplicate clips**
  (same-ish time window) a coach can merge/delete — later, mirrors the
  duplicate-*player* nudge we already built.
- **Filter by tagger** (above) is the main coping tool at scale.
- **QA thread** (coach ↔ tagger "check #110 at 4:10") is the `clip_comments`
  table from the tagger design — build with the tagger track, not now.

## Build plan (this surface, standalone)
1. `clips.tsx`: wire tap-to-seek + an **Edit** entry point + attribution on cards.
2. `tagging-overlay` edit mode: seed from an existing clip; Set-In/Set-Out + nudge
   re-time; tag diff-save; editable note. (`clips.update()` + clip_tags diff.)
3. RLS: add creator branch to `clip_tags_delete` (+ repo migration).
4. Sort/filter (chrono/starred/player + category/player/tagger chips).
5. (later) duplicate-clip nudge; drag-handle trim polish; `clip_comments` QA.

## Open decision
- **Confirm: reuse `tagging-overlay` in edit mode** (recommended — least code,
  no drift) vs. a dedicated clip-edit screen.
- Re-time v1 = **Set-In/Set-Out + nudge** (recommended) vs. jump straight to
  drag-handle trim.

## Cross-refs
`tagger_role_and_tag_editing_design.md` (the surface is its shared foundation);
`project_share_tags_travel_with_video` (do shared videos carry tags?).

---

## Deep-research update (2026-07-31, 105-agent run, 23 sources, 23/25 claims confirmed)

This confirmed and sharpened the design. Key evidence-backed conclusions:

### The core answer to "I can't see what's tagged while watching"
Best-in-class tools (Video Tagger, Nacsport, Frame.io) all solve it the SAME way,
and it's a triad — build all three or none work:
1. **Tag markers on the scrub bar** — every clip is a colored tick on the
   timeline (color = category). The timeline becomes "a navigation map of the
   whole game."
2. **A synced event list that auto-highlights the current tag** as the playhead
   moves — so at any instant you see the active clip's tags.
3. **Tap a marker / list row → jump** the playhead to that moment.
This is THE missing primitive. On our existing landscape tagging-overlay it's a
marker strip on the scrubber + a thin "now playing: [tags]" readout. That alone
makes errors *visible*, which is 80% of the value — fixing is a small step after.

### Re-timing on a phone — the validated control set
- **Drag the clip's edge handles** (desktop pattern from Nacsport) — but needs
  **44×44pt hit targets** (iOS HIG) even if the handle looks small.
- **Better/faster: "Set start here" / "Set end here" buttons at the playhead**
  (Nacsport's I/O keys). No precise dragging — scrub to the moment, tap. This is
  the primary control; drag-handles are secondary polish.
- **Frame accuracy = variable-speed "loupe" scrubbing**: finger on the scrubber,
  slide vertically away to slow the scrub rate. Proven default (Apple Music /
  OBSlider): 100/50/25/10% speed at 0/50/100/150pt of vertical offset. This
  REPLACES the desktop jog-wheel and is the single most important phone-precision
  interaction. (Note: OBSlider is iOS/ObjC — we reimplement the gesture math in
  RN, not a drop-in.)

### Add / relabel / re-attribute
Confirmed pattern (Nacsport): **select the clip, then tap a descriptor to add it**
— i.e. REUSE our existing category tag panel on an already-created clip. Validates
the "tagging-overlay in edit mode" architecture directly. Delete-tag + re-attribute
follow the diff-save model already in this doc.

### Edit must be a distinct MODE (NN/g, strongly confirmed)
Mixing watch + edit causes "mode errors" — accidental edits during casual
watching, exactly the risk here. Two safe options:
- **Spring-loaded/held gesture (quasimode)** — edit only while actively held;
  "little risk the user forgets the mode." Cleanest.
- **Persistent toggle** — allowed ONLY with **≥2 simultaneous visual indicators**
  of edit state (e.g. control highlight + changed affordance/border).
Decision: a clear **Review ⇄ Edit toggle** with two indicators (simplest to build
and reason about); revisit a held-gesture later. Watching never mutates data.

### Phone can be first-class, not a fallback
Nacsport's Tag&View is a first-class iPad/iPhone tagging app (PRE/POST buffers +
manual start/stop). Precedent that our phone editor can be the real thing.

### Collaboration — DEFER, but leave hooks
Multi-analyst co-tagging + sync/conflict reconciliation are advanced-tier even in
Hudl Sportscode / Nacsport. For launch: **one designated editor at a time +
"tagged by" attribution + timestamp-pinned notes** (Frame.io's comment-pin
pattern) is the pragmatic subset. Conflict model v1 = **silent overwrite with
"last edited by" attribution**; add a needs-review flag before true multi-tagger.

### Two refuted claims (don't rely on these)
- Sportscode does NOT require double-click-to-play before editing an instance.
- Video Tagger does NOT reject manual scrubbing/editing as a philosophy.

### Placement correction (Adam, after seeing slice #1)
The marker strip + "now tagged" readout belong on the **TAGGING screen, not
watch**. Watching a game should stay clean ("if I'm watching, I just want to
watch"); seeing-what's-tagged-and-fixing-it is a *tagging/review* activity. So:
- **Watch mode = clean** (no markers/readout). (A future opt-in reveal toggle is
  fine but not now.)
- **Tagging mode = markers overlaid ON the scrub bar** (zero added height, so the
  tuned tag-column layout is untouched — a tall marker lane collided with it) +
  **"now tagged" readout in the top bar** (collision-free) + **◄Tag / Tag► buttons**
  in the controls row to step through every tag and check it (Adam's "forward to
  next tag" — a review counterpart to the ±1/±5s skips). Markers are visual-only
  (pan owns the bar); navigation is the buttons.
- Editing the tags you step to (change/remove/re-attribute/re-time) is the NEXT
  slice.

### Revised build order (evidence-ranked)
1. **Marker strip + now-tagged readout + ◄Tag/Tag► step-through** on the TAGGING
   screen (watch stays clean). (The core fix — highest value, makes errors
   visible in the place you'd fix them.) — BUILT.
2. **Review⇄Edit mode toggle** (2 indicators) so watching is safe.
3. **Set-start/Set-end-here buttons** + `clips.update()` re-timing.
4. **Reuse tag panel** to add/remove/re-attribute on the selected clip (diff-save)
   + `clip_tags_delete` creator-branch RLS fix + editable note.
5. **Loupe (variable-speed) scrubbing** for frame accuracy.
6. Defer: drag-handle trim polish, duplicate-clip nudge, attribution filters,
   `clip_comments` QA thread, multi-tagger sync/versioning.

### Resolved: overlay vs separate screen
**Overlay/mode on the existing `tagging-overlay`, NOT a new screen.** It already
has the player, scrubber, and tag panel; adding a marker strip + a Review/Edit
toggle reuses all of it and avoids a second orphan-twin. (Open Q4 from research —
resolved in favor of a mode on the current overlay.)

Sources: Video Tagger (App Store), Nacsport Elite manual, Frame.io review docs,
NN/g Modes + Spring-loaded Modes, OBSlider, Apple HIG / Material / WCAG target
sizes, Hudl Sportscode release notes.
