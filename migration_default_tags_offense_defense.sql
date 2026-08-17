-- Default (global) Offense + Defense starter tags, in Adam's chosen order.
-- Applied to live DB 2026-08-17 via the Supabase MCP. Stat tags keep their
-- stat_primitive wiring (box score keys off stat_primitive, NOT the display name,
-- so renaming/capitalizing tag names is stat-safe). Non-stat "film" tags added for
-- filtering + reels. "Plays" category left intact; Post Up / Iso / Off Screen were
-- MOVED from Plays into Offense to avoid duplicates.

-- 1) Capitalize the missed-shot tags (tagger display only)
update tags set name='MISSED 2'  where scope='global' and category='offense' and name='miss 2';
update tags set name='MISSED 3'  where scope='global' and category='offense' and name='miss 3';
update tags set name='MISSED FT' where scope='global' and category='offense' and name='miss ft';

-- 2) Move Post Up / Iso→Isolation / Off Screen→Off-Ball Screen from Plays into Offense
update tags set category='offense', sort_order=11, name='Post Up'         where scope='global' and category='plays' and name='Post Up';
update tags set category='offense', sort_order=12, name='Isolation'       where scope='global' and category='plays' and name='Iso';
update tags set category='offense', sort_order=13, name='Off-Ball Screen' where scope='global' and category='plays' and name='Off Screen';

-- 3) New OFFENSE tags (non-stat)
insert into tags (name, category, sort_order, scope, team_id) values
  ('Fouled on Shot','offense',10,'global'::tag_scope,null),
  ('Backdoor Cut','offense',14,'global'::tag_scope,null),
  ('Paint Touch','offense',15,'global'::tag_scope,null),
  ('Extra Pass','offense',16,'global'::tag_scope,null),
  ('Swing Ball','offense',17,'global'::tag_scope,null);

-- 4) Reorder existing DEFENSE stat tags to fit the new order
update tags set sort_order=5 where scope='global' and category='defense' and name='Foul';
update tags set sort_order=7 where scope='global' and category='defense' and name='Technical';

-- 5) New DEFENSE tags (non-stat)
insert into tags (name, category, sort_order, scope, team_id) values
  ('Deflection','defense',3,'global'::tag_scope,null),
  ('Charge Taken','defense',4,'global'::tag_scope,null),
  ('Shooting Foul','defense',6,'global'::tag_scope,null),
  ('Forced Turnover','defense',8,'global'::tag_scope,null),
  ('Contested Shot','defense',9,'global'::tag_scope,null),
  ('Man to Man','defense',10,'global'::tag_scope,null),
  ('Zone','defense',11,'global'::tag_scope,null),
  ('Press','defense',12,'global'::tag_scope,null),
  ('Trap','defense',13,'global'::tag_scope,null),
  ('Rotation','defense',14,'global'::tag_scope,null),
  ('Closeout','defense',15,'global'::tag_scope,null),
  ('Box Out','defense',16,'global'::tag_scope,null),
  ('Ball Screen D','defense',17,'global'::tag_scope,null),
  ('Denial','defense',18,'global'::tag_scope,null),
  ('Transition D','defense',19,'global'::tag_scope,null);
