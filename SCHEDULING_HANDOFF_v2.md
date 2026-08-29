# SCHEDULING_HANDOFF_v2.md — architecture pushback + reconciled build plan

**Author:** Claude Code (grounded in the *live* IamSports codebase + Supabase schema, verified via MCP on 2026-08-24).
**Purpose:** This supersedes the framing of the original `SCHEDULING_HANDOFF.md`. That doc is good product thinking but was written **greenfield** — it does not know that ~60% of it is already built and live. Followed literally it would create parallel tables that duplicate production and cause repo↔DB drift. Read this first. Hand this to any AI before it writes a line.

**Prime directive for anyone building from this:** the schedule already exists. You are *extending* it, not creating it. Map every new thing onto the live tables named below. If you catch yourself writing `CREATE TABLE schedule_events`, stop.

---

## 0. GROUND TRUTH — what is already LIVE (do not rebuild)

Verified against Supabase project `wscfpkaltajnrhiusoze`.

| Concern | Live object(s) | Notes |
|---|---|---|
| Schedule events | **`events`** table (unified typed: game/scrimmage/practice/tournament_game/team_event) | Game-family events keep a 1:1 **`games`** row via `games.event_id`. Nullable times, `time_status`, `event_timezone` (IANA), `status` (scheduled/completed/canceled/postponed), `version` + touch trigger, `series_id` (recurrence), `tournament_id`. **This is the schedule. Use it.** |
| Availability (in/out/maybe) | **`event_attendance`** (event_id, player_id, responder_user_id, rsvp_status ∈ going/maybe/out) | The doc's "Phase 8 event_availability" is THIS, already shipped. |
| Coach CRUD + parent read-only | `app/edit-event.tsx` (coach-gated), `app/(tabs)/schedule.tsx` (agenda + RSVP + headcount) | Cancel-not-delete already enforced. |
| AI ingestion | Edge fn **`extract-schedule`** (Anthropic vision) → **`app/import-schedule.tsx`** mandatory review screen → confirm → insert | **Photos/screenshots only.** No PDF yet. Per-user 10/day rate limit via `schedule_import_log`. Never auto-publishes (review is mandatory). |
| Push tokens | **`device_push_tokens`** (user_id, token UNIQUE, platform) — **per device**, user-owned RLS | Registered on login (`lib/native/push.ts` → `usePushRegistration`). |
| Push send | Edge fn **`send-push`** (team-scoped: caller must be confirmed coach; recipients resolved from roster server-side; Expo push API, batches of 100) | Client helper `lib/core/push.ts` `sendTeamPush()`. |
| Change alerts / RSVP nudge | Wired in `edit-event.tsx` (edit/cancel → "notify team?") and `schedule.tsx` ("🔔 Remind to RSVP") | **These are per-action, inline sends. This is the thing to refactor (see §1).** |
| Calendar | **Static `.ics` export/download** (web) + native "Add to my calendar" (`lib/native/deviceCalendar.ts`) | NOT a subscribable feed. The doc's Phase 6 webcal feed is a real upgrade. |
| Recurrence, tournaments | Live (`create_practice_series` RPC, tournament grouping) | Bonus the doc doesn't mention. |
| Tag hide (unrelated but recent) | `team_hidden_tags` | — |

**RLS helpers that exist and must be reused:** `is_team_member(team_id)`, `is_team_coach(team_id)`, `is_super_admin()`, `is_linked_parent(player_id)`, `effective_user_id()`. There is **no `users` table** — identity is `auth.users` + **`user_profiles`** (put phone here, not on a `users` table). Guardian↔player is **`parent_player_links`**. Sharing/wall chokepoint is **`shares`**.

**Known bug already fixed this session (informs the architecture below):** RN's `Alert.alert` is a no-op on web, so inline success-then-navigate silently failed and coaches re-submitted → duplicate recurring series. The systemic lesson: **notification sends must be idempotent and decoupled from the client action.** See §1.

---

## 1. THE central pushback: build the fan-out as an OUTBOX, not inline sends

The doc's instinct ("one event, four pipes, one system not four features") is correct. But the doc leaves the *mechanism* vague, and the obvious implementation — the app calling `sendTeamPush()` inline on save, which is what we do today — is the wrong one. It already bit us (duplicate series). Do it this way instead:

