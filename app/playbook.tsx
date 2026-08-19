// /playbook — the install list, read from the database. This is the player/coach
// entry point: every PUBLISHED install for a team you belong to, newest first.
// Tap one to open it. Dark route for now (not yet in navigation); the real home
// will link here once we wire it onto the team page.

import { fetchInstalls, type InstallSummary } from '@/lib/core/playbook/installs';
import { goBackOrHome } from '@/lib/nav';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

export default function PlaybookHome() {
  const [installs, setInstalls] = useState<InstallSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchInstalls()
      .then(d => { if (alive) setInstalls(d); })
      .catch(e => { if (alive) setErr(e?.message ?? String(e)); });
    return () => { alive = false; };
  }, []);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Pressable onPress={() => goBackOrHome()} hitSlop={8} style={styles.back}>
        <Text style={styles.backTxt}>← Back</Text>
      </Pressable>
      <Text style={styles.eyebrow}>PLAYBOOK</Text>
      <Text style={styles.h1}>Installs</Text>
      <Text style={styles.sub}>What your coaches have published. Tap one to run the plays.</Text>

      {err ? (
        <View style={styles.errBox}><Text style={styles.errTxt}>Couldn’t load installs: {err}</Text></View>
      ) : installs === null ? (
        <ActivityIndicator color="#ff6a2c" style={{ marginTop: 30 }} />
      ) : installs.length === 0 ? (
        <Text style={styles.empty}>No installs yet. When a coach publishes one to your team, it shows up here.</Text>
      ) : (
        installs.map(inst => (
          <Pressable
            key={inst.id}
            style={styles.card}
            onPress={() => router.push({ pathname: '/playbook-install', params: { id: inst.id } })}
          >
            <View style={styles.cardTop}>
              <Text style={styles.cardTitle}>{inst.title}</Text>
              <Text style={styles.count}>{inst.playCount} {inst.playCount === 1 ? 'play' : 'plays'}</Text>
            </View>
            {inst.teamName ? <Text style={styles.team}>{inst.teamName}</Text> : null}
            {inst.note ? <Text style={styles.note}>{inst.note}</Text> : null}
            <Text style={styles.open}>Open →</Text>
          </Pressable>
        ))
      )}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0e1b2c' },
  content: { padding: 20, maxWidth: 720, width: '100%', alignSelf: 'center' },
  back: { alignSelf: 'flex-start', paddingVertical: 6 },
  backTxt: { color: '#ff6a2c', fontSize: 14, fontWeight: '700' },
  eyebrow: { color: '#ff6a2c', fontSize: 12, fontWeight: '800', letterSpacing: 1.6, marginTop: 8 },
  h1: { color: '#f1f4f6', fontSize: 28, fontWeight: '800', letterSpacing: -0.5, marginTop: 6 },
  sub: { color: '#9db0bd', fontSize: 14, marginTop: 6, marginBottom: 16 },
  card: { backgroundColor: '#16232f', borderColor: '#25333f', borderWidth: 1, borderRadius: 16, padding: 18, marginBottom: 14, gap: 6 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  cardTitle: { color: '#f1f4f6', fontSize: 18, fontWeight: '700', flexShrink: 1 },
  count: { color: '#ff6a2c', fontSize: 12.5, fontWeight: '800' },
  team: { color: '#9db0bd', fontSize: 13, fontWeight: '600' },
  note: { color: '#c7d2dc', fontSize: 13.5, lineHeight: 19, marginTop: 2 },
  open: { color: '#ff6a2c', fontSize: 13, fontWeight: '700', marginTop: 6 },
  empty: { color: '#9db0bd', fontSize: 14, marginTop: 24, lineHeight: 20 },
  errBox: { backgroundColor: '#2a1416', borderColor: '#5c2a2a', borderWidth: 1, borderRadius: 12, padding: 14, marginTop: 20 },
  errTxt: { color: '#ffb4a8', fontSize: 13.5, lineHeight: 19 },
});
