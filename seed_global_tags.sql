-- V3 global default tags (13). Run once on a fresh/empty environment. Will create duplicates if re-run.
BEGIN;
INSERT INTO tags (name, category, sort_order, scope, team_id) VALUES
  ('MADE 2',   'offense', 0, 'global', NULL),
  ('miss 2',   'offense', 1, 'global', NULL),
  ('MADE 3',   'offense', 2, 'global', NULL),
  ('miss 3',   'offense', 3, 'global', NULL),
  ('MADE FT',  'offense', 4, 'global', NULL),
  ('miss ft',  'offense', 5, 'global', NULL),
  ('Assist',   'offense', 6, 'global', NULL),
  ('Reb O',    'offense', 7, 'global', NULL),
  ('Turnover', 'offense', 8, 'global', NULL),
  ('Steal',    'defense', 0, 'global', NULL),
  ('Block',    'defense', 1, 'global', NULL),
  ('Reb D',    'defense', 2, 'global', NULL),
  ('Foul D',   'defense', 3, 'global', NULL);
COMMIT;