### 1.1 Source the trigger from the DATABASE, not the app
Put an `AFTER INSERT/UPDATE` trigger on **`events`** that writes a row to a new **`notification_outbox`** whenever a notify-worthy change happens (created, time/venue changed, canceled). Reasons this beats app-invoked sends:
- Fires no matter which client made the change (web, iOS, AI import, a future admin tool). No "forgot to call notify()" class of bug.
- The coach's save commits instantly; it never blocks on Expo/Twilio, and a provider outage can't fail the save.
- One chokepoint = one place to get "what counts as a change" right (diff old vs new row in the trigger; ignore no-op saves).

### 1.2 Drain the outbox with a worker (cron), and make it IDEMPOTENT
A Supabase scheduled function (or Railway cron) drains `notification_outbox` every ~60s:
1. For each pending change, call `resolve_event_recipients(event_id, change_kind)` (a SECURITY DEFINER SQL function — §1.3).
2. For each (recipient, channel) it INSERTs a **`schedule_notifications`** row with a **dedupe key** `= (event_id, recipient_user_id, channel, change_kind, event.version)`. A UNIQUE constraint on that key means a retry, a double-save, or an overlapping worker tick **can never double-send**. This is the systemic fix for the whole class of bug we just patched.
3. Dispatch each queued row via its channel dispatcher (§1.4); write back `status`/`provider_message_id`/`error_code`.

### 1.3 Recipient resolution = ONE SQL function, reused by every channel
`resolve_event_recipients(event_id, change_kind)` returns `(user_id, channels[], reason)` and centralizes ALL the "who + how" logic:
- team members via `team_memberships` + guardians via `parent_player_links`
- `receives_logistics_alerts` gating (§3)
- phone-number opt-outs (§4)
- quiet-hours → sets a `send_after` per recipient in their tz (§3)
Every channel reads the same resolution. Get it right once.

### 1.4 Channels are dispatchers behind a uniform interface
`dispatch(notification_row) → {status, provider_id, error}`. Push = Expo (reuse the existing `send-push` logic, refactored to accept resolved rows). SMS = Twilio. Wall = insert an announcement row. **Adding a channel = adding a dispatcher**, never touching the fan-out. Adopt the doc's principle, but make the interface explicit and the outbox the seam.

### 1.5 DEBOUNCE — the doc misses this and it matters
A coach who edits an event 4 times in 2 minutes must NOT generate 4 texts. Coalesce: the outbox row carries a short quiet window (e.g. 90s); the worker only dispatches a change once it's been stable for that window, collapsing rapid edits into one "updated" notification. Without this, the first power-user coach spams their whole team and turns texts off forever.

### 1.6 Calendar is a PULL feed — it is NOT in the fan-out
The doc lists calendar as one of "four pipes," but architecturally it's different: nobody *sends* to a calendar. Parents subscribe to a per-team ICS URL (keyed on `teams.ics_token`) and their calendar app polls it. So the real shape is **three push-pipes (push / SMS / wall) + one always-live pull-feed (calendar)**. Do not try to route calendar through the outbox — it's a standalone read-only endpoint that renders the current `events` for a team on request. This distinction saves a real dead-end.

---

## 2. Compliance is not a "phase 5 detail" — the consent trail is load-bearing

The doc handles opt-**out** well (phone-number level, STOP = permanent — correct) but under-specifies opt-**IN**, which is the part that gets you filtered or sued.

- **Record a consent event per number.** When a parent taps "Receives text alerts? On" at invite, store `phone_consent_at`, `phone_consent_source` ('invite_toggle'), and the exact copy they agreed to. A2P/TCPA compliance is *"prove this number consented, when, and how."* Without the trail you're exposed. This is a genuine gap in the doc.
- **A2P 10DLC is the critical-path long pole and it has NOT been started.** The doc says "should already be underway" — it isn't. Nothing about SMS can be *tested* until a Brand + Campaign clear the carriers (days-to-weeks; vague campaign descriptions are the #1 rejection cause). **Start registration today, in parallel with everything else.** I can draft an honest campaign description ("youth-sports team schedule alerts, opt-in via in-app team invite, ~4 msgs/family/month, STOP to unsubscribe").
- **Verification:** don't hand-roll an OTP. Either use Twilio Verify, or simpler — the *first* "You're subscribed to {Team} alerts, reply STOP to opt out" message IS the verification: if it fails, surface a bad-number warning on day one. Prefer the latter; it's free and doubles as the required opt-in confirmation.

