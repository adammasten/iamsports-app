# App Store Connect — Age Rating + App Privacy (paste-ready)

Verified against the live DB + `package.json` on 2026-08-28. Two ASC sections:
**(1) Age Rating** questionnaire, **(2) App Privacy** ("nutrition") labels.

---

## 1) AGE RATING

**Do NOT enroll in the Kids Category.** IamSports is an adult-operated tool
(coaches/parents manage youth film — Hudl model); children are not users. The
Kids Category triggers COPPA-grade requirements and bans normal analytics/ads —
we don't want it. Stay in the standard category with a **13+** rating.

### Content questions — answer NONE / lowest for all of these:
- Cartoon or Fantasy Violence — **None**
- Realistic Violence — **None**
- Sexual Content or Nudity — **None**
- Profanity or Crude Humor — **None**
- Alcohol, Tobacco, or Drug Use — **None**
- Mature/Suggestive Themes — **None**
- Horror/Fear — **None**
- Gambling — **None**
- Contests — **None**
- Medical/Treatment Info — **None**
- Unrestricted Web Access — **No** (the app has no open web browser)

### Capability questions (the ones that set the floor) — answer truthfully:
- **User-generated content** — **YES.** Coaches upload video and post to walls;
  users write messages, notes, captions.
  - Moderation controls in place: **report content**, **block user**, an
    accepted **EULA with zero tolerance for objectionable content**, and content
    is **team-private** (no public feed).
- **Messaging / communication between users** — **YES** (team message board).
- **In-app purchases** — **No** (RevenueCat is post-launch; not in this build).

### Expected result: **13+**
User-generated content + user-to-user messaging is what lifts this above 4+/9+.
The private, adult-operated, moderated design keeps it at 13+ rather than higher.
Answer truthfully — Apple rejects apps that understate UGC/messaging to get a
lower rating. If the questionnaire lands on a different number, take what it
gives; do not hand-tune it downward.

---

## 2) APP PRIVACY (nutrition labels)

Headline: **Data Used to Track You = NONE.** There are no analytics, ad, or
attribution SDKs in the build (verified — nothing in package.json), so there is
**no tracking** and **no ATT prompt required.**

For every data type below: **Linked to the user = YES**, **Used for tracking =
NO**, **Purpose = App Functionality** (unless noted).

### Data collected (declare these):

| Data type (ASC path) | Why we collect it |
|---|---|
| **Contact Info → Email Address** | Account creation / sign-in (Supabase Auth) |
| **Contact Info → Name** | The user's display name + roster/player names coaches enter |
| **Contact Info → Phone Number** | **Opt-in** SMS schedule alerts + snack reminders (verified opt-in flow) |
| **User Content → Photos or Videos** | The core product: game film, clips, highlight reels, thumbnails |
| **User Content → Other User Content** | Messages, clip notes, tags, captions |
| **Identifiers → User ID** | The Supabase account ID that ties a user to their content |

For each of the six rows, in the ASC flow choose:
- "Is this data linked to the user's identity?" → **Yes**
- "Is this data used to track users?" → **No**
- Purpose → **App Functionality** (Phone Number may also list
  "Customer Communications" if offered — App Functionality alone is fine)

### Data NOT collected (do not declare):
- **Location** — none. (Event venue is free-text a coach types, not device GPS.)
- **Financial / Payment Info** — none (no purchases in this build).
- **Health & Fitness** — none.
- **Browsing/Search History** — none.
- **Contacts (address book)** — none (accessing the photo library to pick a
  video is not "Contacts" and is not collecting the library).
- **Diagnostics / Usage / Crash data** — none (no analytics or crash SDK).
- **Device ID / push token** — **not in this build** (push is stripped;
  `device_push_tokens` exists but no token registers). **Add "Identifiers →
  Device ID" only when push is activated in a future build.**

### Third-party note (no "data sharing" to declare):
SMS is sent via **Twilio acting as a service provider/processor** on our
instructions — not sold or shared for marketing (see the SMS consent page). This
is not "sharing" for label purposes, so **do not** check any data type as
"shared with third parties."

---

## Notes for Adam
- When you turn **push notifications** on in a later build, come back and add
  **Identifiers → Device ID** to the privacy labels.
- If you add **RevenueCat / subscriptions**, add **Purchases** and possibly
  **Identifiers → Purchase/User ID** at that time.
- These labels must match the app's **Privacy Policy** at
  https://www.iamsports.com/legal/privacy.html — they're consistent as written.
