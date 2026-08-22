// PlayDiagram — renders a play document as a static diagram. Uses react-native-svg
// so it works on BOTH native and web (the interactive ▶/scrub player is the
// web-only PlayPlayer.web.tsx; on the phone we show this static diagram).
//
// Definite aspect-ratio box, centered, max-width — per the video-playback standard.
// Tap to view full screen (the diagram's fullscreen affordance). The SVG's own
// width/height are stripped so it scales to the box via its viewBox.

import { surfaceSize } from '@/lib/core/playbook/court';
import type { PlayDoc } from '@/lib/core/playbook/playDoc';
import { renderPlaySvg } from '@/lib/core/playbook/renderPlay';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';

export default function PlayDiagram({ doc, maxWidth = 520, allowFullscreen = true }: { doc: PlayDoc; maxWidth?: number; allowFullscreen?: boolean }) {
  const { w, h } = surfaceSize(doc.surface);
  const svg = renderPlaySvg(doc).replace(/ width="\d+" height="\d+"/, '');
  const [fs, setFs] = useState(false);

  const diagram = (mw: number) => (
    <View style={[styles.wrap, { maxWidth: mw, aspectRatio: w / h }]}>
      <SvgXml xml={svg} width="100%" height="100%" />
    </View>
  );

  if (!allowFullscreen) return diagram(maxWidth);

  return (
    <>
      <Pressable onPress={() => setFs(true)}>{diagram(maxWidth)}</Pressable>
      <Modal visible={fs} transparent animationType="fade" onRequestClose={() => setFs(false)}>
        <Pressable style={styles.backdrop} onPress={() => setFs(false)}>
          <Pressable style={styles.card} onPress={() => {}}>
            {doc.name ? <Text style={styles.name}>{doc.name}</Text> : null}
            {diagram(900)}
            <Text style={styles.close} onPress={() => setFs(false)}>✕  Close</Text>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', alignSelf: 'center', borderRadius: 12, overflow: 'hidden' },
  backdrop: { flex: 1, backgroundColor: 'rgba(6,12,20,0.92)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: { width: '100%', maxWidth: 940, gap: 12 },
  name: { color: '#f1f4f6', fontSize: 18, fontWeight: '800' },
  close: { color: '#ff6a2c', fontSize: 15, fontWeight: '700', alignSelf: 'center', paddingVertical: 8 },
});
