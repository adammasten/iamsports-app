// <ContentCard> — the ONE reusable poster card for games & reels across every
// surface. Surface-agnostic by construction: everything that differs by surface is a
// PROP (share pill via `shareStatus`, ▶ via `showPlayOnThumb`, tag ring via
// `content.tagStatus`, note box via `note`, actions via `actions`). No surface forks.
// Visual tokens from the "IamSports — Dark UI System" artifact.
//
// The card is a pure POSTER (+ optional note box). Surfaces that need extra chrome
// below it (e.g. the Film Room's expand/accordion, until slice 2's detail screen)
// render it as a SIBLING — the card doesn't know about it.
import { Ionicons } from '@expo/vector-icons';
import ContentTypeBadge from '@/app/components/ContentTypeBadge';
import type { ShareStatus } from '@/lib/core/shareStatus';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export type CardContent = {
  id: string;
  kind: 'game' | 'reel';
  title: string;
  meta: string;                                   // prebuilt meta line
  result?: string | null;                          // e.g. "Won 48-41"
  videoCount?: number;                             // games; chip shown only where the meta line does NOT already state the count (e.g. walls). Hidden when <= 1.
  thumbnailUri?: string | null;                    // null → icon fallback
  tagStatus?: 'none' | 'tagging' | 'done';         // Film Room badge ring; undefined → none
};

export type CardAction = {
  icon: string;
  label: string;                                   // accessibility / long-press
  onPress: () => void;
  active?: boolean;
  danger?: boolean;
  busy?: boolean;
};

export type CardNoteData = { text: string; canEdit?: boolean; onEdit?: () => void };

export type ContentCardProps = {
  content: CardContent;
  onOpen: () => void;
  onLongPress?: () => void;
  shareStatus?: ShareStatus;       // present → render the pill
  actions?: CardAction[];          // small icon buttons
  note?: CardNoteData | null;      // present → render the note box below
  showPlayOnThumb?: boolean;       // walls: ▶ on the thumbnail
  onPlay?: () => void;
  trailing?: React.ReactNode;      // e.g. a chevron on the Film Room (transitional)
};

const RING: Record<NonNullable<CardContent['tagStatus']>, string> = {
  none: '#FF453A', tagging: '#FFD60A', done: '#32D74B',
};

function ShareStatusPill({ status }: { status: ShareStatus }) {
  if (!status.shared) {
    // NOT shared → weighted "Only you" so it stands out as needing attention.
    return (
      <View style={[styles.pill, styles.pillOnlyYou]}>
        <Ionicons name="lock-closed" size={11} color="#c9a05a" />
        <Text style={styles.pillOnlyYouText}>Only you</Text>
      </View>
    );
  }
  // Shared → quiet, low-key.
  return (
    <View style={styles.pillShared}>
      <Ionicons name="checkmark-circle" size={12} color="#1D9E75" />
      <Text style={styles.pillSharedText}>Shared{status.count > 1 ? ` · ${status.count}` : ''}</Text>
    </View>
  );
}

// Videos = the uploaded footage in a game (First Half, etc.). Clips = tagged moments
// cut from them. A game contains VIDEOS. Shown only where the meta line doesn't
// already state the count.
function VideoCountChip({ count }: { count: number }) {
  return (
    <View style={styles.clipChip}>
      <Ionicons name="reorder-three" size={13} color="#aaa" />
      <Text style={styles.clipChipText}>{count} videos</Text>
    </View>
  );
}

function CardNote({ note }: { note: CardNoteData }) {
  return (
    <View style={styles.note}>
      <View style={styles.noteHead}>
        <Text style={styles.noteLabel}>NOTE</Text>
        {note.canEdit && note.onEdit ? (
          <TouchableOpacity onPress={note.onEdit} hitSlop={8}>
            <Ionicons name="pencil" size={13} color="#8B82E8" />
          </TouchableOpacity>
        ) : null}
      </View>
      <Text style={styles.noteText}>{note.text}</Text>
    </View>
  );
}

