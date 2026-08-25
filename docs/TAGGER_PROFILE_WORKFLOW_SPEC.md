# IamSports — Paid "Tagger" Profile & Tagging-Job Workflow

**Status: product spec for review. Circulate to other AIs for critique of the workflow.**
Grounded against the live Supabase DB + current code on 2026-08-24. Nothing in the
"net-new" section is built yet; the "already exists" section is verified.

This is the "I send my game to someone else and they tag it for me" feature —
turned into a real, paid, two-sided workflow with a job queue, due dates,
instructions, private messaging, and a finalize handshake.

> Companion doc: `docs/tagger_role_and_tag_editing_design.md` already covers the
> **technical authz layer** (the grant primitive + the RLS wiring + the tag
> review/edit surface). **This doc does not repeat that** — it covers the
> product/workflow layer that sits on top. Read both together.

---

## 1. The vision (the story we're designing)

Adam has a game. He wants someone else — could be a paid tagger anywhere in the
world (his example: "someone in India") — to do the tedious tagging for him.

The end-to-end flow he described:

1. **Owner shares a game** with a specific person (a tagger).
2. That person is a **paid "Tagger" profile** (~$5/mo). Their app looks different
   — a tagger home screen, not the coach/parent home.
3. The tagger sees a **dashboard/bucket** of every game they've been asked to tag:
   the game, **who requested it, when it was requested, and the due date**.
4. Before tagging, the tagger can open a game and see **instructions** from the
   owner, and a **back-and-forth message thread** with the owner to nail down
   exactly what the owner wants tagged.
5. The tagger **tags the game** (all its videos), then presses **"Complete."**
6. The **owner reviews** the tagged game. If it's wrong, they **message** the
   tagger ("re-do this, add that"). The tagger fixes it and re-marks complete.
7. When the owner is satisfied, the **owner presses "Complete" (finalize).**
8. On finalize, the job **disappears from the tagger's active queue** (moves to
   their done/history). The two-step handshake — tagger-complete then
   owner-finalize — is the core of the model.

Two **consenting adults** coordinating a paid tagging job. Not kids. This is a
**production/QA workflow**, essentially a lightweight job board bolted onto the
existing tagging engine.

---

## 2. System context for an outside reviewer (what IamSports is)

- Expo / React Native + web app; Supabase (Postgres + strict per-table RLS + Edge
  Functions). Adults (coaches/parents) manage youth-sports game film; **kids are
  not users** (Hudl model).
- **A "game" is an event container of one or more videos** (quarters/halves).
- **Tagging** = marking clips on a video and attaching tags (players, plays,
  offense/defense). The live tagger is a full-screen studio (`tagging-overlay`,
  with a web variant); a remote tagger would use the **web** app.
- **Sharing** already flows through one `shares` table (content types include
  `game`). Audiences are team / coaches / player — **no "public"** (retired for
  child-safety).
- **Storage is private**; the only path to a playable URL is a service-role Edge
  Function (`sign-media`) that entitlement-checks first. A remote tagger can't
  see any video they aren't explicitly authorized for.
- **Payments**: RevenueCat, begins **post-App-Store-launch**. The $5/mo tagger
  SKU is a post-launch capability gate, not a launch blocker.

---

## 3. What already exists (verified live — reuse, don't reinvent)

- **`video_tagging_rights`** — a per-video grant table, live with RLS, **zero app
  code (reserved scaffold).** Columns: `id, video_id, granted_to_user_id,
  granted_by_user_id, can_tag (default true), names_hidden (default false),
  status (active|revoked|expired), expires_at, created_at`. RLS: a coach of the
  video's team can grant/revoke; the grantee can read their own grants.
  → **This is the authorization primitive for "X may tag video Y."**
- **"Tagger is a grant, not a role"** is the settled technical stance: a tagger
  holds `video_tagging_rights` rows. This is why it composes — the same person can
  be a coach on one team and a tagger for another with no schema conflict. (See
  companion doc.)
- **`videos.tagging_complete`** boolean already exists (a per-video done flag).
- **`shares.content_type` includes `game`** — sharing a whole game is modeled.
- **Tag vocabulary is team-scoped** — a tagger must be able to read the *granting
  team's* tags (their kids/plays), which is the whole point; the RLS wiring for
  that is specified in the companion doc.
- **`names_hidden`** grant flag exists so a non-member tagger tags "#12 assist"
  not "Jordan assist."
