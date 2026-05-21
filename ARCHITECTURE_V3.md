# IamSports V3 Architecture

## Goal

Move from solo-coach-only to multi-tenant team-based platform with role-based permissions, multi-sport support, full-game sharing, and per-asset visibility controls. Architected now so schema doesn't require painful migration later.

## Core architectural shifts

1. Clips, games, and videos owned by **teams**, not users.
2. **Multi-sport** from day one via a `sports` table.
3. **Role-based permissions** per team (owner, coach, co-coach, player, parent, viewer).
4. **Per-asset visibility** (private, coaches-only, specific-users, team, public-link).
5. **Public share links** with no-login watch page — the "grandma watches" flow.

## Subscription tiers

- **Viewer** — $2.99/mo. Watch shared clips and games. No upload, no tag.
- **Creator** — $12.99/mo. Full coach/parent tier. Upload + tag + export + manage own teams.
- **Co-coach add-on** — $6.99/mo. Added to a Creator's team as an assistant.
- **Program** — $49.99/mo. Multi-team management, ~5 teams, includes some co-coach seats.
- **Organization** — $299+/mo. 20–50 teams, location hierarchy, branding.
- **Enterprise / School** — custom. Multi-sport athletic departments.

## Schema design (target)

```
teams
  id
  name
  sport_id            → sports.id
  organization_id     → organizations.id (nullable)
  owner_user_id       → auth.users.id
  status              enum('active', 'frozen', 'archived')
  created_at

team_members
  team_id             → teams.id
  user_id             → auth.users.id
  role                enum('owner', 'coach', 'co_coach', 'player', 'parent')
  invited_by_user_id  → auth.users.id
  joined_at

organizations
  id
  name
  owner_user_id       → auth.users.id
  tier                enum('program', 'org', 'enterprise')
  created_at

sports
  id
  name
  config_json         (sport-specific tag taxonomy, period structure, etc.)

games
  id
  team_id             → teams.id   (replaces current user-scoped ownership)
  visibility          enum('private', 'coaches_only', 'specific_users', 'team', 'public_link')
  ...existing columns

clips
  id
  team_id             → teams.id   (replaces current user-scoped ownership)
  visibility          enum('private', 'coaches_only', 'specific_users', 'team', 'public_link')
  ...existing columns (start_time, end_time, is_starred, note, video_id)

clip_shares
  id
  clip_or_game_id     (polymorphic — type column distinguishes clip vs game)
  shared_with_user_id → auth.users.id
  shared_by_user_id   → auth.users.id
  note
  viewed_at           (null until first view)

public_share_tokens
  id
  token               (random url-safe string)
  clip_or_game_id     (polymorphic)
  created_by_user_id  → auth.users.id
  expires_at          (null = never expires)
  view_count

subscriptions
  id
  user_id             → auth.users.id
  tier                enum('viewer', 'creator', 'co_coach_addon', 'program', 'org', 'enterprise')
  billing_status      enum('active', 'past_due', 'cancelled', 'trial')
  started_at
```

## Permission matrix

Starting point — refine in beta based on real friction. `partial` = scoped subset (see notes).

| Role      | Watch | Upload      | Tag         | Export | Invite     | Manage roles | Manage billing |
|-----------|-------|-------------|-------------|--------|------------|--------------|----------------|
| owner     | ✓     | ✓           | ✓           | ✓      | ✓          | ✓            | ✓              |
| coach     | ✓     | ✓           | ✓           | ✓      | ✓          | partial      | –              |
| co_coach  | ✓     | ✓           | ✓           | ✓      | –          | –            | –              |
| player    | ✓     | own only    | own only    | own    | –          | –            | –              |
| parent    | ✓     | own only    | own only    | own    | –          | –            | –              |
| viewer    | ✓     | –           | –           | –      | –          | –            | –              |

