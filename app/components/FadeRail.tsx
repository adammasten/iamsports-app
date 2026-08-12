// "There's more →" affordance for a horizontal rail. Combines the two cues the
// carousel-UX research (NN/g, Smashing, UX Movement) rates highest for mobile:
//   1. a soft edge FADE into the page background (subtle "content continues"), and
//   2. a NETFLIX-STYLE CHEVRON button on that edge — the cue people actually
//      NOTICE — which also nudge-scrolls the rail when tapped (a real control,
//      not just decoration).
// Each edge only appears when that side has content off-screen (right shows at
// rest; left appears once you've scrolled). The fade is pointerEvents="none" and
// the chevron container is "box-none", so swiping the rail anywhere still works —
// only the small chevron circle catches a tap.
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRef, useState } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, ScrollView, StyleProp, StyleSheet, TouchableOpacity, View, ViewStyle } from 'react-native';

export default function FadeRail({
  children,
  fadeColor = '#000000',
  fadeWidth = 44,
  contentContainerStyle,
}: {
  children: React.ReactNode;
  fadeColor?: string;       // must be #RRGGBB — we append alpha for the transparent stop
  fadeWidth?: number;
  contentContainerStyle?: StyleProp<ViewStyle>;
}) {
  const ref = useRef<ScrollView>(null);
  const [viewW, setViewW] = useState(0);
  const [contentW, setContentW] = useState(0);
  const [x, setX] = useState(0);
  const transparent = `${fadeColor}00`;
  const canLeft = x > 4;
  const canRight = contentW - viewW - x > 4;

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => setX(e.nativeEvent.contentOffset.x);
  const page = (dir: 1 | -1) => {
    const dx = viewW * 0.75;
    const target = Math.max(0, Math.min(contentW - viewW, x + dir * dx));
    ref.current?.scrollTo({ x: target, animated: true });
  };

  return (
    <View>
      <ScrollView
        ref={ref}
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={onScroll}
        onLayout={e => setViewW(e.nativeEvent.layout.width)}
        onContentSizeChange={w => setContentW(w)}
        contentContainerStyle={contentContainerStyle}
      >
        {children}
      </ScrollView>

      {canLeft && (
        <>
          <LinearGradient
            pointerEvents="none"
            colors={[fadeColor, transparent]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.edge, { left: 0, width: fadeWidth }]}
          />
          <View pointerEvents="box-none" style={[styles.edge, styles.chevWrap, { left: 0, width: fadeWidth }]}>
            <TouchableOpacity style={styles.chev} onPress={() => page(-1)} activeOpacity={0.7} hitSlop={8}>
              <Ionicons name="chevron-back" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
        </>
      )}

      {canRight && (
        <>
          <LinearGradient
            pointerEvents="none"
            colors={[transparent, fadeColor]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.edge, { right: 0, width: fadeWidth }]}
          />
          <View pointerEvents="box-none" style={[styles.edge, styles.chevWrap, { right: 0, width: fadeWidth }]}>
            <TouchableOpacity style={styles.chev} onPress={() => page(1)} activeOpacity={0.7} hitSlop={8}>
              <Ionicons name="chevron-forward" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  edge: { position: 'absolute', top: 0, bottom: 0 },
  chevWrap: { alignItems: 'center', justifyContent: 'center' },
  // Circle biased toward the avatar row (top of the rail), not the label below it.
  chev: {
    marginTop: -14,
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(18,18,22,0.82)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
  },
});