- **A private messaging table exists (`messages`) but it is PUBLIC team chat**
  (adults-only, no DMs). The tagger↔owner thread is a **different, private, 1:1**
  channel — net-new (see §5).

## 3b. What is NOT built (the net-new surface this spec is really about)

The grant primitive authorizes tagging. It does **not** provide any of the
workflow Adam wants:

- ❌ No **job/assignment** concept (no request, no due date, no status lifecycle).
- ❌ No **tagger home screen / dashboard** (distinct profile experience).
- ❌ No **per-job instructions** field or **private owner↔tagger messaging**.
- ❌ No **two-step finalize handshake** (tagger-complete → owner-finalize) and no
  queue-visibility rule driven by it.
- ❌ No **entitlement/payment** for a tagger profile.

Everything below §4 is proposed and open for the reviewers to shape.

---

## 4. Proposed data model

### 4.1 The job (net-new table) — `tagging_jobs`
One row per "please tag this game for me" request. This is the spine.

| column | meaning |
|---|---|
| `id` | pk |
| `game_id` | the game to tag (grants are written per-video underneath) |
| `team_id` | denormalized for RLS scoping |
| `requester_user_id` | the owner/coach who wants it tagged |
| `tagger_user_id` | the assigned tagger (nullable until accepted, if we allow open offers) |
| `status` | enum — see state machine below |
| `instructions` | free text the owner writes ("tag every possession, star made 3s") |
| `requested_at` | when the request was created |
| `due_at` | the deadline the owner sets (nullable) |
| `tagger_completed_at` | when the tagger last pressed Complete |
| `finalized_at` | when the owner pressed Complete (finalize) |
| `created_at / updated_at` | |

A `tagging_jobs` row **fans out to `video_tagging_rights` grants** for each of the
game's videos (the existing primitive stays the authz layer). Job = the workflow
wrapper; grants = the permission.

### 4.2 The state machine (the handshake)

```
requested ──(tagger accepts)──▶ in_progress ──(tagger presses Complete)──▶ tagger_complete
                                     ▲                                            │
                                     │                                            ▼
                          changes_requested ◀──(owner: "redo this")──── owner reviews
                                                                                  │
                                                                    (owner presses Complete)
                                                                                  ▼
                                                                             finalized
```
Plus terminal `canceled` / `declined`.

