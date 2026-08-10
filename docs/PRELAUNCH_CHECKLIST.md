# Pre-Launch Checklist — IamSports (Sept 9, 2026)

**Purpose:** the things an AI agent will never think to ask you about. Work through this over the next six weeks.
**Written:** July 31, 2026

Legend: 🔴 blocks launch · 🟡 fix before real users · 🟢 first 90 days

---

## A. Legal & Regulatory

### COPPA — your single largest exposure
You are storing video and images of children under 13, tied to names and team affiliations. This is the highest-risk item in the whole document and it has real financial teeth.

- 🔴 Verifiable parental consent flow before any under-13 account exists — a checkbox is not verifiable consent
- 🔴 Decide the actual model: are under-13s users at all, or do parents hold the account and players are records inside it? The second is dramatically simpler to comply with. Your `players` table already has a nullable `user_id`, so the architecture supports it — make it a policy decision, not an accident
- 🔴 Privacy policy has a dedicated children's section stating what's collected, why, and how a parent deletes it
- 🔴 Parent-facing deletion that actually removes the child's video and images, not just the row
- 🟡 No behavioral advertising or third-party ad SDKs anywhere near minor accounts
- 🟡 Data minimization: don't collect a birthdate you don't need, don't collect precise location at all
- 🟡 Written retention limit — how long does a 12-year-old's video live after their parent stops paying?

