// A small poster image that signs its OWN storage key (thumbnails/<id>.jpg via
// getSignedVideoUrl, which caches per-path) and renders it with expo-image
// (memory-disk cache). Fail-safe: no key, or a signing miss, shows `fallback`
// (e.g. a play icon) — identical to before thumbnails existed. For places that
// aren't a full ContentCard, like the video rows in game-detail.
import { getSignedVideoUrl } from '@/lib/native/video-url';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

export default function SignedThumb({
  thumbnailKey,
  style,
  fallback,
}: {
  thumbnailKey?: string | null;
  style?: StyleProp<ViewStyle>;
  fallback?: React.ReactNode;
}) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!thumbnailKey) { setUri(null); return; }
    getSignedVideoUrl(thumbnailKey).then(u => { if (!cancelled) setUri(u); });
    return () => { cancelled = true; };
  }, [thumbnailKey]);

  return (
    <View style={[styles.box, style]}>
      {uri
        ? <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={120} />
        : fallback}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