**Notes:**
- `coach.manage_roles = partial` → can promote players/parents to co_coach but cannot demote the owner or other coaches.
- `player.upload/tag/export = own only` → players may upload personal highlight clips and tag/export their own content, but not modify team-wide assets.
- `parent.upload = own only` → parent uploads are dual-owned (see Data ownership rules #3).
- `viewer` is a subscription tier; on a team, a viewer is typically `parent` or `player` who only consumes content. The "viewer role" row above represents the floor of capabilities granted to anyone with a Viewer subscription on a shared clip.

## Data ownership rules

1. **Clips belong to the team, not the user.** Tag groups, exports, and analytics aggregate at the team level.
2. **Frozen teams persist for 12 months in read-only mode.** Members can still view existing content but cannot upload, tag, or invite.
3. **Parent uploads are dual-owned**: the parent retains a personal-library copy and the team gets a shared copy. If the parent leaves the team, the team's copy stays; the parent's personal copy follows them.
4. **Anyone with Creator+ subscription can take over a frozen team within a 30-day grace period.** After 30 days, the team archives permanently.
5. **Viewer subscriptions persist independently of team status.** A parent's Viewer sub lets them keep watching previously-shared clips even after the team archives.

## Visibility model

Each game and clip has a `visibility` column:

- `private` — only the uploader sees it.
- `coaches_only` — owner, coach, co_coach roles within the team.
- `specific_users` — explicitly listed in `clip_shares`.
- `team` — all team members (default for new uploads).
- `public_link` — anyone with the URL, no login required.

**Default for new uploads: `team`.**

Public links expire after 30 days by default with an optional never-expires toggle. The public watch page shows IamSports branding + a corner watermark + a CTA to subscribe. View count tracked via `public_share_tokens.view_count`.

## Phased build plan

Each phase ships independently to TestFlight for beta testing.

- **Phase 3a — Schema migration, no UI changes.** Add `teams`, `team_members`, `organizations`, `sports`, `clip_shares`, `public_share_tokens`, `subscriptions` tables. Backfill via the migration strategy below. UI behavior unchanged.
- **Phase 3b — Game Library tab + per-game visibility.** New nav tab listing games scoped by team membership. Per-game visibility selector on upload.
- **Phase 3c — Invite flow + role management.** Team settings screen, send-invite by email or link, role assignment within the team.
- **Phase 3d — Public share links + watch page.** Generate token, share URL externally, no-login watch page with branding + watermark.
- **Phase 3e — Sport selector + multi-sport tag scoping.** Team creation includes sport selection; tag taxonomy filtered by `teams.sport_id`.
- **Phase 3f — Pricing tiers via RevenueCat integration.** Tier-gated features, paywall, in-app purchase. RevenueCat wiring per CLAUDE.md's already-flagged plan.

## Migration strategy from current state

- **All existing solo coaches**: auto-create one team per user on schema deploy. New team's `owner_user_id` = the user, `sport_id` = basketball (seeded), `status` = active.
- **All existing clips, games, videos**: assigned to the auto-created team via a backfill UPDATE that joins through the current `profile_id → user_id` linkage.
- **Existing users see zero change in UI behavior.** The team layer is invisible; their current single-user mental model maps 1:1 to the new "team of one with you as owner" structure.
- **Solo coach experience remains identical post-migration.** A solo user is just a Creator-tier user with one team where they're the only owner.

## Open questions still to resolve

These are flagged for discussion before Phase 3a schema lock-in.

- **Co-coach billing**: paid by the inviting Creator (recommended — friction-free invite) or by the invited co-coach (clearer payer alignment)?
- **Program / Org tier**: flat seat count with included co-coach seats (recommended — simpler pricing) or per-team scaling (more granular billing)?
- **Watermark on public links**: yes (recommended — drives subscriber conversion) or no (cleaner UX)?
- **Practices vs games**: same entity with a `type` column (recommended — fewer tables) or separate entities (clearer mental model)?
- **Sports at launch**: which to seed beyond basketball? Candidates: volleyball, soccer, lacrosse, baseball, football. TBD based on beta-coach interest.

## Export flow concerns flagged by Adam

Current 3-step flow (game → tags → review) may need restructure. **Do not refactor preemptively** — identify specific friction in beta testing first. Topics to explore once beta feedback lands:

- Step count: is 3 too many? Is the games-step skippable when there's only one selected team?
- AND/OR logic clarity: do users understand how tag groups combine? Does the ★ Highlight chip (FIX 1) cover the most common case well enough that more advanced logic could be hidden by default?
- Preview-before-export: should users see a video preview of the result before triggering the Railway render?
- Server-side processing time: ~minutes for long highlight reels — can the perceived wait be reduced (background processing, push notification on completion — see Tier 2/Tier 3 from the export-resume work)?
- Clip discovery for highlight reels: with the new ★ Highlight filter and `is_starred` data, is the "Make Highlight Reel" shortcut from CLAUDE.md the natural simplification?
