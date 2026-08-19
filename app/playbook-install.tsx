// /playbook-install?id=… — one install, opened. Reads the pinned play VERSIONS
// from the database and renders each with the interactive player + its notes.
// This is the pilot artifact: a coach's install, exactly as a player opens it.

import PlayPlayer from '@/components/PlayPlayer';
import { useTeamContext } from '@/context';
import { fetchInstallDetail, fetchInstallReceipts, logInstallView, type InstallDetail, type Receipt } from '@/lib/core/playbook/installs';
import { goBackOrHome } from '@/lib/nav';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import WebTopNav from './components/WebTopNav';

export default function InstallDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useTeamContext();
  const [detail, setDetail] = useState<InstallDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    fetchInstallDetail(id)
      .then(d => { if (alive) setDetail(d); })
      .catch(e => { if (alive) setErr(e?.message ?? String(e)); });
    // Log this open (binary), then load who's opened it (RLS: coach → everyone,
    // parent → just themselves).
    if (userId) logInstallView(id, userId).then(() => fetchInstallReceipts(id)).then(r => { if (alive) setReceipts(r); }).catch(() => {});
    return () => { alive = false; };
  }, [id, userId]);

  return (
    <View style={styles.root}>
      {Platform.OS === 'web' ? <WebTopNav /> : null}
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Pressable onPress={() => goBackOrHome()} hitSlop={8} style={styles.back}>
        <Text style={styles.backTxt}>← Installs</Text>
      </Pressable>

      {err ? (
        <View style={styles.errBox}><Text style={styles.errTxt}>Couldn’t load this install: {err}</Text></View>
      ) : detail === null ? (
        <ActivityIndicator color="#ff6a2c" style={{ marginTop: 30 }} />
      ) : (
        <>
          <Text style={styles.eyebrow}>{detail.teamName ?? 'INSTALL'}</Text>
          <Text style={styles.h1}>{detail.title}</Text>
          {detail.note ? <Text style={styles.sub}>{detail.note}</Text> : null}

          {receipts.length > 0 ? (
            <View style={styles.receiptBox}>
              <Text style={styles.receiptLabel}>👁  VIEWED BY {receipts.length}</Text>
              <Text style={styles.receiptTxt}>{receipts.map(r => r.name).join('  ·  ')}</Text>
            </View>
          ) : null}

          <View style={styles.grid}>
            {detail.plays.map((p, i) => (
              <View key={p.playId} style={[styles.card, styles.gridCard]}>
                <Text style={styles.name}>{p.doc?.name ?? `Play ${i + 1}`}</Text>
                {p.doc ? (
                  <PlayPlayer doc={p.doc} />
                ) : (
                  <Text style={styles.missing}>This play couldn’t be loaded.</Text>
                )}
                {(p.installNote || p.doc?.note) ? (
                  <View style={styles.noteBox}>
                    <Text style={styles.noteLabel}>COACH’S NOTES</Text>
                    {p.installNote ? <Text style={styles.noteTxt}>{p.installNote}</Text> : null}
                    {p.doc?.note ? <Text style={styles.noteTxtDim}>{p.doc.note}</Text> : null}
                  </View>
                ) : null}
              </View>
            ))}
          </View>
          <View style={{ height: 40 }} />
        </>
      )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0e1b2c' },
  screen: { flex: 1, backgroundColor: '#0e1b2c' },
  content: { padding: 20, maxWidth: 1120, width: '100%', alignSelf: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  gridCard: { flexBasis: '30%', flexGrow: 1, minWidth: 250, maxWidth: 380, marginTop: 0 },
  receiptBox: { backgroundColor: '#12271e', borderColor: '#1D9E75', borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 8, marginBottom: 12, gap: 4 },
  receiptLabel: { color: '#3ec48c', fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  receiptTxt: { color: '#c7d2dc', fontSize: 13.5, lineHeight: 19 },
  back: { alignSelf: 'flex-start', paddingVertical: 6 },
  backTxt: { color: '#ff6a2c', fontSize: 14, fontWeight: '700' },
  eyebrow: { color: '#ff6a2c', fontSize: 12, fontWeight: '800', letterSpacing: 1.6, marginTop: 8 },
  h1: { color: '#f1f4f6', fontSize: 26, fontWeight: '800', letterSpacing: -0.4, marginTop: 6 },
  sub: { color: '#c7d2dc', fontSize: 14, marginTop: 8, marginBottom: 8, lineHeight: 20 },
  card: { backgroundColor: '#16232f', borderColor: '#25333f', borderWidth: 1, borderRadius: 16, padding: 16, marginTop: 16, gap: 10 },
  name: { color: '#f1f4f6', fontSize: 16, fontWeight: '700' },
  missing: { color: '#ffb4a8', fontSize: 13.5 },
  noteBox: { backgroundColor: '#0e1b2c', borderColor: '#25333f', borderWidth: 1, borderRadius: 10, padding: 12, gap: 6 },
  noteLabel: { color: '#ff6a2c', fontSize: 10.5, fontWeight: '800', letterSpacing: 1.2 },
  noteTxt: { color: '#c7d2dc', fontSize: 13.5, lineHeight: 19 },
  noteTxtDim: { color: '#9db0bd', fontSize: 13, lineHeight: 19, fontStyle: 'italic' },
  errBox: { backgroundColor: '#2a1416', borderColor: '#5c2a2a', borderWidth: 1, borderRadius: 12, padding: 14, marginTop: 20 },
  errTxt: { color: '#ffb4a8', fontSize: 13.5, lineHeight: 19 },
});
