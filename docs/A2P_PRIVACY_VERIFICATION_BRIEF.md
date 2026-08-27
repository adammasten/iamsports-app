# Twilio A2P 10DLC — "compliant privacy policy cannot be verified" — full brief

A self-contained summary for an outside reviewer. Goal: figure out why a Twilio
A2P 10DLC campaign keeps failing verification of the privacy policy, despite
multiple fixes. Written 2026-08-26.

---

## 1. The problem, in one line
Every time we submit our A2P 10DLC campaign, it is rejected with the identical
reason: **"The campaign submission has been reviewed and rejected because a
compliant privacy policy cannot be verified."** As of the latest attempt,
Twilio's *pre-check* now warns: *"Our pre-check was unable to verify some of the
information you provided."*

## 2. Business & product context
- **Product:** IamSports — a youth-sports app where adult coaches and parents
  upload game film and manage team schedules. Adults only; children do not have
  accounts.
- **Legal entity:** I AM SPORTS LLC (Austin, TX). D-U-N-S 14-707-0567.
- **Tech:** Expo / React Native + Supabase. The web app is a static-exported
  single-page app (SPA) hosted on **Vercel**, served at **iamsports.com**.
- **Campaign type:** A2P 10DLC **Low Volume Mixed**. Opt-in is **in-app** (a
  consent checkbox on a "Text alerts" screen), not a public web form.
- **What the texts are:** team schedule alerts only — game/practice
  added/moved/canceled + occasional snack reminders. ~2–6 msgs/family/month. No
  marketing.

## 3. The privacy policy content (this part is NOT the problem anymore)
The policy is published and includes a dedicated **"Text message (SMS) alerts"**
section containing every carrier-required element, verified present:
1. Mobile numbers are collected for text alerts
2. Message types + program description
3. Message frequency (~2–6/month)
4. "Message and data rates may apply"
5. STOP to opt out / HELP for help
6. **The key clause:** "We do not sell, rent, or share your mobile phone number
   or your SMS opt-in information with third parties or affiliates… never shared
   with any third party."
Plus the business name "I AM SPORTS LLC" and a contact email.

## 4. What we've tried, in order, and the result
1. **Original submission** pointed the campaign at `iamsports-app.vercel.app/privacy`.
   That page's policy had **no SMS/messaging language at all.** → We added the SMS
   section above. **Rejected again (same reason).**
2. **Discovered the domain was wrong.** The app's code referenced a dead domain
   (`iamsports.app`, which is *unregistered* — confirmed via DNS NXDOMAIN + the
   .app registry returning 404). The real, live, branded domain is
   **`iamsports.com`** (owned via GoDaddy, pointed at Vercel). We repointed the
   campaign's privacy/terms URLs to `iamsports.com/privacy` and `/terms`.
   **Rejected again (same reason).**
3. **Inspected what a verifier actually receives** (instead of just the page text)
   and found THREE concrete delivery defects:
   - **(a) HTTP 308 redirect:** `iamsports.com/privacy` → `www.iamsports.com/privacy`.
     A verifier that doesn't follow redirects sees a redirect, not a policy.
   - **(b) App-shell wrapper:** the `/privacy` route is an SPA screen, so the
     served HTML contains the app UI — a top bar, "Pick a team", and a
     `role="tab"` bottom nav — around the policy text. It reads as an app screen,
     not a standalone published policy.
   - **(c) No discoverable link:** visiting `iamsports.com` (logged out) renders
     the app shell with **no privacy/terms link anywhere** on the page.
4. **Built clean standalone static pages** to eliminate (a), (b), (c):
   - New plain-HTML pages (no app chrome, no SPA) at
     **`https://www.iamsports.com/legal/privacy`** and **`/legal/terms`**,
     served directly from Vercel's static output.
   - Added a visible **Privacy · Terms footer** on the login + landing pages
     linking to those clean pages.
5. **Latest:** Twilio's pre-check now warns it "was unable to verify some of the
   information." **Prime suspect:** the URL was entered **without `www.`** — see
   §5, the apex still 308-redirects.

## 5. Current verified technical state (HTTP-level evidence)
```
curl -sI https://iamsports.com/legal/privacy       → HTTP 308, Location: https://www.iamsports.com/legal/privacy
curl -sI https://www.iamsports.com/legal/privacy   → HTTP 200   (clean, no redirect)
```
- The **apex** domain (`iamsports.com`, no www) **308-redirects to `www.`** for
  ALL paths. Vercel treats `www.` as the canonical host.
