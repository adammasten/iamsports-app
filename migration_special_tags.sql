-- V3 special tags — add 'special' category, insert ★ Highlight + POE as global tags. One-time migration.
BEGIN;
ALTER TABLE tags DROP CONSTRAINT tags_category_check;
ALTER TABLE tags ADD CONSTRAINT tags_category_check CHECK (category IN ('offense', 'defense', 'plays', 'players', 'special'));
INSERT INTO tags (name, category, sort_order, scope, team_id) VALUES
  ('★ Highlight', 'special', 0, 'global', NULL),
  ('POE', 'special', 1, 'global', NULL);
COMMIT;
NOTIFY pgrst, 'reload schema';
