// Coach edits which players are attributed to a game (game_lineups). A checklist
// of the roster (+ anyone already in the lineup); toggling drives who keeps the
// game in their family archive. Reads/writes via coach-gated RPCs.
import { goBackOrHome } from '@/lib/nav';
import { supabase } from '@/supabase';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Row = { player_id: string; label: string; in_lineup: boolean };

export default function EditLineupScreen() {
  const params = useLocalSearchParams();
  const gameId = Array.isArray(params.gameId) ? params.gameId[0] : params.gameId;
  const gameTitle = Array.isArray(params.gameTitle) ? params.gameTitle[0] : (params.gameTitle as string);
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!gameId) return;
      const { data, error } = await supabase.rpc('get_game_lineup_editor', { p_game_id: gameId });
      if (cancelled) return;
      if (error) { Alert.alert('Error', error.message); setLoading(false); return; }
      setRows((data as Row[]) ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [gameId]);

  function toggle(id: string) {
    setRows(prev => prev.map(r => (r.player_id === id ? { ...r, in_lineup: !r.in_lineup } : r)));
  }

  async function save() {
    if (!gameId) return;
    setSaving(true);
    const ids = rows.filter(r => r.in_lineup).map(r => r.player_id);
    const { error } = await supabase.rpc('set_game_lineup', { p_game_id: gameId, p_player_ids: ids });
    setSaving(false);
    if (error) { Alert.alert('Error', error.message); return; }
    goBackOrHome();
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <TouchableOpacity onPress={goBackOrHome} style={styles.back}><Text style={styles.backText}>← Back</Text></TouchableOpacity>
      <Text style={styles.title}>Who played</Text>
      <Text style={styles.subtitle} numberOfLines={1}>{gameTitle || 'Game'} · tap to include a player</Text>
      {loading ? (
        <ActivityIndicator size="large" color="#534AB7" style={{ marginTop: 40 }} />
      ) : rows.length === 0 ? (
        <Text style={styles.empty}>No players on this team yet. Add them on the Roster.</Text>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.player_id}
          contentContainerStyle={{ paddingBottom: 100 }}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.row} onPress={() => toggle(item.player_id)} activeOpacity={0.7}>
              <Ionicons name={item.in_lineup ? 'checkbox' : 'square-outline'} size={24} color={item.in_lineup ? '#534AB7' : '#666'} />
              <Text style={[styles.rowLabel, !item.in_lineup && styles.rowLabelOff]}>{item.label}</Text>
            </TouchableOpacity>
          )}
        />
      )}
      {!loading && rows.length > 0 && (
        <TouchableOpacity style={[styles.saveBtn, { bottom: insets.bottom + 16 }]} onPress={save} disabled={saving} activeOpacity={0.8}>
          <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save lineup'}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', paddingHorizontal: 20 },
  back: { marginBottom: 8 },
  backText: { color: '#534AB7', fontSize: 16, fontWeight: '600' },
  title: { color: '#fff', fontSize: 26, fontWeight: '800' },
  subtitle: { color: '#888', fontSize: 13, marginTop: 2, marginBottom: 16 },
  empty: { color: '#666', fontSize: 14, textAlign: 'center', marginTop: 40 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1c1c1c' },
  rowLabel: { color: '#fff', fontSize: 16, fontWeight: '600' },
  rowLabelOff: { color: '#777', fontWeight: '500' },
  saveBtn: { position: 'absolute', left: 20, right: 20, backgroundColor: '#534AB7', borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
