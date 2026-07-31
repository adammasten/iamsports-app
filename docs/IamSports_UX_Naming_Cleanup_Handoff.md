# IamSports — UX & Naming Cleanup Handoff

**Date:** July 5, 2026
**Purpose:** Reduce confusion in the app by fixing *vocabulary and screen clarity* — NOT by adding or removing features. Every change below is copy, labels, or hiding an internal term. No new tables, no schema migrations required for this pass.

**Core principle this session settled:** The app felt "too much" because of extra *concepts* layered on top of the features, not the features themselves. We are cutting concepts (followers, "feed" as a vague idea, "clip" on family screens), not functionality.

---

## The locked mental model (5 surfaces, each one job)

A coach should be able to hold this in their head:

1. **Home** — a *lens*, not a place. Shows what's new across the teams and players you're part of, newest first. Reads data that already exists on the walls; it does NOT hold content and does NOT grant access.
2. **Team wall** — a *place*. A team's permanent collection of posted games and reels.
3. **Kid's wall** — a *place*. A player's permanent collection.
4. **Film Room** — the *workbench*. Where you upload footage, tag, and build reels. Backstage. Has thumbnails + "Post to wall" + delete buttons.
5. **Coaches' Corner** — coaches only. A private board. Players and families never see it.

**Access rule:** Membership is the gate. On the team → you see the walls. Not on the team → you see nothing team-gated. Coach/admin approves members. Home only ever surfaces what you're already allowed to see.

---

## Decision 1 — Rename "feed" to "Home"

- The concept previously called "feed" is renamed **Home** everywhere user-facing.
- Rationale: Instagram, TikTok, YouTube, and X all label this exact tab "Home" with a house icon. Universally understood, no algorithm/follower baggage. ("For You" = strangers/algorithm — wrong signal. "Following" = drags back the follower concept we cut. "Feed" = insider/vague.)
- The bottom-nav item currently labeled **"Team"** (house icon) becomes **"Home"**.
- Home is chronological (newest first), merged from the walls the user is a member of. No algorithm.

---

## Decision 2 — Cut "followers" entirely (for launch)

- Remove the follower concept from all user-facing surfaces.
- There is ONE relationship at launch: **are you on the team or not.** Coach approves members (parents, players, grandparents/family). Approved = sees the walls.
- **Auto-follow model:** being on a team automatically means you see that team's content on Home. No follow button, no follow-request inbox. Membership *is* the subscription.
- Public/discovery followers = a v2 idea, deferred with the rest of the public layer.
- **Naming for the approved people:** still open — leaning **"Members"** ("Add member" / "Team members"). "Family" is the warm alternative. Adam to confirm; does not block build.
- **Implementation note (verify on terminal before touching):** cutting followers is expected to be a "stop offering it in the UI" change, not a migration. The `share_audience` enum value for followers can sit unused. Do NOT drop enum values. Confirm the wall/share logic doesn't hard-require a followers view before removing it.

---

## Decision 3 — Hide the word "clip" from family-facing surfaces

