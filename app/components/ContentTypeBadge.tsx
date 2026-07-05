import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

// One consistent content-type indicator used across every surface that lists
// shareable content (Film Room, Coaches' Corner, team wall, kid wall). Same
// pill shape everywhere; icon + color distinguish the type.
//   reel → 🎬 REEL (purple)   clip → ✂️ CLIP (blue)   game → 🏀 GAME (amber)
// 'video' shares are full game uploads, so they render as GAME too.
type Meta = { label: string; icon: keyof typeof Ionicons.glyphMap; bg: string };

const MAP: Record<string, Meta> = {
  reel:  { label: 'REEL', icon: 'film',       bg: '#534AB7' },
  clip:  { label: 'CLIP', icon: 'cut',        bg: '#2D7DD2' },
  game:  { label: 'GAME', icon: 'basketball', bg: '#C8742B' },
  video: { label: 'GAME', icon: 'basketball', bg: '#C8742B' },
};

export default function ContentTypeBadge({ type }: { type: string }) {
  const m = MAP[type] ?? { label: type.toUpperCase(), icon: 'ellipse' as const, bg: '#3a3a3a' };
  return (
    <View style={[styles.badge, { backgroundColor: m.bg }]}>
      <Ionicons name={m.icon} size={11} color="#fff" />
      <Text style={styles.text}>{m.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
    borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2,
  },
  text: { color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
});
