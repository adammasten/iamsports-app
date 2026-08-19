// /playbook-link?playId=&teamId=&version= — pick a game clip to link to a play.
// Browse the team's clips, WATCH any of them first, then link with a type
// (how it should look / us running it / what went wrong). Coaches only (RLS).

import { useTeamContext } from '@/context';
import { LINK_TYPE_LABEL, fetchTeamClips, linkClip, type LinkType, type TeamClip } from '@/lib/core/playbook/filmLinks';
import { goBackOrHome } from '@/lib/nav';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import WebTopNav from './components/WebTopNav';

const TYPES: LinkType[] = ['execution', 'exemplar', 'mistake'];
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export default function LinkClipScreen() {
  const params = useLocalSearchParams();
  const playId = String(params.playId ?? '');
  const teamId = String(params.teamId ?? '');
  const version = Number(params.version ?? 1) || 1;
  const { userId } = useTeamContext();

  const [clips, setClips] = useState<TeamClip[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [type, setType] = useState<LinkType>('execution');
  const [linked, setLinked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!teamId) return;
    let alive = true;
    fetchTeamClips(teamId).then(c => { if (alive) setClips(c); }).catch(e => { if (alive) setErr(e?.message ?? String(e)); });
    return () => { alive = false; };
  }, [teamId]);

  function watch(c: TeamClip) {
    if (!c.storagePath) return;
    router.push({ pathname: '/shared-viewer', params: { title: c.title, storagePath: c.storagePath, startTime: String(c.start), endTime: String(c.end) } });
  }

  async function attach(c: TeamClip) {
    if (!userId) { setErr('Not signed in.'); return; }
    setBusy(c.id); setErr(null);
    try {
      await linkClip({ playId, playVersion: version, clipId: c.id, teamId, linkType: type, userId });
      setLinked(s => new Set(s).add(c.id));
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(null); }
  }

  return (
    <View style={styles.root}>
      {Platform.OS === 'web' ? <WebTopNav /> : null}
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <Pressable onPress={() => goBackOrHome()} hitSlop={8} style={styles.back}><Text style={styles.backTxt}>← Back to play</Text></Pressable>
        <Text style={styles.h1}>Link film</Text>
        <Text style={styles.sub}>Watch a clip to be sure, then link it. Pick what the clip shows:</Text>

        <View style={styles.typeRow}>
          {TYPES.map(t => (
            <Pressable key={t} onPress={() => setType(t)} style={[styles.typeChip, type === t && styles.typeChipOn]}>
              <Text style={[styles.typeTxt, type === t && styles.typeTxtOn]}>{LINK_TYPE_LABEL[t]}</Text>
            </Pressable>
          ))}
        </View>

        {err ? <View style={styles.errBox}><Text style={styles.errTxt}>{err}</Text></View> : null}
        {clips === null ? (
          <ActivityIndicator color="#ff6a2c" style={{ marginTop: 30 }} />
        ) : clips.length === 0 ? (
          <Text style={styles.empty}>No clips on this team yet. Tag some film first, then come back to link it.</Text>
        ) : (
          clips.map(c => (
            <View key={c.id} style={styles.clipRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.clipTitle} numberOfLines={1}>{c.title}</Text>
                <Text style={styles.clipMeta}>{fmt(c.start)}–{fmt(c.end)}{c.note ? ` · ${c.note}` : ''}</Text>
              </View>
              <Pressable style={styles.watchBtn} onPress={() => watch(c)}><Text style={styles.watchTxt}>▶</Text></Pressable>
              {linked.has(c.id) ? (
                <Text style={styles.linkedTxt}>✓ Linked</Text>
              ) : (
                <Pressable style={styles.attachBtn} onPress={() => attach(c)} disabled={busy === c.id}>
                  <Text style={styles.attachTxt}>{busy === c.id ? '…' : 'Link'}</Text>
                </Pressable>
              )}
            </View>
          ))
        )}
        <View style={{ height: 50 }} />
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
  h1: { color: '#f1f4f6', fontSize: 26, fontWeight: '800', letterSpacing: -0.4, marginTop: 8 },
  sub: { color: '#9db0bd', fontSize: 14, marginTop: 6, marginBottom: 12, lineHeight: 20 },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  typeChip: { backgroundColor: '#16232f', borderColor: '#25333f', borderWidth: 1, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8 },
  typeChipOn: { backgroundColor: '#ff6a2c', borderColor: '#ff6a2c' },
  typeTxt: { color: '#c7d2dc', fontSize: 13, fontWeight: '700' },
  typeTxtOn: { color: '#160b02' },
  clipRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#16232f', borderColor: '#25333f', borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 10 },
  clipTitle: { color: '#f1f4f6', fontSize: 14, fontWeight: '700' },
  clipMeta: { color: '#9db0bd', fontSize: 12, marginTop: 2 },
  watchBtn: { backgroundColor: '#534AB7', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  watchTxt: { color: '#fff', fontSize: 14, fontWeight: '700' },
  attachBtn: { backgroundColor: '#1D9E75', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  attachTxt: { color: '#fff', fontSize: 13, fontWeight: '800' },
  linkedTxt: { color: '#3ec48c', fontSize: 13, fontWeight: '800' },
  empty: { color: '#9db0bd', fontSize: 14, lineHeight: 20, marginTop: 10 },
  errBox: { backgroundColor: '#2a1416', borderColor: '#5c2a2a', borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 12 },
  errTxt: { color: '#ffb4a8', fontSize: 13.5, lineHeight: 19 },
});
