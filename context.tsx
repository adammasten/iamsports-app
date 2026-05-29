import { supabase } from '@/supabase';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type Role = 'admin' | 'head_coach' | 'coach' | 'parent' | 'player' | 'follower';

// Higher number = higher precedence. Used by activeRole to pick a single role
// when the same user holds multiple roles on the same team (e.g. a parent who
// is also an assistant coach). Mirrors the membership_role enum in
// migration_step1.sql; do not reorder without auditing every UI gate.
const ROLE_RANK: Record<Role, number> = {
  admin: 6,
  head_coach: 5,
  coach: 4,
  parent: 3,
  player: 2,
  follower: 1,
};

export type UserTeamRow = {
  team_id: string;
  name: string;
  sport: string;
  role: Role;
};

type TeamContext = {
  userId: string | null;
  activeTeam: { id: string; name: string; sport: string } | null;
  activeRole: Role | null;
  userTeams: UserTeamRow[];
  setActiveTeam: (teamId: string | null) => void;
  refreshTeams: () => Promise<void>;
};

const TeamCtx = createContext<TeamContext>({
  userId: null,
  activeTeam: null,
  activeRole: null,
  userTeams: [],
  setActiveTeam: () => {},
  refreshTeams: async () => {},
});

export function TeamProvider({ children }: { children: any }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [userTeams, setUserTeams] = useState<UserTeamRow[]>([]);
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);

  // Track auth session — userId drives the team query below.
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id ?? null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => { subscription.unsubscribe(); };
  }, []);

  // Read team_memberships joined to teams. Only 'confirmed' memberships are
  // surfaced; 'pending' invites belong to a separate invites UI (out of scope
  // for the context). Multiple rows per team are possible — see ROLE_RANK
  // comment above.
  const refreshTeams = useCallback(async () => {
    if (!userId) {
      setUserTeams([]);
      return;
    }
    const { data, error } = await supabase
      .from('team_memberships')
      .select('role, teams ( id, name, sport )')
      .eq('user_id', userId)
      .eq('status', 'confirmed');
    if (error || !data) {
      setUserTeams([]);
      return;
    }
    const flattened: UserTeamRow[] = (data as any[])
      .filter(r => r.teams)
      .map(r => ({
        team_id: r.teams.id,
        name: r.teams.name,
        sport: r.teams.sport,
        role: r.role as Role,
      }));
    setUserTeams(flattened);
  }, [userId]);

  useEffect(() => {
    refreshTeams();
  }, [refreshTeams]);

  // activeTeam is derived from activeTeamId + the latest userTeams. If the
  // selected team disappears from userTeams (membership revoked, team
  // deleted), activeTeam naturally goes null without the caller having to
  // clear state.
  const teamRow = activeTeamId
    ? userTeams.find(r => r.team_id === activeTeamId) ?? null
    : null;
  const activeTeam = teamRow
    ? { id: teamRow.team_id, name: teamRow.name, sport: teamRow.sport }
    : null;

  // Highest-ranked role across all membership rows for the active team.
  const activeRole: Role | null = activeTeam
    ? (userTeams
        .filter(r => r.team_id === activeTeam.id)
        .map(r => r.role)
        .sort((a, b) => ROLE_RANK[b] - ROLE_RANK[a])[0] ?? null)
    : null;

  const setActiveTeam = (teamId: string | null) => {
    setActiveTeamId(teamId);
  };

  return (
    <TeamCtx.Provider value={{ userId, activeTeam, activeRole, userTeams, setActiveTeam, refreshTeams }}>
      {children}
    </TeamCtx.Provider>
  );
}

export function useTeamContext() {
  return useContext(TeamCtx);
}
