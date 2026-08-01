// Recipient-facing display of a per-share note: a speech-bubble + the text,
// expandable when long. Only ever rendered for shares the viewer can read (the
// note rides the share row, so RLS already scoped it) — so a coaches-only note
// simply never reaches a player's card.
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';

export function ShareNote({ note }: { note: string }) {
  const [open, setOpen] = useState(false);
  const long = note.length > 90;
  return (
    <TouchableOpacity
      style={styles.wrap}
      onPress={long ? () => setOpen(o => !o) : undefined}
      activeOpacity={long ? 0.7 : 1}
    >
      <Ionicons name="chatbubble-ellipses" size={14} color="#8B7CF6" style={{ marginTop: 2 }} />
      <Text style={styles.text} numberOfLines={open ? undefined : 2}>{note}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', gap: 6, backgroundColor: '#17131f', borderRadius: 8, padding: 8, marginTop: 6 },
  text: { color: '#cfc8ea', fontSize: 13, lineHeight: 18, flex: 1 },
});
