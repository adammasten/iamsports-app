# Web Tagging Studio — Plan (LOCKED v1)

The desktop-web tagging experience for IamSports. Goal: a **keyboard-first** studio
so a coach can rip through a backlog of games fast. This plan is the product of a
research pass (Hudl / Sportscode / Nacsport / OpenTag / NLEs) plus critique from
two independent AIs (VO + Gemini) that **converged on the same answers**, plus
codebase-grounded notes. The native mobile tagging overlay
(`app/tagging-overlay.tsx`) is **untouched** — this is a new `tagging.web.tsx`
(platform-split), reusing the existing clip-save logic.

> Status: plan locked, not yet built. Build in slices (see bottom).

## Guiding principle
**One key = one clip.** Playhead-first tagging is the *only* creation path; the
coach watches (often at 1.5–2×) and presses a tag hotkey when something happens.
Everything else (in/out, bundles) is a *refinement*, never a co-equal mode —
mode-hesitation is what kills a backlog tool.

## Existing data model (REUSE — do not replace)
- Videos belong to games (Q1/Q2/… are separate videos in one game).
- A **clip** has `start_time` + `end_time` (seconds) on a video.
- **Tags** have `category`: **offense / defense / plays / players** (4 categories —
  `plays` is real; don't forget it). Tags are per-team or global, from the DB.
- `clip_tags` join rows; `bundle_number` groups tags (0 = whole-clip; 1,2,3 =
  distinct bundles). `app/export.tsx`'s `clipMatchesGroup` depends on this.
- Per-clip flags: `is_starred`, `is_point_of_emphasis` (POE), `note` (text).
- Playback = expo-video; private signed URLs; **seeking now works on web**
  (duration-0 fallback fix already shipped in game-player + tagging-overlay).

## Locked decisions

### 1. Creation model — playhead-first, in/out as override
- Pressing a tag hotkey creates a clip **at the playhead** with an auto-window.
- If the coach has pressed **I** and/or **O**, the *next* tag consumes those exact
  bounds instead of the auto-window, then the markers clear. No visible "mode."

### 2. Pre/post-roll — 8s pre / 3s post (basketball)
The outcome (shot, turnover, steal, assist) happens at the **end** of a possession
and the coach reacts *after* seeing it → reach back, not forward. Overrides at the
**archetype** level (not per-tag):
| Archetype | Pre | Post | Example tags |
|---|---|---|---|
| Possession outcome (default) | 8s | 3s | Made/Missed shot, Turnover, Assist, Foul |
| Fast break / transition | 12s | 3s | Steal, Transition, Press |
| Set play / dead ball | 4s | 8s | Inbounds, OOB set, Free throw |
Boundary nudging (below) is cheap enough that "close enough" defaults are fine.

### 3. Multi-tag — temporal coalescing (v1); true bundles (v2)
If two+ tag hotkeys fire within **~1.5s** of each other, attach them all to the
**same clip** as `bundle_number 0` (covers "#23 + Made Shot" without any bundle UI).
True multi-entity bundles ("A scored, B assisted, kept separable on one clip") =
a deliberate **"group selected tags into bundle N"** action in the refine panel,
deferred to v2. Both are `clip_tags`/`bundle_number`-compatible → no migration.

### 4. Timeline — single lane, color-coded by category (v1)
One lane under the player; markers colored by category; click a marker to seek.
Category filter (in the clip list) dims non-matching markers. **No multi-lane** in
v1 (unreadable at 40–60 clips per 8–12 min quarter) — revisit only if asked.

### 5. Player tagging — roster palette, NOT jersey typing
Youth rosters are ~8–12 and coaches know kids by name. Jersey-number typing
introduces a mode collision with tag hotkeys — avoid. The palette's **players**
category *is* the roster (it's already tags), auto-assigned hotkeys.

### 6. Precision under web seek limits — decouple value from seek
HTML5 `currentTime` is settable sub-100ms; the real limits are seek latency +
keyframe snapping. So:
- Playhead scrub: **←/→ = ±1s**, **Shift+←/→ = ±5s**.
- Boundary nudge (clip selected): **←/→ = ±0.25s**, **Shift = ±1s** — edit the
  stored number immediately, **debounce the actual seek (~150ms / on key-up)** so
  the UI stays responsive.
- **Always show numeric values** (`04:12.25 → 04:20.00`). Basketball needs ~0.5–1s
  tolerance ("start of the possession"), not frames. Use `requestVideoFrameCallback`
  for a smoother playhead readout where available.

### 7. Anti-abandonment core (all v1 — not polish)
- **Undo (Cmd/Ctrl+Z)** deletes the most-recently-created clip. Non-negotiable —
  fat-finger + no undo is the #1 rage-quit.
- **Autosave every clip on creation.** Drop the global "dirty" concept for clips
  (keep explicit save only for the note field). Removes save anxiety.
- **Transient confirmation** — flash the new timeline marker + pulse the new row at
  the top of the clip list, so the coach trusts it without stopping to verify.
- **First-run cheat-sheet** auto-shown, plus an always-visible one-line hint strip.
- **Resume state** — persist playhead position + selected video (quarter) per game.

## Codebase-grounded notes
- **Palette is data-driven from existing tags** (offense/defense/plays/players) —
  no new roster/plumbing. `players` category = the roster buttons.
- **Autosave-per-clip is a NEW interaction** vs. the mobile batch-on-save, but
  reuses the same `clips` + `clip_tags` insert. Keep it in `tagging.web.tsx`; don't
  entangle the mobile save path.
- **Hotkeys auto-assigned at load** from the team's real tags, skipping reserved
  keys (Space, J/K/L, I/O, Z, S, P, N, Esc, Enter, ?, arrows) and flagging
  collisions. Don't hardcode tag→key.

## Desktop layout
```
┌ Studio · Game vs Oak Hill · Quarter [Q1 ▾] · Speed [1.5× ▾] · (autosaved) ┐
├───────────────────────────────────────────────┬─────────────────────────┤
│                                               │ TAG PALETTE (hotkeys)   │
│              MAIN PLAYER (~65%)               │  Players / Offense /     │
│                                               │  Defense / Plays        │
│                                               ├─────────────────────────┤
├───────────────────────────────────────────────┤ CLIP LIST (chrono)      │
│ TIMELINE (single lane, color by category) ▲   │  02:14 #23, Made Shot   │
│  [clipA]     [clipB]          [clipC]         │   ★ POE  note…          │
└───────────────────────────────────────────────┴─────────────────────────┘
```

## Keyboard registry (reserved namespace)
- **Space** play/pause · **J/K/L** shuttle rev/pause/fwd (multi-tap faster)
- **←/→** scrub ±1s · **Shift+←/→** ±5s
- **I / O** mark in / out (override next clip) · **Esc** clear markers / deselect
- **Cmd/Ctrl+Z** undo last clip · **?** toggle cheat-sheet
- **Tag hotkeys** — auto-assigned per team tag, at the playhead
- Refine (clip selected): boundary nudge ←/→ (±0.25s), **star**, **POE**, **note**
- **All app hotkeys suspended while a text field (note) is focused.**

## Build slices (each independently testable; mobile untouched)
1. **Shell + playback** — desktop layout (player left; palette + clip list right;
   timeline strip), reusing the web-working player. No tagging yet.
2. **Tag-at-playhead + autosave + undo** — the core loop: key → clip → saved →
   confirmed → undoable. This alone makes tagging possible.
3. **Timeline + clip list + refine** — markers, click-to-seek, boundary nudge,
   star / POE / note.
4. **Coalescing, archetypes, cheat-sheet, resume** — the speed + first-run polish.

## Deferred to v2
True multi-entity bundles UI · multi-lane timeline · user-customizable hotkeys ·
real-time/live tagging · auto-advance to next quarter.

## Hard constraints
- Native mobile overlay unchanged; all web work platform-split (`tagging.web.tsx`,
  `Platform.OS`/width gates).
- Reuse existing clip/tag insert + `bundle_number` semantics (export compatibility).
- Design around ~1s web seek tolerance; never rely on true frame accuracy.