### Documents
- 🔴 Terms of Service, live and linked from the App Store listing
- 🔴 Privacy policy that matches what the app **actually does** — the most common rejection cause is a policy describing an app you didn't build
- 🔴 EULA (Apple's standard is fine unless you need custom terms)
- 🔴 The marketing license clause you flagged: right to use uploaded clips in promotion, with an opt-out toggle. Get this in *before* launch — retroactively acquiring rights to existing content is much harder
- 🟡 Have a lawyer read all three. Roughly $2–4k for a youth-sports app with minors' media. This is the single highest-ROI spend on the list

### Privacy law
- 🔴 Texas TDPSA applies to you as a Texas business — sensitive data (children's data qualifies) requires consent
- 🟡 CCPA/CPRA if you have California users, which you will
- 🟡 A functioning data subject request process, even if it's just a monitored email address
- 🟢 EU/UK: skip entirely by restricting App Store territories to US + Canada at launch

### AI disclosure
- 🟢 Not in scope today — no generative AI ships in v1
- 🔴 If territories are US/CA only, EU AI Act is moot. Confirm this in App Store Connect
- 🟡 The moment AI auto-breakdown ships, revisit: disclosure, plus the `training_data_consent` boolean you already planned

### Publicity & likeness
- 🟡 Minors' images used in marketing need parental consent specifically for that purpose — separate from the ToS license grant. Some states require it in writing
- 🟢 Right-of-publicity varies by state; relevant if you ever feature a specific player in an ad

---

## B. App Store Review

- 🔴 **In-app account deletion.** Hard requirement. Rejection is automatic without it. Must be reachable inside the app, not a support email
- 🔴 Privacy nutrition labels accurate and complete, including every third-party SDK
- 🔴 Privacy manifest files for all third-party SDKs
- 🔴 Demo account with real seeded data for reviewers — an empty app gets rejected as incomplete
- 🔴 **Restore Purchases** button, visible and functional
- 🔴 Subscription screens show price, duration, and auto-renewal terms before purchase
- 🔴 Sign in with Apple offered if you offer any other third-party login
- 🔴 Age rating questionnaire answered honestly — user-generated content raises it
- 🟡 Export compliance declaration (you use HTTPS, so you're answering the encryption question)
- 🟡 If you use the Kids Category: no external links, no third-party analytics, much stricter rules. Probably avoid it
- 🟡 UGC moderation: Apple requires a report mechanism, a block mechanism, and a stated 24-hour response commitment. Your `moderationActions.ts` needs to actually be wired to something
- 🟡 Screenshots must show the real app, current build

---

## C. Security

- 🔴 The "Door #2" storage policy hole — all four verbs blanket `TO authenticated` with bucket-name-only checks. Any authenticated user can read, overwrite, or delete any video
- 🔴 `migration_retire_public.sql` actually run; the 4 live public shares gone
- 🔴 Every `getPublicUrl` call replaced with signed URLs carrying expiry
- 🔴 RLS enabled and **tested** on every table — as coach, parent, player, follower, and stranger. Enabled ≠ correct
- 🔴 Service role key confirmed absent from any client bundle. Grep the built artifact, not the source
- 🔴 `git log -p | grep` for secrets ever committed. Rotation doesn't help if the old key is in history and the repo goes public
- 🟡 Rate limiting on auth, upload, and invite endpoints
- 🟡 `npm audit` clean, or documented exceptions
- 🟡 Deep link and invite token validation — tap-to-join auto-linking is exactly the kind of flow that gets abused
- 🟡 Invite tokens expire and are single-use
- 🟢 Penetration test or a second set of eyes on the permissions model

---

## D. Operational

- 🔴 **Error monitoring in production.** You've flagged this yourself: the codebase fails silently and shows blank screens. At 1,000 users you will not know something broke. Sentry, before launch
- 🔴 Backups verified by performing an actual restore into a scratch project. An untested backup is a hope
- 🔴 A rollback plan: if build N is broken, what happens in the next 30 minutes?
- 🟡 Uptime monitoring on the Railway service and Supabase
- 🟡 A support email that reaches you, and a stated response time
- 🟡 Confirm logs don't capture PII or minors' data
- 🟡 Load sanity check: 50 concurrent uploads on a Saturday tournament morning — does Railway FFmpeg queue or fall over?
- 🟢 Documented incident process, even if it's three lines

---

## E. Data Integrity

- 🔴 Deleting a user removes their storage objects, not just their rows. **Orphaned files in buckets after row deletion is the single most common data-privacy miss in Supabase apps** — the row vanishes, the video stays, and your deletion promise is false
- 🔴 Cascade behavior verified end to end: delete a team, a player, a parent link, an account. Confirm what survives and whether that's intentional
- 🟡 Written retention policy, and 60-day post-lapse retention actually enforced by a job
- 🟡 Data export for users who ask
- 🟢 Soft-delete vs. hard-delete decided and documented

---

## F. Money

- 🔴 **Business bank account.** You still don't have one. Apple pays an entity; commingling with personal funds undermines the LLC liability shield you formed the LLC for. Mercury or Novo, this week
- 🔴 Every purchase path tested in sandbox: Universal monthly, Universal annual, Team Pass, Pro Coach, restore, expiry, refund
- 🔴 Apple tax and banking forms complete in App Store Connect — payouts don't run without them
- 🔴 Apple Small Business Program application submitted (15% vs. 30%). Free money, easy to forget
- 🟡 Team Pass is one-time, not auto-renewing — verify it does not appear as a subscription in the user's Apple settings
- 🟡 Refund policy stated; know what Apple handles vs. what you handle
- 🟢 Sales tax nexus — probably none for IAP, but ask your accountant once

---

## G. Business

- 🟡 Insurance: general liability plus cyber/E&O. A youth-sports app holding minors' video is exactly the risk profile insurers price for, and it's cheap relative to the exposure
- 🟡 USPTO trademark filing (Class 9 + 41) before launch strengthens the Apple IP dispute
- 🟡 Registered agent and entity in good standing
- 🟢 Founder IP assignment to the LLC — matters if you ever raise or sell

---

## The meta-lesson

Almost nothing on this list is a coding problem. It's context an agent can't have, because it lives in your business, your state, and your customer base.

Two habits close most of the gap permanently:

1. **A lawyer reads your three documents once.** $2–4k. Catches most of Section A, which is where the real financial risk lives.
2. **Anything on this list that can become a test, becomes a test.** "Deleting a user removes their storage objects" is assertable. Write it once and it's enforced forever, by a machine, in every future session — which is the same principle as the banned-terms linter you already invented for Ambient.

The list is how you catch it this time. The tests are how you stop needing the list.
