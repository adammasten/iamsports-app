import { supabase } from '@/supabase';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type Role = 'admin' | 'head_coach' | 'coach' | 'parent' | 'player' | 'follower';

// Roles that count as coaching a team. Shared across screens that gate on
// coach-level access (e.g. My Work / Coaches' Corner destination + filter logic).
export const COACH_ROLES: Role[] = ['admin', 'head_coach', 'coach'];

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

export type UserKidRow = {
  player_id: string;
  name: string;
  jersey_number: string | null;
  photo_path: string | null;
  team_id: string;
  relationship: string | null;
};

type TeamContext = {
  userId: string | null;
  sessionResolved: boolean;
  membershipsLoaded: boolean;
  kidsLoaded: boolean;
  activeTeam: { id: string; name: string; sport: string } | null;
  activeRole: Role | null;
  userTeams: UserTeamRow[];
  userKids: UserKidRow[];
  setActiveTeam: (teamId: string | null) => void;
  refreshTeams: () => Promise<void>;
  refreshKids: () => Promise<void>;
};

const TeamCtx = createContext<TeamContext>({
  userId: null,
  sessionResolved: false,
  membershipsLoaded: false,
  kidsLoaded: false,
  activeTeam: null,
  activeRole: null,
  userTeams: [],
  userKids: [],
  setActiveTeam: () => {},
  refreshTeams: async () => {},
  refreshKids: async () => {},
});

export function TeamProvider({ children }: { children: any }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [userTeams, setUserTeams] = useState<UserTeamRow[]>([]);
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const [userKids, setUserKids] = useState<UserKidRow[]>([]);
  // True once the initial getSession() resolves — lets the router tell
  // "not logged in" apart from "session not determined yet".
  const [sessionResolved, setSessionResolved] = useState(false);
  // Which userId the current userTeams belong to (undefined = never loaded).
  // membershipsLoaded is DERIVED from this (below) so it flips false
  // synchronously the moment userId changes — no stale-"loaded" race.
  const [loadedForUserId, setLoadedForUserId] = useState<string | null | undefined>(undefined);
  // Mirror of loadedForUserId for the kids query (drives derived kidsLoaded).
  const [kidsLoadedForUserId, setKidsLoadedForUserId] = useState<string | null | undefined>(undefined);

  // Track auth session — userId drives the team query below.
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id ?? null);
      setSessionResolved(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
      setSessionResolved(true);
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
      setLoadedForUserId(null);
      return;
    }
    const { data, error } = await supabase
      .from('team_memberships')
      .select('role, teams ( id, name, sport )')
      .eq('user_id', userId)
      .eq('status', 'confirmed');
    if (error || !data) {
      setUserTeams([]);
      setLoadedForUserId(userId);
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
    setLoadedForUserId(userId);
  }, [userId]);

  useEffect(() => {
    refreshTeams();
  }, [refreshTeams]);

  // Read parent_player_links joined to players for the current user — the kids
  // this user is a guardian of. Mirrors refreshTeams exactly.
  // NOTE: the nested players select is subject to players_read RLS, so a kid
  // whose team this user is NOT a confirmed member of will be filtered out
  // (players_read has no linked-parent branch).
  const refreshKids = useCallback(async () => {
    if (!userId) {
      setUserKids([]);
      setKidsLoadedForUserId(null);
      return;
    }
    const { data, error } = await supabase
      .from('parent_player_links')
      .select('relationship, players ( id, name, jersey_number, team_id, photo_path )')
      .eq('parent_user_id', userId);
    if (error || !data) {
      setUserKids([]);
      setKidsLoadedForUserId(userId);
      return;
    }
    const flattened: UserKidRow[] = (data as any[])
      .filter(r => r.players)
      .map(r => ({
        player_id: r.players.id,
        name: r.players.name,
        jersey_number: r.players.jersey_number ?? null,
        photo_path: r.players.photo_path ?? null,
        team_id: r.players.team_id,
        relationship: r.relationship ?? null,
      }));
    setUserKids(flattened);
    setKidsLoadedForUserId(userId);
  }, [userId]);

  useEffect(() => {
    refreshKids();
  }, [refreshKids]);

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

  // Derived (NOT state) so it tracks userId synchronously — see loadedForUserId.
  const membershipsLoaded = loadedForUserId === userId;

  // Same derived pattern for the kids query.
  const kidsLoaded = kidsLoadedForUserId === userId;

  const setActiveTeam = (teamId: string | null) => {
    setActiveTeamId(teamId);
  };

  return (
    <TeamCtx.Provider value={{ userId, sessionResolved, membershipsLoaded, kidsLoaded, activeTeam, activeRole, userTeams, userKids, setActiveTeam, refreshTeams, refreshKids }}>
      {children}
    </TeamCtx.Provider>
  );
}

export function useTeamContext() {
  return useContext(TeamCtx);
}
