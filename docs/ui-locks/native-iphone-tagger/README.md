# Approved runtime screenshots — native iPhone tagger

Visual references for the lock in
[`docs/NATIVE_IPHONE_TAGGER_UI_LOCK.md`](../../NATIVE_IPHONE_TAGGER_UI_LOCK.md).

```
APPROVED BUILD:  76  (version 1.0.0)
APPROVED COMMIT: 56da2f27b5d93f5e275e0c2e126aef153cf51c9a
APPROVED BY:     Adam Masten, 2026-09-29
```

## STATUS: SCREENSHOTS NOT YET ADDED

**Adam's approved Build 76 runtime screenshots still need to be placed here.**

The session that created this lock did not have access to the approved Build 76
runtime captures, and did not fabricate substitutes. Earlier screenshots from
this project were Build 73 — they show the **defects** this lock exists to
prevent (covered tag-nav, Save clip / + Group collision, Basketball's stacked
period circles), so they are not usable as the approved reference.

## What to add

Capture from the Build 76 phone runtime, tags visible, on a video that **has
saved clips** so the scrub-bar markers and `◄ Tag / Tag ►` are present:

| Filename | Contents |
|---|---|
| `football-approved-build-76.png` | Flag Football, OFF phase, DN/DIST/DR visible |
| `basketball-approved-build-76.png` | Basketball, OFF phase, sticky Their Defense lit |

Optional, and useful for the parts a single frame cannot show:

| Filename | Contents |
|---|---|
| `bottom-rail-approved-build-76.png` | The full rail: time → `◄ Tag` / `Tag ►` → Start/End |
| `zoom-hidden-chrome-build-76.png` | Chrome hidden, video pinch-zoomed |

Then delete this status section and list what was added.

## Why this directory exists

**RUNTIME SCREENSHOTS > SOURCE-CODE ASSUMPTIONS.**

A future implementation is not equivalent because its JSX or styles look
equivalent. Three TestFlight builds in this sequence had source that read
correctly and a screen that did not: the tag-nav buttons rendered in the JSX and
were invisible on the device, twice for a layout reason and once because a
malformed query made their render gate false. These images are the evidence a
future change is compared against.
