# SMS / A2P 10DLC registration — copy-paste kit for Twilio

**Decision:** 10DLC, **Brand registered under the LLC**, request **standard/external vetting**
(the vetting is what unlocks high throughput — needed for the "thousands/day" target).
This is the multi-week long pole; start it now. SMS was always post-launch, so the
timeline doesn't threaten Sept 9.

## Step 0 — Twilio account
1. Create a Twilio account (business, under the LLC).
2. Console → **Messaging → Try it out / Senders → A2P 10DLC**.

## Step 1 — Register the BRAND (your LLC)
Use the LLC's legal details exactly as on the EIN paperwork:
- **Legal business name:** {LLC legal name}
- **Business type:** Private company / LLC
- **EIN (Tax ID):** {LLC EIN}
- **Business address / phone / website:** {…} / {…} / iamsports.com
- **Business email:** {your support email}
- **Brand vetting:** request **Standard vetting** (external vetting via Campaign
  Registry / WMC). Higher trust score → higher messages-per-second. Worth it for scale.

## Step 2 — Register the CAMPAIGN (the use case)
- **Use case:** **Mixed / Low Volume Mixed** → if offered, **"Customer Care" + "Account Notifications"**
  (schedule/logistics alerts to opted-in team members). Avoid "Marketing."
- **Campaign description (paste this):**
  > IamSports sends youth-sports teams their own schedule and logistics alerts. Coaches
  > and parents opt in inside the app; the app texts them when a game or practice is
  > added, moved, or canceled, plus occasional reminders (e.g. "you're bringing snacks
  > Saturday"). Recipients choose to receive texts during team sign-up and can reply
  > STOP at any time. Roughly 2–6 messages per family per month. No marketing, no
  > third-party content.

- **How do end users consent? (paste this):**
  > Consent is collected in-app. When an adult joins a team or is invited, they see a
  > "Receive text alerts?" toggle and enter their own mobile number, which is verified
  > by a confirmation text. Only verified, opted-in numbers receive messages. Every
  > message supports STOP to opt out and HELP for support.

- **Opt-in type:** Web form / in-app (not purchased lists).

- **Sample messages (carriers require 2–5 realistic samples — paste these):**
  1. `IamSports: Warriors 14U — Sat game vs Rivals moved to 7:00 PM, Field 4. Reply STOP to opt out.`
  2. `IamSports: Warriors 14U — Sunday's practice is CANCELED. Reply STOP to opt out.`
  3. `IamSports: You're on snacks for Saturday's game vs Rivals (10:00 AM). Reply STOP to opt out.`
  4. `IamSports: New game added — Warriors 14U vs Storm, Fri Sep 12 6:30 PM. Reply STOP to opt out.`
  5. `IamSports: Reply STOP to unsubscribe, HELP for help. Msg&data rates may apply.`

- **Opt-in / opt-out / help language** (must be truthful and present in traffic):
  - Opt-out keyword **STOP** → "You're unsubscribed from IamSports alerts. Reply START to resume."
  - Help keyword **HELP** → "IamSports team alerts. Support: {support email}. Msg&data rates may apply. Reply STOP to opt out."

## Step 3 — Number + Messaging Service
- Buy a 10DLC long code (~$1.15/mo). For scale, create a **Messaging Service** and add
  the number to it (later you add more numbers to the pool for throughput — the app
  sends via the Messaging Service SID, not a single From number).
- Attach the number/Messaging Service to the approved Campaign.

## Step 4 — Give the app 3 secrets (Supabase → Edge Functions → Secrets)
Exactly like the Anthropic key. The app never sees them; they live server-side.
- `TWILIO_ACCOUNT_SID`  = AC… (Console dashboard)
- `TWILIO_AUTH_TOKEN`   = the auth token (Console dashboard)
- `TWILIO_FROM`         = the **Messaging Service SID** (MG…) *or* the +1 number
- (I'll wire the STOP + delivery-status webhook URLs into the number/Messaging Service.)

## What happens when approval lands
The SMS code is already built and wired (dispatcher, opt-out/STOP, delivery status,
verification, gating). The day the campaign is approved and the 3 secrets are set, SMS
starts flowing for "gravity" changes (canceled / time / venue) + snack reminders — no
further code needed. Until then those rows are marked `skipped: no_sms_config`, harmless.
