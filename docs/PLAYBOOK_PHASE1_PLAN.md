# Playbook — Phase 1 build plan

Working doc for the Playbook feature. Spec of record: `PLAYBOOK_V2_CONVERGED.md`.
This tracks what's built vs. what's next. Keep it in sync as slices land.

## The thesis (so we don't drift)

The playbook screen is the front door; the **product is the teach → run → review
loop**: a coach installs a play this week → players open it → Friday's tagged film
links back to *the exact version taught* → the app closes the loop. Plays + clips
in one schema is the thing Hudl structurally can't do.

## Navigation (decided)

- **Coaches → its own top-level section**, NOT inside Coaches' Corner. Coaches'
  Corner is team-scoped + PIN-gated; the Playbook (and the Pro Coach library) is
  *cross-team*, so it lives at the app-home level next to team/kid selection.
- **Players → their team page.** Players only ever see **published installs for
  that team**. Never the library, drafts, or other teams. Maps to the two-layer
  ownership model exactly.

## Status

### ✅ DONE — P0 data model (live, dark)
Migration `migration_playbook_core.sql`, applied as `playbook_core_phase1`
(2026-08-19). Additive, referenced by zero app code. Seven tables, all with RLS:

| Table | Role | Key invariant |
|---|---|---|
| `library_plays` | coach's personal, cross-team library (§5) | RLS: `owner_user_id = auth.uid()` |
| `plays` | team-scoped play instance (§5) | coach CRUD; members read only via a visible install |
| `play_versions` | append-only snapshots (§4) | no UPDATE/DELETE policy → immutable |
| `installs` | what was taught, draft→published (§4) | members read **published** only |
| `install_plays` | pins `(play_id, play_version)` (§4) | composite FK **ON DELETE RESTRICT** → installs immutable |
| `play_clips` | clip linkage, hardened (§6) | SELECT = `is_team_member(team_id)` (film's team) → cross-team leak structural |
| `install_receipts` | binary events (§7) | **no duration column, ever**; parents see their child's |

Verified live: 7/7 RLS on, policy counts correct, RESTRICT + composite FKs present.
Cross-team RLS test written (`test_playbook_crossteam_leak.sql`) — runs once the
pilot has ≥2 teams.

### ▶ NEXT slices (post data-model, in order)
1. **Render worker + cache** (Railway): JSON → `play_renders/{play_id}/{version}/{renderer_version}.{svg,png}`. Viewer reads images; no client vector renderer.
2. **Viewer**: install list → install detail → play view (cached images). Player-facing on the team page; parent-visible receipts.
3. **Internal seeding tools** (concierge): import a pilot team's real playbook as JSON. Not user-facing.
4. Editor / template library / install-authoring UI — **Phase 2**, gated on pilot metrics.

## Open items / gates (need Adam or counsel)

1. **Who is the "player" viewer?** The app is positioned as an *adult* app (kids
   aren't users; Hudl model). But receipts assume someone opens an install as the
   player. Decide: is the install-viewer the **guardian** (logged in on the kid's
   behalf) or a **player-role account**? `install_receipts.user_id` is just the
   authenticated viewer either way, so the table is fine — but the targeting/UI
   model depends on this answer. **Flagged, not blocking the schema.**
2. **Counsel review before receipts UI ships** (§7): COPPA applicability, school-
   team context, consent. The table is built (dark); the *surface* waits on this.
3. **Pilot recruitment**: 5–10 teams, ≥2 football (football taxonomy needs a real
   football coach — basketball is Adam's domain, football is not).
4. **Football taxonomy** review gates any football template/branching work.

## Constraint on record
The spec marks all of this **post-launch** (9 Sep 2026). The data model was applied
pre-launch on Adam's explicit "live now" call — safe because additive + dark. No UI
work should compete with launch stabilization without a fresh go-ahead.
