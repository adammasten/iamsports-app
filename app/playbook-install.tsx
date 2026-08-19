// /playbook-install?id=… — one install, opened. Reads the pinned play VERSIONS
// from the database and renders each with the interactive player + its notes.
// This is the pilot artifact: a coach's install, exactly as a player opens it.

import PlayPlayer from '@/components/PlayPlayer';
import { fetchInstallDetail, type InstallDetail } from '@/lib/core/playbook/installs';
import { goBackOrHome } from '@/lib/nav';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import WebTopNav from './components/WebTopNav';

export default function InstallDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [detail, setDetail] = useState<InstallDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    fetchInstallDetail(id)
      .then(d => { if (alive) setDetail(d); })
      .catch(e => { if (alive) setErr(e?.message ?? String(e)); });
    return () => { alive = false; };
  }, [id]);

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

          {detail.plays.map((p, i) => (
            <View key={p.playId} style={styles.card}>
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
  content: { padding: 20, maxWidth: 640, width: '100%', alignSelf: 'center' },
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
