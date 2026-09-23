-- SLICE A — format metadata only (Adam, 2026-09-23).
-- APPLIED LIVE as migration 20260923223000_team_and_tag_format.
--
-- Adds the format concept. NOTHING reads it yet: no filtering, no vocabulary change,
-- no category change, no tag id change, no clip_tags touched. Every column is NULL on
-- every existing row, so behavior is byte-identical until slice B wires the filter.
--
-- Sport and format stay SEPARATE: 'Flag Football' + '5v5', never 'Flag Football 5v5'
-- (which would break every exact-match sport comparison and strand historical content).
-- NULL always means "legacy / full behavior":
--   teams.format NULL -> that team is offered the whole sport vocabulary (today)
--   tags.format  NULL -> that tag is offered to every format of its sport

alter table teams add column if not exists format text;
alter table teams drop constraint if exists teams_format_check;
alter table teams add constraint teams_format_check
  check (format is null or format in ('5v5','7v7','11v11'));

alter table tags add column if not exists format text;
alter table tags drop constraint if exists tags_format_check;
alter table tags add constraint tags_format_check
  check (format is null or format in ('5v5','7v7','11v11'));

-- NOTE: the CHECK deliberately allows only the three football-family formats we
-- support today. Adding a format later (3v3 basketball, 6v6 volleyball) is a
-- one-line constraint change, and that is preferable to an unconstrained text
-- column that would silently accept typos.
--
-- Regents Bangels is deliberately NOT set to '5v5' here -- see slice C. Leaving
-- every team NULL keeps slices A and B provably zero-behavior-change; the Regents
-- write then becomes the single isolated, observable moment its board changes.
--
-- ROLLBACK: alter table teams drop column format; alter table tags drop column format;
-- (both are new and entirely NULL, so dropping them loses nothing).
--
-- Post-apply verification (2026-09-23): 0 teams and 0 tags have a format set;
-- teams 7, tags 554, clips 402, clip_tags 1535 unchanged; Regents still
-- sport='Flag Football', format NULL, 19 team tags; no tagger file touched.
