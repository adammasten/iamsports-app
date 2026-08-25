// My Taggers — your personal tagger code (so others can add YOU as their tagger)
// plus the address book of taggers you've added (via their code) to send games to.
import { useTeamContext } from '@/context';
import { addTaggerByCode, generateTaggerCode, getMyTaggerCode, listMyTaggers, removeTagger, type Tagger } from '@/lib/core/tagging-jobs';
import { confirm } from '@/lib/confirm';
import { goBackOrHome } from '@/lib/nav';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import WebTopNav from './components/WebTopNav';

function webAlert(title: string, message: string) {
  if (Platform.OS === 'web') { if (typeof window !== 'undefined') window.alert(message); return; }
  Alert.alert(title, message);
}

export default function TaggersScreen() {
  const { userId } = useTeamContext();
  const [code, setCode] = useState<string | null>(null);
  const [taggers, setTaggers] = useState<Tagger[]>([]);
  const [loading, setLoading] = useState(true);
  const [addInput, setAddInput] = useState('');
  const [adding, setAdding] = useState(false);
  const [genning, setGenning] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([getMyTaggerCode(), listMyTaggers()])
      .then(([c, t]) => { setCode(c); setTaggers(t); })
      .catch(e => webAlert('My Taggers', e?.message ?? 'Could not load.'))
      .finally(() => setLoading(false));
  }, []);
  useFocusEffect(useCallback(() => { if (userId) load(); }, [userId, load]));

  async function makeCode() {
    setGenning(true);
    try { setCode(await generateTaggerCode()); }
    catch (e: any) { webAlert('Tagger code', e?.message ?? 'Could not generate a code.'); }
    finally { setGenning(false); }
  }
  async function shareCode() {
    if (!code) return;
    const msg = `Add me as your tagger on IamSports with code: ${code}`;
    if (Platform.OS === 'web') {
      try { await navigator.clipboard.writeText(code); webAlert('Copied', `Tagger code ${code} copied.`); }
      catch { webAlert('Your tagger code', code); }
    } else { Share.share({ message: msg }); }
  }
  async function add() {
    const c = addInput.trim();
    if (!c) return;
    setAdding(true);
    try {
      const t = await addTaggerByCode(c);
      setAddInput('');
      webAlert('Added', `${t.displayName} is now in your taggers.`);
      load();
    } catch (e: any) { webAlert('Add tagger', e?.message ?? 'Could not add that code.'); }
    finally { setAdding(false); }
  }
  async function remove(t: Tagger) {
    const ok = await confirm({ title: `Remove ${t.displayName}?`, message: 'They stay removed from your taggers; existing jobs are unaffected.', confirmText: 'Remove', destructive: true });
    if (!ok) return;
    try { await removeTagger(t.userId); setTaggers(prev => prev.filter(x => x.userId !== t.userId)); }
    catch (e: any) { webAlert('Remove', e?.message ?? 'Could not remove.'); }
  }

  return (
    <View style={styles.screen}>
      {Platform.OS === 'web' ? <WebTopNav /> : null}
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={goBackOrHome} hitSlop={8} style={styles.back}><Text style={styles.backTxt}>← Back</Text></Pressable>
        <Text style={styles.eyebrow}>MY TAGGERS</Text>
        <Text style={styles.h1}>Taggers</Text>
        <Text style={styles.sub}>Add someone by their tagger code, then send them games to tag. Share your own code to tag for others.</Text>

        {/* Your own code */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Your tagger code</Text>
          {code ? (
            <>
              <View style={styles.codeRow}>
                <Text style={styles.codeBig}>{code}</Text>
                <Pressable style={styles.smallBtn} onPress={shareCode}><Text style={styles.smallBtnTxt}>{Platform.OS === 'web' ? 'Copy' : 'Share'}</Text></Pressable>
              </View>
              <Text style={styles.hint}>Give this to a coach so they can add you and send you games to tag.</Text>
            </>
          ) : (
            <Pressable style={[styles.smallBtn, { alignSelf: 'flex-start', marginTop: 4 }]} disabled={genning} onPress={makeCode}>
              <Text style={styles.smallBtnTxt}>{genning ? 'Generating…' : 'Generate my code'}</Text>
            </Pressable>
          )}
        </View>

        {/* Add a tagger */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Add a tagger</Text>
          <View style={styles.addRow}>
            <TextInput style={styles.input} value={addInput} onChangeText={setAddInput} placeholder="Enter a tagger code" placeholderTextColor="#66748a" autoCapitalize="characters" autoCorrect={false} onSubmitEditing={add} returnKeyType="done" />
            <Pressable style={[styles.smallBtn, (adding || !addInput.trim()) && { opacity: 0.5 }]} disabled={adding || !addInput.trim()} onPress={add}>
              <Text style={styles.smallBtnTxt}>{adding ? 'Adding…' : 'Add'}</Text>
            </Pressable>
          </View>
        </View>

        <Text style={styles.sectionLabel}>Your taggers</Text>
        {loading ? <ActivityIndicator color="#8b7bff" style={{ marginTop: 20 }} /> :
          taggers.length === 0 ? <Text style={styles.empty}>No taggers yet. Add one with their code above.</Text> :
            taggers.map(t => (
              <View key={t.userId} style={styles.taggerRow}>
                <Text style={styles.taggerName} numberOfLines={1}>{t.displayName}</Text>
                <Pressable onPress={() => remove(t)} hitSlop={6}><Text style={styles.remove}>Remove</Text></Pressable>
              </View>
            ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0e1b2c' },
  content: { padding: 20, maxWidth: 720, width: '100%', alignSelf: 'center' },
  back: { alignSelf: 'flex-start', paddingVertical: 6 },
  backTxt: { color: '#8b7bff', fontSize: 14, fontWeight: '700' },
  eyebrow: { color: '#8b7bff', fontSize: 12, fontWeight: '800', letterSpacing: 1.6, marginTop: 8 },
  h1: { color: '#f1f4f6', fontSize: 26, fontWeight: '800', letterSpacing: -0.5, marginTop: 6 },
  sub: { color: '#9db0bd', fontSize: 14, marginTop: 6, marginBottom: 16, lineHeight: 20 },
  card: { backgroundColor: '#16232f', borderColor: '#25333f', borderWidth: 1, borderRadius: 14, padding: 16, marginBottom: 14 },
  cardLabel: { color: '#c7d2dc', fontSize: 13, fontWeight: '800', marginBottom: 10, letterSpacing: 0.4 },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  codeBig: { color: '#f1f4f6', fontSize: 26, fontWeight: '800', letterSpacing: 3, flex: 1 },
  hint: { color: '#7a8794', fontSize: 12.5, marginTop: 10, lineHeight: 18 },
  addRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  input: { flex: 1, backgroundColor: '#0e1b2c', borderColor: '#2f4152', borderWidth: 1, borderRadius: 10, color: '#f1f4f6', paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, fontWeight: '700', letterSpacing: 1 },
  smallBtn: { backgroundColor: '#8b7bff', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16 },
  smallBtnTxt: { color: '#140b02', fontSize: 14, fontWeight: '800' },
  sectionLabel: { color: '#8090a0', fontSize: 12, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 8, marginBottom: 8 },
  taggerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#23323f' },
  taggerName: { color: '#f1f4f6', fontSize: 15, fontWeight: '700', flex: 1 },
  remove: { color: '#e2574a', fontSize: 14, fontWeight: '700' },
  empty: { color: '#8b96a3', fontSize: 15, textAlign: 'center', marginTop: 24 },
});
