import { useTeamContext } from '@/context';
import { supabase } from '@/supabase';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

export default function SelectTeamScreen() {
  const { userId, userTeams, setActiveTeam, refreshTeams } = useTeamContext();
  const [showNewTeam, setShowNewTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamSport, setNewTeamSport] = useState('Basketball');
  const [creating, setCreating] = useState(false);

  // userTeams can have duplicate team_id when the user holds multiple roles on
  // the same team (UNIQUE key is (team_id, user_id, role)). Show one card per
  // team; role chip / highest-role display is a future polish.
  const uniqueTeams = Array.from(
    new Map(userTeams.map(t => [t.team_id, t])).values()
  );

  async function createTeam() {
    if (!newTeamName.trim()) { Alert.alert('Enter a team name'); return; }
    if (!newTeamSport.trim()) { Alert.alert('Enter a sport'); return; }
    if (!userId) { Alert.alert('Not signed in'); return; }
    setCreating(true);

    const { data: team, error: teamError } = await supabase
      .from('teams')
      .insert({ name: newTeamName.trim(), sport: newTeamSport.trim(), created_by_user_id: userId })
      .select()
      .single();
    if (teamError || !team) {
      Alert.alert('Error creating team', teamError?.message ?? 'unknown');
      setCreating(false);
      return;
    }

    // Two-step write: team insert succeeded. If the membership insert fails,
    // best-effort delete the just-created team to avoid leaving an orphan.
    // The cleanup delete itself isn't guaranteed (network may stay flaky),
    // but the common case — a transient failure on the second write — is
    // covered. Right long-term fix is a DB trigger that creates the admin
    // membership atomically on team insert; belongs in Step 3 alongside RLS.
    const { error: memberError } = await supabase
      .from('team_memberships')
      .insert({ team_id: team.id, user_id: userId, role: 'admin', status: 'confirmed' });
    if (memberError) {
      await supabase.from('teams').delete().eq('id', team.id);
      Alert.alert('Error joining team', memberError.message);
      setCreating(false);
      return;
    }

    await refreshTeams();
    setActiveTeam(team.id);
    setNewTeamName('');
    setShowNewTeam(false);
    setCreating(false);
    router.replace('/');
  }

  function selectTeam(teamId: string) {
    setActiveTeam(teamId);
    router.replace('/');
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🏀 IamSports</Text>
      <Text style={styles.subtitle}>Pick a team</Text>

      {showNewTeam ? (
        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Team name (e.g. Travel Team)"
            value={newTeamName}
            onChangeText={setNewTeamName}
            autoFocus
            editable={!creating}
          />
          <TextInput
            style={styles.input}
            placeholder="Sport (e.g. Basketball)"
            value={newTeamSport}
            onChangeText={setNewTeamSport}
            editable={!creating}
          />
          <TouchableOpacity style={styles.saveBtn} onPress={createTeam} disabled={creating}>
            <Text style={styles.saveBtnText}>{creating ? 'Creating…' : 'Create Team'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowNewTeam(false)} disabled={creating}>
            <Text style={styles.cancel}>Cancel</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <FlatList
            data={uniqueTeams}
            keyExtractor={item => item.team_id}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.card} onPress={() => selectTeam(item.team_id)}>
                <View>
                  <Text style={styles.cardTitle}>{item.name}</Text>
                  <Text style={styles.cardSub}>{item.sport}</Text>
                </View>
                <Text style={styles.cardArrow}>→</Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={<Text style={styles.empty}>No teams yet. Create your first one below!</Text>}
          />
          <TouchableOpacity style={styles.newBtn} onPress={() => setShowNewTeam(true)}>
            <Text style={styles.newBtnText}>+ Create Team</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, paddingTop: 60, backgroundColor: '#fff' },
  title: { fontSize: 32, fontWeight: '700', marginBottom: 4 },
  subtitle: { fontSize: 18, color: '#666', marginBottom: 32 },
  card: { backgroundColor: '#f5f5f5', borderRadius: 12, padding: 16, marginBottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 18, fontWeight: '600' },
  cardSub: { fontSize: 13, color: '#888', marginTop: 2 },
  cardArrow: { fontSize: 20, color: '#888' },
  form: { backgroundColor: '#f5f5f5', borderRadius: 12, padding: 16, marginBottom: 16 },
  input: { backgroundColor: '#fff', borderRadius: 8, padding: 12, marginBottom: 10, fontSize: 16, borderWidth: 1, borderColor: '#ddd' },
  saveBtn: { backgroundColor: '#534AB7', borderRadius: 8, padding: 14, alignItems: 'center', marginBottom: 8 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cancel: { textAlign: 'center', color: '#888', fontSize: 14 },
  newBtn: { backgroundColor: '#534AB7', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 8 },
  newBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  empty: { textAlign: 'center', color: '#888', marginTop: 40, fontSize: 16 },
});
