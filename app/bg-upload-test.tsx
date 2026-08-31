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
import { startBackgroundMultipart, completeMultipart, retryParts, type StartedUpload } from '@/lib/native/background-upload';
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
  // Pending multipart upload (plan + fileUri), read by onComplete/onError.
  const mpu = useRef<{ started: StartedUpload; retried: boolean } | null>(null);

  const add = (line: string) =>
    setLog(prev => [`${new Date().toLocaleTimeString()}  ${line}`, ...prev].slice(0, 60));

  useEffect(() => {
    if (!BackgroundUpload) return;   // Expo Go: native module absent — no listeners.
    const subs = [
      BackgroundUpload.addListener('onProgress', ({ progress }) => setProgress(progress)),
      BackgroundUpload.addListener('onComplete', async (e) => {
        const secs = ((Date.now() - startedAt.current) / 1000).toFixed(0);
        setProgress(1);
        if (mpu.current) {
          // Multipart: parts uploaded — finalize from ListParts (server truth), not client ETags.
          const { started } = mpu.current;
          add(`Parts uploaded (${secs}s). Finalizing from ListParts…`);
          try {
            const data = await completeMultipart(started.key, started.uploadId, started.numParts);
            add(`✅ MULTIPART COMPLETE — object assembled (ETag ${data?.etag ?? '?'})`);
          } catch (err: any) {
            add(`❌ Finalize FAILED — ${err?.message ?? err}`);
          }
          setBusy(false);
          mpu.current = null;
        } else {
          setBusy(false);
          add(`✅ COMPLETE — HTTP ${e.status}, ETag ${e.etag ?? '(none)'}, ${secs}s`);
        }
      }),
      BackgroundUpload.addListener('onError', async (e: any) => {
        // Final "incomplete" event (rolling window drained with failures) carries failedParts.
        if (Array.isArray(e.failedParts)) {
          if (mpu.current && !mpu.current.retried) {
            mpu.current.retried = true;
            add(`⚠️ ${e.failedParts.length} part(s) failed: [${e.failedParts.join(', ')}]. Re-signing + retrying…`);
            try { await retryParts(mpu.current.started, e.failedParts); add('🔁 Retry enqueued for failed parts.'); }
            catch (err: any) { setBusy(false); add(`❌ Retry FAILED — ${err?.message ?? err}`); }
          } else {
            setBusy(false);
            add(`❌ INCOMPLETE — parts still failing: [${e.failedParts.join(', ')}]`);
          }
          return;
        }
        // Per-part errors are non-fatal — the rolling window keeps going; just log.
        if (e.part) { add(`⚠️ part ${e.part} err${e.status ? ` (HTTP ${e.status})` : ''} — will reconcile`); return; }
        setBusy(false);
        add(`❌ ERROR — ${e.error ?? ''}${e.body ? `\n${String(e.body).slice(0, 300)}` : ''}`);
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
      add('Creating multipart + signing parts (rolling-window protocol)…');
      const started = await startBackgroundMultipart({ key, fileUri: pending.uri, fileSize: bytes, partSizeMB: 128 });
      add(`Enqueued ${started.numParts} parts (${(started.partSize / 1048576).toFixed(0)} MB each); native stages ~3 at a time.`);
      mpu.current = { started, retried: false };
      startedAt.current = Date.now();
      add('🚀 [multipart] Uploading. NOW LOCK THE PHONE / SWITCH APPS, then come back.');
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
