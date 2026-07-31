# IamSports — Next Session Handoff: Visibility Slice

*Paste this as the first message of a fresh chat to kick off the visibility build. Workflow unchanged: architecture/decisions in Claude chat; execution in Claude Code (CC) in the Mac terminal; SQL only via Supabase SQL Editor (never CC); VS Code for editing. One terminal command per code block. One step at a time with confirmation. Honest pushback wanted.*

---

## WHERE WE LEFT OFF (end of June 15 session)

Clean stopping point. Everything committed and pushed (HEAD = `0cdeab8`, in sync with origin/main).

**Banked this session:**
- Kid-wall reel posting working + committed (`40b8603`) — a reel posts from My Work to a kid's wall and plays there.
- My Work media-card layout committed (`0cdeab8`) — big left thumbnail, single right column (name / meta / badges / actions), readable.
- Cleanup done: orphan `migration_publish_reel.sql` deleted; orphan public-reel `shares` row (the `target_player_id=null` one) deleted from Supabase; the real kid-attached public reel row left intact. (`dependable-enchantment` Railway project couldn't be fully deleted — not a problem, app doesn't use it.)

---

## THE SLICE: VISIBILITY (public / team / private on wall posts)

### The core reframe (this is NOT a new feature)
It's fixing one hardcoded line. `app/my-work.tsx:171` calls `post_to_wall` with `p_audience: 'public'` **hardcoded** — every reel posted from My Work goes fully public with no choice. That's a child-safety gap in a youth app. Visibility = turning that single value into a deliberate user pick, then making every posting path share the same pick.

### Current posting reality (verified via grep this session)
`post_to_wall` is called in exactly TWO places, and they've diverged:
- `app/my-work.tsx:171` — reel kid-picker, **`p_audience: 'public'` hardcoded**.
- `app/kid.tsx:276` — inbox "Save to wall" picker, lets you choose audience (public/team), conditionally includes `p_team_id`.
- NOT wired anywhere else (Team page, Player Profile, Clips folder, Export have no posting).

### DECISIONS LOCKED
- **Option B — three tiers now:** Public / Team / Private.
  - **Public** = `audience='public'`.
  - **Team** = `audience='team'` (carries `team_id`) — already works in kid.tsx.
  - **Private** = the *absence* of a share row (or `visible=false`). "Private" is not an audience value; it's "don't show it anywhere — lives only in My Work."
- **Family/Followers tier is DEFERRED** — it depends on the followers/invite system (its own post-launch multi-session build). Slots in later as a 4th pick. Not in this slice.
- **DEFAULT RULE (the safety decision):** When posting a reel to a kid's wall, the picker **opens on Private / only-me**. Public and Team are deliberate taps. The resting state is NEVER public.

### BUILD ORDER (execution)
1. Build ONE shared posting/picker component: **Public / Team / Private**, defaulting to **Private** for kid posts. Both my-work and kid.tsx render this (kills the two diverged versions).
2. Swap `my-work.tsx:171`'s hardcoded `p_audience: 'public'` for the picker's value. Private = don't write a share row (don't call `post_to_wall`).
3. Point `kid.tsx` at the same shared picker so both paths share one posting behavior.
4. **Verify RLS** (this is a check, not a build — shares RLS is already locked): private (no row) is genuinely unreadable by others; `team` rows are gated to team members.
5. Confirm My Work badges reflect the chosen audience — should be FREE (the card already reads share rows to show Public / 🔒 Only-you / team-name; once the picker writes the right audience, badges light up correctly).

### EXPLICITLY OUT OF SCOPE (keep the slice tight)
- The followers / invite system (the deferred Family tier).
- Public no-login playback path (token → server-minted signed URL — separate growth-engine build).
- Propagating posting to Team page / Player Profile / Clips folder — that's the NEXT slice, after this posting behavior is unified and correct. (Work by functionality, not page-by-page: build posting-with-visibility once, then drop it into those pages.)

### ONE-LINE BUILD ORDER
Build shared picker (Public/Team/Private, default-private-for-kids) → swap my-work's hardcoded `'public'` for it → point kid.tsx at the same picker → verify RLS hides private + gates team → confirm badges reflect it.

---

## AFTER THIS SLICE (queued, not now)
- Propagate posting (with visibility built in) to Team page, Player Profile, Clips folder.
- Thumbnails (auto poster-frame from Railway FFmpeg → `thumbnail_path` column → signed URL). Fixes the gray-box problem on every reel card.
- Smaller items from the annotated PDF: tournament name on New Game (searchable site-wide), rename "Highlights"→"Reels" in export, larger tag list per clip in export review, duplicate-clip flagging, Coaches Corner.
