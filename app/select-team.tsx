import { useTeamContext } from '@/context';
import { supabase } from '@/supabase';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

export default function SelectTeamScreen() {
  const { setTeamContext } = useTeamContext();
  const [profiles, setProfiles] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<any>(null);
  const [showNewProfile, setShowNewProfile] = useState(false);
  const [showNewTeam, setShowNewTeam] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamSport, setNewTeamSport] = useState('Basketball');

  useEffect(() => { fetchProfiles(); }, []);

  async function fetchProfiles() {
    const { data } = await supabase.from('profiles').select('*').order('created_at');
    setProfiles(data || []);
  }

  async function fetchTeams(profileId: string) {
    const { data } = await supabase.from('teams').select('*').eq('profile_id', profileId).order('created_at');
    setTeams(data || []);
  }

  async function createProfile() {
    if (!newProfileName) { Alert.alert('Enter a name'); return; }
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('profiles').insert({ name: newProfileName, user_id: user?.id });
    if (error) Alert.alert('Error', error.message);
    else { fetchProfiles(); setShowNewProfile(false); setNewProfileName(''); }
  }

  async function createTeam() {
    if (!newTeamName || !selectedProfile) { Alert.alert('Enter a team name'); return; }
    const { error } = await supabase.from('teams').insert({ name: newTeamName, sport: newTeamSport, profile_id: selectedProfile.id });
    if (error) Alert.alert('Error', error.message);
    else { fetchTeams(selectedProfile.id); setShowNewTeam(false); setNewTeamName(''); }
  }

  async function selectTeam(team: any) {
    setTeamContext(selectedProfile.id, selectedProfile.name, team.id, team.name);
    router.replace({ 
      pathname: '/', 
      params: { 
        teamId: team.id, 
        teamName: team.name, 
        profileName: selectedProfile.name,
        profileId: selectedProfile.id
      } 
    });
  }

  async function selectAllTeams() {
    setTeamContext(selectedProfile.id, selectedProfile.name, 'all', `All ${selectedProfile.name}'s Teams`);
    router.replace({ 
      pathname: '/', 
      params: { 
        teamId: 'all', 
        teamName: `All ${selectedProfile.name}'s Teams`, 
        profileName: selectedProfile.name,
        profileId: selectedProfile.id
      } 
    });
  }

  if (!selectedProfile) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>🏀 IamSports</Text>
        <Text style={styles.subtitle}>Who are we filming today?</Text>

        {showNewProfile ? (
          <View style={styles.form}>
            <TextInput style={styles.input} placeholder="Player name (e.g. Conrad)" value={newProfileName} onChangeText={setNewProfileName} autoFocus />
            <TouchableOpacity style={styles.saveBtn} onPress={createProfile}>
              <Text style={styles.saveBtnText}>Create Profile</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowNewProfile(false)}>
              <Text style={styles.cancel}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <FlatList
              data={profiles}
              keyExtractor={item => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.card} onPress={() => { setSelectedProfile(item); fetchTeams(item.id); }}>
                  <Text style={styles.cardTitle}>{item.name}</Text>
                  <Text style={styles.cardArrow}>→</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={<Text style={styles.empty}>No profiles yet. Create one!</Text>}
            />
            <TouchableOpacity style={styles.newBtn} onPress={() => setShowNewProfile(true)}>
              <Text style={styles.newBtnText}>+ New Profile</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => { setSelectedProfile(null); setTeams([]); }} style={styles.back}>
        <Text style={styles.backText}>← Back to Profiles</Text>
      </TouchableOpacity>
      <Text style={styles.title}>🏀 IamSports</Text>
      <Text style={styles.subtitle}>{selectedProfile.name}'s Teams</Text>

      {showNewTeam ? (
        <View style={styles.form}>
          <TextInput style={styles.input} placeholder="Team name (e.g. Travel Team)" value={newTeamName} onChangeText={setNewTeamName} autoFocus />
          <TextInput style={styles.input} placeholder="Sport (e.g. Basketball)" value={newTeamSport} onChangeText={setNewTeamSport} />
          <TouchableOpacity style={styles.saveBtn} onPress={createTeam}>
            <Text style={styles.saveBtnText}>Create Team</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowNewTeam(false)}>
            <Text style={styles.cancel}>Cancel</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <TouchableOpacity style={[styles.card, styles.allTeamsCard]} onPress={selectAllTeams}>
            <Text style={[styles.cardTitle, { color: '#fff' }]}>View All {selectedProfile.name}'s Teams</Text>
            <Text style={[styles.cardArrow, { color: '#fff' }]}>→</Text>
          </TouchableOpacity>

          <FlatList
            data={teams}
            keyExtractor={item => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.card} onPress={() => selectTeam(item)}>
                <View>
                  <Text style={styles.cardTitle}>{item.name}</Text>
                  <Text style={styles.cardSub}>{item.sport}</Text>
                </View>
                <Text style={styles.cardArrow}>→</Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={<Text style={styles.empty}>No teams yet. Create one!</Text>}
          />
          <TouchableOpacity style={styles.newBtn} onPress={() => setShowNewTeam(true)}>
            <Text style={styles.newBtnText}>+ New Team</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, paddingTop: 60, backgroundColor: '#fff' },
  back: { marginBottom: 16 },
  backText: { color: '#534AB7', fontSize: 16 },
  title: { fontSize: 32, fontWeight: '700', marginBottom: 4 },
  subtitle: { fontSize: 18, color: '#666', marginBottom: 32 },
  card: { backgroundColor: '#f5f5f5', borderRadius: 12, padding: 16, marginBottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  allTeamsCard: { backgroundColor: '#534AB7' },
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