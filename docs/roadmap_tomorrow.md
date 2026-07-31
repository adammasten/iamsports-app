# Roadmap — next work session

Updated 2026-07-30. Ordered roughly quick-wins → risky/irreversible last. "Basketball
setup" (the core team/roster/film/tag/share/stats loop) is functionally complete;
this is the finish-out + the newly-scoped tagger track.

## 0. Testing (Adam — do first)
Device pass on the roster/guardian/join/delete/merge flow. Needs multiple accounts.
Also: verify the duplicate-kid **merge** on real data once a team has 3+ players
(tracked in memory — it's built + applied but never run live).

## 1. Quick wins (low risk, warm-ups)
- **Per-video label rename.** A video inside a game can't be renamed. Small CRUD
  hole (invariant 2). NOTE: this is just the label — quarter is a persistent tag,
  not the video name, so scope is only "rename the label," nothing about quarters.
- **Orphan / dead-code cleanup.**
  - Delete `app/tagging.tsx` (orphan; live tagger is `tagging-overlay.tsx`).
  - Uninstall `draggable-flatlist` (unused since 78f7423).
  - Fix stale doc line `docs/IamSports_Current_State_Master.md:286` (players_read
    linked-parent branch is done now).

## 2. Tag review & fix surface  ⭐ NEW — recommended early
Standalone, high value, **independent of the tagger role.** Today there is *zero*
tag editing: no clip re-timing, no per-tag remove/re-attribute, and the clip list's
"Tap to preview" is dead. Coaches need this for their own tags regardless of the
tagger feature. Upgrade `app/clips.tsx` into a review-and-fix surface:
- wire the dead `onPress` → open the clip in `tagging-overlay` edit mode at `startAt`,
- re-time a clip (first-ever `clips.update()`),
- remove a tag / re-attribute an assist / move a tag between bundles
  (delete+reinsert; preserve the `clipMatchesGroup` bundle contract),
- RLS fix: `clip_tags_delete` is coach-only today — let the clip's creator remove a
  tag off their own clip.
Full detail: `docs/tagger_role_and_tag_editing_design.md` §6.

## 3. Background upload — the launch blocker (big, risky → later in the day)
Phase 1 (status lifecycle + reconcile + 409 fix) is done. The survive-app-switch
piece is NOT. Backgrounding suspends the JS runtime and stalls the transfer.
Do a fresh read-only investigation → report → build (Phase 2 progress-persistence,
Phase 3 native background transfer). This is the last true launch prerequisite on
the media path.

## 4. Tagger track (separate, needs 3 decisions from Adam first)
The "designated tagger" — grant someone access to tag a coach's games, cross-team.
Primitive already exists in the DB (`video_tagging_rights`, fully built + unwired).
Design + build order in `docs/tagger_role_and_tag_editing_design.md`. Sequence:
1. `can_tag_video()` helper + `clip_comments` table (additive).
2. **(= item 2 above — the review/fix surface, shared foundation.)**
3. Wire `video_tagging_rights` into the RLS branches (playback, tags read,
   clips/clip_tags write).
4. Coach grant screen + revoke.
5. Tagger workspace + `names_hidden` handling.
6. Comments UI.
7. Subscription/entitlement gate (post-launch, RevenueCat).

**Decisions blocking the tagger track (not the review surface):**
- Grant per game or per video? (recommend game, auto-extend to new quarters)
- Does $4.99 gate tagging your own team, or only others' games? (recommend own
  team free)
- Invite tagger by email or redeemable code? (recommend code)

## Explicitly NOT this session (parked)
- Payment / RevenueCat wiring (researched, deferred post-launch).
- Launch legal/store: host privacy + terms URL, App Store listing assets, NCMEC ESP
  registration, lawyer review of minor-footage retention.
- Stats UI/UX (lives inside the team page — Adam has a construction in mind).
- Home watch-only cleanup / screen separation.
- Share-wall notes (distinct from the clip QA comments in the tagger track).
