# App Store Connect — Review Notes & Sign-In (copy-paste ready)

Paste these into **App Store Connect → your app version → App Review Information**.

---

## Sign-In Information (required — the app is fully behind login)

- **Sign-in required:** Yes
- **Username:** `demo@iamsports.com`
- **Password:** `Iamhim3232!`

This account is pre-loaded with a demo team ("Demo Warriors 14U"), a full game
with film, tagged clips, a team wall post, and upcoming schedule events, so the
core features can be reviewed immediately without uploading anything.

---

## Review Notes (paste into the "Notes" box)

IamSports is an adult-operated tool for youth-sports COACHES and PARENTS to
manage game film (Hudl model). Children are not users and do not have accounts;
adults upload and share footage. All content is private to a team — there is no
public feed.

HOW TO REVIEW THE CORE FEATURES (after signing in with the demo account above):

1. FILM ROOM — Open "Film Room" from the bottom bar. Open the game "vs Thunder."
   Tap the video to play it. Tap a tagged clip (e.g. "Transition finish") to
   watch just that moment. This is the core film + tagging feature.

2. TEAM WALL — Open "Home." The game "vs Thunder" is posted to the team's wall
   with a caption. This is where a coach shares film with the team's families.

3. SCHEDULE — Open "Schedule" to see the team's upcoming practice and game,
   with RSVP.

USER-SAFETY / MODERATION (Guideline 1.2):

- REPORT / BLOCK: Press-and-hold (long-press) any shared item on a wall to open
  a menu with "Report this content" and "Block this person." On the demo account
  the wall post was made by the demo user, so "Block this person" (which hides a
  DIFFERENT user's content) is not shown on that item — but "Report this content"
  is available and demonstrates the reporting flow. Blocking a user hides all of
  that user's content and prevents contact.
- TERMS / EULA with zero tolerance for objectionable content is presented on
  first launch and must be accepted before using the app.
- Account deletion is available in-app under Account settings.
- Objectionable-content reports are reviewed and acted on within 24 hours;
  offending content and users are removed.

CONTACT: <SUPPORT EMAIL — fill in> · Privacy: https://www.iamsports.com/legal/privacy.html · Terms: https://www.iamsports.com/legal/terms.html

---

## Notes for Adam (not for Apple)

- Fill in the **support email** above before submitting (Apple requires a
  monitored contact for a UGC app).
- The demo video is your real "Vs. THP Championship" footage, borrowed by
  pointing a demo video row at the existing storage object. If you'd prefer a
  neutral clip, upload one short video on the demo account and I'll repoint the
  demo video row + clips to it (one-line change).
- KNOWN WEB GAP (does NOT affect iOS review): Report/Block uses `Alert.alert`,
  which is a no-op on the web build — so long-press moderation silently does
  nothing in a browser. The iOS reviewer is unaffected (native Alert works), but
  this is on the pre-launch punch-list to fix for the web app.
