import { useTeamContext } from '@/context';
import { computeSortOrderUpdates } from '@/lib/core/tag-reorder';
import { supabase } from '@/supabase';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

type Tag = { id: string; name: string; category: string; sort_order: number; scope: string; };

const CATEGORIES = [
  { key: 'offense', label: 'Offense', color: '#1a6fd4', bg: '#e8f0fe' },
  { key: 'defense', label: 'Defense', color: '#c0392b', bg: '#fde8e8' },
  { key: 'plays', label: 'Plays', color: '#1e8449', bg: '#e8f8ed' },
  { key: 'players', label: 'Players', color: '#7d3c98', bg: '#f5eef8' },
];

export default function TagsScreen() {
  const { profileId, profileName, teamId, teamName } = useTeamContext();
  const [tags, setTags] = useState<Record<string, Tag[]>>({ offense: [], defense: [], plays: [], players: [] });
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [newTagName, setNewTagName] = useState('');
  const [newTagScope, setNewTagScope] = useState<'global' | 'player' | 'team'>('player');

  useEffect(() => { fetchTags(); }, [profileId, teamId]);

  async function fetchTags() {
    let query = supabase.from('tags').select('*').order('sort_order');
    if (profileId && teamId && teamId !== 'all') {
      query = query.or(`scope.eq.global,and(scope.eq.player,profile_id.eq.${profileId}),and(scope.eq.team,team_id.eq.${teamId})`);
    } else if (profileId) {
      query = query.or(`scope.eq.global,and(scope.eq.player,profile_id.eq.${profileId})`);
    } else {
      query = query.eq('scope', 'global');
    }
    const { data } = await query;
    if (!data) return;
    const grouped: Record<string, Tag[]> = { offense: [], defense: [], plays: [], players: [] };
    data.forEach(t => { if (grouped[t.category]) grouped[t.category].push(t); });
    setTags(grouped);
  }

  async function addTag() {
    if (!newTagName || !addingTo) return;
    const existing = tags[addingTo];
    const tagData: any = { name: newTagName, category: addingTo, sort_order: existing.length, scope: newTagScope };
    if (newTagScope === 'player' && profileId) tagData.profile_id = profileId;
    if (newTagScope === 'team' && teamId && teamId !== 'all') tagData.team_id = teamId;
    const { error } = await supabase.from('tags').insert(tagData);
    if (error) Alert.alert('Error', error.message);
    else { fetchTags(); setNewTagName(''); setAddingTo(null); }
  }

  async function deleteTag(id: string, name: string) {
    Alert.alert(name, 'Delete this tag?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await supabase.from('tags').delete().eq('id', id);
        fetchTags();
      }}
    ]);
  }

  async function moveTag(catKey: string, fromIndex: number, toIndex: number) {
    const current = tags[catKey];
    if (toIndex < 0 || toIndex >= current.length) return;
    const reordered = [...current];
    [reordered[fromIndex], reordered[toIndex]] = [reordered[toIndex], reordered[fromIndex]];
    // Optimistic update: re-render the new order immediately, then persist diffs.
    setTags(prev => ({ ...prev, [catKey]: reordered }));
    const updates = computeSortOrderUpdates(reordered);
    if (updates.length === 0) return;
    await Promise.all(updates.map(update =>
      supabase.from('tags').update({ sort_order: update.sort_order }).eq('id', update.id)
    ));
  }

  function getScopeLabel(tag: Tag) {
    if (tag.scope === 'global') return '🌍';
    if (tag.scope === 'player') return '👤';
    if (tag.scope === 'team') return '🏀';
    return '';
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>My Tags</Text>
          <Text style={styles.context}>
            {profileName ? `${profileName}${teamName && teamId !== 'all' ? ` • ${teamName}` : ''}` : 'No team selected'}
          </Text>
          <Text style={styles.subtitle}>Long press a tag to delete • ▲▼ to reorder • 🌍 Global 👤 Player 🏀 Team</Text>
        </View>

        {addingTo && (
          <View style={styles.addForm}>
            <Text style={styles.addFormTitle}>
              Add to {CATEGORIES.find(c => c.key === addingTo)?.label}
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Tag name"
              value={newTagName}
              onChangeText={setNewTagName}
              autoFocus
              onSubmitEditing={addTag}
            />
            <Text style={styles.scopeLabel}>Add to:</Text>
            <View style={styles.scopeRow}>
              <TouchableOpacity
                style={[styles.scopeBtn, newTagScope === 'global' && styles.scopeBtnActive]}
                onPress={() => setNewTagScope('global')}
              >
                <Text style={[styles.scopeBtnText, newTagScope === 'global' && styles.scopeBtnTextActive]}>🌍 Everyone</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.scopeBtn, newTagScope === 'player' && styles.scopeBtnActive]}
                onPress={() => setNewTagScope('player')}
              >
                <Text style={[styles.scopeBtnText, newTagScope === 'player' && styles.scopeBtnTextActive]}>👤 {profileName || 'Player'}</Text>
              </TouchableOpacity>
              {teamId && teamId !== 'all' && (
                <TouchableOpacity
                  style={[styles.scopeBtn, newTagScope === 'team' && styles.scopeBtnActive]}
                  onPress={() => setNewTagScope('team')}
                >
                  <Text style={[styles.scopeBtnText, newTagScope === 'team' && styles.scopeBtnTextActive]}>🏀 {teamName || 'Team'}</Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={styles.formButtons}>
              <TouchableOpacity style={styles.saveBtn} onPress={addTag}>
                <Text style={styles.saveBtnText}>Add Tag</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => { setAddingTo(null); setNewTagName(''); }}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {CATEGORIES.map(cat => (
          <View key={cat.key}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: cat.color }]}>{cat.label}</Text>
              <TouchableOpacity onPress={() => { setAddingTo(cat.key); setNewTagName(''); }}>
                <Text style={[styles.addBtn, { color: cat.color }]}>+ Add</Text>
              </TouchableOpacity>
            </View>
            {tags[cat.key].map((tag, index) => {
              const isFirst = index === 0;
              const isLast = index === tags[cat.key].length - 1;
              return (
                <View key={tag.id} style={[styles.tagRow, { backgroundColor: cat.bg }]}>
                  <TouchableOpacity
                    style={styles.tagBody}
                    onLongPress={() => deleteTag(tag.id, tag.name)}
                    delayLongPress={400}
                  >
                    <Text style={[styles.tagText, { color: cat.color }]}>
                      {getScopeLabel(tag)} {tag.name}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => moveTag(cat.key, index, index - 1)}
                    disabled={isFirst}
                    style={[styles.moveBtn, isFirst && styles.moveBtnDisabled]}
                  >
                    <Text style={[styles.moveBtnText, { color: cat.color }]}>▲</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => moveTag(cat.key, index, index + 1)}
                    disabled={isLast}
                    style={[styles.moveBtn, isLast && styles.moveBtnDisabled]}
                  >
                    <Text style={[styles.moveBtnText, { color: cat.color }]}>▼</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingTop: 60, paddingBottom: 60 },
  header: { marginBottom: 24 },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 2 },
  context: { fontSize: 14, color: '#534AB7', fontWeight: '600', marginBottom: 4 },
  subtitle: { fontSize: 12, color: '#888' },
  addForm: { backgroundColor: '#f5f5f5', borderRadius: 12, padding: 16, marginBottom: 20 },
  addFormTitle: { fontSize: 14, fontWeight: '600', marginBottom: 10, color: '#333' },
  input: { backgroundColor: '#fff', borderRadius: 8, padding: 12, marginBottom: 10, fontSize: 16, borderWidth: 1, borderColor: '#ddd' },
  scopeLabel: { fontSize: 12, color: '#888', marginBottom: 8 },
  scopeRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  scopeBtn: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 8, alignItems: 'center' },
  scopeBtnActive: { backgroundColor: '#534AB7', borderColor: '#534AB7' },
  scopeBtnText: { fontSize: 11, color: '#666', fontWeight: '500' },
  scopeBtnTextActive: { color: '#fff' },
  formButtons: { flexDirection: 'row', gap: 10 },
  saveBtn: { flex: 1, backgroundColor: '#534AB7', borderRadius: 8, padding: 12, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  cancelBtn: { flex: 1, backgroundColor: '#f0f0f0', borderRadius: 8, padding: 12, alignItems: 'center' },
  cancelBtnText: { color: '#888', fontSize: 14 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, marginTop: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  addBtn: { fontSize: 14, fontWeight: '600' },
  tagRow: { flexDirection: 'row', alignItems: 'stretch', borderRadius: 8, marginBottom: 4, overflow: 'hidden' },
  tagBody: { flex: 1, paddingHorizontal: 10, paddingVertical: 12, justifyContent: 'center' },
  moveBtn: { paddingHorizontal: 14, paddingVertical: 12, minWidth: 44, backgroundColor: 'rgba(0,0,0,0.07)', alignItems: 'center', justifyContent: 'center', borderLeftWidth: 1, borderLeftColor: 'rgba(0,0,0,0.08)' },
  moveBtnDisabled: { opacity: 0.25 },
  moveBtnText: { fontSize: 18, fontWeight: '700' },
  tagText: { fontSize: 13, fontWeight: '500' },
});