- Internally the pipeline is unchanged: tag a game → creates clips → assemble clips → export a reel. Keep all internal code/terms as-is.
- **User-facing rule:** families (walls, Home, kid's page, shared-with-you) only ever see two content words: **GAME** and **REEL**.
  - **Game** = the footage.
  - **Reel** = the highlights / the shareable thing.
- "Clip" is a *workshop* word — it may appear ONLY on the tagging / reel-building screens inside Film Room, never on a watching surface.
- Do NOT build any in-app "how tagging works" explainer/tooltip. The pipeline should be invisible, not taught. (This was flagged as an overbuild temptation — resist it.)

---

## Decision 4 — Collapse video/reel into ONE user-facing word: "reel"

- Users do not carry a video-vs-reel distinction. To a parent, the thing they upload and the thing they share are the same object: they filmed their kid, they post it.
- **Pick one word — "reel" — for the shareable thing, everywhere family-facing.** Whether it's one clip or several stitched, the user calls it a reel.
- "Video" remains an internal / upload-mechanics word only.
- The specific word matters less than *picking one and stopping.* Reel is the pick.

---

## Decision 5 — Always-on description line at the top of each screen

Small, permanent, grey subtitle directly under each screen title. Not an empty-state (does not vanish when content exists). Small enough not to take real space. Same treatment on every screen.

**Final copy (paste-ready):**

- **Home:**
  `What's new across your teams and players.`

- **Team wall:**
  `[TBD — depends on who can post]`
  - If coaches-only: `Games and reels your coaches post — everyone on the team sees these.`
  - If anyone on team: `Games and reels from your team — everyone on the team sees these.`

- **Film Room:**
  `Your workbench. Everything you've made — games and reels. Tap "Post to wall" to share.`

- **Coaches' Corner:**
  `Coaches only. A private board for your staff — players and families never see this.`

(Coaches' Corner shows its description even when empty — no empty-state apology needed; the description carries it. Coaches are auto-attached to their own Corner.)

---

## Decision 6 — Film Room must look different from the Wall

- Root cause of "what's the difference between Film Room and the Wall?": they render as near-identical lists.
- **Fix (visual, not structural):**
  - **Film Room cards** = workbench look: thumbnail + "Post to wall" button + delete. (Already partially true — keep/extend it.)
  - **Wall cards** = published-feed look: simpler, tap-to-play, no post/delete buttons.
- The visual difference IS the explanation. Combined with the description lines, no further education needed.

---

## Decision 7 — Keep "Post to wall" vs "Save to wall" as distinct verbs

- They are genuinely different actions; keep both words.
  - **"Post to wall"** = publishing your own content (from Film Room).
  - **"Save to wall"** = keeping something someone shared with you (e.g. the "Shared with you" tab).
- The description lines carry the explanation. Do not merge them.
- **Watch item (do NOT change now):** the shared-with-you → "Save to wall" flow is the most conceptually loaded screen. Flag as the next candidate for simplification if device testing shows people stumble. Leave it alone this pass.

---

## OPEN ITEMS (do not build blind — resolve first)

1. **Team wall — who can post?** Coaches-only, or anyone on the team. This is a COPY decision (changes the team-wall description line above) — mark the string `[TBD: coaches-only or all-members]` until Adam confirms. Also affects whether members get a post affordance on the team wall.

2. **The bottom-nav "+" on Home.** A bare "+" reads as "create a post" (Instagram/TikTok convention). On Home — a *watching* lens — a create button is ambiguous.
   - **Recommendation:** move all creation (upload/build) into Film Room where it belongs, and remove the "+" from Home. Home's nav becomes pure navigation (Home / My Tags / Explore), no orphan plus.
   - If a create entry MUST stay on Home, label it (`Upload` / `Add video`) — never leave it bare, and never label it "reel" (tapping it uploads footage, it does not produce a reel).
   - Adam leaning toward "let them figure it out" — pushed back: fine for navigation between tabs, risky for a create button. Needs a decision before build.

3. **Public posting — PARKED (child-safety).** "Post a reel to a public page" was raised but deliberately deferred. Public = strangers with no membership = the one door kept shut all session because this is minors' footage. A parent posting their *own* kid's reel publicly may be reasonable, but "public posting" as a general feature needs its own deliberate child-safety design session (who can post publicly, whose kids can appear, coach posting reels containing other people's kids, etc.). **Do NOT include public posting in this build.**

---

## What is NOT changing

- No features removed. The core (tag a game → build a reel → post to a wall; walls = team/kid/Coaches' Corner; membership = access) is intact and tight.
- No schema migration required for this UX pass (pending the followers-enum verification note in Decision 2).
- Internal pipeline terms (clip, video, bundle, etc.) unchanged in code.
- The separate, already-scoped **game-on-wall** build (SQL `game` enum + `resolve_shared_game` SECURITY DEFINER + wall game-card render + viewer list-view playlist) is tracked elsewhere and is not part of this naming pass.

---

## Suggested build order for this pass (smallest → safest first)

1. Add the four description lines (Home, Team wall, Film Room, Coaches' Corner) — pure copy, no logic. (Team wall string uses the `[TBD]` placeholder.)
2. Rename "feed"→"Home" and the bottom-nav "Team"→"Home" label.
3. Sweep family-facing surfaces to ensure only GAME/REEL badges appear — hide any "clip" wording.
4. Standardize the shareable-thing word to "reel" on family surfaces.
5. Differentiate Film Room vs Wall card styling (workbench vs tap-to-play).
6. Followers removal (UI-only; verify enum/share-logic first per Decision 2).
7. Resolve the two open decisions (team-wall posting, Home "+"), then implement.

Each step verified on device before the next. Nothing committed until the diff is reviewed.
