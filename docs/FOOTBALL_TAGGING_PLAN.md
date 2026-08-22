# Football film tagging (ODK) — build plan

Phase 3 of the multi-sport work. Signed off by Adam. The football **film tagger**:
break a game video into plays, each classified **ODK (Offense / Defense /
Kicking)** with the situational columns coaches filter on. Distinct from
basketball's tag-a-highlight tagger, which stays untouched.

## Model (in our schema)
- A **play = a `clip`** (start/end on a video). Reuse the clip + its `period` (quarter),
  `note`, `is_starred` (highlight), `is_point_of_emphasis`.
- A new **`clip_football`** row (1:1, cascade-deletes with the clip) holds the ODK
  breakdown. **ODK is the backbone** — it decides which columns matter.
- Dropdown options come from the football tag vocabulary already seeded in
  `lib/core/playbook/tags.ts` (formations / fronts / play types).

`clip_football` columns: `odk` (req), `down`, `distance`, `yard_line` (1..99;
red zone = ≥80), `play_type`, `gap`, `off_formation`, `def_front`, `result`,
`gain_loss`, `drive_id`, `opp_formation`. RLS mirrors `clips`.

## Confirmed decisions
1. **Both platforms** — the existing web tagger (`tagging-overlay.web.tsx`) AND
   the mobile tagger (`tagging-overlay.tsx`). (The separate "web tagging studio"
   redesign is a different, later thing.) Web is testable immediately.
2. **v1 column set:** ODK · down/distance/yard-line · play_type · formation/front
   · result · gain_loss · drive · optional opponent formation ("basic ~12 col").
3. **Opponent formation optional** — capture-capable, never required (VO's
   compromise over Gemini's mandatory two-formation-per-play).
4. **Drive grouping** — auto-start a new `drive_id` when ODK flips
   (offense↔defense), with a manual "＋ New drive" override.

## v1 vs v2
- **v1:** the columns above, captured in the tagger, shown on each clip.
- **v2 (later):** per-player attribution (passer/rusher/tackler), coverage/blitz
  detail, the 40-column "advanced" depth, **tendency reports + box score**
  (that's Phase D), a prominent Scouting Mode, auto-transitions, the web-studio
  redesign.

## Slices
1. **`clip_football` table + RLS** — DONE (`migration_clip_football.sql`).
2. **Football branch in the tagger** (both platforms): when the video's sport is
   football, show the ODK toggle + a structured panel (down/distance/yard-line
   steppers + dropdowns); write `clip_football` on clip save.
3. **Drive grouping** (auto-increment on ODK flip + manual override) + wire
   dropdowns to the football tag vocab.
4. **Show each clip's breakdown** in the clip list / review.

Football tagging only appears for football videos; basketball tagging is untouched.
