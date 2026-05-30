import { useTeamContext } from '@/context';
import { supabase } from '@/supabase';
import DateTimePicker, { DateTimePickerAndroid, DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, FlatList, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

// Extract local YYYY-MM-DD from a Date. Never use .toISOString() — that
// converts via UTC and shifts the date by a day for users west of UTC
// (this app's users are US/Central, where any local date before 6am turns
// into the previous day in UTC). All three getters below return LOCAL time.
function dateToLocalYMD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Single source of truth for date display. Postgres returns the date column
// as a YYYY-MM-DD string; we split and reorder to DD/MM/YYYY without ever
// instantiating a Date object (which would re-introduce timezone risk).
function formatDate(ymd: string | null): string {
  if (!ymd) return 'No date set';
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

export default function HomeScreen() {
  const { activeTeam } = useTeamContext();

  const [games, setGames] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [opponent, setOpponent] = useState('');
  const [gameDate, setGameDate] = useState<Date>(new Date());

  useEffect(() => {
    if (activeTeam) {
      fetchGames(activeTeam.id);
    } else {
      setGames([]);
      setLoading(false);
    }
  }, [activeTeam]);

  async function fetchGames(teamId: string) {
    setLoading(true);
    const { data, error } = await supabase
      .from('games')
      .select('*')
      .eq('team_id', teamId)
      .order('game_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (error) Alert.alert('Error', error.message);
    else setGames(data || []);
    setLoading(false);
  }

  function toggleForm() {
    // Reset the picker default to "today" each time the form opens, so a
    // session that spans midnight doesn't show yesterday on the next open.
    if (!showForm) setGameDate(new Date());
    setShowForm(!showForm);
  }

  function onDateChange(_: DateTimePickerEvent, selected?: Date) {
    if (selected) setGameDate(selected);
  }

  function openAndroidPicker() {
    DateTimePickerAndroid.open({
      value: gameDate,
      mode: 'date',
      onChange: onDateChange,
    });
  }

  async function createGame() {
    if (!opponent.trim()) { Alert.alert('Enter an opponent'); return; }
    if (!activeTeam) { Alert.alert('No team selected'); return; }
    const { error } = await supabase
      .from('games')
      .insert({
        title: `vs ${opponent.trim()}`,
        opponent: opponent.trim(),
        game_date: dateToLocalYMD(gameDate),
        team_id: activeTeam.id,
      });
    if (error) Alert.alert('Error', error.message);
    else {
      await fetchGames(activeTeam.id);
      setShowForm(false);
      setOpponent('');
      setGameDate(new Date());
    }
  }

  async function deleteGame(id: string, title: string) {
    Alert.alert('Delete Game', `Delete "${title}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        const { error } = await supabase.from('games').delete().eq('id', id);
        if (error) Alert.alert('Error', error.message);
        else if (activeTeam) fetchGames(activeTeam.id);
      }}
    ]);
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  if (!activeTeam) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <View />
          <TouchableOpacity onPress={signOut}>
            <Text style={styles.signOut}>Sign out</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.title}>🏀 IamSports</Text>
        <Text style={styles.empty}>No team selected.</Text>
        <TouchableOpacity style={styles.newGame} onPress={() => router.replace('/select-team')}>
          <Text style={styles.newGameText}>Pick a team</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace('/select-team')}>
          <Text style={styles.switchBtn}>← Switch team</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={signOut}>
          <Text style={styles.signOut}>Sign out</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.title}>🏀 IamSports</Text>
      <Text style={styles.teamName}>{activeTeam.name}</Text>

      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.newGame} onPress={toggleForm}>
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
            autoFocus
          />
          <View style={styles.dateRow}>
            <Text style={styles.dateLabel}>Game date:</Text>
            {Platform.OS === 'ios' ? (
              <DateTimePicker
                value={gameDate}
                mode="date"
                display="compact"
                onChange={onDateChange}
              />
            ) : (
              <TouchableOpacity style={styles.dateBtn} onPress={openAndroidPicker}>
                <Text style={styles.dateBtnText}>{formatDate(dateToLocalYMD(gameDate))}</Text>
              </TouchableOpacity>
            )}
          </View>
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
              <Text style={styles.gameDate}>{formatDate(item.game_date)}</Text>
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
  switchBtn: { color: '#534AB7', fontSize: 14, fontWeight: '600' },
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
  dateRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 10 },
  dateLabel: { fontSize: 16, color: '#333' },
  dateBtn: { backgroundColor: '#fff', borderRadius: 8, padding: 12, borderWidth: 1, borderColor: '#ddd', flex: 1 },
  dateBtnText: { fontSize: 16, color: '#333' },
  saveBtn: { backgroundColor: '#534AB7', borderRadius: 8, padding: 14, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  gameCard: { backgroundColor: '#f5f5f5', borderRadius: 12, padding: 16, marginBottom: 12 },
  gameTitle: { fontSize: 18, fontWeight: '600', marginBottom: 4 },
  gameDate: { fontSize: 13, color: '#888', marginBottom: 4 },
  hint: { fontSize: 11, color: '#ccc' },
  empty: { textAlign: 'center', color: '#888', marginTop: 60, fontSize: 16 },
});
