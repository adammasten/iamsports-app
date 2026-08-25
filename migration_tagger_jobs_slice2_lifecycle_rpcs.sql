-- Tagger workflow — Slice 2: backend logic (additive functions only; no existing
-- policy is modified here). Encapsulates the whole state machine + grant fan-out
-- so the UI stays thin. Wiring can_tag_video() INTO the live tags/clips/clip_tags
-- policies is a separate, carefully-reviewed step (Slice 2b).
-- Applied live via Supabase MCP 2026-08-24.

-- "Do I hold an active, unexpired tagging grant on this video?" — the primitive the
-- RLS OR-branches will consult in Slice 2b.
create or replace function public.can_tag_video(p_video uuid)
returns boolean language sql security definer set search_path to 'public' stable as $$
  select exists (
    select 1 from video_tagging_rights r
    where r.video_id = p_video
      and r.granted_to_user_id = auth.uid()
      and r.can_tag = true
      and r.status = 'active'
      and (r.expires_at is null or r.expires_at > now())
  );
$$;

-- Internal: revoke every active grant a job handed its tagger.
create or replace function public._revoke_job_grants(p_job uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare j tagging_jobs;
begin
  select * into j from tagging_jobs where id = p_job;
  if not found then return; end if;
  update video_tagging_rights r set status = 'revoked'
   where r.granted_to_user_id = j.tagger_user_id
     and r.status = 'active'
     and r.video_id in (select id from videos where game_id = j.game_id);
end $$;

-- Owner creates a job → job row + a tagging grant per video in the game.
-- names_hidden defaults ON when the tagger isn't a confirmed team member.
create or replace function public.create_tagging_job(
  p_game_id uuid, p_tagger_user_id uuid, p_due_at timestamptz default null, p_instructions text default null
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_team uuid; v_job uuid; v_hide boolean; v_exp timestamptz;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select team_id into v_team from games where id = p_game_id;
  if v_team is null then raise exception 'game not found'; end if;
  if not (is_super_admin() or is_team_coach(v_team)) then raise exception 'not authorized'; end if;
  if p_tagger_user_id = v_uid then raise exception 'You can''t assign a job to yourself.'; end if;
  if not exists (select 1 from tagger_links where owner_user_id = v_uid and tagger_user_id = p_tagger_user_id) then
    raise exception 'Add this tagger to My Taggers first.';
  end if;

  v_hide := not exists (
    select 1 from team_memberships where team_id = v_team and user_id = p_tagger_user_id and status = 'confirmed'
  );
  v_exp := coalesce(p_due_at, now() + interval '30 days') + interval '14 days';

  insert into tagging_jobs (game_id, team_id, requester_user_id, tagger_user_id, status, instructions, due_at)
    values (p_game_id, v_team, v_uid, p_tagger_user_id, 'new', p_instructions, p_due_at)
    returning id into v_job;

  insert into video_tagging_rights (video_id, granted_to_user_id, granted_by_user_id, can_tag, names_hidden, status, expires_at)
    select v.id, p_tagger_user_id, v_uid, true, v_hide, 'active', v_exp
    from videos v
    where v.game_id = p_game_id
      and not exists (
        select 1 from video_tagging_rights r
        where r.video_id = v.id and r.granted_to_user_id = p_tagger_user_id and r.status = 'active'
      );
  return v_job;
end $$;

-- Keep a grant fanning out to videos ADDED after the job was created (invariant 5).
create or replace function public.extend_job_grants_to_new_video()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  insert into video_tagging_rights (video_id, granted_to_user_id, granted_by_user_id, can_tag, names_hidden, status, expires_at)
    select new.id, j.tagger_user_id, j.requester_user_id, true,
           not exists (select 1 from team_memberships m where m.team_id = j.team_id and m.user_id = j.tagger_user_id and m.status='confirmed'),
           'active', coalesce(j.due_at, now() + interval '30 days') + interval '14 days'
    from tagging_jobs j
    where j.game_id = new.game_id
      and j.status in ('new','in_progress','review','changes_requested')
      and j.tagger_user_id is not null
      and not exists (
        select 1 from video_tagging_rights r
        where r.video_id = new.id and r.granted_to_user_id = j.tagger_user_id and r.status='active'
      );
  return new;
end $$;
drop trigger if exists trg_extend_job_grants on public.videos;
create trigger trg_extend_job_grants after insert on public.videos
  for each row when (new.game_id is not null)
  execute function public.extend_job_grants_to_new_video();

-- ── State-machine transitions (each guards the caller + the legal from-state) ──
create or replace function public.tagger_start_job(p_job uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  update tagging_jobs set status='in_progress'
   where id=p_job and tagger_user_id=auth.uid() and status='new';
  if not found then raise exception 'Cannot start this job.'; end if;
end $$;

create or replace function public.tagger_decline_job(p_job uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  update tagging_jobs set status='declined'
   where id=p_job and tagger_user_id=auth.uid() and status='new';
  if not found then raise exception 'Cannot decline this job.'; end if;
  perform _revoke_job_grants(p_job);
end $$;

create or replace function public.tagger_complete_job(p_job uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  update tagging_jobs set status='review', tagger_completed_at=now()
   where id=p_job and tagger_user_id=auth.uid() and status in ('in_progress','changes_requested');
  if not found then raise exception 'Cannot mark this job complete.'; end if;
end $$;

create or replace function public.owner_request_changes(p_job uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  update tagging_jobs set status='changes_requested', revisions=revisions+1
   where id=p_job and requester_user_id=auth.uid() and status='review';
  if not found then raise exception 'Cannot request changes on this job.'; end if;
end $$;

-- Owner finalize = the only path that blesses the work: flip tagging_complete on
-- the game's videos, revoke the grants, move to history.
create or replace function public.owner_finalize_job(p_job uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare j tagging_jobs;
begin
  update tagging_jobs set status='complete', finalized_at=now()
   where id=p_job and requester_user_id=auth.uid() and status in ('review','changes_requested')
   returning * into j;
  if not found then raise exception 'Cannot finalize this job.'; end if;
  update videos set tagging_complete=true where game_id=j.game_id;
  perform _revoke_job_grants(p_job);
end $$;

create or replace function public.cancel_tagging_job(p_job uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  update tagging_jobs set status='canceled'
   where id=p_job and requester_user_id=auth.uid() and status <> 'complete';
  if not found then raise exception 'Cannot cancel this job.'; end if;
  perform _revoke_job_grants(p_job);
end $$;

-- Auto-RELEASE (not approve): after 14 days sitting in review, drop it off the
-- tagger's active queue but leave status='review' so the owner can still finalize.
create or replace function public.release_stale_tagging_jobs()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare n integer;
begin
  update tagging_jobs set released_at=now()
   where status='review' and released_at is null
     and tagger_completed_at is not null
     and tagger_completed_at < now() - interval '14 days';
  get diagnostics n = row_count;
  return n;
end $$;

grant execute on function public.can_tag_video(uuid)            to authenticated;
grant execute on function public.create_tagging_job(uuid, uuid, timestamptz, text) to authenticated;
grant execute on function public.tagger_start_job(uuid)         to authenticated;
grant execute on function public.tagger_decline_job(uuid)       to authenticated;
grant execute on function public.tagger_complete_job(uuid)      to authenticated;
grant execute on function public.owner_request_changes(uuid)    to authenticated;
grant execute on function public.owner_finalize_job(uuid)       to authenticated;
grant execute on function public.cancel_tagging_job(uuid)       to authenticated;
