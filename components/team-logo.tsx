// components/team-logo.tsx — a team's circle avatar. Signs the private
// logo_path via sign-media (never a public URL); falls back to the team's
// initial. Reused on the team rail, wall header, and the frozen past-team card.
import { getSignedVideoUrl } from '@/lib/native/video-url';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

export function TeamLogo({ logoPath, name, size = 44 }: { logoPath?: string | null; name?: string; size?: number }) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setUri(null);
    if (logoPath) {
      getSignedVideoUrl(logoPath).then(u => { if (!cancelled) setUri(u); });
    }
    return () => { cancelled = true; };
  }, [logoPath]);
  const initial = (name?.trim().charAt(0) || '🏀').toUpperCase();
  const r = size / 2;
  return (
    <View style={[styles.circle, { width: size, height: size, borderRadius: r }]}>
      {uri ? (
        <Image source={{ uri }} style={{ width: size, height: size, borderRadius: r }} contentFit="cover" cachePolicy="memory-disk" transition={120} />
      ) : (
        <Text style={[styles.initial, { fontSize: size * 0.42 }]}>{initial}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#2a2540', overflow: 'hidden' },
  initial: { color: '#b9b1e8', fontWeight: '800' },
});
