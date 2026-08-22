// PlayPlayer (native) — interactive play viewer for the phone, mirroring the web
// player. Press ▶ and the players slide along their routes; drag the slider to
// scrub; Step advances one action; Reset snaps back to the start. Tap the
// diagram to view full screen.
//
// The frame comes from the pure renderPlayFrameSvg(doc, t) (same as web) rendered
// via react-native-svg's SvgXml — this component only owns time + the controls.
// Works for every sport / play; the surface (court or field) is baked into the SVG.

import { surfaceSize } from '@/lib/core/playbook/court';
import type { PlayDoc } from '@/lib/core/playbook/playDoc';
import { renderPlayFrameSvg } from '@/lib/core/playbook/renderPlay';
import Slider from '@react-native-community/slider';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';

const DURATION_MS = 4200; // full play, start → finish

export default function PlayPlayer({ doc, allowFullscreen = true }: { doc: PlayDoc; allowFullscreen?: boolean }) {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [fs, setFs] = useState(false);
  const raf = useRef<number | undefined>(undefined);
  const last = useRef(0);
  const steps = Math.max(1, doc.actions.length);
  const { w, h } = surfaceSize(doc.surface);

  // rAF advance while playing; auto-stop at the end.
  useEffect(() => {
    if (!playing) return;
    last.current = Date.now();
    const tick = () => {
      const now = Date.now();
      const dt = (now - last.current) / DURATION_MS;
      last.current = now;
      setT(prev => {
        const next = prev + dt;
        if (next >= 1) { setPlaying(false); return 1; }
        return next;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [playing]);

  const svg = renderPlayFrameSvg(doc, t);
  const playPause = () => { setT(p => (p >= 1 ? 0 : p)); setPlaying(p => !p); };
  const reset = () => { setPlaying(false); setT(0); };
  const step = () => { setPlaying(false); setT(p => Math.min(1, (Math.floor(p * steps + 1e-6) + 1) / steps)); };

  const bg = doc.surface === 'field' ? '#2f6b3a' : '#f4ead4';

  const player = (mw: number) => (
    <View style={{ width: '100%', maxWidth: mw, alignSelf: 'center' }}>
      <Pressable onPress={() => { if (allowFullscreen) setFs(true); }} disabled={!allowFullscreen}>
        <View style={{ width: '100%', aspectRatio: w / h, borderRadius: 10, overflow: 'hidden', backgroundColor: bg }}>
          <SvgXml xml={svg} width="100%" height="100%" />
        </View>
      </Pressable>
      <View style={styles.controls}>
        <Pressable onPress={playPause} style={styles.btnPrimary}>
          <Text style={styles.btnPrimaryTxt}>{playing ? '❚❚' : t >= 1 ? '↻' : '▶'}</Text>
        </Pressable>
        <Slider
          style={styles.slider}
          minimumValue={0}
          maximumValue={1}
          value={t}
          onValueChange={v => { setPlaying(false); setT(v); }}
          minimumTrackTintColor="#ff6a2c"
          maximumTrackTintColor="#25333f"
          thumbTintColor="#ff6a2c"
        />
        <Pressable onPress={step} style={styles.btnGhost}><Text style={styles.btnGhostTxt}>Step</Text></Pressable>
        <Pressable onPress={reset} style={styles.btnGhost}><Text style={styles.btnGhostTxt}>Reset</Text></Pressable>
      </View>
    </View>
  );

  return (
    <View style={{ width: '100%' }}>
      {player(9999)}
      {allowFullscreen ? (
        <Modal visible={fs} transparent animationType="fade" onRequestClose={() => setFs(false)}>
          <View style={styles.backdrop}>
            {doc.name ? <Text style={styles.fsName}>{doc.name}</Text> : null}
            <View style={styles.fsCard}>
              <PlayPlayer doc={doc} allowFullscreen={false} />
            </View>
            <Text style={styles.close} onPress={() => setFs(false)}>✕  Close</Text>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  controls: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  slider: { flex: 1, height: 36 },
  btnPrimary: { backgroundColor: '#ff6a2c', borderRadius: 8, paddingVertical: 7, paddingHorizontal: 12, minWidth: 42, alignItems: 'center' },
  btnPrimaryTxt: { color: '#160b02', fontSize: 14, fontWeight: '800' },
  btnGhost: { borderColor: '#25333f', borderWidth: 1, borderRadius: 8, paddingVertical: 7, paddingHorizontal: 10 },
  btnGhostTxt: { color: '#9db0bd', fontSize: 13, fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: 'rgba(6,12,20,0.94)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  fsCard: { width: '100%', maxWidth: 940 },
  fsName: { color: '#f1f4f6', fontSize: 18, fontWeight: '800', marginBottom: 10 },
  close: { color: '#ff6a2c', fontSize: 15, fontWeight: '700', paddingVertical: 12 },
});
