// The Vault — the community play bank. Browse plays other coaches published, filter
// by sport + tag, watch them animate, and grab any into your own playbook (a deep
// copy of the diagram; film never travels). Reachable from My Playbook.
import PlayPlayer from '@/components/PlayPlayer';
import { useTeamContext } from '@/context';
import { fetchVaultPlays, grabPlay, type VaultPlay } from '@/lib/core/playbook/library';
import { goBackOrHome } from '@/lib/nav';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import WebTopNav from './components/WebTopNav';

function webSafeAlert(title: string, message: string) {
  if (Platform.OS === 'web') { if (typeof window !== 'undefined') window.alert(message); return; }
  Alert.alert(title, message);
}
const SPORT_LABEL: Record<string, string> = { basketball: '🏀 Basketball', football: '🏈 Football / Flag' };

export default function PlayVault() {
  const insets = useSafeAreaInsets();
  const { userId } = useTeamContext();
  const [plays, setPlays] = useState<VaultPlay[]>([]);
  const [loading, setLoading] = useState(true);
  const [sport, setSport] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [grabbing, setGrabbing] = useState<string | null>(null);

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
      webSafeAlert('Added to your playbook', `“${p.name}” is now in My Playbook — yours to edit and run.`);
    } catch (e: any) { webSafeAlert('Add to playbook', e?.message ?? 'Could not add the play.'); }
    finally { setGrabbing(null); }
  }

  return (
    <View style={styles.root}>
      {Platform.OS === 'web' ? <WebTopNav /> : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: Platform.OS === 'web' ? 16 : insets.top + 12, paddingHorizontal: 16, paddingBottom: 44, maxWidth: Platform.OS === 'web' ? 1120 : 760, width: '100%', alignSelf: 'center' }}>
        {Platform.OS !== 'web' ? <Pressable onPress={goBackOrHome} hitSlop={8} style={{ paddingVertical: 4 }}><Text style={styles.back}>← Back</Text></Pressable> : null}
        <View style={styles.hero}>
          <Text style={styles.heroKicker}>IAMSPORTS · PLAYBOOK</Text>
          <Text style={styles.heroTitle}>THE VAULT</Text>
          <View style={styles.heroRule} />
          <Text style={styles.heroTagline}>A community bank of plays from coaches everywhere. Grab any into your playbook — the diagram's yours to run.</Text>
        </View>

        {sports.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }} style={{ marginBottom: 6 }}>
            <Pressable onPress={() => { setSport(null); setTag(null); }} style={[styles.chip, !sport && styles.chipOn]}><Text style={[styles.chipTxt, !sport && styles.chipTxtOn]}>All sports</Text></Pressable>
            {sports.map(s => (
              <Pressable key={s} onPress={() => { setSport(s); setTag(null); }} style={[styles.chip, sport === s && styles.chipOn]}><Text style={[styles.chipTxt, sport === s && styles.chipTxtOn]}>{SPORT_LABEL[s] ?? s}</Text></Pressable>
            ))}
          </ScrollView>
        ) : null}
        {tags.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7, paddingBottom: 4 }} style={{ marginBottom: 8 }}>
            <Pressable onPress={() => setTag(null)} style={[styles.tag, !tag && styles.tagOn]}><Text style={[styles.tagTxt, !tag && styles.tagTxtOn]}>All</Text></Pressable>
            {tags.map(t => (
              <Pressable key={t} onPress={() => setTag(tag === t ? null : t)} style={[styles.tag, tag === t && styles.tagOn]}><Text style={[styles.tagTxt, tag === t && styles.tagTxtOn]}>{t}</Text></Pressable>
            ))}
          </ScrollView>
        ) : null}

        {loading ? <ActivityIndicator color="#ff6a2c" style={{ marginTop: 30 }} /> :
          filtered.length === 0 ? <Text style={styles.empty}>No plays here yet.</Text> :
          <View style={styles.grid}>
          {filtered.map(p => (
            <View key={p.id} style={[styles.card, styles.gridCell]}>
              <View style={styles.cardHead}>
                <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
                {p.saveCount > 0 ? <Text style={styles.saves}>★ {p.saveCount}</Text> : null}
              </View>
              {p.tags.length ? (
                <View style={styles.tagRow}>{p.tags.slice(0, 6).map(t => <Text key={t} style={styles.pill}>{t}</Text>)}</View>
              ) : null}
              <View style={styles.playerWrap}>{p.doc ? <PlayPlayer doc={p.doc} /> : <Text style={styles.empty}>Couldn’t load.</Text>}</View>
              <Pressable style={[styles.grabBtn, grabbing === p.id && { opacity: 0.5 }]} disabled={grabbing === p.id} onPress={() => grab(p)}>
                <Text style={styles.grabTxt}>{grabbing === p.id ? 'Adding…' : '＋ Add to Playbook'}</Text>
              </Pressable>
            </View>
          ))}
          </View>}

        <Pressable onPress={() => router.push('/my-playbook')} style={{ paddingVertical: 18, alignItems: 'center' }}>
          <Text style={styles.link}>← Back to My Playbook</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b1725' },
  back: { color: '#ff6a2c', fontSize: 14, fontWeight: '700' },
  hero: { paddingTop: Platform.OS === 'web' ? 22 : 8, paddingBottom: 22, marginBottom: 18, borderBottomWidth: 1, borderBottomColor: '#25333f' },
  heroKicker: { color: '#62707e', fontSize: 11.5, fontWeight: '800', letterSpacing: 3, marginBottom: 8 },
  heroTitle: { color: '#f4f7fa', fontSize: Platform.OS === 'web' ? 64 : 44, fontWeight: '900', letterSpacing: 1, lineHeight: Platform.OS === 'web' ? 62 : 44 },
  heroRule: { height: 5, width: 96, backgroundColor: '#ff6a2c', borderRadius: 3, marginTop: 16, marginBottom: 16 },
  heroTagline: { color: '#9db0bd', fontSize: 15.5, lineHeight: 22, maxWidth: 480 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  gridCell: Platform.OS === 'web' ? { width: '31.5%', marginBottom: 0 } : { width: '100%' },
  chip: { backgroundColor: '#16232f', borderColor: '#25333f', borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  chipOn: { backgroundColor: '#534AB7', borderColor: '#534AB7' },
  chipTxt: { color: '#c7d2dc', fontSize: 13, fontWeight: '700' },
  chipTxtOn: { color: '#fff' },
  tag: { backgroundColor: '#16232f', borderColor: '#25333f', borderWidth: 1, borderRadius: 8, paddingHorizontal: 11, paddingVertical: 6 },
  tagOn: { backgroundColor: '#1b2c44', borderColor: '#8b7bff' },
  tagTxt: { color: '#9db0bd', fontSize: 12.5, fontWeight: '700' },
  tagTxtOn: { color: '#c8bcff' },
  empty: { color: '#8b96a3', fontSize: 15, textAlign: 'center', marginTop: 30 },
  card: { backgroundColor: '#16232f', borderColor: '#25333f', borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 14 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { color: '#f1f4f6', fontSize: 17, fontWeight: '800', flex: 1 },
  saves: { color: '#e0a52e', fontSize: 13, fontWeight: '800', marginLeft: 8 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  pill: { color: '#b9c6ff', fontSize: 11, fontWeight: '700', backgroundColor: '#1b2c44', borderColor: '#3a4d78', borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  playerWrap: { marginTop: 12, borderRadius: 10, overflow: 'hidden' },
  grabBtn: { backgroundColor: '#ff6a2c', borderRadius: 11, paddingVertical: 13, alignItems: 'center', marginTop: 12 },
  grabTxt: { color: '#160b02', fontSize: 15, fontWeight: '800' },
  link: { color: '#8b7bff', fontSize: 14, fontWeight: '700' },
});
