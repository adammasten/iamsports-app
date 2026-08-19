// /playbook-all?teamId=… — the cumulative team play LIBRARY. Every play the team
// runs, across all weeks/installs, deduplicated (one row per play). This is the
// "review everything we've installed" view, distinct from the week-by-week list.

import PlayPlayer from '@/components/PlayPlayer';
import { fetchTeamPlays, type TeamPlay } from '@/lib/core/playbook/installs';
import { goBackOrHome } from '@/lib/nav';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import WebTopNav from './components/WebTopNav';

export default function AllPlaysScreen() {
  const params = useLocalSearchParams();
  const teamId = Array.isArray(params.teamId) ? params.teamId[0] : params.teamId;
  const teamName = Array.isArray(params.teamName) ? params.teamName[0] : params.teamName;
  const [plays, setPlays] = useState<TeamPlay[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!teamId) return;
    let alive = true;
    fetchTeamPlays(teamId)
      .then(d => { if (alive) setPlays(d); })
      .catch(e => { if (alive) setErr(e?.message ?? String(e)); });
    return () => { alive = false; };
  }, [teamId]);

  return (
    <View style={styles.root}>
      {Platform.OS === 'web' ? <WebTopNav /> : null}
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Pressable onPress={() => goBackOrHome()} hitSlop={8} style={styles.back}>
        <Text style={styles.backTxt}>← Back</Text>
      </Pressable>
      <Text style={styles.eyebrow}>{teamName ? teamName.toUpperCase() : 'PLAYBOOK'}</Text>
      <Text style={styles.h1}>All Plays</Text>
      <Text style={styles.sub}>Everything this team runs — every play from every week, in one place.</Text>

      {err ? (
        <View style={styles.errBox}><Text style={styles.errTxt}>Couldn’t load plays: {err}</Text></View>
      ) : plays === null ? (
        <ActivityIndicator color="#ff6a2c" style={{ marginTop: 30 }} />
      ) : plays.length === 0 ? (
        <Text style={styles.empty}>No plays yet.</Text>
      ) : (
        plays.map((p, i) => (
          <View key={p.playId} style={styles.card}>
            <Text style={styles.name}>{p.doc?.name ?? p.name ?? `Play ${i + 1}`}</Text>
            {p.doc ? <PlayPlayer doc={p.doc} /> : <Text style={styles.missing}>This play couldn’t be loaded.</Text>}
            {p.doc?.note ? (
              <View style={styles.noteBox}>
                <Text style={styles.noteLabel}>COACH’S NOTES</Text>
                <Text style={styles.noteTxt}>{p.doc.note}</Text>
              </View>
            ) : null}
          </View>
        ))
      )}
      <View style={{ height: 40 }} />
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
  h1: { color: '#f1f4f6', fontSize: 28, fontWeight: '800', letterSpacing: -0.5, marginTop: 6 },
  sub: { color: '#9db0bd', fontSize: 14, marginTop: 6, marginBottom: 8, lineHeight: 20 },
  card: { backgroundColor: '#16232f', borderColor: '#25333f', borderWidth: 1, borderRadius: 16, padding: 16, marginTop: 16, gap: 10 },
  name: { color: '#f1f4f6', fontSize: 16, fontWeight: '700' },
  missing: { color: '#ffb4a8', fontSize: 13.5 },
  noteBox: { backgroundColor: '#0e1b2c', borderColor: '#25333f', borderWidth: 1, borderRadius: 10, padding: 12, gap: 6 },
  noteLabel: { color: '#ff6a2c', fontSize: 10.5, fontWeight: '800', letterSpacing: 1.2 },
  noteTxt: { color: '#c7d2dc', fontSize: 13.5, lineHeight: 19 },
  empty: { color: '#9db0bd', fontSize: 14, marginTop: 24 },
  errBox: { backgroundColor: '#2a1416', borderColor: '#5c2a2a', borderWidth: 1, borderRadius: 12, padding: 14, marginTop: 20 },
  errTxt: { color: '#ffb4a8', fontSize: 13.5, lineHeight: 19 },
});