export default function ContentCard({
  content, onOpen, onLongPress, shareStatus, actions, note, showPlayOnThumb, onPlay, trailing,
}: ContentCardProps) {
  const isGame = content.kind === 'game';
  const ring = content.tagStatus ? RING[content.tagStatus] : undefined;

  return (
    <View style={styles.card}>
      <Pressable style={styles.head} onPress={onOpen} onLongPress={onLongPress} android_ripple={{ color: '#222' }}>
        <View style={styles.thumb}>
          {content.thumbnailUri ? (
            <Image source={{ uri: content.thumbnailUri }} style={styles.thumbImg} resizeMode="cover" />
          ) : (
            <Ionicons name={isGame ? 'basketball' : 'film-outline'} size={22} color={isGame ? '#C8742B' : '#8B82E8'} />
          )}
          {showPlayOnThumb ? (
            <View style={styles.playOverlay} pointerEvents={onPlay ? 'auto' : 'none'}>
              <TouchableOpacity onPress={onPlay} hitSlop={10}>
                <Ionicons name="play-circle" size={30} color="#fff" />
              </TouchableOpacity>
            </View>
          ) : null}
        </View>

        <View style={styles.body}>
          <View style={styles.badgeLine}>
            <ContentTypeBadge type={content.kind} outlineColor={ring} />
            {isGame && (content.videoCount ?? 0) > 1 ? <VideoCountChip count={content.videoCount!} /> : null}
          </View>
          <Text style={styles.title} numberOfLines={1}>{content.title}</Text>
          <Text style={styles.meta} numberOfLines={1}>
            {content.meta}{content.result ? <Text style={styles.result}>{`  ·  ${content.result}`}</Text> : null}
          </Text>
          {shareStatus ? <View style={styles.pillRow}><ShareStatusPill status={shareStatus} /></View> : null}
        </View>

        {trailing ?? null}
      </Pressable>

      {actions && actions.length > 0 ? (
        <View style={styles.actions}>
          {actions.map((a, i) => (
            <TouchableOpacity
              key={`${a.label}-${i}`}
              style={[styles.iconBtn, a.active && styles.iconBtnActive]}
              onPress={a.onPress}
              accessibilityLabel={a.label}
              disabled={a.busy}
              hitSlop={6}
            >
              {a.busy
                ? <ActivityIndicator size="small" color="#8B82E8" />
                : <Ionicons name={a.icon as any} size={18} color={a.danger ? '#DC3545' : a.active ? '#8B82E8' : '#aaa'} />}
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {note ? <CardNote note={note} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: '#333', borderRadius: 10, padding: 14, marginBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  thumb: {
    width: 72, height: 46, borderRadius: 8, backgroundColor: '#0D0D0D', borderWidth: 1, borderColor: '#2A2A2A',
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  thumbImg: { width: '100%', height: '100%' },
  playOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.25)' },
  body: { flex: 1, minWidth: 0 },
  badgeLine: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' },
  title: { color: '#fff', fontSize: 15, fontWeight: '700' },
  meta: { color: '#888', fontSize: 12, marginTop: 2 },
  result: { color: '#1D9E75', fontWeight: '700' },
  pillRow: { flexDirection: 'row', marginTop: 8 },

  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 3, borderWidth: 1 },
  pillOnlyYou: { backgroundColor: 'rgba(200,116,43,0.12)', borderColor: 'rgba(200,116,43,0.4)' },
  pillOnlyYouText: { color: '#c9a05a', fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
  pillShared: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  pillSharedText: { color: '#888', fontSize: 11, fontWeight: '700' },

  clipChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#0D0D0D', borderWidth: 1, borderColor: '#2A2A2A', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  clipChipText: { color: '#aaa', fontSize: 11, fontWeight: '700' },

  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 6, marginTop: 10, borderTopWidth: 1, borderTopColor: '#2A2A2A', paddingTop: 10 },
  iconBtn: { width: 40, height: 32, borderRadius: 8, backgroundColor: '#0D0D0D', borderWidth: 1, borderColor: '#2A2A2A', alignItems: 'center', justifyContent: 'center' },
  iconBtnActive: { borderColor: '#534AB7', backgroundColor: '#2A2740' },

  note: { marginTop: 10, backgroundColor: '#141414', borderWidth: 1, borderColor: '#2A2A2A', borderRadius: 8, padding: 10 },
  noteHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  noteLabel: { color: '#666', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  noteText: { color: '#ddd', fontSize: 14, lineHeight: 19 },
});
