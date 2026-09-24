-- TAG RETIREMENT (Adam, 2026-09-23).
-- APPLIED LIVE as migration 20260923235000_tag_retirement.
--
-- A generic way to stop offering an obsolete tag for NEW tagging while keeping the
-- row, its id, and every historical clip_tags reference intact. Replaces what would
-- otherwise have been a hardcoded exception for three specific Catch rows.
--
-- SEMANTICS
--   active  = retired_at IS NULL   -> offered in My Tags and both taggers
--   retired = retired_at set       -> not offered for new tagging
--
-- Retirement is per-row and EXPLICIT. It is never inferred from scope, category,
-- sport or format, so a team's custom vocabulary can never be retired as a
-- side-effect of anything else.
--
-- WHAT RETIREMENT DOES NOT DO: Export is untouched (it loads every tag so any
-- historical id resolves), as are the `.in('id', ...)` readers that render tag names
-- on existing clips. A retired tag that a historical clip uses stays visible,
-- selectable and matchable in Export, and clipMatchesGroup is unchanged.

alter table tags add column if not exists retired_at timestamptz;

comment on column tags.retired_at is
  'When set, this tag is no longer offered for NEW tagging (My Tags / taggers). '
  'Historical clip_tags, Export discoverability and tag ids are unaffected. '
  'Retirement is explicit per row -- never inferred from scope, category or format.';

-- Retire the three obsolete receiver-catch rows. All three have ZERO clip_tags
-- references, so nothing historical can be hidden even in principle. They were
-- created via My Tags back when it only offered offense/defense/plays/players, which
-- is why a completion result ended up filed under `offense` -- a category the flag
-- board has never rendered.
--
-- The canonical row, 'Catch (Receiver)' (b64c27f8, off_result, 11 uses), stays
-- ACTIVE and is deliberately not listed here.
update tags set retired_at = now()
where id in (
  'f54963e9-99ca-475a-bb95-120cc37cb054',   -- Catch          global, flag, offense, 0 uses
  '686625f3-9b43-40e5-8a9c-3d75f1cbb7fb',   -- Catch          Regents team,  offense, 0 uses
  'c7855de5-7fd2-4e3f-af0c-8cbb5bd274f9'    -- Reciever Catch Regents team,  offense, 0 uses
);

-- Verified post-apply: exactly 3 rows retired, all with 0 clip uses, none a player
-- tag; Catch (Receiver) still active with its 11 uses; tags 556 and clip_tags 1535
-- unchanged. Regents' offered vocabulary 134 -> 131 (-3 exactly), team tags 19 -> 17,
-- category `offense` now 0 rows so My Tags' extras section no longer renders,
-- Cross/X1/X2/x3/Reverse and all 12 player tags intact. Every other team unchanged.
--
-- ROLLBACK: update tags set retired_at = null;  (or drop the column -- it is new and
-- the three rows are referenced by nothing).
