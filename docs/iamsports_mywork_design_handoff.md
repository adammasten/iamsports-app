# IamSports — "My Work" + Publishing Model — Design Handoff

*Captures the design discussion + CC investigation for the "My Work" screen and reel-publishing model. No code written yet. This is the spec to build from.*

---

## THE MENTAL MODEL (locked)
**Create once → it lives in My Work → decide where to publish (at export OR later).**

- A reel is made on the export screen.
- It gets an **automatic default name**, but the user can **rename it right there** at export.
- On export, it **always saves to My Work** (My Work = the master list of everything you've made). It stays there forever unless you delete it.
- At export, it **asks where to publish** (see "Publish choices" below) — but publishing is a *choice*, not automatic. A reel can simply stay private.
- **Everything you can do at export, you can also do later in My Work.** My Work is the management home, not just a list.

## PUBLISH CHOICES (asked at export, and editable later in My Work)
In plain language, the publish options are:
- **Kid's wall** — tag/attach the reel to a kid.
- **Personal page** — and if personal, a follow-up: **public or not?**
- **Team wall** — and if team, a follow-up: **public, or just for the team?**

### ⭐ CRITICAL CLARIFICATION — tagging a kid ≠ visibility
**Tagging/attaching a kid does NOT mean the kid (or anyone) can see it.** Tagging a kid is just *labeling* ("this reel is about Lars"). The reel can still be **completely private to the coach.** "Who is this about" and "who can see this" are **two separate switches.** (Consistent with the existing tagging philosophy: tagging and visibility are decoupled.)

## MY WORK — full management capabilities (anytime, per reel)
My Work is where you do ALL of this for any reel you've made:
- **Rename**
- **Re-clip / edit** *(scope TBD — see open questions)*
- **Make public / not public**
- **Put on / take off a team wall**
- **Put on / take off your personal wall**
- **Delete** (My Work keeps everything forever unless you delete it — so a delete function is required)
- **See where it lives** at a glance (the badges — see below)

## "WHERE IT LIVES" INDICATORS (core to the screen — first slice)
Each reel card shows, at a glance, where it's published — clear visual indicators (colored accent/badge + icon), not just text:
- **Personal / public wall** → one clear indicator (colored accent + label)
- **Team wall** → a different clear indicator (different accent + team name)
- **Private / not shared** → a **LOCK icon** ("only you"), neutral/no accent
- A reel can be in **multiple places at once** → show multiple indicators on one card.
- Exact colors are a design choice — optimize for "I can tell in half a second where this lives."

## SEARCH / SORT / FILTER (required — critical at scale)
With many reels and many tags, drill-down is essential:
- **Search** — a search box that filters reels by **name** (and ideally by **tag**).
- **Sort** — by **date** (newest/oldest), **name** (A–Z), **duration**.
- **Filter by team** — chips (All / each team).
- **Filter by tag** — important; there will be MANY tags, must be able to drill to a specific one (with tag-search since there are so many).
- *Sequencing instinct:* first slice = search-by-name + sort-by-date + team chips (if cheap); follow-on = filter-by-tag + tag-search UI (deriving a reel's tags is more involved — see "technical crux").

## THUMBNAILS (later slice — planned, not first)
- No thumbnail column today.
- Smallest path: Railway export server (FFmpeg) extracts one poster frame during render → uploads to `exports/thumbnails/<id>.jpg` → new `highlight_reels.thumbnail_path` column → app serves via signed URL.
- Needs: migration (new column) + server change + redeploy + client plumbing. **Defer.** First-slice card layout should leave a square placeholder so it drops in cleanly.

## NEW IDEA — save reels OTHERS send you (distinct, later feature)
- Today: My Work = "everything **I** made."
- Desired addition: also be able to **save a reel someone shared with you** into your permanent stash, so it lives in My Work **forever** even if they unshare it.
- New definition: My Work = "everything I made **+ everything I've chosen to keep**."
- ⚠️ Open design question: is a saved reel a **your-own copy** or a **protected reference** to theirs? (Ties to the locked principle: *content families have saved cannot be recalled by the original sharer.*) → decide before building this.

---

## CC INVESTIGATION FINDINGS (verified against the repo)

**`clips-library.tsx`** (the screen being repurposed — but DECISION: build My Work as a NEW route, leave clips-library alone): coach clips list, derives coaching teams from `useTeamContext().userTeams`, one query (clips ⨝ videos), client-side team-chip filter, dark cards (title + meta), tap → `/shared-viewer` with `{title, storagePath, startTime, endTime}`.

**`highlight_reels` columns (confirmed):** id, team_id, **season_id** (nullable — was omitted from earlier lists), created_by_user_id, name, storage_path, source_clip_ids (uuid[]), duration_seconds, overlay_mode, status (rendering|ready|failed), public_share_token, created_at.

**My-reels query + RLS:** `highlight_reels` where `created_by_user_id = userId`, newest first. RLS `highlight_reels_read` has the `created_by_user_id = auth.uid()` branch (already run) — covers the `team_id IS NULL` rows that export persistence writes. ✅

**"Where it lives" query (the key part):** ONE batched query, modeled on `kid.tsx:183`:
```
shares.select('content_id, audience, team_id, visible, teams ( name )')
  .eq('content_type','reel')
  .in('content_id', reelIds)
```
Group by `content_id` client-side. Per reel: `audience='public'` ⇒ Public badge; each `audience='team'` ⇒ team-name badge; no rows ⇒ 🔒. Multiple rows ⇒ multiple badges. Readable because `shares_read` includes `shared_by_user_id = auth.uid()`. **No RPC, no per-reel queries.** (Audience enum is `public | team | player | coaches` — there is NO separate "personal" audience; personal wall = `audience='public'`.)

**Playback:** reuse `/shared-viewer` as-is — pass `storagePath` + `title`, OMIT start/end so the whole rendered reel plays (the seek/stop effects no-op when those are null). No viewer change.

**Rename:** RLS `highlight_reels_update` has `created_by_user_id = auth.uid()` in USING + WITH CHECK — creator can update name. ✅ Implementation: tap title → inline edit / `Alert.prompt` → `update({name}).eq('id', reelId)`.

### 🚩 THE BACKEND WRINKLE that makes publishing non-trivial
- **Nothing creates `content_type='reel'` shares yet.** The only `post_to_wall` caller (`kid.tsx:276`) posts clips/videos from a kid's inbox. So **today every reel shows 🔒 private** until a reel-publishing action exists.
- **`post_to_wall` is parent/kid-centric:** it REQUIRES a `target_player_id` and that the caller is a linked parent of that kid. **A reel isn't inherently tied to a kid**, so publishing reels needs either a target player or a **new/modified RPC variant** for reels. → This is the main new backend work for the publish system.
- Also flag: confirm `resolve_shared_content` can render a reel (vs showing "content unavailable") — CC was mid-check on this.

---

## DECISIONS LOCKED THIS SESSION
- My Work = **new route**, leave `clips-library.tsx` as-is.
- Pull **reel-publishing forward** (so badges actually light up) — but per discussion, the model is "create → My Work → choose where to publish," with publish available at export AND in My Work.
- Tagging a kid is **decoupled from visibility** (can tag + stay private).
- My Work keeps everything forever → **delete** is required.
- Thumbnails = later slice (leave placeholder).
- Save-others'-reels = later feature (copy-vs-reference TBD).

## OPEN QUESTIONS (to decide before/while building)
1. **Sequencing:** build My Work screen first (reels show 🔒 until publishing), OR build My Work + publish together? (Leaning: the publish action is the glue that makes "where it lives" real, so they likely go together — but the screen can be built first and publishing wired right after.)
2. **Save-others'-reels:** copy or protected reference?
3. **"Re-clip / edit" a reel:** re-trim the existing reel, or rebuild from source clips? (Sizing depends on this.)
4. **Reel-publishing RPC:** new reel-friendly `post_to_wall` variant that doesn't force a kid target — confirm shape.
5. **`resolve_shared_content` for reels:** confirm it renders published reels (CC was verifying).

## TECHNICAL CRUX (worth remembering for filter-by-tag and filter-by-team)
A reel doesn't directly have tags or a team — it has `source_clip_ids`. The clips carry `clip_tags` and `team_id`. So **reel→tags** and **reel→team** must be **derived from the source clips** (or, for "shared to team," from the shares table). This is why filter-by-tag is a later slice — it needs a batched derivation (or an RPC).

## ONE-LINE STATUS
Design locked for "My Work" (new route): a master list of every reel you've made — rename, play, delete, search/sort/filter, and see/manage where each lives (personal/team/private) via a batched `shares` query. Publishing ("where should this go?") works at export and in My Work, with tagging-a-kid decoupled from visibility. Main new backend piece: a reel-friendly publish path (current `post_to_wall` is kid-centric). Thumbnails + save-others'-reels are later slices.
