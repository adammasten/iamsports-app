import { useTeamContext } from '@/context';
import { supabase } from '@/supabase';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { initials, teamColor } from './select-team';

// Wall filter tabs — placeholders for now (selecting just highlights).
const TABS = [
  { key: 'shared', label: 'Shared with you' },
  { key: 'wall', label: 'Wall' },
  { key: 'games', label: 'Games' },
  { key: 'clips', label: 'Clips' },
  { key: 'sport', label: 'Sport' },
];

export default function KidWallScreen() {
  const insets = useSafeAreaInsets();
  const { refreshKids } = useTeamContext();
  const params = useLocalSearchParams();
  const playerId = Array.isArray(params.playerId) ? params.playerId[0] : params.playerId;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [gradClass, setGradClass] = useState('');
  const [selectedTab, setSelectedTab] = useState('shared');

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

  // Save via update_kid RPC (SECURITY DEFINER) — direct UPDATE is blocked for a
  // parent by players_update RLS. Returns to the wall view (no navigation).
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
    setEditing(false);
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top + 12 }]}>
        <ActivityIndicator size="large" color="#534AB7" />
      </View>
    );
  }

  // Edit form (name + grad class) — mirrors the create/add-kid forms.
  if (editing) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => setEditing(false)} style={styles.back}>
          <Text style={styles.backText}>← Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Edit kid</Text>
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
      </View>
    );
  }

  // Wall (stub).
  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <View style={styles.topRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setEditing(true)} style={styles.editBtn} hitSlop={8}>
          <Ionicons name="create-outline" size={18} color="#534AB7" />
          <Text style={styles.editText}>Edit</Text>
        </TouchableOpacity>
      </View>

      {/* Header: avatar + name + grad class + sports row */}
      <View style={styles.headerBlock}>
        <View style={[styles.avatar, { backgroundColor: teamColor(playerId || name) }]}>
          {/* A photo could replace this initials text later. */}
          <Text style={styles.avatarText}>{initials(name)}</Text>
        </View>
        <Text style={styles.name}>{name}</Text>
        {gradClass ? <Text style={styles.grad}>{gradClass}</Text> : null}
        {/* Sports row — placeholder until sports data is wired. */}
        <Text style={styles.sports}>No sports yet</Text>
      </View>

      {/* Filter bar */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterBar}
        style={styles.filterBarWrap}
      >
        {TABS.map(tab => {
          const active = selectedTab === tab.key;
          return (
            <TouchableOpacity key={tab.key} style={styles.tab} onPress={() => setSelectedTab(tab.key)}>
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{tab.label}</Text>
              {/* Unseen-count badge slot — render here when wired (count > 0). */}
              {active && <View style={styles.tabUnderline} />}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Content */}
      <View style={styles.content}>
        <Text style={styles.empty}>Nothing here yet</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', paddingHorizontal: 20 },
  center: { alignItems: 'center', justifyContent: 'center' },

  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  back: { paddingVertical: 8 },
  backText: { color: '#534AB7', fontSize: 16 },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8 },
  editText: { color: '#534AB7', fontSize: 16 },

  headerBlock: { alignItems: 'center', marginTop: 8, marginBottom: 20 },
  avatar: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  avatarText: { color: '#fff', fontSize: 32, fontWeight: '700' },
  name: { color: '#fff', fontSize: 26, fontWeight: '700', textAlign: 'center' },
  grad: { color: '#aaa', fontSize: 14, marginTop: 4, textAlign: 'center' },
  sports: { color: '#666', fontSize: 13, marginTop: 8, textAlign: 'center' },

  filterBarWrap: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: '#222' },
  filterBar: { gap: 20, paddingRight: 8 },
  tab: { paddingBottom: 10, alignItems: 'center' },
  tabText: { color: '#888', fontSize: 14, fontWeight: '600' },
  tabTextActive: { color: '#fff' },
  tabUnderline: { height: 2, backgroundColor: '#534AB7', alignSelf: 'stretch', marginTop: 8 },

  content: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { color: '#555', fontSize: 15 },

  // Reserved for future unseen-count badges on the filter tabs (not rendered yet).
  badge: { minWidth: 16, height: 16, borderRadius: 8, backgroundColor: '#D85A30', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },

  // Edit form (reused from the previous kid.tsx).
  title: { color: '#fff', fontSize: 28, fontWeight: '700', marginBottom: 24, marginTop: 8 },
  label: { color: '#aaa', fontSize: 13, fontWeight: '600', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { backgroundColor: '#1a1a1a', borderRadius: 8, padding: 14, marginBottom: 18, fontSize: 16, borderWidth: 1, borderColor: '#333', color: '#fff' },
  saveBtn: { backgroundColor: '#534AB7', borderRadius: 8, padding: 16, alignItems: 'center', marginTop: 8 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
