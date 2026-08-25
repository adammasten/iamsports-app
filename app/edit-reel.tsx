import { useTeamContext } from '@/context';
import { loadHiddenTagIds } from '@/lib/core/hiddenTags';
import { supabase } from '@/supabase';
import { useLocalSearchParams } from 'expo-router';
import { goBackOrHome } from '@/lib/nav';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { webAlert } from '@/lib/webAlert';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Dropdown, { type DropdownOption } from './components/Dropdown';

// Edit a reel's basics: name, team, and descriptive tags. The tags are chosen
// from the same tag library the tagging screens use (scoped global + the reel's
// team) so the Film Room / Coaches' Corner filters sort reels by them exactly
// like games. Reached from the Film Room reel long-press → "Edit reel".
//
// Tags here are independent of the source clips' tags — a reel about defense can
// be tagged "Defense" even if its clips weren't. On save we diff reel_tags
// (insert added, delete removed) so re-saving is idempotent.

const CATEGORIES = [
  { key: 'offense', label: 'Offense', color: '#1a6fd4' },
  { key: 'defense', label: 'Defense', color: '#c0392b' },
  { key: 'plays', label: 'Plays', color: '#1e8449' },
  { key: 'players', label: 'Players', color: '#7d3c98' },
];

type Tag = { id: string; name: string; category: string };

