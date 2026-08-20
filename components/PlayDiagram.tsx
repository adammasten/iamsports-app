// PlayDiagram — renders a play document as a static diagram. Uses react-native-svg
// so it works on BOTH native and web (the interactive ▶/scrub player is the
// web-only PlayPlayer.web.tsx; on the phone we show this static diagram).
//
// Definite aspect-ratio box, centered, max-width — per the video-playback standard.
// The SVG's own width/height are stripped so it scales to the box via its viewBox.

import { surfaceSize } from '@/lib/core/playbook/court';
import type { PlayDoc } from '@/lib/core/playbook/playDoc';
import { renderPlaySvg } from '@/lib/core/playbook/renderPlay';
import { StyleSheet, View } from 'react-native';
import { SvgXml } from 'react-native-svg';

export default function PlayDiagram({ doc, maxWidth = 520 }: { doc: PlayDoc; maxWidth?: number }) {
  const { w, h } = surfaceSize(doc.surface);
  const svg = renderPlaySvg(doc).replace(/ width="\d+" height="\d+"/, '');
  return (
    <View style={[styles.wrap, { maxWidth, aspectRatio: w / h }]}>
      <SvgXml xml={svg} width="100%" height="100%" />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', alignSelf: 'center', borderRadius: 12, overflow: 'hidden' },
});