- **Tagger's active queue** = jobs NOT in `finalized/canceled`. On `finalized`,
  the job leaves the active dashboard → moves to their history. (Adam's "the game
  disappears on the tagger's end.")
- **`changes_requested`** is the review-bounce: owner sends it back with a
  message; tagger returns it to `tagger_complete`. Track a revision count.
- Open: do we need an explicit **accept/decline** step, or is assigning = the job
  is on? (Adam's example is a private, pre-agreed person, so accept may be
  optional — but an open/marketplace model needs it.)

### 4.3 Private job messaging (net-new) — `tagging_job_messages`
`id, job_id, author_user_id, body, created_at`. Strictly the two parties (owner +
tagger). This is where they align on "exactly what the tag should be" and where
the review bounce ("no, redo Q3") happens. **Distinct from**:
- team **public** messages (`messages`) — team-wide, adults-only, not private;
- per-clip **QA comments** (`clip_comments`, proposed in the companion doc) —
  those are pinpoint "check the assist at 4:10" notes on a specific clip/tag.

Open question for reviewers: do we need BOTH a job-level thread and clip-level QA
comments, or does one cover it? (Leaning: job thread for coordination, clip
comments for pinpoint fixes — they serve different moments.)

### 4.4 Entitlement
A RevenueCat `tagger` SKU (~$5/mo). Gates the **tagger workspace UI / ability to
accept jobs** — NOT the RLS (RLS always enforces the underlying grant). Post-launch.

---

## 5. Proposed screens

**Tagger side (the different "profile"):**
1. **Tagger Home / Dashboard** — the bucket. Rows: game, requester, requested
   date, **due date**, status pill (In progress / Needs changes / Waiting on
   owner / Done). Sort by due date. Active vs history tabs.
2. **Job detail** — top: **instructions** + **message thread** with the owner.
   Primary action: **"Start tagging"** → opens the web tagging studio on the
   game's videos (names hidden if `names_hidden`), using the granting team's tag
   vocabulary. Secondary: **"Mark complete."**

**Owner side (fits existing surfaces):**
3. **Assign a tagger** (from a game): pick the tagger (redeemable **tagger code**
   or email lookup — code matches every other invite in the app), set **due
   date** + **instructions**. Creates the job + underlying grants.
4. **Review** — watch the tagged game, open the thread, and either **"Request
   changes"** (→ message + bounce) or **"Complete" (finalize)**.

**Profile shape question:** Adam describes a *different home screen*. The prior
technical stance is "tagger = a grant, not an account type." Reconcile by making
**"tagger mode" a view/entitlement on a normal account** (so multi-role still
composes) rather than a separate login. Flagged as an open question — see below.

---

## 6. Child-safety / trust angle (must not be an afterthought)

IamSports' whole positioning is **adults managing youth footage**, Public retired,
storage locked down. A tagging workflow **hands a stranger (possibly overseas)
access to video of minors.** This is a first-class design constraint, not an edge
case. Points for reviewers to weigh:
- What can a non-member tagger **see** — only the granted game, or anything else?
  (Must be: only what the grant covers; `sign-media` already enforces this if we
  wire `can_tag_video`.)
- **Names hidden by default** for non-member taggers (jersey only). Is that
  sufficient, or do we need more (face blurring is out of scope/unrealistic)?
- **Vetting/consent**: two "consenting adults" — but the *kids* didn't consent to
  an overseas contractor. Does the owner (guardian/coach) have the authority to
  grant that? Terms/EULA + a clear consent step at assignment.
- **Revocation + expiry**: grants must be revocable and time-boxed (the primitive
  supports `status` + `expires_at`).
- **Auditability**: who was granted what, when, by whom (grants table + job row
  give us this).

---

## 7. Open questions for the other AIs (the debate)

1. **Profile vs grant.** Should "Tagger" be a *mode/entitlement on a normal
   account* (keeps multi-role composition, one login) or a genuinely separate
   account type with its own home? Trade-offs?
2. **Who pays, and is this a marketplace?** Adam said "$5/mo per profile." Does
   the **tagger** pay for the profile, the **owner** pay for the service, or both?
   Is IamSports a two-sided **marketplace** (we match owners↔taggers and take a
   cut) or just **BYO-tagger** (owner already knows the person, we're only the
   tool)? His example is private/pre-arranged — but a marketplace is a much bigger
   product.
3. **Job lifecycle depth.** Is tagger-complete → owner-finalize (+ changes bounce)
   enough? Do we need explicit accept/decline, per-video partial completion,
   revision limits, or auto-finalize after N days of owner silence?
4. **Due dates.** Soft (display only) or enforced with reminders/overdue states?
   (We already have a notification + SMS backbone that could drive reminders.)
5. **Instructions + messaging surface.** One job-level thread, or job thread +
   per-clip QA comments? How do they relate without confusing the user?
6. **Discovery/handoff.** Redeemable tagger-code vs email lookup vs a directory of
   available taggers (marketplace). Recommend code for the private case.
7. **What "Finalize" triggers downstream.** On owner-finalize: flip
   `videos.tagging_complete`? Notify? Unlock the owner's highlight/export flow?
   Post to a wall? Define the completion side-effects.
8. **Child-safety guardrails** (see §6) — what's the minimum bar to ethically and
   legally let a remote adult tag youth video?
9. **Scope unit.** Per game (recommended) vs per video vs a multi-game package /
   ongoing "tag all my season" retainer.
10. **Quality/trust.** Ratings, repeat-tagger relationships, dispute handling,
    and what happens to the work if a job is abandoned (team-owned content
    survives — the tagger leaving doesn't delete the clips).

---

## 8. Suggested build order (if/when we do it)

The companion doc's build order still holds for the **authz + tag-edit** layer.
This spec adds the workflow layer on top, in roughly this order:
1. `tagging_jobs` table + status enum + RLS (owner + assigned tagger only) — additive.
2. Wire `video_tagging_rights` into RLS (`can_tag_video()` OR-branches) — from companion doc.
3. Owner "assign a tagger" flow (code/email + due date + instructions) → creates job + grants.
4. Tagger dashboard + job detail (instructions + thread + Start tagging + Mark complete).
5. Owner review + Request-changes / Finalize handshake + queue-visibility rule.
6. `tagging_job_messages` (private thread) — can land with step 4.
7. Completion side-effects (tagging_complete, notify, export unlock).
8. RevenueCat `tagger` entitlement gate (post-launch).

> Independent high-value piece (from companion doc): the **tag review/edit
> surface** (fix a wrong tag, re-time a clip) is valuable to *every* coach today,
> not just taggers — worth shipping first, regardless of this workflow.
