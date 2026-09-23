-- Parent-highlight safety (Adam, 2026-09-23). APPLIED LIVE as migration
-- 20260923213000_parent_highlight_positive_only_and_clip_origin (see list_migrations).
--
-- Closes four bypasses found in the read-only product-invariant audit:
--   1. another player's positive bundle qualifying my kid for a highlight
--   2. a clip-level (bundle 0) positive such as a team Touchdown qualifying anyone
--   3. clips.is_starred bypassing the positive-only rule
--   4. the ungated Film Room -> "Make a reel" -> Export path
--
-- NOT touched: clips_read (parents keep film access, including their own kid's
-- negative clips), clip_is_pure_negative, clip_involves_my_kid, is_roster_film_parent,
-- tag polarity values, clip_tags, tag ids, bundle_number semantics, tagger layout.

-- 1. DURABLE CLIP PROVENANCE ------------------------------------------------
-- A stored column, not "created_by_user_id + current role": role is ALREADY
-- ambiguous (the main account holds admin AND parent on the same team), and a
-- parent who later becomes a coach would otherwise see their old personal clips
-- silently reclassify. Freezing the value at creation is the only stable answer.
-- DEFAULT 'team' backfills all 402 pre-existing clips correctly: every one was
-- created by a user holding a coach role on that clip's own team (verified).
alter table clips add column if not exists origin text not null default 'team';
alter table clips drop constraint if exists clips_origin_check;
alter table clips add constraint clips_origin_check check (origin in ('team','personal'));

create or replace function public.set_clip_origin()
  returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  new.origin := case
    when (new.team_id is not null and is_team_coach(new.team_id)) or can_tag_video(new.video_id)
      then 'team' else 'personal' end;
  return new;
end $$;

drop trigger if exists trg_set_clip_origin on public.clips;
create trigger trg_set_clip_origin before insert on public.clips
  for each row execute function public.set_clip_origin();

-- 2. WHO MAY PUT A CLIP IN A REEL -------------------------------------------
-- Single source of truth; mirrored client-side in lib/core/highlight-eligibility.ts
-- (UI only). The parent branch is BUNDLE-AWARE: the linked player's tag and the
-- positive tag must share the SAME bundle_number, and that bundle must be > 0.
create or replace function public.may_reel_clip(p_clip uuid)
  returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from clips c
    where c.id = p_clip
      and (
        is_super_admin()
        or (c.team_id is not null and is_team_coach(c.team_id))
        or (c.origin = 'personal' and c.created_by_user_id = (select auth.uid()))
        or exists (
          select 1
          from clip_tags ctp
          join tags tp on tp.id = ctp.tag_id
          join clip_tags cts
            on cts.clip_id = ctp.clip_id and cts.bundle_number = ctp.bundle_number
          join tags ts on ts.id = cts.tag_id
          where ctp.clip_id = c.id
            and ctp.bundle_number > 0
            and tp.category = 'players'
            and tp.player_id is not null
            and is_linked_parent(tp.player_id)
            and ts.tag_polarity = 'positive'
            and ts.category <> 'players'
        )
      )
  );
$$;

grant execute on function public.may_reel_clip(uuid) to public, anon, authenticated, service_role;

-- 3. SERVER-SIDE ENFORCEMENT ------------------------------------------------
-- The app now RESERVES the reel row before calling the Railway renderer, so this
-- WITH CHECK is a real gate, not bookkeeping. Authority comes from each CLIP, not
-- from highlight_reels.team_id (which is usually null).
drop policy if exists highlight_reels_insert on public.highlight_reels;
create policy highlight_reels_insert on public.highlight_reels
  for insert to public
  with check (
    (is_super_admin() or created_by_user_id = (select auth.uid()) or is_team_member(team_id))
    and (
      source_clip_ids is null
      or not exists (select 1 from unnest(source_clip_ids) cid where not may_reel_clip(cid))
    )
  );

drop policy if exists highlight_reels_update on public.highlight_reels;
create policy highlight_reels_update on public.highlight_reels
  for update to public
  using (is_super_admin() or created_by_user_id = (select auth.uid()) or is_team_coach(team_id))
  with check (
    (is_super_admin() or created_by_user_id = (select auth.uid()) or is_team_coach(team_id))
    and (
      source_clip_ids is null
      or not exists (select 1 from unnest(source_clip_ids) cid where not may_reel_clip(cid))
    )
  );

-- Verified post-apply: 402/402 clips origin='team'; clips_read byte-identical;
-- a non-entitled user's reel insert rejected with 42501; a coach's neutral-only
-- reel insert accepted; export/tag baseline unchanged on all 7 groups.
