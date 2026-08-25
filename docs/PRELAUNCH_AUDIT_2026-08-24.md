# IamSports pre-launch audit — 2026-08-24

Read-only sweep across code (3 parallel review agents), the live web app (Playwright
on iamsports-app.vercel.app), and the database (Supabase advisors + RLS). Goal:
find what's broken or needs attention **before inviting people to join**.

**Verdict:** No crashes, white-screens, or infinite redirects. Gates are structurally
sound. No hardcoded secrets. Landing, login, and the Privacy Policy are live and
launch-quality. The damage is concentrated in ONE systemic bug — `Alert.alert` is a
no-op on the web app — which silently breaks many web flows, **including the invite
flows themselves** — plus one cross-team data leak and a few launch-hygiene items.

The root fix for most of the list already exists in the repo: `lib/confirm.ts`
(`confirm()`), the `webAlert()` helper (roster.tsx), and the `Platform.OS==='web'`
branch pattern (messages.tsx / text-alerts.tsx). Several screens just never adopted them.

---

## 🔴 BLOCKERS — fix before sending invites

1. **The web invite flows silently dead-end.** join-team / join-coach / claim-kid are
   the ONLY new-user entry flows and are all web-reachable. The DB write succeeds, but
   the success confirmation + navigation is an `Alert.alert` button `onPress` that never
   fires on web, and wrong-code errors are invisible too. A parent/assistant coach you
   invite enters a code, it works, and the screen appears to do nothing → they retry or
   abandon. Files: `join-team.tsx:34,40,48`, `join-coach.tsx:23,26`, `claim-kid.tsx:33,40`.

2. **Stats views leak other teams' player data (child data).** All 5 stats views
   (`game_box_score`, `season_player_stats`, `stat_events`, `season_team_stats`,
   `resolved_game_stats`) are `SECURITY DEFINER` (invoker off) AND selectable by any
   authenticated user, and expose player NAMES + stats across all teams with no
   membership filter → a signed-in user can pull another team's box score / a kid's
   season stats from the REST API. Fix: `security_invoker = on` on the views, confirm
   `game_stat_lines` RLS, then re-test the stats feature.

3. **Web Film Room can't delete games, videos, or clips.** Destructive actions bypass
   the imported `confirm()` and use raw `Alert.alert` button arrays → tapping Delete
   does nothing on web, zero feedback. `my-work.tsx:459,481`; `clips.tsx:66`;
   `game.tsx:158,248,252` (the whole per-video menu — Tag/Clips/Rename/Delete — is dead
   on web).

4. **A dev card ships to every user.** `account.tsx:14 SPIKE_SHOW_BG_TEST = true` puts a
   "🧪 Dev: Background upload test" card on the Account screen in release/TestFlight.
   Set `false` / remove before submission. (`bg-upload-test.tsx` is the harness.)

5. **New users' first screen is a "coming soon" placeholder.** A user with no team lands
   on `onboarding.tsx` which reads "Full onboarding is coming soon — for now…", is
   light-themed (jarring vs the dark app), and the kid wall has non-functional filter
   tabs. This is the first impression of every invite — needs a product decision.

## 🟠 HIGH

6. **Upload errors are invisible on web.** Every failure branch in upload.tsx surfaces via
   `Alert.alert` then returns to the form silently — on the #1 stability path.
   `upload.tsx:143,158,181,196,200,210`.
7. **Coaches can't change permissions on web** — `team-permissions.tsx:113` confirm is a
   dead `Alert.alert`; the toggle is the button's onPress → silent no-op.
