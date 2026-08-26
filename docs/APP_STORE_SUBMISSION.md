# App Store submission — prep & answers

Everything pre-filled that I can figure out from the code/DB, so the manual
Apple/NCMEC forms become copy-and-paste. Status as of 2026-08-26.

Legend: ✅ done · ⚠️ needs your action / verify · ❌ not started

---

## 1. Permission usage strings (app.json → ios.infoPlist) — ✅ mostly done

| Permission | Status |
|---|---|
| `NSPhotoLibraryUsageDescription` | ✅ present, specific |
| `NSPhotoLibraryAddUsageDescription` | ✅ present (saving reels) |
| `NSCalendarsUsageDescription` | ✅ auto-injected by the `expo-calendar` plugin config |
| `ITSAppUsesNonExemptEncryption: false` | ✅ set → skips the export-compliance prompt |
| Microphone | ✅ **not required** — app only *picks* video from the library, never records |
| `NSCameraUsageDescription` | ✅ **removed** (2026-08-26) — the camera was never used; re-add if in-app recording is built later. |

---

## 2. App Privacy "nutrition label" (App Store Connect → App Privacy) — ⚠️ you enter, answers below

Enter these in ASC. Nothing here is used for **Tracking**, and **no data is
sold**. Everything is **linked to the user** and used for **App Functionality**.

**Data collected:**
- **Contact Info → Name** — App Functionality — Linked — not for tracking
- **Contact Info → Email Address** — App Functionality — Linked — not for tracking
- **Contact Info → Phone Number** — App Functionality — Linked — not for tracking
  *(only for users who opt into SMS text alerts)*
- **User Content → Photos or Videos** — App Functionality — Linked — not for tracking
- **User Content → Other User Content** (tags, notes, comments, team/player info,
  reels) — App Functionality — Linked — not for tracking
- **Identifiers → User ID** — App Functionality — Linked — not for tracking

**Do NOT declare** (unless you add them later): advertising data, location,
browsing history, purchases, health, contacts, or any **Tracking** use. You have
no ad SDK and no cross-app tracking.

**Third-party processors** (service providers, not tracking — no ASC field, but
good to know for your policy): Supabase (hosting/DB), Railway (video rendering),
Twilio (SMS), Anthropic (the schedule-photo import sends the image to Anthropic),
Expo (push, when activated).

---

## 3. Age rating questionnaire (ASC) — ⚠️ you enter, answers below

- Made for Kids: **No**
- Cartoon/Fantasy Violence, Realistic Violence, Sexual Content/Nudity, Profanity,
  Alcohol/Tobacco/Drug use, Horror/Fear, Mature/Suggestive, Medical/Treatment,
  Gambling: **None / No** for all
- Unrestricted Web Access: **No**
- **User-Generated Content: Yes** — and note you provide **moderation**
  (reporting, blocking, and content takedown)

Expected result: **17+** (standard for a UGC app). That's fine and expected —
don't try to force it lower; a UGC app rated too low is itself a rejection risk.

---

## 4. NCMEC / CSAE reporting registration — ❌ you must register (steps below)

As a U.S.-based platform hosting user content, IamSports is an **Electronic
Service Provider (ESP)** under **18 U.S.C. § 2258A**: if you become aware of
child sexual abuse material (CSAM), you're legally required to report it to
NCMEC's CyberTipline. Your Terms already promise this — now make it real.

**What to do (one-time, ~30 min):**
1. **Register as an ESP with NCMEC** — go to the CyberTipline
   (**report.cybertip.org**) and register your company/LLC as a reporting ESP.
   You'll provide: mailing address, phone, email, and a **designated point of
   contact** (you). This gives you portal access to file reports.
2. **Pick a reporting method** — at your (tiny) scale, the **manual web form /
   portal** is enough. You do NOT need the automated API (that requires
   NCMEC-issued credentials and is for high-volume platforms).
3. **Preserve reports for at least 1 year** (REPORT Act, 2024 — up from 90 days).
4. Keep your in-app **`child_safety` report reason** (already built) as the
   intake path that would trigger a manual NCMEC report if warranted.

This is a **you** task (it's tied to your business identity). I can't register on
your behalf, but the above is the whole path.

---

## 5. Content filtering / Guideline 1.2 moderation — ✅ built, just demo it

Apple's "content filtering" for a UGC app means: users can report, users can
block, and you can remove content. You have all three:
- **Report** content (`content_reports`, incl. a `child_safety` reason) ✅
- **Block** users (`user_blocks`, filtered in read paths) ✅
- **Takedown** — flip `shares.visible` to remove reported content ✅ (reactive
  moderation via the Supabase dashboard)

Nothing to build. In App Review, be ready to **show the report + block buttons**
on shared content, and mention 24-hour action in your review notes.

---

## 6. Push notifications — ✅ clean for this build

The build **strips** the push entitlement (`plugins/strip-push-entitlement.js`
runs before `expo-notifications`), so it won't declare `aps-environment`. That's
fine for review — just **don't advertise push features** in the listing copy
that this build can't deliver. (Activating push is a separate later step.)

---

## 7. App Review notes — ⚠️ paste this (with your demo login) into ASC

> IamSports is an **adults-only** tool for youth-sports coaches and parents to
> manage and share game film and team schedules (Hudl model). Children do not
> create or use accounts. Demo login: **[email]** / **[password]**. This account
> is on a team pre-loaded with videos, a schedule, and shared content so you can
> evaluate playback, tagging, sharing, RSVP, and the schedule. Moderation:
> shared content has **Report** and **Block** actions (long-press / overflow
> menu); we act on reports within 24 hours and report CSAE to NCMEC. Account
> deletion is in **Account → Delete my account**.

**Critical:** the demo account MUST be seeded with real content — because our RLS
returns nothing for an empty account, a reviewer logging into a blank app is the
#1 rejection risk.

---

## 8. Metadata & assets (ASC) — ❌ still to create

Screenshots (real app, required sizes) · app description · subtitle · keywords ·
support URL (`iamsports.com`) · marketing URL · app icon · category (**Sports**).
Sign in with Apple is **not required** (email/password only, no social login).

---

## What only YOU can do (the remaining list)
1. Register as an NCMEC ESP (§4).
2. Create + seed the reviewer demo account (§7).
3. In ASC: fill App Privacy (§2), Age rating (§3), set Privacy Policy URL to
   `https://iamsports.com/privacy`, paste review notes (§7).
4. Create listing metadata + screenshots (§8).
5. Confirm your Apple Developer account type (Individual vs Organization/LLC —
   the LLC path needs a D-U-N-S number).
