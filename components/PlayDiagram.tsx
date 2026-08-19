// PlayDiagram — renders a play document INSIDE the app by calling the pure
// renderer (lib/core/playbook) and showing the SVG through expo-image as a
// data URI. No new native module: on web this is an <img> with an inline SVG,
// which renders everywhere the web app runs.
//
// Follows the video-playback standard's spirit (docs/VIDEO_PLAYBACK_STANDARD.md):
// a definite aspect-ratio box, centered, max-width on web — no full-bleed sprawl.
//
// NOTE (native): expo-image's SVG-data-URI support on iOS is unverified. The
// web app is the current surface; if/when native needs it, either enable
// expo-image SVG or add react-native-svg's SvgXml behind this same component —
// the renderer output doesn't change (that's the whole point of the pure fn).

import { surfaceSize } from '@/lib/core/playbook/court';
import type { PlayDoc } from '@/lib/core/playbook/playDoc';
import { renderPlaySvg } from '@/lib/core/playbook/renderPlay';
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

export default function PlayDiagram({ doc, maxWidth = 520 }: { doc: PlayDoc; maxWidth?: number }) {
  const { w, h } = surfaceSize(doc.surface);
  const uri = 'data:image/svg+xml;utf8,' + encodeURIComponent(renderPlaySvg(doc));
  return (
    <View style={[styles.wrap, { maxWidth, aspectRatio: w / h }]}>
      <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', alignSelf: 'center', borderRadius: 12, overflow: 'hidden' },
});
