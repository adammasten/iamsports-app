# Approved runtime screenshots — mobile web tagger

Visual references for the lock in
[`docs/MOBILE_WEB_TAGGER_UI_LOCK.md`](../../MOBILE_WEB_TAGGER_UI_LOCK.md).

```
APPROVED COMMIT: 0a5a517812443dfb3f1ed15a2ac3a3814598b55c
APPROVED BY:     Adam Masten, 2026-09-30
PLATFORM:        phone browser (isPhoneFrame), iPhone landscape
```

## STATUS: SCREENSHOTS NOT YET ADDED

**Adam's approved runtime screenshots still need to be placed here.**

The session that created this lock did not have the approved captures and did not
fabricate substitutes. The only mobile-web screenshot it received during the
sequence predates several of the fixes, so it shows the **defects** this lock
exists to prevent (browser chrome eating the viewport, unreachable last tags,
white right-rail glyphs) and is not usable as the approved reference.

## What to add

Capture from the deployed phone browser in landscape, on a video that **has saved
clips** so the scrub markers and `◄ Tag / Tag ►` are present:

| Filename | Contents |
|---|---|
| `flag-approved-0a5a517.png` | Flag Football, OFF phase, DN/DIST/DR visible, chrome visible |
| `basketball-approved-0a5a517.png` | Basketball, OFF phase, sticky Their Defense lit |
| `inspection-approved-0a5a517.png` | Chrome hidden, video zoomed, `TAG ↑` chip visible |

Optional and useful:

| Filename | Contents |
|---|---|
| `bottom-rail-0a5a517.png` | The full rail: time → `◄ Tag` / `Tag ►` → Start/End |
| `column-scroll-0a5a517.png` | A 6-column sport scrolled to its last tag |

Then delete this status section and list what was added.

## Why this directory exists

**RUNTIME IS THE SOURCE OF TRUTH.**

Five deploys in this sequence shipped with every static guard green and the phone
still wrong. Two of the defects were invisible to source reading — a missing
`playsinline` attribute, and a video player that discards the `play()` promise —
and one was caused by an earlier fix in the same sequence. These images are the
evidence a future change is compared against.
