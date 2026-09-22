# Flag Football Tagger — Reference (APP / native)

> Snapshot of the **native app** tagging screen (`app/tagging-overlay.tsx`) for
> **Flag Football**, taken 2026-09-05. Tags are from the LIVE database; controls
> are from the live code. Edit this file freely — it's our source of truth to go
> back to. (A basketball version can follow.)

---

## THE 5 TAG COLUMNS (the board you tag from)

Order on screen: **Formation · Play · Defense · Result · Players**. Every tag is
**groupable** — tap several, hit **+ Group**, and they bundle together on one clip
("Conrad + Slant + Touchdown"). Nothing here is single-select.

### 1. Formation (8)
- Trips
- Bunch
- Empty
- Spread
- Stack
- Motion
- Deuce
- Trey

### 2. Play (31)  ← offense play calls + special-teams plays live here now
**Offense:**
- Slant
- Out
- Post
- Corner
- Go / Fly
- Hitch / Curl
- Wheel
- Crosser / Drag
- Screen
- Run / Rush
- QB scramble
- Handoff
- Reverse / Trick
- Play action
- Rollout
- Jet Sweep
- RPO
- Run Left
- Run Right
- Run Inside
- Run Outside
- Sweep / Toss
- Option / Read

**Special teams (folded into Play):**
- Kickoff
- Punt
- Field Goal
- PAT
- Kick Return
- Punt Return
- Onside
- Fake

### 3. Defense (7)
- Man
- Zone
- Blitz
- Cover 2
- Cover 3
- Combo
- Safe

### 4. Result (31)  ← what happened; offense + defense + special-teams outcomes
**Offense outcomes:**
- Touchdown
- Passing TD
- Rushing TD
- Completion
- Deep completion
- Big gain (20+)
- First down
- 2-pt conversion
- Drop
- Incompletion
- INT thrown
- Fumble

**Defense outcomes:**
- Flag pull
- Missed flag pull
- Sack
- TFL (behind LOS)
- Pass breakup
- Interception
- Forced fumble
- Fumble recovery
- QB pressure
- Stop / turnover on downs
- Safety

**Special-teams / general outcomes:**
- Return TD
- Block
- Good
- Miss
- Muff
- Downed
- Tackle
- Penalty

### 5. Players (your roster — the "Vs Ravens Week 1" team, 12)
*(No jersey numbers set yet — add them and they'll show on the chips.)*
- Carter Hudson
- Conrad Masten
- Dillon Trammell
- DJ Anderson
- Jackson Schneider
- Jackson Tochman
- Luke Shotwell
- Moses Kanneganti
- Rhett Williamson
- Shepherd Park
- Speller Haley
- Tommy Allen

---

## STAMPS (sticky — set once, auto-applied to every clip you save)

### Possession — OFF / DEF / SP  (top-left, next to the quarters)
- **OFF** = Offense
- **DEF** = Defense
- **SP** = Special Teams
One at a time; tap again to clear. This is the offense/defense/special-teams
marker export will use to split the film.

### Quarters / Halves (period)  (top-left cluster)
- Q1
- Q2
- Q3
- Q4
- 1H
- 2H
One at a time; sticky; stamps every saved clip.

---

## CLIP TOGGLES (right-edge strip)

- **☆ / ★  Highlight** — star this clip (reel-worthy).
- **!  POE** — Point of Emphasis (teaching moment).
- **+ Group** — bundle the currently-selected tags into one group, then start a
  fresh group. A badge on the button shows how many groups are staged.
- **TAG ↑ / ↓** — grow / shrink the tag panel (compact ↔ fullscreen).

---

## SAVE

- **Save clip** — writes the clip with all its groups + stamps. Shows
  **"Save clip (N)"** when N tag-groups are staged.

---

## VIDEO / TRANSPORT CONTROLS (bottom row)

- **Time readout** — `0:00 / 0:00` (current / total).
- **-5s**, **-1s** — rewind (press and hold to repeat).
- **▶ / ❚❚** — play / pause.
- **+1s**, **+5s** — forward (press and hold to repeat).
- **Speed** — cycles **1× → 1.2× → 1.5× → 2×**.
- **◄ Tag** / **Tag ►** — jump to the previous / next already-tagged clip
  (only shows once at least one clip exists).

### Set the clip window
- **Start** — sets clip start at the playhead (shows **"Start 0:00"** once set).
- **End** — sets clip end at the playhead (shows **"End 0:00"** once set).

### Scrub bar
- Drag the thumb or tap anywhere to seek. Already-tagged clips appear as markers
  on the bar — tap a marker to jump to that clip.

### Top bar
- **←** Back.
- Active-tags readout — shows the tags currently selected (not a button).

---

## NOTES

- **iPad** shows the same controls, just tucked into bottom-corner rails (left =
  playback, right = clip actions).
- **Watch mode** hides every tag control (pure viewing).

---

## ⚠️ DECISIONS TO MAKE (edit these, then tell me)

1. **Special teams has no column of its own** right now — its *plays* (Kickoff,
   Punt, Return, etc.) sit inside **Play** and its *outcomes* (Return TD, Block,
   Good, Miss…) sit inside **Result**. You mark a play as special teams with the
   **SP** possession stamp. → Do you want SP broken out into its own column, or
   is the SP stamp + folded tags fine?
2. **Play (31) and Result (31) are long.** Want to trim, reorder, or split any?
3. **Defense (7)** — is this the set you want, or add/remove any?
4. **Jersey numbers** aren't set on the roster — want to add them?
