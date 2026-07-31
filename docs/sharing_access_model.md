# Sharing & Access Model (LOCKED)

The authoritative model for who owns content, who can tag it, and how it reaches walls.
Locked across the June 5 `shares` design + later refinements. This is the durable source of truth — do not re-derive from chat.

## Core principle: walls are VIEWS over shares, never auto-collected
Nothing lands on a wall automatically. A wall is a filtered view of content that someone **deliberately shared** to a given audience. Content appears on a wall ONLY because a `shares` row points it there. Tags never flow to a wall on their own.

## The pipeline (raw → produced → placed)
1. **Raw footage** — a game/session video is uploaded.
2. **Tags** — markers inside a game video ("this is where #32 made a three"). A player can be tagged 100x in one game. Tags are tied to a **jersey number / role (#32), NOT to the person** — so they survive a kid leaving (the team keeps #32's tags; they were never "Lars's wall content"). Tags are raw material that live in the game and flow nowhere by themselves.
3. **Produced highlight** — someone deliberately filters tags ("all of #32's threes") and produces a highlight reel. An act of creation.
4. **Deliberate placement (share)** — the producer chooses where the finished reel goes by creating a `shares` row with an `audience`. THIS is the only way content reaches a wall.

## Ownership (who owns the content)
- **Parent/personal upload:** the video belongs to the **uploader's account** (`uploaded_by_user_id`), `team_id = null`. The parent owns it and can do whatever they want with it — post to their kid's wall, keep private, etc. — **even if it's footage of a team they're connected to.** Tagging it to a kid is optional.
- **Coach/admin/assistant-coach upload (team content):** team-owned (uploader recorded for attribution, not ownership). A departing coach can't delete team film (the "hostage problem" is impossible).

## Tag visibility is coach-controlled (the key access lever)
When a coach/admin/assistant-coach uploads + tags a game:
- They decide **who can view/sort the tags** — and the default can be **no one** (only they see the tags).
- When tag visibility is closed, **only they (coach/admin/granted taggers) can produce breakdown/highlight videos** from those tags.
- This is the master-doc "allow players to sort their own tagged clips" toggle (default OFF). When ON, a permitted parent/player can filter the game's tags → produce a highlight → then deliberately share it.
- **Sorting tags is the (coach-permitted) on-ramp to PRODUCING a highlight — it is not itself a wall feature.**

## Once a highlight is produced — the coach chooses where it goes (the `audience`)
Every produced reel requires a deliberate placement decision. Audiences:
- **Personal / nobody** — no share row (lives in the library, shared nowhere). Coach-only / staff = `audience='coaches'`.
- **A specific kid (individual share)** — `audience='player'`, `target_player_id` set. Shared just between coach and that family. **Youth-safety rule:** a *coach's* share to a kid starts `hidden_by_family=true` — delivered (family sees it arrived) but NOT shown on the kid's public wall until the family unhides it. The family controls that flag; the coach cannot.
- **Team wall (private)** — `audience='team'`. Only team members + accepted/paying followers see it.
- **Public** — `audience='public'`. Anyone, no login (the growth engine). Never full games.

The simple framing the coach sees: **Public / Private (team) / Individual (one family)** — plus coaches-only and "nobody."

## The `shares` table (June 5 lock)
Walls are SELECTs over this; content never moves.
- `content_type` (reel/video/clip) + `content_id` — polymorphic pointer
- `team_id`, `season_id` (nullable, context)
- `audience` — public | team | player | coaches
- `target_player_id` — set when audience='player' (whose wall / who it's for)
- `shared_by_user_id`
- `hidden_by_family` (bool, default false) — coach→player shares start TRUE (youth-safety)
- `visible` (bool, default true) — soft toggle for recall/hide without deleting
- UNIQUE(content_type, content_id, audience, target_player_id)

Rules that fall out of this:
- **Change visibility anytime** = add/remove/flip share rows. Reel never moves.
- **Recall / unshare** = set `visible=false` (non-destructive, reversible).
- **Same reel on multiple walls** = multiple share rows.
- **Family-created shares** (parent posts own upload to kid's wall) = coach can't remove (RLS: only family deletes family-created shares).

## Taggers (paid, per-video access — MUST be remembered)
People who are NOT roster members pay to tag videos on behalf of a team:
- A tagger pays (~$4.99/$5.99) for **time-limited access** to specific videos to tag them for coaches.
- A tagger is a **per-video GRANT, never a roster member** (`video_tagging_rights`): `can_tag`, `names_hidden` (sees numbers not names), `status` (active/revoked/expired), `expires_at`.
- A tagger **owns nothing** and their access is revocable/expiring. Watching ≠ tagging.
- This is how "people who tag on behalf of the team" are modeled — keep this in mind whenever access/ownership is designed.

## Why ownership + tag-control + deliberate-share matter together
- Tags belong to the team's footage and a jersey number → can't be auto-bound to a person's wall (person and number are decoupled by design).
- Coach controls who can even see/produce from tags → privacy by default.
- Every wall appearance is a deliberate `audience` choice → no accidental exposure of a minor's content.
