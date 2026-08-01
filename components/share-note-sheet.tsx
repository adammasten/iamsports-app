// Compose sheet for an optional per-share note. The big colored AUDIENCE BANNER
// is the safety element: it restates, every time, exactly who will see this note
// ("Only coaches will see this" vs "Only Max's family will see this" vs "Everyone
// on <Team> will see this") so a coaches-only evaluation can't be typed into a
// player-facing box by mistake. One-way for now (a note from the sharer).
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

export type NoteAudience = {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  color: string;
};

export function ShareNoteSheet({ audience, initialNote, busy, onSend, onCancel }: {
  audience: NoteAudience;
  // Prefill for editing an already-posted note. When provided (even ''), the
  // sheet is in edit mode: the button says Save/Remove instead of Share.
  initialNote?: string;
  busy?: boolean;
  onSend: (note: string) => void;
  onCancel: () => void;
}) {
  const isEdit = initialNote !== undefined;
  const [note, setNote] = useState(initialNote ?? '');
  return (
    <Modal transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={busy ? undefined : onCancel} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.wrap}>
        <View style={styles.sheet}>
          <View style={[styles.banner, { backgroundColor: audience.color + '26', borderColor: audience.color }]}>
            <Ionicons name={audience.icon} size={16} color={audience.color} />
            <Text style={[styles.bannerText, { color: audience.color }]} numberOfLines={2}>{audience.label}</Text>
          </View>
          <TextInput
            style={styles.input}
            value={note}
            onChangeText={setNote}
            placeholder="Add a note (optional)"
            placeholderTextColor="#777"
            multiline
            maxLength={500}
            autoFocus
            editable={!busy}
          />
          <View style={styles.row}>
            <TouchableOpacity onPress={onCancel} disabled={busy} hitSlop={8}>
              <Text style={styles.cancel}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.sendBtn, busy && { opacity: 0.6 }]} onPress={() => onSend(note.trim())} disabled={busy} activeOpacity={0.8}>
              <Text style={styles.sendText}>
                {busy ? 'Saving…' : isEdit ? (note.trim() ? 'Save note' : 'Remove note') : note.trim() ? 'Share with note' : 'Share'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  wrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#161616', borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, paddingBottom: 34, gap: 14 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12 },
  bannerText: { fontSize: 14, fontWeight: '800', flexShrink: 1 },
  input: { backgroundColor: '#0e0e0e', borderRadius: 10, padding: 12, color: '#fff', fontSize: 15, minHeight: 90, textAlignVertical: 'top' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cancel: { color: '#888', fontSize: 15, fontWeight: '600', paddingVertical: 8, paddingHorizontal: 8 },
  sendBtn: { backgroundColor: '#534AB7', borderRadius: 10, paddingVertical: 11, paddingHorizontal: 22 },
  sendText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
