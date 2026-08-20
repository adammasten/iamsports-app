// /recently-deleted?teamId=… — the admin-only "Recently Deleted" bin (Apple
// Photos model). Lists games/videos/reels soft-deleted in the last 30 days with
// a Restore action. Server-gated: list_deleted_content + restore_* raise unless
// you're a team admin, so a non-admin sees an error, not data.

import { supabase } from '@/supabase';
import { goBackOrHome } from '@/lib/nav';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import WebTopNav from './components/WebTopNav';

type DeletedItem = { kind: string; id: string; title: string; deleted_at: string };

const KIND_LABEL: Record<string, string> = { game: 'Game', video: 'Video', reel: 'Reel' };

function daysLeft(deletedAt: string): number {
  const gone = new Date(deletedAt).getTime();
  const purge = gone + 30 * 24 * 60 * 60 * 1000;
  return Math.max(0, Math.ceil((purge - Date.now()) / (24 * 60 * 60 * 1000)));
}

export default function RecentlyDeleted() {
  const params = useLocalSearchParams();
  const teamId = Array.isArray(params.teamId) ? params.teamId[0] : params.teamId;
  const teamName = Array.isArray(params.teamName) ? params.teamName[0] : params.teamName;
  const [items, setItems] = useState<DeletedItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!teamId) return;
    supabase.rpc('list_deleted_content', { p_team_id: teamId }).then(({ data, error }) => {
      if (error) setErr(error.message); else { setItems((data ?? []) as DeletedItem[]); setErr(null); }
    });
  }, [teamId]);
  useEffect(() => { load(); }, [load]);

  async function restore(it: DeletedItem) {
    setBusy(it.id); setErr(null);
    const fn = it.kind === 'game' ? 'restore_game' : it.kind === 'video' ? 'restore_video' : 'restore_reel';
    const key = it.kind === 'game' ? 'p_game_id' : it.kind === 'video' ? 'p_video_id' : 'p_reel_id';
    const { error } = await supabase.rpc(fn, { [key]: it.id } as any);
    setBusy(null);
    if (error) { Alert.alert('Couldn’t restore', error.message); return; }
    setItems(prev => (prev ?? []).filter(x => x.id !== it.id));
  }

  return (
    <View style={styles.root}>
      {Platform.OS === 'web' ? <WebTopNav /> : null}
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <Pressable onPress={() => goBackOrHome()} hitSlop={8} style={styles.back}><Text style={styles.backTxt}>← Back</Text></Pressable>
        <Text style={styles.eyebrow}>{teamName ? teamName.toUpperCase() : 'TEAM'}</Text>
        <Text style={styles.h1}>Recently Deleted</Text>
        <Text style={styles.sub}>Deleted games, videos, and reels stay here for 30 days. Restore anything before it's permanently removed.</Text>

        {err ? (
          <View style={styles.errBox}><Text style={styles.errTxt}>{err}</Text></View>
        ) : items === null ? (
          <ActivityIndicator color="#ff6a2c" style={{ marginTop: 30 }} />
        ) : items.length === 0 ? (
          <Text style={styles.empty}>Nothing deleted in the last 30 days.</Text>
        ) : (
          items.map(it => (
            <View key={`${it.kind}:${it.id}`} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} numberOfLines={1}>{it.title}</Text>
                <Text style={styles.rowMeta}>{KIND_LABEL[it.kind] ?? it.kind} · {daysLeft(it.deleted_at)} day{daysLeft(it.deleted_at) === 1 ? '' : 's'} left</Text>
              </View>
              <Pressable style={styles.restoreBtn} onPress={() => restore(it)} disabled={busy === it.id}>
                <Text style={styles.restoreTxt}>{busy === it.id ? '…' : 'Restore'}</Text>
              </Pressable>
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
  content: { padding: 20, maxWidth: 720, width: '100%', alignSelf: 'center' },
  back: { alignSelf: 'flex-start', paddingVertical: 6 },
  backTxt: { color: '#ff6a2c', fontSize: 14, fontWeight: '700' },
  eyebrow: { color: '#ff6a2c', fontSize: 12, fontWeight: '800', letterSpacing: 1.6, marginTop: 8 },
  h1: { color: '#f1f4f6', fontSize: 28, fontWeight: '800', letterSpacing: -0.5, marginTop: 6 },
  sub: { color: '#9db0bd', fontSize: 14, marginTop: 6, marginBottom: 16, lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#16232f', borderColor: '#25333f', borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 10 },
  rowTitle: { color: '#f1f4f6', fontSize: 15, fontWeight: '700' },
  rowMeta: { color: '#9db0bd', fontSize: 12.5, marginTop: 3 },
  restoreBtn: { backgroundColor: '#1D9E75', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 9 },
  restoreTxt: { color: '#fff', fontSize: 13.5, fontWeight: '800' },
  empty: { color: '#9db0bd', fontSize: 14, marginTop: 24 },
  errBox: { backgroundColor: '#2a1416', borderColor: '#5c2a2a', borderWidth: 1, borderRadius: 12, padding: 14, marginTop: 16 },
  errTxt: { color: '#ffb4a8', fontSize: 13.5, lineHeight: 19 },
});
