-- migration_phase2_team_logos.sql — Phase 2: team logos.
-- teams.logo_path = a storage object key in the private Videos bucket
-- (team-logos/<team_id>/<ts>.jpg), mirroring players.photo_path. Coaches upload;
-- the logo persists on the team (teams are never deleted) so it stays put on the
-- frozen past-team card. Display goes through sign-media (never a public URL) via
-- authorize_team_logo_view — which is intentionally permissive enough that a
-- FORMER member still sees a past team's logo: any linked parent of a player who
-- has (or had) a player_teams row on the team qualifies, not just current members.

alter table teams add column if not exists logo_path text;

create or replace function public.authorize_team_logo_view(p_team_id uuid)
returns text language plpgsql security definer set search_path to 'public' as $$
declare lp text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select logo_path into lp from teams where id = p_team_id;
  if lp is null then raise exception 'No logo set'; end if;
  if is_super_admin()
     or is_team_member(p_team_id)
     or exists (select 1 from player_teams pt
                where pt.team_id = p_team_id and is_linked_parent(pt.player_id))
  then
    return lp;
  end if;
  raise exception 'Not allowed to view this logo';
end $$;
grant execute on function public.authorize_team_logo_view(uuid) to authenticated;
