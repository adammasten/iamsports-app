# The Wall — Full Design Spec (LOCKED)

The kid's profile page (e.g. Lars's wall). Five views + wall-level visibility, all built on the existing `shares` / `highlight_reels` / `followers` tables (live in Supabase since June 4–5, currently allow_all RLS — locking those down is the foundational build).

## Core principle (inherited from Sharing & Access Model)
Walls are VIEWS over the `shares` table. Content appears on a wall ONLY because a `shares` row deliberately places it there. Nothing auto-collects. Putting a clip on the wall does NOT move it — it stays in the Clips library; the wall is just a view.

## Structure: ALL is the spine; the other tabs are filters down from it
The wall opens on **All** — a single unified, chronological feed of everything related to the kid (shared-with-you + what they posted + games + clips), each item lightly timestamped ("2 days ago" / date in the corner) so you can scan the timeline of activity without hopping tabs to reconstruct who sent what, when. The other tabs are just lenses/filters on this one underlying stream. Sport and Team are cross-cutting filters that apply on top of any view. (Matches the All/Lars/Highlights/Sent pills already on the home screen.) The underlying stream = the `shares` table plus the kid's clips/games, ordered by date.

## The views

### 0. All (DEFAULT)
- Unified chronological feed of everything: incoming shares + your posts + games + clips.
- Each item lightly dated. Filterable by sport or team.
- The spine — you orient here; everything else is a filter down from this.

### 1. Shared with you (inbox)
- Content others deliberately shared TO this kid/family. Shows who shared it + title.
- From here you can take share ACTIONS to re-place it (see Share actions below).
- `shares` rows where `audience='player'`, `target_player_id = kid`.
- Curated / browse (light — no heavy search needed).

### 2. Wall (the showcase — Facebook-style)
- Curated mix: clips + highlights (coach-made if the coach made them; parent/child-made if they chose to feature it) + personal uploads chosen "for the wall."
- "Upload to wall" lands here.
- Every wall item is ALSO still in Clips (wall = view, not a move).
- Unshare: tap any wall item → "take off my wall" = set the share row `visible=false` (non-destructive).
- Curated / browse.

### 3. Games (games only — a library)
- Strictly games. Needs find-ability: search + sort by date, alphabetical, tournament, label.
- Games gain a **tournament** attribute (attach games to a tournament, sort by it) and a **label** (e.g. "Championship"). [Tournament/label = a later sub-feature; basic Games list + date sort first.]
- **Games visibility rule (important):**
  - Coach-uploaded team games → full game visible ONLY to people approved by the coach (team-gated).
  - Parent-uploaded games (own footage, not coach-related) → parent owns it, viewable by whoever the parent allows.
  - "Upload game FOR THE TEAM" link (shown to parents who aren't coaches): the parent uploads but the game is OWNED BY THE TEAM (coach's domain, team-gated). The button chosen at upload determines ownership — this replaces the parent→team handshake. Assistant-coach nuance: parents sometimes film for the team; coach's discretion.

### 4. Clips (your own clip library)
- Your own clips. The library drawer — needs strong find-ability: **sort/filter by tag** (dunk, layup, alley-oop…) + **search**.
- Own clips are ALWAYS sortable by their owner. Team clips remain coach-permission-gated (the locked "allow players to sort their tagged clips" toggle).
- **"On wall" indicator:** a clip currently featured on the wall shows a colored border/highlight in the Clips view, so you can see at a glance what's featured.
- Library / search-first.

### 5. Sport (a filter/lens)
- Not a content type — a filter across the other views ("show me just basketball").

## Design principle
Showcase views (Shared, Wall) = curated, browse. Library views (Clips, Games) = find-ability first (sort, filter, search).

## Share actions (the "where does it go" menu)
Sharing is not one button — it's a small menu of destinations, each writing a `shares` row with a different audience:
- Add to public wall (`audience='public'`)
- Add to personal wall — team (`audience='team'`)
- Add to personal wall — friends/family (followers-scoped)
- (coaches-only, nobody, etc. per the audience model)
Unshare anywhere = flip `visible=false`. Re-share / change audience = add/flip rows. Content never moves.