export default function EditReelScreen() {
  const insets = useSafeAreaInsets();
  const { userTeams } = useTeamContext();
  const params = useLocalSearchParams();
  const reelId = Array.isArray(params.id) ? params.id[0] : params.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [teamId, setTeamId] = useState('');           // '' = no team
  const [tags, setTags] = useState<Tag[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [origTagIds, setOrigTagIds] = useState<Set<string>>(new Set());

  // Reels are team-optional, so "None" is allowed here (unlike games).
  const teamOptions = useMemo<DropdownOption[]>(() => {
    const seen = new Map<string, string>();
    userTeams.forEach(t => { if (!seen.has(t.team_id)) seen.set(t.team_id, t.name); });
    return [{ value: '', label: 'None' }, ...[...seen].map(([value, label]) => ({ value, label }))];
  }, [userTeams]);

  // Load the reel + its current tags.
  useEffect(() => {
    (async () => {
      if (!reelId) { setLoading(false); return; }
      const { data: r, error } = await supabase.from('highlight_reels').select('id, name, team_id').eq('id', reelId).single();
      if (error || !r) { webAlert('Error', error?.message ?? 'Reel not found'); goBackOrHome(); return; }
      setName(r.name ?? '');
      setTeamId(r.team_id ?? '');
      const { data: rt } = await supabase.from('reel_tags').select('tag_id').eq('reel_id', reelId);
      const ids = new Set<string>((rt || []).map((x: any) => x.tag_id));
      setSelected(ids);
      setOrigTagIds(ids);
      setLoading(false);
    })();
  }, [reelId]);

  // Load tags for the current team scope (global + the selected team). Prune any
  // selected tags that fall out of scope, so what's shown selected is what saves.
  useEffect(() => {
    if (loading) return;
    (async () => {
      let q = supabase.from('tags').select('id, name, category').order('sort_order');
      q = teamId
        ? q.or(`scope.eq.global,and(scope.eq.team,team_id.eq.${teamId})`)
        : q.eq('scope', 'global');
      const { data } = await q;
      // Honor the team's hidden-tag list here too, so a hidden tag doesn't reappear
      // when building a reel.
      const hidden = teamId ? await loadHiddenTagIds(teamId).catch(() => new Set<string>()) : new Set<string>();
      const list = ((data as Tag[]) || []).filter(t => !hidden.has(t.id));
      setTags(list);
      const inScope = new Set(list.map(t => t.id));
      setSelected(prev => new Set([...prev].filter(id => inScope.has(id))));
    })();
  }, [teamId, loading]);

  function toggle(id: string) {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  async function save() {
    if (!reelId) return;
    if (!name.trim()) { webAlert('Name required', 'Give the reel a name.'); return; }
    setSaving(true);
    const { error: rErr } = await supabase.from('highlight_reels')
      .update({ name: name.trim(), team_id: teamId || null }).eq('id', reelId);
    if (rErr) { webAlert('Error', rErr.message); setSaving(false); return; }

    // Diff reel_tags against what was loaded.
    const toAdd = [...selected].filter(id => !origTagIds.has(id));
    const toRemove = [...origTagIds].filter(id => !selected.has(id));
    if (toRemove.length > 0) {
      const { error } = await supabase.from('reel_tags').delete().eq('reel_id', reelId).in('tag_id', toRemove);
      if (error) { webAlert('Error', error.message); setSaving(false); return; }
    }
    if (toAdd.length > 0) {
      const { error } = await supabase.from('reel_tags').insert(toAdd.map(tag_id => ({ reel_id: reelId, tag_id })));
      if (error) { webAlert('Error', error.message); setSaving(false); return; }
    }
    setSaving(false);
    goBackOrHome();
  }

  if (loading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
        <View style={styles.center}><ActivityIndicator size="large" color="#534AB7" /></View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <TouchableOpacity onPress={goBackOrHome} style={styles.back}><Text style={styles.backText}>← Back</Text></TouchableOpacity>
      <Text style={styles.title}>Edit reel</Text>

      <ScrollView contentContainerStyle={{ paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Name</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Reel name" placeholderTextColor="#888" />

        <Text style={styles.label}>Team</Text>
        <Dropdown value={teamId} options={teamOptions} onSelect={setTeamId} placeholder="None" />

        <Text style={styles.label}>Tags</Text>
        <Text style={styles.hint}>Describe the reel so you can sort by it — e.g. Defense, Press break. These are independent of the clips’ tags.</Text>
        {CATEGORIES.map(cat => {
          const catTags = tags.filter(t => t.category === cat.key);
          if (catTags.length === 0) return null;
          return (
            <View key={cat.key} style={styles.catBlock}>
              <Text style={[styles.catHeader, { color: cat.color }]}>{cat.label.toUpperCase()}</Text>
              <View style={styles.chipsWrap}>
                {catTags.map(t => {
                  const on = selected.has(t.id);
                  return (
                    <TouchableOpacity
                      key={t.id}
                      onPress={() => toggle(t.id)}
                      style={[styles.chip, on ? { backgroundColor: cat.color, borderColor: cat.color } : { borderColor: cat.color }]}
                    >
                      <Text style={[styles.chipText, on ? { color: '#fff' } : { color: cat.color }]}>{t.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          );
        })}
        {tags.length === 0 ? <Text style={styles.hint}>No tags available for this scope yet.</Text> : null}

        <TouchableOpacity style={[styles.saveBtn, saving && styles.saveBtnDisabled]} onPress={save} disabled={saving}>
          <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save changes'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', paddingHorizontal: 20 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  back: { paddingVertical: 8 },
  backText: { color: '#534AB7', fontSize: 16 },
  title: { color: '#fff', fontSize: 28, fontWeight: '700', marginBottom: 16, marginTop: 8 },

  label: { color: '#aaa', fontSize: 13, fontWeight: '600', marginTop: 18, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  hint: { color: '#666', fontSize: 13, lineHeight: 18, marginBottom: 6 },
  input: { backgroundColor: '#1a1a1a', borderRadius: 8, padding: 14, fontSize: 16, borderWidth: 1, borderColor: '#333', color: '#fff', marginTop: 6 },

  catBlock: { marginTop: 14 },
  catHeader: { fontSize: 12, fontWeight: '800', letterSpacing: 0.5, marginBottom: 8 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1.5, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7 },
  chipText: { fontSize: 13, fontWeight: '700' },

  saveBtn: { backgroundColor: '#534AB7', borderRadius: 8, padding: 16, alignItems: 'center', marginTop: 24 },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