8. **Export shows a misleading empty state.** `export.tsx` fetchGames/fetchTags/loadClips
   discard query errors (`data || []`), so an RLS/transient failure looks like "you have
   no film / nothing to export." Validation alerts are also dead on web. `export.tsx:319,
   412,456-475` + the `Alert.alert` guards.
9. **Roster merge shows `undefined` counts on an irreversible merge.** `roster.tsx:136`
   passes a 4-field object where `DupePair` needs 8, so guardian/content counts render
   blank in the merge-confirm → a coach can merge the wrong profile.
10. **AuthGate bounces every web refresh/deep-link to Home.** `_layout.tsx:65-86` only
    carves out `/playbook`; a browser refresh or shared/bookmarked URL (`/my-work`,
    `/messages`, `/game-player`, …) is thrown back to `/select-team`. Matters for a
    link-distributed app. Fix: only force-redirect from `/`, `/login`, `/landing`,
    `/onboarding`.
11. **Enable leaked-password protection** in Supabase Auth (one toggle).

## 🟡 MEDIUM

12. More web-dead confirms/actions (same root cause, all web-reachable): `game-detail.tsx:99`
    (remove from game), `kid.tsx:154,202,217,465` (leave team / guardian code / remove
    guardian / take off wall), `edit-event.tsx:55,211,224` + `import-schedule.tsx:21`,
    `account.tsx:45,49,50` (Save name — even success is silent), `edit-reel.tsx` +
    `edit-game.tsx` save/validation errors, remaining bare `Alert.alert` in `roster.tsx`,
    and `box-score.tsx` / `StatEditorSheet.tsx`.
13. **Video-status null/cast bug** in all 3 playback surfaces (`game-player.tsx:77,135,136`,
    `shared-viewer.tsx:98,99`, `tagging-overlay.web.tsx:124,142,149`) — on the web
    faststart/retry path. Drop `as string`, null-guard `status?.status`.
14. **Two notification systems may be live at once** — older `migration_notifications_*`
    vs newer `migration_notif_backbone_*`. Verify against live DB; retire dead triggers.
15. **Terms/name gate error path invisible on web** (`_layout.tsx:141,179`) — if the RPC
    errors the sheet stays up with no explanation (looks stuck). `webAlert()` those.
16. **Mobile upload `Uint8Array→BodyInit` cast** (`video-upload.ts:115`) — latent on the
    launch-critical chunked-PATCH loop; works today, could break on an RN/lib bump.

## 🟢 LOW / cleanup

17. Orphan/dead routes: `team.tsx` (dead two-file duplicate of `(tabs)/index.tsx`),
    `clips-library.tsx` (dead dup of `clips.tsx`), `playbook-dev.tsx` (ungated dev screen,
    URL-reachable on web), `modal.tsx` (Expo template leftover). Dead components:
    `hello-wave.tsx`, `parallax-scroll-view.tsx`, `external-link.tsx`.
18. `tsconfig.json` type-checks `supabase/functions` (Deno) → 60 false TS errors masking
    the ~10 real app errors. Exclude the Deno dir so `tsc` is a usable pre-launch gate.
19. 53 `console.*` on media/upload/export paths — gate behind `__DEV__`. JSX unescaped
    quotes (6), unused vars/eslint-disables — `--fix`/cleanup.
20. Minor DB hardening: 3 functions want a fixed `search_path` (`gen_join_code`,
    `touch_event`, `game_stat_lines_touch_updated_at`); `pg_trgm` + `pg_net` in the public
    schema. Update CLAUDE.md — its `app/tagging.tsx` orphan note is stale (file is gone).

## 🟢 Confirmed good (don't re-investigate)
- No public table has RLS disabled; storage lockdown intact.
- Landing + login render clean; login is inline/state-driven (web-safe). Privacy Policy
  live and launch-quality at `/privacy` (adults-only, minor-consent, AI-training, delete).
- Gates structurally sound; tab screens handle `activeTeam == null`; content viewers guard
  missing params; `goBackOrHome()` handles deep-link/no-history. Tagger flow fully reachable.
- No hardcoded secrets (anon key in supabase.js is public-by-design).

## Not launch blockers — pre-SCALE performance debt
- 73 `auth.uid()` re-evaluated per row in RLS (wrap as `(select auth.uid())`).
- 45 unindexed foreign keys; 35 unused indexes; 26 multiple-permissive-policies. Fine at
  launch volume; revisit before thousands of users.

---

## Highest-leverage plan
1. **One web-`Alert` sweep** using the existing `confirm()` / `webAlert()` / inline-state
   helpers fixes #1, #3, #6, #7, #8, #12, #15 — most of the blockers/highs at once.
2. **Stats-view lockdown** (#2) + re-test stats.
3. **Kill the dev card** (#4) and decide the **onboarding first-run** (#5).
4. **Roster merge type fix** (#9) + **AuthGate deep-link allow-list** (#10) +
   **leaked-password toggle** (#11).
5. Cleanup (#17–20) when convenient.