---

## 3. Multi-adult gating + quiet hours — good ideas, two fixes

- **`receives_logistics_alerts` on `parent_player_links`, decided at invite** — keep this, it's right. But drop the "default on for the first 1–2 adults, off after" heuristic; "first two" is fuzzy and brittle. Just **ask on every invite** (the doc also says this) and default the *inviting* guardian on. The coach roster "3 of 4 adults texted" count is a good visibility feature — keep it.
- **Quiet hours need the recipient's timezone, which we don't store.** Add `user_profiles.timezone`, captured on login the same way `edit-event` already derives `DEVICE_TZ`. Quiet-hours deferral is then just a `send_after` timestamp on the notification row (hold to 7am recipient-local), which the worker already respects.
- **"Urgent bypass" should be a rule, not a coach toggle** (coaches forget toggles). Rule: **cancellations always bypass** quiet hours; **time/venue changes within N hours of kickoff bypass**; everything else defers. Derive it from `change_kind` + proximity to `starts_at`.

---

## 4. Schema deltas (map onto LIVE tables; corrections to the doc)

New tables — all reference **`events`**, not a new `schedule_events`:
- **`notification_outbox`** — (id, event_id, change_kind ∈ created/time_changed/venue_changed/canceled/custom, payload jsonb, quiet_until, processed_at). The trigger writes here; the worker drains it.
- **`schedule_notifications`** — the delivery log AND idempotency ledger. (event_id, recipient_user_id, channel ∈ push/sms/wall, dedupe_key UNIQUE, status ∈ queued/sent/delivered/failed/opted_out, provider_message_id, error_code, send_after, sent_at). Powers the doc's "14 of 15 delivered" surface.
- **`sms_opt_outs`** — keyed on **phone_number** (not user_id). Correct in the doc; keep.
- **`team_announcements`** / **`announcement_replies`** — BUT see §5; render them in the existing wall feed, don't spawn a second feed.
- **`event_snack_signups`** — the snack sign-up (§6).

Column additions (corrected targets):
- `parent_player_links.receives_logistics_alerts` boolean.
- **`user_profiles`**`.phone_number`, `.phone_verified_at`, `.phone_consent_at`, `.phone_consent_source`, `.timezone` — **on `user_profiles`, NOT a `users` table (there is no `users` table).**
- `teams.ics_token` — random, unguessable, per team. Correct in the doc.

Do **not** add: `event_availability` (exists as `event_attendance`), `schedule_events` (exists as `events`).

Every new table gets RLS from the start using the existing helpers (`is_team_member`, `is_team_coach`, `is_linked_parent`, `is_super_admin`).

---

## 5. Announcements — reuse the wall, don't build a parallel one

We already have a team wall (`shares` + content feed). If announcements live in a separate `team_announcements` table rendered on a *separate* screen, parents now have two feeds to check — exactly the "another inbox nobody reads" failure the doc rightly mocks. **Render announcements in the SAME feed as clips/content** (a new item type), even if they're stored in their own table. Investigate whether an announcement should just be a new `shares.content_type` before adding tables. Players read-only, coaches/admins post, public replies, reuse the **existing report/block moderation** (`content_reports` / `user_blocks`) rather than assuming "sunlight moderates."

---

## 6. 🍎 Snack sign-up (fold-in — Adam's explicit ask)

A first-class sibling of availability, on `events`, and a clean demo of the fan-out done right.

- **`event_snack_signups`** (event_id, claimed_by_user_id, player_id nullable, note, created_at). One open slot per event by default (config later); first family to claim it gets it.
- Coach sees per event: **"Snacks: covered by the Jensens"** / **"Snacks: open."**
- It becomes a **fan-out change_kind** like any other: a reminder fires through the same outbox — *"You're on snacks for Saturday's game vs Rivals."* No special-case code; it rides the layer built in §1.
- **Free tier**, pure engagement — pulls parents back between films.
- Tiny once §1 exists: one table + one claim button on the event + one reminder change_kind.

