import { createContext, useContext, useState } from 'react';

type TeamContext = {
  profileId: string | null;
  profileName: string | null;
  teamId: string | null;
  teamName: string | null;
  setTeamContext: (profileId: string, profileName: string, teamId: string, teamName: string) => void;
};

const TeamCtx = createContext<TeamContext>({
  profileId: null,
  profileName: null,
  teamId: null,
  teamName: null,
  setTeamContext: () => {},
});

export function TeamProvider({ children }: { children: any }) {
  const [profileId, setProfileId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [teamName, setTeamName] = useState<string | null>(null);

  function setTeamContext(pid: string, pname: string, tid: string, tname: string) {
    setProfileId(pid);
    setProfileName(pname);
    setTeamId(tid);
    setTeamName(tname);
  }

  return (
    <TeamCtx.Provider value={{ profileId, profileName, teamId, teamName, setTeamContext }}>
      {children}
    </TeamCtx.Provider>
  );
}

export function useTeamContext() {
  return useContext(TeamCtx);
}