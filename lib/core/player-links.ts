// Cross-team player identity — coach-side linking (Slice 1). RN-agnostic core.
// A player's "identity" is its player_lineage_id (falls back to its own id until
// linked). Two rows are the same human when they share a lineage id.
import { supabase } from '@/supabase';

export type LinkablePlayer = {
  id: string;
  name: string;
  teamId: string | null;
  teamName: string;
  jersey: string | null;
  lineageId: string;   // coalesce(player_lineage_id, id)
};

// One identity: 1+ player rows that share a lineage.
export type Identity = { lineageId: string; name: string; rows: LinkablePlayer[] };

export async function loadCoachPlayers(
  teamIds: string[],
  teamNameById: Map<string, string>,
): Promise<LinkablePlayer[]> {
  if (teamIds.length === 0) return [];
  const { data, error } = await supabase
    .from('players')
    .select('id, name, team_id, jersey_number, player_lineage_id')
    .in('team_id', teamIds)
    .order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((p: any) => ({
    id: p.id,
    name: p.name,
    teamId: p.team_id,
    teamName: teamNameById.get(p.team_id) ?? 'Team',
    jersey: p.jersey_number != null ? String(p.jersey_number) : null,
    lineageId: p.player_lineage_id ?? p.id,
  }));
}

// Group rows into identities (by lineage). Name taken from the first row.
export function groupIdentities(rows: LinkablePlayer[]): Identity[] {
  const m = new Map<string, LinkablePlayer[]>();
  rows.forEach(r => { const g = m.get(r.lineageId) ?? []; g.push(r); m.set(r.lineageId, g); });
  return [...m.entries()]
    .map(([lineageId, rs]) => ({ lineageId, name: rs[0].name, rows: rs }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function linkPlayers(keepId: string, mergeId: string): Promise<void> {
  const { error } = await supabase.rpc('link_players', { p_keep: keepId, p_merge: mergeId });
  if (error) throw error;
}

export async function unlinkPlayer(playerId: string): Promise<void> {
  const { error } = await supabase.rpc('unlink_player', { p_player: playerId });
  if (error) throw error;
}
