import { supabase } from '@/supabase';

// UGC moderation core (App Store Guideline 1.2): report content + block users,
// and the read-side filter both feed loaders apply. RN-agnostic (Supabase +
// plain JS) → lib/core. UI lives in app/moderationActions.ts.

export type ReportReason = 'inappropriate' | 'harassment' | 'child_safety' | 'spam' | 'other';

// File a report. Reactive moderation: the row lands in content_reports for the
// developer to review (Supabase dashboard) and take down via shares.visible.
export async function reportContent(args: {
  contentType: string; contentId: string; shareId?: string | null; reason: ReportReason; note?: string;
}): Promise<{ error: string | null }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'You’re not signed in.' };
  const { error } = await supabase.from('content_reports').insert({
    reporter_user_id: user.id,
    content_type: args.contentType,
    content_id: args.contentId,
    share_id: args.shareId ?? null,
    reason: args.reason,
    note: args.note ?? null,
  });
  return { error: error?.message ?? null };
}

// Block another user. Idempotent (upsert on the composite key).
export async function blockUser(blockedUserId: string): Promise<{ error: string | null }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'You’re not signed in.' };
  if (user.id === blockedUserId) return { error: 'You can’t block yourself.' };
  const { error } = await supabase.from('user_blocks').upsert(
    { blocker_user_id: user.id, blocked_user_id: blockedUserId },
    { onConflict: 'blocker_user_id,blocked_user_id' },
  );
  return { error: error?.message ?? null };
}

export async function unblockUser(blockedUserId: string): Promise<{ error: string | null }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'You’re not signed in.' };
  const { error } = await supabase.from('user_blocks').delete()
    .eq('blocker_user_id', user.id).eq('blocked_user_id', blockedUserId);
  return { error: error?.message ?? null };
}

// The current user's moderation view: everyone hidden from their feed (blocks in
// either direction — mutual) + the content-keys they've reported (hidden from
// them immediately). Loaded once per feed refresh and applied via filterModerated.
export type ModerationFilter = { blockedUserIds: Set<string>; reportedKeys: Set<string> };

export async function loadModeration(): Promise<ModerationFilter> {
  const blockedUserIds = new Set<string>();
  const reportedKeys = new Set<string>();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { blockedUserIds, reportedKeys };

  const { data: blocks } = await supabase.from('user_blocks')
    .select('blocker_user_id, blocked_user_id')
    .or(`blocker_user_id.eq.${user.id},blocked_user_id.eq.${user.id}`);
  (blocks || []).forEach((b: any) => {
    const other = b.blocker_user_id === user.id ? b.blocked_user_id : b.blocker_user_id;
    if (other) blockedUserIds.add(other);
  });

  const { data: reports } = await supabase.from('content_reports')
    .select('content_type, content_id').eq('reporter_user_id', user.id);
  (reports || []).forEach((r: any) => reportedKeys.add(`${r.content_type}:${r.content_id}`));

  return { blockedUserIds, reportedKeys };
}

// Drop items shared by a hidden user, or whose content the viewer has reported.
export function filterModerated<T extends { sharedByUserId?: string | null; key?: string; contentType?: string; contentId?: string }>(
  items: T[], mod: ModerationFilter,
): T[] {
  return items.filter(it => {
    if (it.sharedByUserId && mod.blockedUserIds.has(it.sharedByUserId)) return false;
    const key = it.key ?? (it.contentType && it.contentId ? `${it.contentType}:${it.contentId}` : null);
    if (key && mod.reportedKeys.has(key)) return false;
    return true;
  });
}
