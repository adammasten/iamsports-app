// Public team messaging (Stage 3): announcements + team chat + (event-attached)
// conversations. All rows are team-visible — no private DMs. RN-agnostic.
import { supabase } from '@/supabase';

export type MessageKind = 'chat' | 'announcement';
export type Message = {
  id: string;
  teamId: string;
  eventId: string | null;
  parentId: string | null;
  authorUserId: string;
  authorName: string;
  kind: MessageKind;
  body: string;
  createdAt: string;
  replyCount: number;
};

function mapRow(r: any, nameById: Map<string, string>): Message {
  return {
    id: r.id, teamId: r.team_id, eventId: r.event_id, parentId: r.parent_id,
    authorUserId: r.author_user_id, authorName: nameById.get(r.author_user_id) || 'Coach',
    kind: r.kind, body: r.body, createdAt: r.created_at, replyCount: 0,
  };
}

async function namesFor(userIds: string[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(userIds)).filter(Boolean);
  if (ids.length === 0) return new Map();
  const { data } = await supabase.from('user_profiles').select('user_id, display_name').in('user_id', ids);
  return new Map((data ?? []).map((r: any) => [r.user_id, r.display_name || 'Coach']));
}

// Top-level messages (parent_id null) for a team, filtered by kind and scope
// (eventId = null → team-level; a uuid → that event's conversation).
export async function loadMessages(teamId: string, opts: { kind?: MessageKind; eventId?: string | null } = {}): Promise<Message[]> {
  let q = supabase.from('messages').select('*')
    .eq('team_id', teamId).is('parent_id', null).is('deleted_at', null)
    .order('created_at', { ascending: false }).limit(200);
  if (opts.kind) q = q.eq('kind', opts.kind);
  q = opts.eventId ? q.eq('event_id', opts.eventId) : q.is('event_id', null);
  const { data, error } = await q;
  if (error) throw error;
  const rows = data ?? [];
  const names = await namesFor(rows.map((r: any) => r.author_user_id));
  const msgs = rows.map((r: any) => mapRow(r, names));
  // reply counts
  if (msgs.length) {
    const { data: replies } = await supabase.from('messages').select('parent_id')
      .in('parent_id', msgs.map(m => m.id)).is('deleted_at', null);
    const counts = new Map<string, number>();
    (replies ?? []).forEach((r: any) => counts.set(r.parent_id, (counts.get(r.parent_id) ?? 0) + 1));
    msgs.forEach(m => { m.replyCount = counts.get(m.id) ?? 0; });
  }
  return msgs;
}

export async function loadReplies(parentId: string): Promise<Message[]> {
  const { data, error } = await supabase.from('messages').select('*')
    .eq('parent_id', parentId).is('deleted_at', null).order('created_at', { ascending: true });
  if (error) throw error;
  const rows = data ?? [];
  const names = await namesFor(rows.map((r: any) => r.author_user_id));
  return rows.map((r: any) => mapRow(r, names));
}

export async function postMessage(args: {
  teamId: string; kind: MessageKind; body: string; eventId?: string | null; parentId?: string | null;
}, userId: string): Promise<void> {
  const body = args.body.trim();
  if (!body) throw new Error('Message is empty.');
  const { error } = await supabase.from('messages').insert({
    team_id: args.teamId, kind: args.kind, body,
    event_id: args.eventId ?? null, parent_id: args.parentId ?? null,
    author_user_id: userId,
  });
  if (error) throw error;
}

// Soft-delete (RLS lets author or a coach do it) — keeps the row for audit.
export async function deleteMessage(id: string, userId: string): Promise<void> {
  const { error } = await supabase.from('messages')
    .update({ deleted_at: new Date().toISOString(), deleted_by: userId }).eq('id', id);
  if (error) throw error;
}
