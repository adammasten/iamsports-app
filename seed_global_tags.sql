-- ============================================================
-- V3 global default tags — 13 tags, all scope='global', team_id=NULL.
-- Non-destructive: only inserts tags that don't already exist (matched
-- by name + category + scope='global' + team_id IS NULL). Re-running
-- adds nothing if all 13 are present, fills only the gaps if some are
-- missing, and NEVER deletes or overwrites any existing row.
-- ============================================================

BEGIN;

INSERT INTO tags (name, category, sort_order, scope, team_id)
SELECT v.name, v.category, v.sort_order, 'global', NULL
FROM (VALUES
  ('MADE 2',   'offense', 0),
  ('miss 2',   'offense', 1),
  ('MADE 3',   'offense', 2),
  ('miss 3',   'offense', 3),
  ('MADE FT',  'offense', 4),
  ('miss ft',  'offense', 5),
  ('Assist',   'offense', 6),
  ('Reb O',    'offense', 7),
  ('Turnover', 'offense', 8),
  ('Steal',    'defense', 0),
  ('Block',    'defense', 1),
  ('Reb D',    'defense', 2),
  ('Foul D',   'defense', 3)
) AS v(name, category, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM tags t
  WHERE t.name = v.name
    AND t.category = v.category
    AND t.scope = 'global'
    AND t.team_id IS NULL
);

COMMIT;
