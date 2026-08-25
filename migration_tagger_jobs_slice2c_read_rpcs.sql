-- Tagger workflow — Slice 2c: enriched read RPCs for the UI (additive).
-- Applied live via Supabase MCP 2026-08-24.

-- Every job I'm party to, enriched with game title, counterpart name, my role, video count.
create or replace function public.list_my_tagging_jobs()
returns table(
  id uuid, game_id uuid, team_id uuid, status tagging_job_status,
  role text, counterpart_name text, game_title text, team_name text,
  instructions text, due_at timestamptz, requested_at timestamptz,
  tagger_completed_at timestamptz, finalized_at timestamptz, released_at timestamptz,
  revisions int, video_count int
) language sql security definer set search_path to 'public' stable as $$
  select j.id, j.game_id, j.team_id, j.status,
    case when j.requester_user_id = auth.uid() then 'owner' else 'tagger' end as role,
    coalesce(nullif(trim(cp.display_name), ''), '—') as counterpart_name,
    coalesce(g.title, 'Game') as game_title,
    coalesce(tm.name, '') as team_name,
    j.instructions, j.due_at, j.requested_at, j.tagger_completed_at, j.finalized_at, j.released_at, j.revisions,
    (select count(*)::int from videos v where v.game_id = j.game_id) as video_count
  from tagging_jobs j
  left join games g  on g.id  = j.game_id
  left join teams tm on tm.id = j.team_id
  left join user_profiles cp on cp.user_id =
    (case when j.requester_user_id = auth.uid() then j.tagger_user_id else j.requester_user_id end)
  where j.requester_user_id = auth.uid() or j.tagger_user_id = auth.uid()
  order by (case j.status when 'changes_requested' then 0 when 'in_progress' then 1
                          when 'new' then 2 when 'review' then 3 else 9 end),
           j.due_at nulls last, j.requested_at desc;
$$;

-- My Taggers address book, with each tagger's display name.
create or replace function public.list_my_taggers()
returns table(tagger_user_id uuid, display_name text, linked_at timestamptz)
language sql security definer set search_path to 'public' stable as $$
  select tl.tagger_user_id, coalesce(nullif(trim(up.display_name), ''), 'Tagger'), tl.created_at
  from tagger_links tl left join user_profiles up on up.user_id = tl.tagger_user_id
  where tl.owner_user_id = auth.uid()
  order by 2;
$$;

-- My own tagger code (null if I've never generated one).
create or replace function public.get_my_tagger_code()
returns text language sql security definer set search_path to 'public' stable as $$
  select tagger_code from user_profiles where user_id = auth.uid();
$$;

-- A job's message thread, with author names and is-mine flag (party-gated).
create or replace function public.list_job_messages(p_job uuid)
returns table(id uuid, body text, author_name text, is_mine boolean, created_at timestamptz)
language sql security definer set search_path to 'public' stable as $$
  select m.id, m.body, coalesce(nullif(trim(up.display_name), ''), 'User'),
         (m.author_user_id = auth.uid()), m.created_at
  from tagging_job_messages m left join user_profiles up on up.user_id = m.author_user_id
  where m.job_id = p_job
    and exists (select 1 from tagging_jobs j
                where j.id = p_job and (j.requester_user_id = auth.uid() or j.tagger_user_id = auth.uid()))
  order by m.created_at;
$$;

grant execute on function public.list_my_tagging_jobs()  to authenticated;
grant execute on function public.list_my_taggers()        to authenticated;
grant execute on function public.get_my_tagger_code()     to authenticated;
grant execute on function public.list_job_messages(uuid)  to authenticated;
