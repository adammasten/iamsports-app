# IamSports — Pre-Launch Homepages & Sharing Architecture

*The north star for the sharing/homepage build. Locked on a brainstorming walk. When we build, it's execution — the decisions are already made.*

---

## THE BIG PICTURE

IamSports is a serious coaches' tool for helping kids get better — NOT a social media app. But it's also a great place to post highlights, and the sharing mechanics ARE the adoption engine. The model below borrows familiar patterns from Instagram (profiles), TikTok (feed), and Facebook (personal wall) so it feels instantly familiar to parents and kids, while staying a youth-safe, coach-controlled environment.

---

## PART 1 — THE THREE CORE HOMEPAGES (at launch)

### 1. My Profile (personal)
- **What:** What I posted + my wall + my clips library. Facebook/Instagram-style "this is my stuff."
- **Shows:** my posts, with each post's audience badge (Public / Team / [Followers later]) + date.
- **Tabs:** Wall (curated posts) · Clips (my clip library) · About.
- **Clips library:** sort/filter by tag; **rename clips** (e.g. "Lars highlight tape" → "Lars massive windmill 360 dunk").
- **Design reference:** Instagram profile (header w/ photo + stats, tabbed content below).

### 2. Team Hub (the team's command center)
- **What:** Everything for the team — game film, what we're working on, announcements, team posts. Where the coach makes sure everyone knows what's going on.
- **Coach with multiple teams:** **Team Hub = ALL teams aggregated** by default, so a coach monitoring 3–5 teams sees everything in one place. Deselect other teams to focus on one. (i.e. "Team Hub All" view + per-team drill-down.)
- **Roster per team:** see every kid on a team, tap a kid → their profile + anything you've sent them (encouragement, a highlight to make them feel good, coaching notes).
- **Players-under-my-care view:** an easy way for a coach to see ALL kids across all their teams and click into any one.
- **Coach controls full-game visibility:** "this game film is team-only" — full games can be locked to team so you don't leak film to competitors.
- **Design reference:** Instagram-style profile/grid, but team-scoped, with coach moderation affordances.

### 3. Feed (social discovery)
- **What:** Anyone you follow / have liked — what's out there socially, cool plays, etc.
- **Design reference:** **TikTok** — full-screen vertical, infinite scroll, immersive. (Kids use TikTok; match what they know.)
- **Status:** We DID decide to include a Feed at launch (public posts from followed players/teams, newest first). Pull is trivial off the existing `shares` table (audience='public'); it's an app-side build, no new schema.

> Mental model: it's "one more view above what Facebook does." Facebook = personal page + share others' things. We add the Team Hub (team-scoped) and a Feed (social discovery) on top.

---

## PART 2 — WHAT EACH ROLE SEES

