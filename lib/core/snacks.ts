// Snack sign-up (Stage 5): one family claims snacks per event; a day-before
// reminder fires through the notification backbone (push now, SMS later).
import { supabase } from '@/supabase';

export type SnackSignup = { eventId: string; claimedByUserId: string; claimerName: string };

export async function loadSnacks(eventIds: string[]): Promise<Map<string, SnackSignup>> {
  const out = new Map<string, SnackSignup>();
  if (eventIds.length === 0) return out;
  const { data, error } = await supabase.from('event_snack_signups')
    .select('event_id, claimed_by_user_id').in('event_id', eventIds);
  if (error) throw error;
  const rows = data ?? [];
  const ids = Array.from(new Set(rows.map((r: any) => r.claimed_by_user_id)));
  const { data: profs } = ids.length ? await supabase.from('user_profiles').select('user_id, display_name').in('user_id', ids) : { data: [] as any[] };
  const nameById = new Map<string, string>((profs ?? []).map((p: any) => [p.user_id, p.display_name || 'A family']));
  rows.forEach((r: any) => out.set(r.event_id, { eventId: r.event_id, claimedByUserId: r.claimed_by_user_id, claimerName: nameById.get(r.claimed_by_user_id) || 'A family' }));
  return out;
}

// First family to claim wins (unique on event_id). A 23505 means someone just took it.
export async function claimSnack(eventId: string, teamId: string, userId: string): Promise<void> {
  const { error } = await supabase.from('event_snack_signups')
    .insert({ event_id: eventId, team_id: teamId, claimed_by_user_id: userId });
  if (error) {
    if ((error as any).code === '23505') throw new Error('Someone just signed up for snacks — refresh to see who.');
    throw error;
  }
}

export async function releaseSnack(eventId: string, userId: string): Promise<void> {
  const { error } = await supabase.from('event_snack_signups').delete().eq('event_id', eventId).eq('claimed_by_user_id', userId);
  if (error) throw error;
}
