// 🧪 DEV-ONLY — Phase 0b background-upload spike harness. Not linked in production
// UI (reached via a __DEV__ card in Account). Delete after 0b is done.
//
// Flow: pick a real video → ask Supabase for a signed upload URL (createSignedUploadUrl,
// no S3 keys needed, works because you're logged in) → hand it to the native background
// URLSession module → watch progress. THE TEST: start it, then LOCK the phone or switch
// apps for a bit, come back — progress should have kept moving. That's background upload.
import BackgroundUpload from '@/modules/background-upload';
import { supabase } from '@/supabase';
import { pickVideo, pendingFileSize } from '@/lib/native/video-upload';
import { goBackOrHome } from '@/lib/nav';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function BgUploadTest() {
  const insets = useSafeAreaInsets();
  const [log, setLog] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const startedAt = useRef<number>(0);

  const add = (line: string) =>
    setLog(prev => [`${new Date().toLocaleTimeString()}  ${line}`, ...prev].slice(0, 60));

  useEffect(() => {
    const subs = [
      BackgroundUpload.addListener('onProgress', ({ progress }) => setProgress(progress)),
      BackgroundUpload.addListener('onComplete', ({ status, etag }) => {
        const secs = ((Date.now() - startedAt.current) / 1000).toFixed(0);
        setBusy(false);
        setProgress(1);
        add(`✅ COMPLETE — HTTP ${status}, ETag ${etag ?? '(none)'}, ${secs}s`);
      }),
      BackgroundUpload.addListener('onError', (e) => {
        setBusy(false);
        add(`❌ ERROR — ${e.error ?? ''}${e.status ? ` (HTTP ${e.status})` : ''}${e.body ? `\n${String(e.body).slice(0, 300)}` : ''}`);
      }),
    ];
    return () => subs.forEach(s => s.remove());
  }, []);

  async function doPing() {
    try {
      const r = await BackgroundUpload.ping();
      add(`ping → "${r}"  (native module is linked ✓)`);
    } catch (e: any) {
      add(`ping FAILED — ${e?.message ?? e}  (module not linked?)`);
    }
  }

  async function pickAndUpload() {
    try {
      setBusy(true);
      setProgress(0);
      add('Picking a video…');
      const pending = await pickVideo();
      if (!pending || pending.isWeb) { setBusy(false); add('No video picked (or web).'); return; }

      const bytes = await pendingFileSize(pending);
      add(`Picked ${(bytes / 1048576).toFixed(0)} MB → ${pending.uri.slice(0, 48)}…`);

      const key = `spike/0b-${Date.now()}.mp4`;
      add('Requesting signed upload URL from Supabase…');
      const { data, error } = await supabase.storage.from('Videos').createSignedUploadUrl(key);
      if (error || !data?.signedUrl) { setBusy(false); add(`Signed-URL FAILED — ${error?.message ?? 'no url'}`); return; }
      add(`Got signed URL for ${key}`);

      startedAt.current = Date.now();
      await BackgroundUpload.startUpload(key, pending.uri, data.signedUrl, { 'content-type': 'video/mp4' });
      add('🚀 Enqueued on background session. NOW LOCK THE PHONE / SWITCH APPS, then come back.');
    } catch (e: any) {
      setBusy(false);
      add(`start FAILED — ${e?.message ?? e}`);
    }
  }

  return (
    <View style={[styles.c, { paddingTop: insets.top + 12 }]}>
      <TouchableOpacity onPress={goBackOrHome} style={styles.back}><Text style={styles.backTxt}>← Back</Text></TouchableOpacity>
      <Text style={styles.h1}>🧪 BG Upload Test</Text>

      <View style={styles.row}>
        <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={doPing}>
          <Text style={styles.btnGhostTxt}>Ping module</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, busy && styles.btnDisabled]} onPress={pickAndUpload} disabled={busy}>
          <Text style={styles.btnTxt}>{busy ? 'Uploading…' : 'Pick video + upload'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.barWrap}>
        <View style={[styles.bar, { width: `${Math.round(progress * 100)}%` }]} />
      </View>
      <Text style={styles.pct}>{Math.round(progress * 100)}%</Text>

      <Text style={styles.tip}>The real test: after &quot;Enqueued&quot;, lock the phone or open another app for ~30s, then return. If progress kept climbing, background upload works.</Text>

      <ScrollView style={styles.logBox} contentContainerStyle={{ padding: 10 }}>
        {log.map((l, i) => <Text key={i} style={styles.logLine}>{l}</Text>)}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: '#0b0b0b', paddingHorizontal: 16 },
  back: { paddingVertical: 8 },
  backTxt: { color: '#a99cf0', fontSize: 16 },
  h1: { color: '#fff', fontSize: 24, fontWeight: '700', marginBottom: 14 },
  row: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  btn: { flex: 1, backgroundColor: '#534AB7', borderRadius: 10, padding: 14, alignItems: 'center' },
  btnTxt: { color: '#fff', fontWeight: '700' },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#534AB7' },
  btnGhostTxt: { color: '#a99cf0', fontWeight: '700' },
  btnDisabled: { opacity: 0.5 },
  barWrap: { height: 14, backgroundColor: '#1c1c1c', borderRadius: 7, overflow: 'hidden' },
  bar: { height: 14, backgroundColor: '#EF9F27' },
  pct: { color: '#EF9F27', fontWeight: '700', marginTop: 6, marginBottom: 10 },
  tip: { color: '#9a9a9a', fontSize: 13, lineHeight: 18, marginBottom: 12 },
  logBox: { flex: 1, backgroundColor: '#141414', borderRadius: 10, borderWidth: 1, borderColor: '#262626' },
  logLine: { color: '#ddd', fontSize: 12, fontFamily: 'Menlo', marginBottom: 6 },
});
