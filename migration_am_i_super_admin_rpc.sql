-- Lets the client ask "am I a super admin?" so it can show moderation controls
-- (e.g. deleting other people's Vault plays). RLS still enforces the real rule
-- (library_plays_all: owner_user_id = auth.uid() OR is_super_admin()).
-- Applied live via Supabase MCP 2026-08-24.
create or replace function public.am_i_super_admin()
returns boolean language sql security definer set search_path to 'public' stable as $$
  select is_super_admin();
$$;
grant execute on function public.am_i_super_admin() to authenticated;
