// Game detail — the screen a game card opens (card-system slice 2a). A game's videos
// are ROWS: tap a row = watch that clip; the per-row ⋯ opens a bottom SHEET for the
// rare actions. Replaces the old Film Room accordion + OS action-sheet ("Tap for
// options"). Auto-advance 1→2→3 and the dual progress bar come in 2b/2c.
//
// Self-contained: loads the game + its videos and owns the simple per-video ops
// (toggle tagged / rename / remove-from-game). Heavier game-level actions (Share /
// Offline) still live on the Film Room card for now.
import { Ionicons } from '@expo/vector-icons';
import { goBackOrHome } from '@/lib/nav';
import { supabase } from '@/supabase';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Vid = { id: string; label: string; url: string; sortOrder: number; taggingComplete: boolean; uploadStatus: 'uploading' | 'ready' | 'failed' };

function formatGameDate(ymd: string | null): string | null {
  if (!ymd) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function GameDetailScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const gameId = (Array.isArray(params.id) ? params.id[0] : params.id) as string;
  const paramTitle = (Array.isArray(params.title) ? params.title[0] : params.title) as string | undefined;

  const [title, setTitle] = useState(paramTitle ?? 'Game');
  const [dateStr, setDateStr] = useState<string | null>(null);
  const [videos, setVideos] = useState<Vid[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheetVid, setSheetVid] = useState<Vid | null>(null);

  const load = useCallback(async () => {
    if (!gameId) { setLoading(false); return; }
    const [{ data: g }, { data: vs }] = await Promise.all([
      supabase.from('games').select('title, game_date').eq('id', gameId).maybeSingle(),
      supabase.from('videos').select('id, label, url, sort_order, tagging_complete, upload_status').eq('game_id', gameId).order('sort_order'),
    ]);
    if (g?.title) setTitle(g.title);
    setDateStr(formatGameDate((g?.game_date as string) ?? null));
    setVideos((vs ?? []).map((v: any) => ({
      id: v.id, label: v.label, url: v.url, sortOrder: v.sort_order,
      taggingComplete: v.tagging_complete === true, uploadStatus: v.upload_status,
    })));
    setLoading(false);
  }, [gameId]);

  // Reload on focus so returning from the tagger / rename reflects changes.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const watch = (v: Vid) => router.push({ pathname: '/tagging-overlay', params: { videoId: v.id, url: v.url, label: v.label, watch: '1' } });
  const tag = (v: Vid) => router.push({ pathname: '/tagging-overlay', params: { videoId: v.id, url: v.url, label: v.label } });
  const viewClips = (v: Vid) => router.push({ pathname: '/clips', params: { videoId: v.id, label: v.label } });

  async function toggleComplete(v: Vid) {
    const next = !v.taggingComplete;
    setVideos(prev => prev.map(x => x.id === v.id ? { ...x, taggingComplete: next } : x));
    const { error } = await supabase.from('videos').update({ tagging_complete: next }).eq('id', v.id);
    if (error) { setVideos(prev => prev.map(x => x.id === v.id ? { ...x, taggingComplete: v.taggingComplete } : x)); Alert.alert('Error', error.message); }
  }

  function renameClip(v: Vid) {
    Alert.prompt?.('Rename clip', undefined, async (text?: string) => {
      const next = (text ?? '').trim();
      if (!next || next === v.label) return;
      setVideos(prev => prev.map(x => x.id === v.id ? { ...x, label: next } : x));
      const { error } = await supabase.from('videos').update({ label: next }).eq('id', v.id);
      if (error) { Alert.alert('Error', error.message); load(); }
    }, 'plain-text', v.label);
  }

  function removeFromGame(v: Vid) {
    Alert.alert('Remove from game', `Take “${v.label}” out of this game? It becomes loose footage — not deleted.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        const { error } = await supabase.from('videos').update({ game_id: null }).eq('id', v.id);
        if (error) { Alert.alert('Error', error.message); return; }
        setVideos(prev => prev.filter(x => x.id !== v.id));
        setSheetVid(null);
      } },
    ]);
  }

  const sheetActions = (v: Vid): { icon: string; label: string; danger?: boolean; onPress: () => void }[] => [
    { icon: 'play-circle-outline', label: 'Watch', onPress: () => { setSheetVid(null); watch(v); } },
    { icon: 'pricetag-outline', label: 'Tag this clip', onPress: () => { setSheetVid(null); tag(v); } },
    { icon: 'list-outline', label: 'View clips', onPress: () => { setSheetVid(null); viewClips(v); } },
    { icon: 'create-outline', label: 'Rename', onPress: () => { setSheetVid(null); renameClip(v); } },
    { icon: 'remove-circle-outline', label: 'Remove from game', danger: true, onPress: () => removeFromGame(v) },
  ];

  return (
    <View style={[styles.c, { paddingTop: insets.top + 8 }]}>
      <TouchableOpacity onPress={goBackOrHome} style={styles.back}><Text style={styles.backTxt}>← Back</Text></TouchableOpacity>
      <Text style={styles.h1} numberOfLines={1}>{title}</Text>
      {dateStr ? <Text style={styles.sub}>{dateStr} · {videos.length} clip{videos.length === 1 ? '' : 's'}</Text> : null}

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color="#534AB7" /></View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}>
          {videos.length === 0 ? (
            <Text style={styles.empty}>No clips in this game yet.</Text>
          ) : videos.map((v, i) => {
            const ready = v.uploadStatus === 'ready';
            return (
              <View key={v.id} style={styles.row}>
                <TouchableOpacity style={styles.check} onPress={() => ready && toggleComplete(v)} disabled={!ready} hitSlop={8}>
                  <Ionicons name={v.taggingComplete ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={!ready ? '#555' : v.taggingComplete ? '#32D74B' : '#666'} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.rowMain}
                  activeOpacity={0.7}
                  onPress={() => ready ? watch(v) : Alert.alert(v.label, v.uploadStatus === 'uploading' ? 'Still uploading — check back in a moment.' : 'This upload didn’t finish.')}
                >
                  <Text style={styles.rowNum}>{i + 1}</Text>
                  <View style={styles.rowBody}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{v.label}</Text>
                    <Text style={styles.rowHint}>{v.uploadStatus === 'uploading' ? 'Uploading…' : v.uploadStatus === 'failed' ? 'Upload didn’t finish' : 'Tap to watch'}</Text>
                  </View>
                  {ready ? <Ionicons name="play" size={18} color="#8B82E8" /> : null}
                </TouchableOpacity>
                <TouchableOpacity style={styles.more} onPress={() => setSheetVid(v)} hitSlop={8}>
                  <Ionicons name="ellipsis-horizontal" size={20} color="#aaa" />
                </TouchableOpacity>
              </View>
            );
          })}

          <TouchableOpacity style={styles.addBtn} onPress={() => router.push({ pathname: '/game', params: { id: gameId, title } })}>
            <Text style={styles.addText}>＋ Add clip</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* Per-row overflow SHEET (replaces the OS Alert). */}
      <Modal visible={!!sheetVid} transparent animationType="slide" onRequestClose={() => setSheetVid(null)}>
        <Pressable style={styles.backdrop} onPress={() => setSheetVid(null)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]} onPress={() => {}}>
            {sheetVid ? <Text style={styles.sheetTitle} numberOfLines={1}>{sheetVid.label}</Text> : null}
            {sheetVid ? sheetActions(sheetVid).map(a => (
              <TouchableOpacity key={a.label} style={styles.sheetRow} onPress={a.onPress}>
                <Ionicons name={a.icon as any} size={20} color={a.danger ? '#DC3545' : '#aaa'} />
                <Text style={[styles.sheetLabel, a.danger && { color: '#DC3545' }]}>{a.label}</Text>
              </TouchableOpacity>
            )) : null}
            <TouchableOpacity style={[styles.sheetRow, styles.sheetCancel]} onPress={() => setSheetVid(null)}>
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: '#000', paddingHorizontal: 16 },
  back: { paddingVertical: 8 }, backTxt: { color: '#8B82E8', fontSize: 16 },
  h1: { color: '#fff', fontSize: 26, fontWeight: '800', letterSpacing: -0.3, marginTop: 4 },
  sub: { color: '#888', fontSize: 13, marginTop: 4, marginBottom: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { color: '#888', fontSize: 15, textAlign: 'center', marginTop: 40 },

  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: '#333', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 10 },
  check: { marginRight: 10 },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowNum: { color: '#555', fontSize: 15, fontWeight: '800', width: 18, textAlign: 'center' },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  rowHint: { color: '#888', fontSize: 12, marginTop: 1 },
  more: { paddingLeft: 8, paddingVertical: 4 },

  addBtn: { alignSelf: 'flex-start', borderWidth: 1, borderColor: '#534AB7', borderRadius: 8, paddingVertical: 9, paddingHorizontal: 14, marginTop: 4 },
  addText: { color: '#8B82E8', fontSize: 13, fontWeight: '700' },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#1A1A1A', borderTopLeftRadius: 16, borderTopRightRadius: 16, borderWidth: 1, borderColor: '#333', paddingTop: 8, paddingHorizontal: 8 },
  sheetTitle: { color: '#888', fontSize: 12, fontWeight: '700', paddingHorizontal: 12, paddingVertical: 8 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 12, borderRadius: 10 },
  sheetLabel: { color: '#eee', fontSize: 16, fontWeight: '600' },
  sheetCancel: { justifyContent: 'center', marginTop: 4, backgroundColor: '#0D0D0D' },
  sheetCancelText: { color: '#8B82E8', fontSize: 16, fontWeight: '700' },
});
