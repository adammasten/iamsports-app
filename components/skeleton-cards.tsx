// Skeleton placeholder for card-based content screens (home feed, team wall,
// Film Room) — a gentle pulse of card-shaped blocks instead of a bare spinner,
// so loading reads as "content is coming" with the right shape. Safe to show
// because every screen using it now has a ~10s timeout (withTimeout) that flips
// to an explicit error — a skeleton never spins forever.
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

export function SkeletonCards({ count = 4 }: { count?: number }) {
  const pulse = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <View style={styles.wrap}>
      {Array.from({ length: count }).map((_, i) => (
        <Animated.View key={i} style={[styles.card, { opacity: pulse }]}>
          <View style={styles.thumb} />
          <View style={styles.body}>
            <View style={[styles.line, { width: '70%' }]} />
            <View style={[styles.line, { width: '45%' }]} />
          </View>
        </Animated.View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12, paddingTop: 8, alignSelf: 'stretch' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#141414', borderRadius: 12, padding: 12 },
  thumb: { width: 54, height: 54, borderRadius: 8, backgroundColor: '#242424' },
  body: { flex: 1, gap: 8 },
  line: { height: 12, borderRadius: 6, backgroundColor: '#242424' },
});
