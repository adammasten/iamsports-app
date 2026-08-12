// <ContentCard> — the reusable poster card, matching docs/game-card-prototype.html.
// A BIG 16:9 thumbnail up top (real poster later; placeholder icon for now) with chips
// overlaid — share-status (top-left), "≡ N videos" (top-right), and a center play
// badge on walls — then a quiet footer: title + meta + two small icon buttons. Tap the
// card opens it. Surface-agnostic: play badge / share chip / actions / note are all props.
import { Ionicons } from '@expo/vector-icons';
import type { ShareStatus } from '@/lib/core/shareStatus';
import { getSignedVideoUrl } from '@/lib/native/video-url';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const C = {
  surface: '#16161a', surface2: '#1e1e24', line: '#2a2a32', text: '#f4f4f6',
  dim: '#9a9aa5', accent: '#6c5ce7', amberBg: 'rgba(200,116,43,0.9)',
};
// Tag-status dot on the type chip: red = never tagged, orange = started, green = done.
const STATUS: Record<'none' | 'started' | 'done', string> = { none: '#ff453a', started: '#ffd60a', done: '#32d74b' };

export type CardContent = {
  id: string;
  kind: 'game' | 'reel';
  title: string;
  meta: string;
  thumbnailUri?: string | null;                // an already-signed URL (rare); null → try thumbnailKey
  thumbnailKey?: string | null;                // storage key (e.g. thumbnails/<id>.jpg) — signed + cached here
  typeLabel?: string;                          // top-right chip: "Game"/"Practice"/"Reel"/"Video"
  tagStatus?: 'none' | 'started' | 'done';     // colored dot on the type chip (Film Room games); omit → no dot
};

export type CardAction = { icon: string; label: string; onPress: () => void; active?: boolean; busy?: boolean };
export type CardNoteData = { text: string; canEdit?: boolean; onEdit?: () => void };

export type ContentCardProps = {
  content: CardContent;
  onOpen: () => void;
  onLongPress?: () => void;
  shareStatus?: ShareStatus;
  actions?: CardAction[];
  note?: CardNoteData | null;
  showPlayOnThumb?: boolean;   // walls: center play badge for watch-in-place
  onPlay?: () => void;
};

function ShareChip({ status }: { status: ShareStatus }) {
  if (!status.shared) {
    return (
      <View style={[styles.chip, styles.chipLeft, styles.chipOnlyYou]}>
        <Ionicons name="lock-closed" size={11} color="#fff" />
        <Text style={styles.chipText}>Only you</Text>
      </View>
    );
  }
  return (
    <View style={[styles.chip, styles.chipLeft, styles.chipShared]}>
      <Ionicons name="checkmark" size={12} color="#fff" />
      <Text style={styles.chipText}>Shared</Text>
    </View>
  );
}

export default function ContentCard({
  content, onOpen, onLongPress, shareStatus, actions, note, showPlayOnThumb, onPlay,
}: ContentCardProps) {
  const isGame = content.kind === 'game';

  // Poster thumbnail: prefer an explicit signed URL; else sign the storage key
  // (getSignedVideoUrl caches per-path, so a feed signs each thumb once/session).
  // Fail-safe: any miss leaves thumbUri null → the placeholder icon (today).
  const [signedThumb, setSignedThumb] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (content.thumbnailUri || !content.thumbnailKey) { setSignedThumb(null); return; }
    getSignedVideoUrl(content.thumbnailKey).then(u => { if (!cancelled) setSignedThumb(u); });
    return () => { cancelled = true; };
  }, [content.thumbnailKey, content.thumbnailUri]);
  const thumbUri = content.thumbnailUri ?? signedThumb;

  return (
    <Pressable style={styles.card} onPress={onOpen} onLongPress={onLongPress} android_ripple={{ color: '#222' }}>
      {/* Thumbnail */}
      <View style={styles.thumb}>
        {thumbUri
          ? <Image source={{ uri: thumbUri }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={120} />
          : <Ionicons name={isGame ? 'basketball' : 'film'} size={40} color="#3a3f4a" />}

        {shareStatus ? <ShareChip status={shareStatus} /> : null}
        {content.typeLabel ? (
          <View style={[styles.chip, styles.chipRight, styles.chipType]}>
            {content.tagStatus ? <View style={[styles.dot, { backgroundColor: STATUS[content.tagStatus] }]} /> : null}
            <Text style={styles.chipText}>{content.typeLabel}</Text>
          </View>
        ) : null}

        {showPlayOnThumb ? (
          <Pressable style={styles.playBadge} onPress={onPlay} hitSlop={10}>
            <Ionicons name="play" size={26} color="#fff" style={{ marginLeft: 3 }} />
          </Pressable>
        ) : null}
      </View>

      {/* Footer */}
      <View style={styles.body}>
        <View style={styles.bodyText}>
          <Text style={styles.title} numberOfLines={1}>{content.title}</Text>
          <Text style={styles.meta} numberOfLines={1}>{content.meta}</Text>
        </View>
        {actions && actions.length > 0 ? (
          <View style={styles.icons}>
            {actions.map((a, i) => (
              <TouchableOpacity
                key={`${a.label}-${i}`}
                style={[styles.iconBtn, a.active && styles.iconBtnActive]}
                onPress={a.onPress}
                accessibilityLabel={a.label}
                disabled={a.busy}
                hitSlop={6}
              >
                <Ionicons name={a.icon as any} size={16} color={a.active ? C.accent : C.dim} />
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
      </View>

      {note ? (
        <View style={styles.note}>
          <View style={styles.noteHead}>
            <Text style={styles.noteLabel}>NOTE</Text>
            {note.canEdit && note.onEdit ? (
              <TouchableOpacity onPress={note.onEdit} hitSlop={8}><Ionicons name="pencil" size={13} color={C.accent} /></TouchableOpacity>
            ) : null}
          </View>
          <Text style={styles.noteText}>{note.text}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // On web the card would otherwise fill the whole browser width, making its 16:9
  // poster screen-sized. Cap it and center so it reads like a real card. Native
  // (and narrow web) is unaffected — full width as before.
  card: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 16, overflow: 'hidden', marginBottom: 16, ...(Platform.OS === 'web' ? { width: '100%' as const, maxWidth: 520, alignSelf: 'center' as const } : null) },
  thumb: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#1c1f26', alignItems: 'center', justifyContent: 'center' },

  chip: { position: 'absolute', top: 10, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  chipLeft: { left: 10 },
  chipRight: { right: 10 },
  chipText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  chipType: { backgroundColor: 'rgba(0,0,0,0.6)' },
  chipShared: { backgroundColor: 'rgba(108,92,231,0.85)' },
  chipOnlyYou: { backgroundColor: C.amberBg },
  dot: { width: 7, height: 7, borderRadius: 4 },

  playBadge: { width: 58, height: 58, borderRadius: 29, borderWidth: 2, borderColor: 'rgba(255,255,255,0.9)', backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },

  body: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 13, paddingHorizontal: 15 },
  bodyText: { flex: 1, minWidth: 0, marginRight: 10 },
  title: { color: C.text, fontSize: 16, fontWeight: '700' },
  meta: { color: C.dim, fontSize: 12, marginTop: 3 },
  icons: { flexDirection: 'row', gap: 6 },
  iconBtn: { width: 34, height: 34, borderRadius: 9, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  iconBtnActive: { borderColor: C.accent },

  note: { marginHorizontal: 15, marginBottom: 14, marginTop: -2, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 11 },
  noteHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  noteLabel: { color: '#666', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  noteText: { color: '#ddd', fontSize: 14, lineHeight: 19 },
});
