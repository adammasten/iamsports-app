// PlayPlayer (native fallback) — no SVG animator on device yet, so show the
// static diagram. The web build resolves PlayPlayer.web.tsx (interactive).
// When native rendering lands (expo-image SVG or react-native-svg), this can
// grow the same play/scrub controls driven by renderPlayFrameSvg.

import type { PlayDoc } from '@/lib/core/playbook/playDoc';
import PlayDiagram from './PlayDiagram';

export default function PlayPlayer({ doc }: { doc: PlayDoc }) {
  return <PlayDiagram doc={doc} />;
}