### Parent / Player
- **Lands on:** My Profile.
- **Has:** My Profile · Team Hub (their kid's/their teams) · Feed · Search.
- **Can:** upload, post to walls (choose audience), invite family/friends (post-launch), search players/teams.

### Coach / Admin / Assistant Coach
- **Lands on:** Team Hub (their feed of all their teams). "Their feed is what they look at."
- **Has:** Team Hub (all-teams + per-team) · Roster per team · Players-under-care list · My Profile · Feed.
- **Can:** post team content, set team-only vs public, **moderate** (see below), manage roster.

---

## PART 3 — SHARING MODEL (the destinations)

From "Shared with you" (or any content), the user picks a destination + audience. A single clip can be posted to MANY places at once — each is its own `shares` row (the schema already supports this via the 6-column unique key incl. team_id).

**Walls & audiences:**
- **My Profile · Public** — anyone; shows on my profile + (if followed) others' feeds.
- **My Profile · Followers** — invited close circle (POST-LAUNCH; see Part 6).
- **Team Hub · Team-only** — only the team. Coaching notes, "fix your blocking assignment," full game film. NEVER leaks to followers/public.
- **Team Hub · Public** — coach opts in to make a team clip public ("wrap our team" highlights for everyone).

**Locked principles:**
- **Coach has NO control over a kid's personal wall.** Coach shares → lands in the family's "Shared with you" inbox. The family decides if/where/at what visibility it goes on the kid's wall.
- **Team-only is sacrosanct.** A coach can keep game film and breakdowns team-only so grandparents/competitors never see them. (Avoids "grandparent watches the breakdown and has opinions" friction, and protects film from rival teams.)
- **A kid can have followers with zero approvals** and they still only see what's posted PUBLIC to that kid's profile.
- **Clips can be posted anywhere.** Maximum flexibility.

---

## PART 4 — MUST-HAVE LAUNCH FEATURES

### Search (LAUNCH — required)
Search for **players and teams**. Without it, "post publicly" is pointless (nobody can find the content). Going live on web too, so a public profile must be reachable/searchable.

### Notifications (LAUNCH)
- Fire on **everything**: a post to a kid's personal wall → a notification on that kid; team activity → team notification; engagement → notify.
- **Design:** research who does notifications best across social (Instagram/Facebook badge + TikTok in-feed style) and match it. Idea floated: a colored (green) accent that surfaces from behind the item.

### Moderation & Safety (LAUNCH)
- **Coaches/admins/assistant coaches monitor team walls** — they can take down anything that shouldn't show up (delete/hide).
- **Flag system built in** — any user can flag a post; flagged items surface to coach/admin for review.

### Clip management (LAUNCH)
- **Rename clips** to anything descriptive.
- Sort/filter clips by tag in the library.

---

## PART 5 — DESIGN REFERENCES (locked)
- **Feed → TikTok**: full-screen vertical, infinite scroll, immersive, native 9:16. (Kids' native pattern.)
- **Profiles → Instagram**: header (photo, name, stats: posts/followers/following) + tabbed content (Wall / Clips). Full-bleed media; tap to expand.
- **Team Hub → Instagram-profile-like**, team-scoped, with coach moderation buttons overlaid.
- **Notifications → Instagram/Facebook** bell + unread badge, TikTok-style in-context cues.
- **General principle Adam keeps returning to:** *fewest clicks to get where you're going, least confusion.* Don't add tiers/decisions that make users think harder than they do on the apps they already use.

---

## PART 6 — POST-LAUNCH (locked vision, deferred build)

### The Followers / Invite System (its own multi-session build)
Three follow types:
1. **Follow me (public)** — anyone can follow; sees only what's posted PUBLIC to that profile. (Pure "updates when this player/team posts public stuff.")
2. **Follow my team (public)** — same, team-scoped.
3. **Close circle / Family invite** — a **parent or player** (from their own login/profile) invites specific family/friends. Invitees come in THROUGH the inviter (not an open follow the coach has to approve). This is how you get growth (kids/teens may invite a ton of people) WITHOUT letting competitors see game film, and without the coach gatekeeping every request.
- **Coach can still revoke/override** any follower.
- **Followers' game-film access:** an approved close-circle follower (e.g. grandparent) can see back content like full games — UNLESS the coach marked that film team-only. Coach's team-only flag always wins.

Why deferred: needs an invites table, shareable invite links, magic-link / guest access (so an overseas uncle can view without a full account), per-tier access control, and management UI. Estimated ~2–3 sessions. NOT needed for launch — launch ships personal wall + team hub + public(logged-in) + feed + search.

### Public Content Viewing Path (the growth engine — post-launch)
Today a row can be audience='public', but an anonymous (logged-out) person still can't PLAY it (storage is auth-only). To make truly shareable links (paste a kid's highlight to a text/Instagram and anyone watches), build: public token → Railway service-role mints a short-lived signed URL → plays without login. Decide reels-only vs all content. This is the real "viral" lever; activate it deliberately, with moderation in place, after launch.

### Other post-launch
- Shareable URL per player/clip ("come see this").
- Richer Feed (people you've liked, discovery).
- Analytics for coaches (views/engagement) — not at launch.

---

## PART 7 — SCHEMA STATUS (already built, ready for this)
The `shares` table already underpins all of the above:
- `audience` enum: public / team / player / coaches (followers value = post-launch add).
- `team_id` nullable (public/personal rows have none; team posts carry it).
- `target_player_id` (kid's wall) ; `shared_by_user_id` (who posted).
- `visible` + `hidden_by_family` (family can take a public post off the wall).
- 6-column unique key `(content_type, content_id, audience, target_player_id, shared_by_user_id, team_id)` → same clip can live on multiple walls as distinct rows.
- RPCs live: `post_to_wall` (incl. team support) and `resolve_shared_content` (SECURITY-DEFINER content read for entitled viewers). `shares_read` public branch already respects `hidden_by_family`.

Already shipped on the app side: "Shared with you" inbox, shared-viewer playback, save-to-wall picker (Public + per-team Team), and the kid's personal Wall tab (public-only, with play + remove).

---

## BUILD SEQUENCE (marching orders)
1. **Team Page + Team Hub** — display team-audience posts; all-teams aggregate + per-team; roster; coach moderation (delete/hide); team-only vs public toggle on posts.
2. **My Profile + Clips library** — personal wall + clip library + **rename clips**.
3. **Feed (TikTok-style) + Search (players/teams)**.
4. **Notifications** across all three homepages.
5. **Moderation queue** (flag/report → coach review).
6. **POST-LAUNCH:** Followers/invite system (3 tiers) · public viewing path (anon signed URLs) · shareable URLs · richer feed · coach analytics.

---

*End of spec. This is the north star — building from here is execution, not design.*
