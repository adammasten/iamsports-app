-- Tagger workflow — Slice 1: data foundation (additive, no app code).
-- The job spine + private thread + "My Taggers" address book + tagger-code identity.
-- Permissions to actually TAG (video_tagging_rights fan-out, can_tag_video) come in Slice 2.
-- Applied live via Supabase MCP 2026-08-24.
-- See docs/TAGGER_PROFILE_WORKFLOW_SPEC.md for the full build plan.

-- User-facing statuses: New / In Progress / Review / Changes Requested / Complete (+ Canceled/Declined).
do $$ begin
  if not exists (select 1 from pg_type where typname = 'tagging_job_status') then
    create type tagging_job_status as enum
      ('new','in_progress','review','changes_requested','complete','canceled','declined');
  end if;
end $$;

-- A personal code others enter to add you as their tagger (mirrors the coach-code pattern).
alter table public.user_profiles add column if not exists tagger_code text unique;

-- "My Taggers": owner ↔ tagger address book (populated only via redeem_tagger_code).
create table if not exists public.tagger_links (
  id uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null references auth.users(id) on delete cascade,
  tagger_user_id uuid not null references auth.users(id) on delete cascade,
  label text,
  created_at timestamptz not null default now(),
  unique (owner_user_id, tagger_user_id),
  check (owner_user_id <> tagger_user_id)
);

-- The job: one "please tag this game for me" request.
create table if not exists public.tagging_jobs (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  requester_user_id uuid not null references auth.users(id) on delete cascade,
  tagger_user_id uuid references auth.users(id) on delete set null,
  status tagging_job_status not null default 'new',
  template_id uuid,               -- reserved: tagging templates are a later slice
  instructions text,
  due_at timestamptz,
  requested_at timestamptz not null default now(),
  tagger_completed_at timestamptz,
  finalized_at timestamptz,
  released_at timestamptz,         -- auto-release from the tagger's queue (NOT owner-approval)
  revisions int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tagging_jobs_tagger_idx    on public.tagging_jobs (tagger_user_id, status);
create index if not exists tagging_jobs_requester_idx on public.tagging_jobs (requester_user_id, status);
create index if not exists tagging_jobs_game_idx      on public.tagging_jobs (game_id);

-- Private 1:1 coordination thread for a job.
create table if not exists public.tagging_job_messages (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.tagging_jobs(id) on delete cascade,
  author_user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists tagging_job_messages_idx on public.tagging_job_messages (job_id, created_at);

-- touch updated_at on tagging_jobs
create or replace function public.touch_tagging_job() returns trigger
language plpgsql set search_path to 'public' as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists trg_touch_tagging_job on public.tagging_jobs;
create trigger trg_touch_tagging_job before update on public.tagging_jobs
  for each row execute function public.touch_tagging_job();

-- Am I a party (owner or tagger) to this job? (used by message RLS)
create or replace function public.is_tagging_job_party(p_job uuid)
returns boolean language sql security definer set search_path to 'public' stable as $$
  select exists (
    select 1 from tagging_jobs j
    where j.id = p_job and (j.requester_user_id = auth.uid() or j.tagger_user_id = auth.uid())
  );
$$;

-- ── RLS ──────────────────────────────────────────────────────────────────
alter table public.tagger_links enable row level security;
alter table public.tagging_jobs enable row level security;
alter table public.tagging_job_messages enable row level security;

create policy tagger_links_read on public.tagger_links for select to authenticated
  using (owner_user_id = auth.uid() or tagger_user_id = auth.uid() or is_super_admin());
create policy tagger_links_delete on public.tagger_links for delete to authenticated
  using (owner_user_id = auth.uid() or is_super_admin());
-- no INSERT/UPDATE policy → links are created only via redeem_tagger_code (SECURITY DEFINER)

create policy tagging_jobs_read on public.tagging_jobs for select to authenticated
  using (requester_user_id = auth.uid() or tagger_user_id = auth.uid() or is_super_admin());
create policy tagging_jobs_insert on public.tagging_jobs for insert to authenticated
  with check (requester_user_id = auth.uid() and is_team_coach(team_id));
create policy tagging_jobs_update on public.tagging_jobs for update to authenticated
  using (requester_user_id = auth.uid() or tagger_user_id = auth.uid() or is_super_admin())
  with check (requester_user_id = auth.uid() or tagger_user_id = auth.uid() or is_super_admin());
create policy tagging_jobs_delete on public.tagging_jobs for delete to authenticated
  using (requester_user_id = auth.uid() or is_super_admin());

create policy tagging_job_messages_read on public.tagging_job_messages for select to authenticated
  using (is_tagging_job_party(job_id) or is_super_admin());
create policy tagging_job_messages_insert on public.tagging_job_messages for insert to authenticated
  with check (author_user_id = auth.uid() and is_tagging_job_party(job_id));

-- ── Identity RPCs ────────────────────────────────────────────────────────
-- Generate (or rotate) my personal tagger code.
create or replace function public.generate_tagger_code()
returns text language plpgsql security definer set search_path to 'public' as $$
declare v_code text; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  loop
    v_code := upper(substr(md5(gen_random_uuid()::text), 1, 6));
    exit when not exists (select 1 from user_profiles where tagger_code = v_code);
  end loop;
  update user_profiles set tagger_code = v_code where user_id = v_uid;
  return v_code;
end $$;

-- Owner redeems a tagger's code → adds them to My Taggers. Returns the tagger's identity.
create or replace function public.redeem_tagger_code(p_code text)
returns json language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_tagger uuid; v_name text;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select up.user_id, coalesce(nullif(trim(up.display_name), ''), 'Tagger')
    into v_tagger, v_name
    from user_profiles up where upper(up.tagger_code) = upper(trim(p_code));
  if v_tagger is null then raise exception 'That tagger code did not match anyone.'; end if;
  if v_tagger = v_uid then raise exception 'That is your own tagger code.'; end if;
  insert into tagger_links (owner_user_id, tagger_user_id)
    values (v_uid, v_tagger) on conflict (owner_user_id, tagger_user_id) do nothing;
  return json_build_object('tagger_user_id', v_tagger, 'display_name', v_name);
end $$;

grant execute on function public.is_tagging_job_party(uuid) to authenticated;
grant execute on function public.generate_tagger_code() to authenticated;
grant execute on function public.redeem_tagger_code(text) to authenticated;
