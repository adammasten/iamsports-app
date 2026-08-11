// Game detail — the screen a game card opens (card-system slices 2a + 2b). A game's
// videos are ROWS with a video player BOX at the top: tap a row (or "Play game") and
// it plays IN the box; when a video ends it AUTO-ADVANCES to the next (1→2→3, one
// continuous game). The per-row ⋯ opens a bottom SHEET for the rare actions. Portrait,
// so it stays Expo-Go-testable and dodges the landscape orientation issues.
//
// 2c will replace the native player controls with a custom DUAL progress bar
// (segmented game timeline + within-video bar). Heavier game-level actions
// (Share / Offline) still live on the Film Room card for now.
import { Ionicons } from '@expo/vector-icons';
import { goBackOrHome } from '@/lib/nav';
import { supabase } from '@/supabase';
import { getSignedVideoUrl } from '@/lib/native/video-url';
import { getCachedPathSync } from '@/lib/native/video-cache';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useVideoPlayer, VideoView } from 'expo-video';
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

  // In-box player + auto-advance.
  const [currentIndex, setCurrentIndex] = useState<number | null>(null);
  const [srcLoading, setSrcLoading] = useState(false);
  const player = useVideoPlayer(null, p => { p.timeUpdateEventInterval = 0.5; });
  const videosRef = useRef<Vid[]>([]);
  videosRef.current = videos;

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

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Load the current video's source (cached file if available, else a signed URL) and
  // play it. Runs whenever currentIndex changes — including auto-advance.
  useEffect(() => {
    if (currentIndex == null) return;
    const v = videos[currentIndex];
    if (!v || v.uploadStatus !== 'ready') return;
    let cancelled = false;
    setSrcLoading(true);
    (async () => {
      const cached = getCachedPathSync(v.id);
      const src = cached ?? await getSignedVideoUrl(v.url, { forceRefresh: true });
      if (cancelled) return;
      setSrcLoading(false);
      if (!src) { Alert.alert('Couldn’t load video', 'Try again in a moment.'); return; }
      try { player.replace(src); player.play(); } catch { /* player released */ }
    })();
    return () => { cancelled = true; };
  }, [currentIndex, videos, player]);

  // Auto-advance: when a video finishes, jump to the next READY one. Reads videosRef to
  // avoid a stale closure.
  useEffect(() => {
    const sub = player.addListener('playToEnd', () => {
      setCurrentIndex(i => {
        if (i == null) return i;
        const list = videosRef.current;
        for (let j = i + 1; j < list.length; j++) if (list[j].uploadStatus === 'ready') return j;
        return i; // end of game
      });
    });
    return () => sub.remove();
  }, [player]);

  const firstReady = () => videos.findIndex(v => v.uploadStatus === 'ready');
  const playGame = () => { const f = firstReady(); if (f >= 0) setCurrentIndex(f); };

  const tag = (v: Vid) => router.push({ pathname: '/tagging-overlay', params: { videoId: v.id, url: v.url, label: v.label } });
  const viewClips = (v: Vid) => router.push({ pathname: '/clips', params: { videoId: v.id, label: v.label } });

  async function toggleComplete(v: Vid) {
    const next = !v.taggingComplete;
    setVideos(prev => prev.map(x => x.id === v.id ? { ...x, taggingComplete: next } : x));
    const { error } = await supabase.from('videos').update({ tagging_complete: next }).eq('id', v.id);
    if (error) { setVideos(prev => prev.map(x => x.id === v.id ? { ...x, taggingComplete: v.taggingComplete } : x)); Alert.alert('Error', error.message); }
  }

  function renameVideo(v: Vid) {
    Alert.prompt?.('Rename video', undefined, async (text?: string) => {
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
        if (currentIndex != null && videos[currentIndex]?.id === v.id) { player.pause(); setCurrentIndex(null); }
      } },
    ]);
  }

  const indexOf = (v: Vid) => videos.findIndex(x => x.id === v.id);
  const sheetActions = (v: Vid): { icon: string; label: string; danger?: boolean; onPress: () => void }[] => [
    { icon: 'play-circle-outline', label: 'Watch', onPress: () => { setSheetVid(null); const i = indexOf(v); if (i >= 0) setCurrentIndex(i); } },
    { icon: 'pricetag-outline', label: 'Tag video', onPress: () => { setSheetVid(null); tag(v); } },
    { icon: 'list-outline', label: 'View clips', onPress: () => { setSheetVid(null); viewClips(v); } },
    { icon: 'create-outline', label: 'Rename', onPress: () => { setSheetVid(null); renameVideo(v); } },
    { icon: 'remove-circle-outline', label: 'Remove from game', danger: true, onPress: () => removeFromGame(v) },
  ];

  return (
    <View style={[styles.c, { paddingTop: insets.top + 8 }]}>
      <TouchableOpacity onPress={goBackOrHome} style={styles.back}><Text style={styles.backTxt}>← Back</Text></TouchableOpacity>
      <Text style={styles.h1} numberOfLines={1}>{title}</Text>
      {dateStr ? <Text style={styles.sub}>{dateStr} · {videos.length} video{videos.length === 1 ? '' : 's'}</Text> : null}

      {/* Player box */}
      <View style={styles.playerBox}>
        {currentIndex == null ? (
          <TouchableOpacity style={styles.placeholder} onPress={playGame} disabled={firstReady() < 0} activeOpacity={0.8}>
            <Ionicons name="play-circle" size={56} color={firstReady() < 0 ? '#444' : '#8B82E8'} />
            <Text style={styles.placeholderText}>{firstReady() < 0 ? 'No playable video yet' : 'Play game'}</Text>
          </TouchableOpacity>
        ) : (
          <>
            <VideoView player={player} style={StyleSheet.absoluteFill} nativeControls contentFit="contain" allowsFullscreen />
            {srcLoading ? <View style={styles.playerLoading}><ActivityIndicator color="#fff" /></View> : null}
          </>
        )}
      </View>
      {currentIndex != null && videos[currentIndex] ? (
        <Text style={styles.nowPlaying} numberOfLines={1}>▶ {videos[currentIndex].label}</Text>
      ) : null}

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color="#534AB7" /></View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}>
          {videos.length === 0 ? (
            <Text style={styles.empty}>No videos in this game yet.</Text>
          ) : videos.map((v, i) => {
            const ready = v.uploadStatus === 'ready';
            const playing = currentIndex === i;
            return (
              <View key={v.id} style={[styles.row, playing && styles.rowPlaying]}>
                <TouchableOpacity style={styles.check} onPress={() => ready && toggleComplete(v)} disabled={!ready} hitSlop={8}>
                  <Ionicons name={v.taggingComplete ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={!ready ? '#555' : v.taggingComplete ? '#32D74B' : '#666'} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.rowMain}
                  activeOpacity={0.7}
                  onPress={() => ready ? setCurrentIndex(i) : Alert.alert(v.label, v.uploadStatus === 'uploading' ? 'Still uploading — check back in a moment.' : 'This upload didn’t finish.')}
                >
                  <Text style={[styles.rowNum, playing && { color: '#8B82E8' }]}>{i + 1}</Text>
                  <View style={styles.rowBody}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{v.label}</Text>
                    <Text style={styles.rowHint}>{v.uploadStatus === 'uploading' ? 'Uploading…' : v.uploadStatus === 'failed' ? 'Upload didn’t finish' : playing ? 'Now playing' : 'Tap to watch'}</Text>
                  </View>
                  {ready ? <Ionicons name={playing ? 'volume-medium' : 'play'} size={18} color="#8B82E8" /> : null}
                </TouchableOpacity>
                <TouchableOpacity style={styles.more} onPress={() => setSheetVid(v)} hitSlop={8}>
                  <Ionicons name="ellipsis-horizontal" size={20} color="#aaa" />
                </TouchableOpacity>
              </View>
            );
          })}

          <TouchableOpacity style={styles.addBtn} onPress={() => router.push({ pathname: '/game', params: { id: gameId, title } })}>
            <Text style={styles.addText}>＋ Add video</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* Per-row overflow SHEET (replaces the old OS Alert). */}
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
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  empty: { color: '#888', fontSize: 15, textAlign: 'center', marginTop: 40 },

  playerBox: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#222' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#0D0D0D' },
  placeholderText: { color: '#888', fontSize: 13, fontWeight: '700' },
  playerLoading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' },
  nowPlaying: { color: '#8B82E8', fontSize: 12, fontWeight: '700', marginTop: 8, marginBottom: 4 },

  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: '#333', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 10, marginTop: 8 },
  rowPlaying: { borderColor: '#534AB7', backgroundColor: '#17152a' },
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