- The **`www.` standalone pages** return **HTTP 200**, contain the full policy +
  SMS section + "I AM SPORTS LLC", and have **no app chrome** (verified: 0
  occurrences of `role="tab"` / "Pick a team" in the raw HTML).
- The old SPA route `www.iamsports.com/privacy` still returns 200 but with the
  app-shell HTML around the policy.

## 6. The exact campaign form values currently entered
- **Privacy URL:** `https://iamsports.com/legal/privacy`  ← NOTE: may be missing `www.`
- **Terms URL:** `https://iamsports.com/legal/terms`  ← same
- **Description:** "IamSports sends youth-sports teams their own schedule and
  logistics alerts. Coaches and parents opt in inside the app; the app texts them
  when a game or practice is added, moved, or canceled, plus occasional reminders…
  ~2–6 messages per family per month. No marketing, no third-party content."
- **Sample 1:** "IamSports: Warriors 14U — Saturday's game vs Rivals moved to 7:00
  PM, Field 4. Reply STOP to opt out, HELP for help."
- **Sample 2:** "IamSports: You're on snacks for Saturday's game vs Rivals (10:00
  AM). Msg & data rates may apply. Reply STOP to opt out, HELP for help."
- **Content flags:** Embedded links / Phone numbers / Direct lending / Age-gated =
  ALL UNCHECKED (messages contain none of these).
- **Opt-in method (verbatim field):** "Users opt in inside the IamSports app, on
  the 'Text alerts' screen (Account → Manage text alerts). The screen shows a
  mobile number field and an unchecked consent checkbox the user must actively
  check — 'Yes, text me my team's schedule alerts' — before the opt-in button
  ('Send my code') becomes active. The checkbox text states the message types,
  frequency (~2–6/month), 'Msg & data rates may apply,' and 'Reply STOP to opt
  out, HELP for help,' with links to the Terms and Privacy Policy. After the user
  checks the box and submits, the app sends a one-time verification code; only
  verified, opted-in numbers ever receive messages, and consent is collected
  solely for the number's own owner (never purchased or shared)."
- **Opt-in keywords:** START,YES,UNSTOP
- **Opt-in message:** "IamSports: You're opted in to team schedule alerts. Msg &
  data rates may apply. Reply HELP for help, STOP to opt out."
- **Opt-out keywords:** CANCEL,QUIT,STOP,OPTOUT,UNSUBSCRIBE,STOPALL,REVOKE,END
- **Opt-out message:** "You have successfully been unsubscribed. You will not
  receive any more messages from this number. Reply START to resubscribe."
- **Help keywords:** HELP,INFO
- **Help message:** "Reply STOP to unsubscribe. Msg&Data Rates May Apply."

## 7. Open questions for a fresh perspective
1. **Is the apex→www 308 redirect the actual cause?** i.e., does Twilio's
   pre-check / carrier vetting fail if the privacy URL 3xx-redirects, even to a
   valid page? (Fix would simply be: always use the `www.` URL — or remove the
   apex→www redirect in Vercel.)
2. **Does A2P vetting require the privacy policy be hosted on the exact
   brand-registered domain?** (Our brand may have been registered with a specific
   website value — is there a mismatch?)
3. **Could the flagged field be something OTHER than the privacy policy** — e.g.,
   the business website, or the **in-app opt-in** (which is not a publicly
   viewable web form, so a reviewer can't independently see the consent flow)?
   The reason string always says "privacy policy," but is that reliable?
4. **Is in-app-only opt-in a problem for Low Volume Mixed?** Would a public
   web-based opt-in page (showing the consent language) be required/safer?
5. **Any known Twilio Low Volume quirk** with SPA/static hosting, or with the
   `.com` vs `www.` canonical-host redirect?
6. Is the **help message** too thin (no brand/contact) enough to trip a check?

## 8. What we believe is true
- The privacy policy **content** is compliant (has the SMS section + non-sharing
  clause).
- A **clean, standalone, non-redirecting** version exists and is verified live at
  `https://www.iamsports.com/legal/privacy`.
- The most probable remaining issue is the **`www.` vs apex redirect** (the URL
  must be entered with `www.`), OR that the failing field is not actually the
  privacy policy at all despite the error text.
