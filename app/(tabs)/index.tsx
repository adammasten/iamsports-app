import { supabase } from '@/supabase';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

export default function HomeScreen() {
  const params = useLocalSearchParams();
  const teamId = Array.isArray(params.teamId) ? params.teamId[0] : params.teamId;
  const teamName = Array.isArray(params.teamName) ? params.teamName[0] : params.teamName;
  const profileName = Array.isArray(params.profileName) ? params.profileName[0] : params.profileName;
  const profileId = Array.isArray(params.profileId) ? params.profileId[0] : params.profileId;

  const [games, setGames] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [opponent, setOpponent] = useState('');
  const [gameDate, setGameDate] = useState('');

  useEffect(() => {
    fetchGames();
  }, [teamId, profileId]);

  async function fetchGames() {
    setLoading(true);
    let query = supabase.from('games').select('*').order('created_at', { ascending: false });

    if (teamId && teamId !== 'all') {
      query = query.eq('team_id', teamId);
    } else if (profileId) {
      const { data: profileTeams } = await supabase.from('teams').select('id').eq('profile_id', profileId);
      const teamIds = (profileTeams || []).map((t: any) => t.id);
      if (teamIds.length > 0) {
        query = query.in('team_id', teamIds);
      } else {
        setGames([]);
        setLoading(false);
        return;
      }
    }

    const { data, error } = await query;
    if (error) Alert.alert('Error', error.message);
    else setGames(data || []);
    setLoading(false);
  }

  async function createGame() {
    if (!opponent || !gameDate) { Alert.alert('Please fill in all fields'); return; }
    const gameData: any = { title: `vs ${opponent}`, opponent, game_date: gameDate };
    if (teamId && teamId !== 'all') gameData.team_id = teamId;
    const { error } = await supabase.from('games').insert(gameData);
    if (error) Alert.alert('Error', error.message);
    else {
      fetchGames();
      setShowForm(false);
      setOpponent('');
      setGameDate('');
    }
  }

  async function deleteGame(id: string, title: string) {
    Alert.alert('Delete Game', `Delete "${title}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        const { error } = await supabase.from('games').delete().eq('id', id);
        if (error) Alert.alert('Error', error.message);
        else fetchGames();
      }}
    ]);
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace('/select-team')}>
          <Text style={styles.profileBtn}>← {profileName || 'Switch'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={signOut}>
          <Text style={styles.signOut}>Sign out</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.title}>🏀 IamSports</Text>
      <Text style={styles.teamName}>{teamName || 'All Teams'}</Text>

      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.newGame} onPress={() => setShowForm(!showForm)}>
          <Text style={styles.newGameText}>{showForm ? 'Cancel' : '+ New Game'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.exportBtn} onPress={() => router.push('/export')}>
          <Text style={styles.exportBtnText}>Export</Text>
        </TouchableOpacity>
      </View>

      {showForm && (
        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Opponent name"
            value={opponent}
            onChangeText={setOpponent}
          />
          <TextInput
            style={styles.input}
            placeholder="Game date (MM/DD/YYYY)"
            value={gameDate}
            onChangeText={setGameDate}
          />
          <TouchableOpacity style={styles.saveBtn} onPress={createGame}>
            <Text style={styles.saveBtnText}>Save Game</Text>
          </TouchableOpacity>
        </View>
      )}

      {loading ? (
        <Text style={styles.empty}>Loading...</Text>
      ) : games.length === 0 ? (
        <Text style={styles.empty}>No games yet. Create your first one!</Text>
      ) : (
        <FlatList
          data={games}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.gameCard}
              onPress={() => router.push({ pathname: '/game', params: { id: item.id, title: item.title } })}
              onLongPress={() => deleteGame(item.id, item.title)}
            >
              <Text style={styles.gameTitle}>{item.title}</Text>
              <Text style={styles.gameDate}>{item.game_date || 'No date set'}</Text>
              <Text style={styles.hint}>Tap to open • Hold to delete</Text>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, paddingTop: 60, backgroundColor: '#fff' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  profileBtn: { color: '#534AB7', fontSize: 14, fontWeight: '600' },
  signOut: { color: '#888', fontSize: 14 },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 2 },
  teamName: { fontSize: 16, color: '#534AB7', fontWeight: '600', marginBottom: 20 },
  buttonRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  newGame: { flex: 1, backgroundColor: '#534AB7', borderRadius: 12, padding: 16, alignItems: 'center' },
  newGameText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  exportBtn: { flex: 1, backgroundColor: '#1D9E75', borderRadius: 12, padding: 16, alignItems: 'center' },
  exportBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  form: { backgroundColor: '#f5f5f5', borderRadius: 12, padding: 16, marginBottom: 16 },
  input: { backgroundColor: '#fff', borderRadius: 8, padding: 12, marginBottom: 10, fontSize: 16, borderWidth: 1, borderColor: '#ddd' },
  saveBtn: { backgroundColor: '#534AB7', borderRadius: 8, padding: 14, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  gameCard: { backgroundColor: '#f5f5f5', borderRadius: 12, padding: 16, marginBottom: 12 },
  gameTitle: { fontSize: 18, fontWeight: '600', marginBottom: 4 },
  gameDate: { fontSize: 13, color: '#888', marginBottom: 4 },
  hint: { fontSize: 11, color: '#ccc' },
  empty: { textAlign: 'center', color: '#888', marginTop: 60, fontSize: 16 },
});