---

## 7. Ingestion (Phase 3) — three concrete improvements

Our `extract-schedule` + `import-schedule` review flow is live and already enforces "never auto-publish." Improvements over the doc:
- **"Confidence" should be per-FIELD uncertainty the model actually reports, not a fake 0–1 score.** Have the vision model return `uncertain: ["time","venue"]` per row; sort any row with uncertainty to the top and highlight those fields. Don't invent a confidence number the model can't produce.
- **"Add to schedule without notifying"** is now *urgent*, not optional — the moment §1 ships, a 40-event season import would fire 40 notifications. Bulk import must insert with the outbox trigger suppressed (a `notify := false` path). Build this in the SAME change as the trigger.
- **PDF: sequence it post-launch.** Text-layer + scanned-PDF handling in a Deno edge function is real work; photos/screenshots cover ~90% of real input. Ship without it, add after.

---

## 8. Revised sequence (grounded in Sept 9 + A2P reality)

The doc's Phase 0→8 assumes greenfield and puts SMS mid-stream. Given what's live and that **SMS is blocked on unstarted A2P (weeks out), your most important channel will not be ready by 9/9.** Plan around that:

**Now / Week 1 — the backbone (all launchable without A2P):**
1. `notification_outbox` + `events` trigger + `schedule_notifications` (idempotent) + `resolve_event_recipients()` + worker. Refactor the existing inline push into this layer (push dispatcher first).
2. Debounce + quiet hours (`user_profiles.timezone`) + urgent-bypass rule.
3. `receives_logistics_alerts` + ask-at-invite + roster "N of M texted".
4. **Kick off A2P 10DLC registration** (parallel, long pole).

**Week 2 — visible wins (still no A2P needed):**
5. Subscribable **`webcal://` feed** on Railway keyed on `teams.ics_token` (upgrade from static export).
6. **Wall announcements** in the existing feed + public replies (reuse moderation).
7. **Snack sign-up.**
8. Import "add without notifying" + review-screen confidence/uncertainty hardening + unsaved-work warning.

**Launch 9/9** with: push + subscribable calendar + announcements + availability + snack. That's a complete, non-crippled free tier that already "talks."

**Post-launch (first drop):** SMS dispatcher goes live the moment A2P clears — the fan-out already has the seam, so it's *just* the Twilio dispatcher + status callbacks + the three-state UI. Then PDF ingestion.

---

## 9. Keep / kill (my verdict on the doc's calls)

**Keep (good calls):** no private messaging ever (especially given minor footage + NCMEC posture); "Text coach" → native SMS handoff; delivery status on the event, no inbox; opt-out at phone-number level; free tier not crippled; locked-video shows thumbnail+tags not a grey box.

**Kill / change:**
- Kill `schedule_events` and `event_availability` (duplicate live tables).
- Kill the "never run SQL" working rule for THIS project — we have the Supabase MCP and apply migrations directly; hand-pasting SQL is pure friction. (Author's note: confirm with Adam.)
- Change "do not build cost controls" → still add a **hard rate cap** (e.g. max N sends/team/hour) so a bug can't fire 10k texts. Safety rail, not cost control.
- Change inline app-sends → the outbox (§1). This is the big one.
- De-scope PDF to post-launch.

---

## 10. Open decisions for Adam (answer before build)

1. **Migrations:** MCP direct (recommended, what we do) vs hand-pasted SQL?
2. **First build target:** the fan-out backbone (unlocks everything, less visible) vs a visible win first (snack sign-up / webcal feed) while A2P bakes? Recommendation: backbone first — everything else is trivial once it exists, and it retires the duplicate-send bug class permanently.
3. **Announcements:** new `shares.content_type` in the existing feed vs separate table rendered in the same feed? (Needs a 20-min investigation of `shares`.)
4. **A2P Brand:** register under an LLC or sole proprietor? Affects approval path/timeline.
