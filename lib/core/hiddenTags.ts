// Per-team tag hiding (team_hidden_tags). Lets a team tuck away tags — especially
// the universal/global ones they don't use — so they stop cluttering the tagging
// screen, without deleting the shared tag for other teams. RN-agnostic.
import { supabase } from '@/supabase';

// The tag ids this team has hidden (empty for loose/teamless content).
export async function loadHiddenTagIds(teamId: string | null | undefined): Promise<Set<string>> {
  if (!teamId) return new Set();
  const { data, error } = await supabase.from('team_hidden_tags').select('tag_id').eq('team_id', teamId);
  if (error) throw error;
  return new Set((data ?? []).map((r: any) => r.tag_id as string));
}

export async function hideTag(teamId: string, tagId: string, userId: string | null): Promise<void> {
  const { error } = await supabase.from('team_hidden_tags').insert({ team_id: teamId, tag_id: tagId, hidden_by: userId });
  if (error) throw error;
}

export async function unhideTag(teamId: string, tagId: string): Promise<void> {
  const { error } = await supabase.from('team_hidden_tags').delete().eq('team_id', teamId).eq('tag_id', tagId);
  if (error) throw error;
}
