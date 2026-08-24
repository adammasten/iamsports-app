// The Vault — the community play bank. Deliberately mirrors My Playbook's layout
// (same header, grid, and cards) so it feels like one product; the only difference
// is the action: "Add to Playbook" copies the diagram into your own library.
import PlayPlayer from '@/components/PlayPlayer';
import { useTeamContext } from '@/context';
import { fetchVaultPlays, grabPlay, type VaultPlay } from '@/lib/core/playbook/library';
import { tagColor } from '@/lib/core/playbook/tags';
import { goBackOrHome } from '@/lib/nav';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import WebTopNav from './components/WebTopNav';

function webSafeAlert(title: string, message: string) {
  if (Platform.OS === 'web') { if (typeof window !== 'undefined') window.alert(message); return; }
  Alert.alert(title, message);
}
const SPORT_LABEL: Record<string, string> = { basketball: 'Basketball', football: 'Football / Flag' };

export default function PlayVault() {
  const { userId } = useTeamContext();
  const [plays, setPlays] = useState<VaultPlay[]>([]);
  const [loading, setLoading] = useState(true);
  const [sport, setSport] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [grabbing, setGrabbing] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setLoading(true);
    fetchVaultPlays().then(setPlays).catch(e => webSafeAlert('The Vault', e?.message ?? 'Could not load plays.')).finally(() => setLoading(false));
  }, []);

  const sports = useMemo(() => Array.from(new Set(plays.map(p => p.sport))).sort(), [plays]);
  const tags = useMemo(() => {
    const s = new Set<string>();
    plays.filter(p => !sport || p.sport === sport).forEach(p => p.tags.forEach(t => s.add(t)));
    return Array.from(s).sort();
  }, [plays, sport]);
  const filtered = useMemo(() => plays.filter(p => (!sport || p.sport === sport) && (!tag || p.tags.includes(tag))), [plays, sport, tag]);

  async function grab(p: VaultPlay) {
    if (!userId) return;
    setGrabbing(p.id);
    try {
      await grabPlay(p.id);
      setPlays(prev => prev.map(x => x.id === p.id ? { ...x, saveCount: x.saveCount + 1 } : x));
      setDone(d => ({ ...d, [p.id]: true }));
    } catch (e: any) { webSafeAlert('Add to playbook', e?.message ?? 'Could not add the play.'); }
    finally { setGrabbing(null); }
  }

  return (
    <View style={styles.screen}>
      {Platform.OS === 'web' ? <WebTopNav /> : null}
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={goBackOrHome} hitSlop={8} style={styles.back}><Text style={styles.backTxt}>← Back</Text></Pressable>
        <Text style={styles.eyebrow}>THE VAULT</Text>
        <Text style={styles.h1}>Community plays</Text>
        <Text style={styles.sub}>Plays from coaches everywhere. Watch any one, then add it to your playbook — the diagram becomes yours to edit and run.</Text>

        {sports.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={styles.chipRowInner}>
            <Pressable onPress={() => { setSport(null); setTag(null); }} style={[styles.chip, !sport && styles.chipOn]}><Text style={[styles.chipTxt, !sport && styles.chipTxtOn]}>All sports</Text></Pressable>
            {sports.map(s => (
              <Pressable key={s} onPress={() => { setSport(s); setTag(null); }} style={[styles.chip, sport === s && styles.chipOn]}><Text style={[styles.chipTxt, sport === s && styles.chipTxtOn]}>{SPORT_LABEL[s] ?? s}</Text></Pressable>
            ))}
          </ScrollView>
        ) : null}
        {tags.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={styles.chipRowInner}>
            <Pressable onPress={() => setTag(null)} style={[styles.chip, !tag && styles.chipOn]}><Text style={[styles.chipTxt, !tag && styles.chipTxtOn]}>All</Text></Pressable>
            {tags.map(t => (
              <Pressable key={t} onPress={() => setTag(tag === t ? null : t)} style={[styles.chip, tag === t && styles.chipOn]}>
                <View style={[styles.tagDot, { backgroundColor: tagColor(t) }]} /><Text style={[styles.chipTxt, tag === t && styles.chipTxtOn]}>{t}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        {loading ? <ActivityIndicator color="#ff6a2c" style={{ marginTop: 30 }} /> :
          filtered.length === 0 ? <Text style={styles.empty}>No plays here yet.</Text> : (
          <View style={styles.grid}>
            {filtered.map(p => (
              <View key={p.id} style={[styles.card, styles.gridCard]}>
                <View style={styles.nameRow}>
                  <Text style={styles.name} numberOfLines={1}>{p.doc?.name ?? p.name}</Text>
                  {p.saveCount > 0 ? <Text style={styles.saves}>★ {p.saveCount}</Text> : null}
                </View>
                {p.tags.length > 0 ? (
                  <View style={styles.tagWrap}>
                    {p.tags.map(t => (
                      <Pressable key={t} onPress={() => setTag(t)} style={[styles.tagChip, { borderColor: tagColor(t) }]}>
                        <View style={[styles.tagDot, { backgroundColor: tagColor(t) }]} /><Text style={styles.tagChipTxt}>{t}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                {p.doc ? <PlayPlayer doc={p.doc} /> : <Text style={styles.empty}>Couldn’t load.</Text>}
                <Pressable style={[styles.grabBtn, (grabbing === p.id || done[p.id]) && { opacity: 0.6 }]} disabled={grabbing === p.id || done[p.id]} onPress={() => grab(p)}>
                  <Text style={styles.grabTxt}>{done[p.id] ? '✓ Added to your playbook' : grabbing === p.id ? 'Adding…' : '＋ Add to Playbook'}</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0e1b2c' },
  content: { padding: 20, maxWidth: 1120, width: '100%', alignSelf: 'center' },
  back: { alignSelf: 'flex-start', paddingVertical: 6 },
  backTxt: { color: '#ff6a2c', fontSize: 14, fontWeight: '700' },
  eyebrow: { color: '#ff6a2c', fontSize: 12, fontWeight: '800', letterSpacing: 1.6, marginTop: 8 },
  h1: { color: '#f1f4f6', fontSize: 28, fontWeight: '800', letterSpacing: -0.5, marginTop: 6 },
  sub: { color: '#9db0bd', fontSize: 14, marginTop: 6, marginBottom: 14, lineHeight: 20 },
  chipRow: { marginBottom: 6 },
  chipRowInner: { gap: 8, paddingRight: 20, paddingVertical: 4 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#16232f', borderColor: '#25333f', borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  chipOn: { backgroundColor: '#ff6a2c', borderColor: '#ff6a2c' },
  chipTxt: { color: '#c7d2dc', fontSize: 13, fontWeight: '700' },
  chipTxtOn: { color: '#160b02' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  gridCard: { flexBasis: '30%', flexGrow: 1, minWidth: 250, maxWidth: 380, marginTop: 0 },
  card: { backgroundColor: '#16232f', borderColor: '#25333f', borderWidth: 1, borderRadius: 16, padding: 16, gap: 10 },
  nameRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { color: '#f1f4f6', fontSize: 16, fontWeight: '700', flex: 1 },
  saves: { color: '#e0a52e', fontSize: 13, fontWeight: '800', marginLeft: 8 },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tagChip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  tagDot: { width: 7, height: 7, borderRadius: 4 },
  tagChipTxt: { color: '#c7d2dc', fontSize: 11.5, fontWeight: '700' },
  grabBtn: { backgroundColor: '#ff6a2c', borderRadius: 11, paddingVertical: 12, alignItems: 'center', marginTop: 2 },
  grabTxt: { color: '#160b02', fontSize: 14, fontWeight: '800' },
  empty: { color: '#8b96a3', fontSize: 15, textAlign: 'center', marginTop: 30 },
});
