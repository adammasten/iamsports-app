// 🧪 DEV-ONLY — Phase 0b background-upload spike harness. Reached via a spike card in
// Account (SPIKE_SHOW_BG_TEST). Delete after 0b is done.
//
// Two tests:
//   • "Single PUT"  — signed upload URL (createSignedUploadUrl) → background PUT.
//   • "Multipart"   — multipart-upload Edge Function presigns each part → background
//                     part uploads → Edge Function finalizes. For the big 2–5 GB games.
// THE TEST either way: start it, then LOCK the phone / switch apps, come back — progress
// should have kept climbing.
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
  // Pending multipart finalize info (key + S3 uploadId), read by the onComplete handler.
  const mpu = useRef<{ key: string; uploadId: string } | null>(null);

  const add = (line: string) =>
    setLog(prev => [`${new Date().toLocaleTimeString()}  ${line}`, ...prev].slice(0, 60));

  useEffect(() => {
    if (!BackgroundUpload) return;   // Expo Go: native module absent — no listeners.
    const subs = [
      BackgroundUpload.addListener('onProgress', ({ progress }) => setProgress(progress)),
      BackgroundUpload.addListener('onComplete', async (e) => {
        const secs = ((Date.now() - startedAt.current) / 1000).toFixed(0);
        setProgress(1);
        if (e.parts && mpu.current) {
          // Multipart: all parts uploaded — finalize server-side.
          add(`All ${e.parts.length} parts uploaded (${secs}s). Finalizing…`);
          const { key, uploadId } = mpu.current;
          const { data, error } = await supabase.functions.invoke('multipart-upload', {
            body: { action: 'complete', key, uploadId, parts: e.parts },
          });
          setBusy(false);
          mpu.current = null;
          if (error || data?.error) add(`❌ Finalize FAILED — ${error?.message ?? data?.error}`);
          else add(`✅ MULTIPART COMPLETE — object assembled (ETag ${data?.etag ?? '?'})`);
        } else {
          setBusy(false);
          add(`✅ COMPLETE — HTTP ${e.status}, ETag ${e.etag ?? '(none)'}, ${secs}s`);
        }
      }),
      BackgroundUpload.addListener('onError', (e) => {
        setBusy(false);
        add(`❌ ERROR — ${e.error ?? ''}${e.part ? ` [part ${e.part}]` : ''}${e.status ? ` (HTTP ${e.status})` : ''}${e.body ? `\n${String(e.body).slice(0, 300)}` : ''}`);
      }),
    ];
    return () => subs.forEach(s => s.remove());
  }, []);

  async function doPing() {
    if (!BackgroundUpload) { add('Native module unavailable — this needs a TestFlight/dev build, not Expo Go.'); return; }
    try {
      const r = await BackgroundUpload.ping();
      add(`ping → "${r}"  (native module is linked ✓)`);
    } catch (e: any) {
      add(`ping FAILED — ${e?.message ?? e}  (module not linked?)`);
    }
  }

  async function pickSingle() {
    if (!BackgroundUpload) { add('Native module unavailable — needs a TestFlight/dev build, not Expo Go.'); return; }
    try {
      setBusy(true); setProgress(0);
      const pending = await pickVideo();
      if (!pending || pending.isWeb) { setBusy(false); add('No video picked.'); return; }
      const bytes = await pendingFileSize(pending);
      add(`[single] Picked ${(bytes / 1048576).toFixed(0)} MB`);
      const key = `spike/0b-${Date.now()}.mp4`;
      const { data, error } = await supabase.storage.from('Videos').createSignedUploadUrl(key);
      if (error || !data?.signedUrl) { setBusy(false); add(`Signed-URL FAILED — ${error?.message}`); return; }
      startedAt.current = Date.now();
      await BackgroundUpload.startUpload(key, pending.uri, data.signedUrl, { 'content-type': 'video/mp4' });
      add('🚀 [single] Enqueued. NOW LOCK THE PHONE / SWITCH APPS, then come back.');
    } catch (e: any) { setBusy(false); add(`start FAILED — ${e?.message ?? e}`); }
  }

  async function pickMultipart() {
    if (!BackgroundUpload) { add('Native module unavailable — needs a TestFlight/dev build, not Expo Go.'); return; }
    try {
      setBusy(true); setProgress(0);
      const pending = await pickVideo();
      if (!pending || pending.isWeb) { setBusy(false); add('No video picked.'); return; }
      const bytes = await pendingFileSize(pending);
      add(`[multipart] Picked ${(bytes / 1048576).toFixed(0)} MB`);

      const key = `spike/0b-mpu-${Date.now()}.mp4`;
      add('Asking Edge Function to create multipart + presign parts…');
      const { data, error } = await supabase.functions.invoke('multipart-upload', {
        body: { action: 'create', key, fileSize: bytes, partSizeMB: 64 },
      });
      if (error || data?.error || !data?.parts) { setBusy(false); add(`Create FAILED — ${error?.message ?? data?.error}`); return; }
      add(`Got ${data.parts.length} presigned parts (${(data.partSize / 1048576).toFixed(0)} MB each).`);

      mpu.current = { key, uploadId: data.uploadId };
      startedAt.current = Date.now();
      await BackgroundUpload.startMultipartUpload(key, pending.uri, data.partSize, data.parts);
      add('🚀 [multipart] All parts enqueued. NOW LOCK THE PHONE / SWITCH APPS, then come back.');
    } catch (e: any) { setBusy(false); add(`start FAILED — ${e?.message ?? e}`); }
  }

  return (
    <View style={[styles.c, { paddingTop: insets.top + 12 }]}>
      <TouchableOpacity onPress={goBackOrHome} style={styles.back}><Text style={styles.backTxt}>← Back</Text></TouchableOpacity>
      <Text style={styles.h1}>🧪 BG Upload Test</Text>

      <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={doPing}>
        <Text style={styles.btnGhostTxt}>Ping module</Text>
      </TouchableOpacity>
      <View style={styles.row}>
        <TouchableOpacity style={[styles.btn, busy && styles.btnDisabled]} onPress={pickSingle} disabled={busy}>
          <Text style={styles.btnTxt}>{busy ? '…' : 'Single PUT'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, busy && styles.btnDisabled]} onPress={pickMultipart} disabled={busy}>
          <Text style={styles.btnTxt}>{busy ? '…' : 'Multipart (big games)'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.barWrap}>
        <View style={[styles.bar, { width: `${Math.round(progress * 100)}%` }]} />
      </View>
      <Text style={styles.pct}>{Math.round(progress * 100)}%</Text>

      <Text style={styles.tip}>After &quot;Enqueued&quot;, lock the phone or open another app for ~30s, then return. If progress kept climbing, background upload works.</Text>

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
  row: { flexDirection: 'row', gap: 10, marginTop: 10, marginBottom: 16 },
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
