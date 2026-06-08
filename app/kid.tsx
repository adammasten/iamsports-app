import { useTeamContext } from '@/context';
import { supabase } from '@/supabase';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function KidDetailScreen() {
  const insets = useSafeAreaInsets();
  const { refreshKids } = useTeamContext();
  const params = useLocalSearchParams();
  const playerId = Array.isArray(params.playerId) ? params.playerId[0] : params.playerId;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [gradClass, setGradClass] = useState('');

  // Load this one kid's row (read allowed via the is_linked_parent branch).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!playerId) { setLoading(false); return; }
      const { data, error } = await supabase
        .from('players')
        .select('id, name, grad_class')
        .eq('id', playerId)
        .single();
      if (cancelled) return;
      if (error || !data) {
        Alert.alert('Error', error?.message ?? 'Could not load kid');
        setLoading(false);
        return;
      }
      setName(data.name ?? '');
      setGradClass(data.grad_class ?? '');
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [playerId]);

  // Save via the update_kid RPC (SECURITY DEFINER) — direct UPDATE is blocked
  // for a parent by players_update RLS. refreshKids() updates the home rail.
  async function save() {
    if (!name.trim()) { Alert.alert("Enter the kid's name"); return; }
    if (!playerId) return;
    setSaving(true);
    const { error } = await supabase.rpc('update_kid', {
      player_id: playerId,
      name: name.trim(),
      grad_class: gradClass.trim() || null,
    });
    if (error) {
      Alert.alert('Error saving', error.message);
      setSaving(false);
      return;
    }
    await refreshKids();
    setSaving(false);
    router.back();
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <TouchableOpacity onPress={() => router.back()} style={styles.back}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>
      <Text style={styles.title}>Edit kid</Text>

      {loading ? (
        <ActivityIndicator size="large" color="#534AB7" style={{ marginTop: 40 }} />
      ) : (
        <>
          <Text style={styles.label}>Name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Kid's name"
            placeholderTextColor="#888"
            editable={!saving}
            autoFocus
          />
          <Text style={styles.label}>Grad class</Text>
          <TextInput
            style={styles.input}
            value={gradClass}
            onChangeText={setGradClass}
            placeholder="e.g. 2032/2033"
            placeholderTextColor="#888"
            editable={!saving}
          />
          <TouchableOpacity style={styles.saveBtn} onPress={save} disabled={saving}>
            <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', paddingHorizontal: 20 },
  back: { paddingVertical: 8 },
  backText: { color: '#534AB7', fontSize: 16 },
  title: { color: '#fff', fontSize: 28, fontWeight: '700', marginBottom: 24, marginTop: 8 },
  label: { color: '#aaa', fontSize: 13, fontWeight: '600', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { backgroundColor: '#1a1a1a', borderRadius: 8, padding: 14, marginBottom: 18, fontSize: 16, borderWidth: 1, borderColor: '#333', color: '#fff' },
  saveBtn: { backgroundColor: '#534AB7', borderRadius: 8, padding: 16, alignItems: 'center', marginTop: 8 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