## Wall ownership model — kid wall and team wall are the SAME system
A **kid wall** is run by the parent/player; a **team wall** is run by the coach/admin. Identical mechanics, different owner:
- Members can POST to the wall (a parent can post to the team wall; a coach can share to a kid).
- The OWNER can TAKE DOWN anything they don't want (coach/admin removes unwanted team-wall posts; parent removes from kid wall).
- The OWNER sets each post's visibility tier.
One system serves both walls.

### Coach has NO control over a kid's wall
A coach shares content → it lands in the family's "Shared with you" inbox. That is the coach's ONLY power over a kid's wall. The coach can neither post to a kid's public wall NOR prevent the family from doing so. Whether shared content goes on the wall, and at what visibility, is 100% the family's/player's decision. (No `public_allowed` permission flag — scrapped as unnecessary friction. Kids self-select to share only good plays; we avoid "coach, please make it public" nagging.) Default when the family posts = public allowed.

### Inbox vs. wall
"Shared with you" is an inbox. Content shared to you lands there, visible only to you, and stays there whether or not you post it to your wall. Posting to the wall is a separate, deliberate act by the wall owner.

## Inbox / content filtering — DEFERRED (needs a tag-model design dive)
The ★ Highlight and POE special tags already exist and map cleanly onto "fun stuff vs. teaching clips" (★ Highlight = highlights; POE = "work on your footwork" coaching clips). A filter could surface them as chips (All / ★ Highlights / POE), powered by extending `resolve_shared_content` to also return each clip's tag names (SECURITY DEFINER — the parent can't read `clip_tags` directly). Tags live on CLIPS only; videos have none; reels are highlight compilations (source_clip_ids).
**Deferred on purpose:** before building filter chips, do a deeper dive on the full tag/category model for clips/reels/highlights, including user-definable tags and attaching existing ones. The tag architecture already supports user-defined tags (category/scope columns) — so the rule is: leave room for future categorization; don't build rigid filtering that fights it. Reels do NOT auto-count as ★ Highlights (per Adam — wants room to categorize deliberately later).

## The wall tiers (refined) — there is NO "private wall"
The wall is for showing to others, so "private" simply means NOT posted to any wall — the item just stays in **All** (the library). Posting to a wall always means choosing an audience to show it to. The three wall tiers:
1. **Team** — everyone on the team sees it.
2. **Followers** — invited people: grandparents, family friends (the `followers` table, scope player/team, revocable).
3. **Public** — anyone, no login.
"Save to wall" presents these three as a picker (NOT a silent default). Not wanting it on a wall = don't post it; it remains in All.

## All = the library + star
**All** holds everything shared with / owned by the kid, sortable by who shared it (sender). Each item can be **starred** (favorite) to find again later. This is the catch-all the wall tiers are curated *out of*.

## THE HARD PROBLEM (unsolved — design next)
**Full games are gated behind team membership — without a membership you cannot watch a full game.** But followers/public need to watch *something*. So: tiers below team-membership can see highlights/clips, but NOT full game film. Need to define exactly what each tier can watch (likely: highlights/reels/clips yes; full raw games membership-only). This is the meatiest remaining piece and ties to the public-content media path (token → server-minted signed URL).

## Build dependencies / order (foundation first)
1. **`shares` RLS lockdown** (+ highlight_reels, followers) — they're live but allow_all. The wall READS shares, and shares is the most complex policy (needs anonymous read for `audience='public'` rows = the growth engine). This is the foundational build — everything else reads from it.
2. **All feed + Wall tab** for a kid (read shares where target_player_id = kid, unified dated feed; Wall is a filter of it).
3. **Shared with you** inbox (read incoming shares).
4. **Clips library** (own clips + tag filter/search + on-wall indicator).
5. **Games library** (list + date sort; tournament/label later; the for-the-team upload link).
6. **Wall visibility tiers** + share-action menu.
7. **Sport filter.**
