// Slice 1: bundle-aware clip pill (REVIEW ONLY). Rendered by app/tagging-overlay.tsx
// inside the runtime-measured free band. Compressed = one line per clip at the playhead;
// tap → a card that lists the clip-level tags + each group's chips. Edit/Delete are
// present but DISABLED in Slice 1. No writes, no navigation — pure display.
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

type Tag = { id: string; name: string; category: string };
export type PillClip = {
  id: string; start: number; end: number;
  starred: boolean; poe: boolean; goodPlay: boolean;
  side: string | null;
  clipLevel: Tag[];
  groups: Tag[][];
  groupCount: number; tagCount: number;
};

// Category → chip color (mirrors the tagger's column palette; review-display only).
const CAT_COLOR: Record<string, string> = {
  offense: '#1a6fd4', defense: '#c0392b', plays: '#1e8449', players: '#7d3c98',
  formation: '#1a6fd4', play: '#1e8449', result: '#6c5ce7',
  off_formation: '#1a6fd4', off_play: '#1e8449', off_result: '#6c5ce7',
  def_scheme: '#c0392b', def_opp_play: '#1a6fd4', def_our_play: '#1e8449', def_result: '#6c5ce7',
  st_play: '#1e8449', st_result: '#6c5ce7',
};
const catColor = (c: string) => CAT_COLOR[c] ?? '#8892a6';
const fmt = (s: number) => { const m = Math.floor(s / 60); const sec = Math.floor(s % 60); return `${m}:${sec.toString().padStart(2, '0')}`; };
const sideShort = (s: string | null) => (s === 'Offense' ? 'OFF' : s === 'Defense' ? 'DEF' : s === 'Special Teams' ? 'SP' : null);

export default function ClipPill({ clip, maxHeight }: { clip: PillClip; maxHeight: number }) {
  const [expanded, setExpanded] = useState(false);
  const edge = clip.starred || clip.poe ? '#EF9F27' : '#8B7CF6';
  const ss = sideShort(clip.side);

  if (!expanded) {
    return (
      <Pressable onPress={() => setExpanded(true)} style={styles.pill}>
        <View style={[styles.edge, { backgroundColor: edge }]} />
        <Text style={styles.pillTxt} numberOfLines={1}>
          {`▶ ${fmt(clip.start)}–${fmt(clip.end)}`}{ss ? ` · ${ss}` : ''}
          {` · ${clip.groupCount} group${clip.groupCount === 1 ? '' : 's'} · ${clip.tagCount} tag${clip.tagCount === 1 ? '' : 's'}`}
        </Text>
        {clip.starred ? <Text style={styles.icon}>★</Text> : null}
        {clip.poe ? <Text style={[styles.icon, { color: '#DC3545' }]}>!</Text> : null}
        {clip.goodPlay ? <Text style={[styles.icon, { color: '#2ecc71' }]}>✓</Text> : null}
        <Text style={styles.chev}>⌄</Text>
      </Pressable>
    );
  }

  const chip = (t: Tag) => (
    <View key={t.id} style={[styles.chip, { borderColor: catColor(t.category), backgroundColor: catColor(t.category) + '22' }]}>
      <Text style={[styles.chipTxt, { color: catColor(t.category) }]} numberOfLines={1}>{t.name}</Text>
    </View>
  );
  const isStamp = (t: Tag) => t.category === 'special' || t.category === 'period' || t.category === 'possession';
  const clipLevelPlay = clip.clipLevel.filter(t => !isStamp(t));

  return (
    <View style={[styles.card, { maxHeight }]}>
      <View style={[styles.edge, { backgroundColor: edge }]} />
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle} numberOfLines={1}>{`▶ ${fmt(clip.start)}–${fmt(clip.end)}`}{ss ? ` · ${ss}` : ''}</Text>
        <View style={styles.cardHeadIcons}>
          {clip.starred ? <Text style={styles.icon}>★</Text> : null}
          {clip.poe ? <Text style={[styles.icon, { color: '#DC3545' }]}>!</Text> : null}
          {clip.goodPlay ? <Text style={[styles.icon, { color: '#2ecc71' }]}>✓</Text> : null}
        </View>
      </View>
      <ScrollView style={styles.cardScroll} contentContainerStyle={styles.cardBody} showsVerticalScrollIndicator={false}>
        {clipLevelPlay.length > 0 ? (
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Clip</Text>
            <View style={styles.rowChips}>{clipLevelPlay.map(chip)}</View>
          </View>
        ) : null}
        {clip.groups.map((g, i) => (
          <View key={i} style={styles.row}>
            <Text style={styles.rowLabel}>{i + 1}</Text>
            <View style={styles.rowChips}>{g.map(chip)}</View>
          </View>
        ))}
      </ScrollView>
      <View style={styles.cardBtns}>
        <View style={[styles.btn, styles.btnDisabled]}><Text style={styles.btnTxt}>Edit</Text></View>
        <View style={[styles.btn, styles.btnDisabled]}><Text style={styles.btnTxt}>Delete</Text></View>
        <Pressable onPress={() => setExpanded(false)} style={styles.btn} hitSlop={8}><Text style={styles.btnTxt}>✕</Text></Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingLeft: 4, paddingRight: 10, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.62)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', maxWidth: 520, overflow: 'hidden' },
  edge: { width: 4, alignSelf: 'stretch', borderRadius: 2, marginRight: 4 },
  pillTxt: { color: '#fff', fontSize: 13, fontWeight: '700', flexShrink: 1 },
  icon: { fontSize: 13, fontWeight: '800', color: '#EF9F27' },
  chev: { color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: '800' },
  card: { width: 520, maxWidth: '96%', borderRadius: 14, backgroundColor: 'rgba(12,14,20,0.94)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', overflow: 'hidden' },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 12, paddingRight: 12, paddingTop: 9, paddingBottom: 7, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.10)' },
  cardTitle: { color: '#fff', fontSize: 14, fontWeight: '800', flexShrink: 1 },
  cardHeadIcons: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardScroll: { flexGrow: 0 },
  cardBody: { paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  rowLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: '800', width: 32, paddingTop: 4 },
  rowChips: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  chip: { paddingHorizontal: 8, height: 24, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  chipTxt: { fontSize: 11, fontWeight: '700' },
  cardBtns: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.10)' },
  btn: { minWidth: 44, height: 30, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' },
  btnDisabled: { opacity: 0.35 },
  btnTxt: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
