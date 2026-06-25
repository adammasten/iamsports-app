import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native';

export type DropdownOption = { value: string; label: string };

type Props = {
  value: string;
  options: DropdownOption[];
  onSelect: (value: string) => void;
  placeholder?: string;
  compact?: boolean;
};

// Reusable single-select dropdown — a compact trigger button showing the current
// selection that opens a bottom-sheet of options. Presentational only (no data
// fetching, no RPCs); the parent owns `value` (controlled). Bottom-sheet structure
// + dark styling mirror VisibilityPicker / NameCaptureSheet so the three stay
// consistent. The component holds only its own open/close state.
export default function Dropdown({ value, options, onSelect, placeholder = 'Select', compact = false }: Props) {
  const [open, setOpen] = useState(false);

  const selectedLabel = options.find(o => o.value === value)?.label ?? placeholder;

  return (
    <>
      <TouchableOpacity
        style={[styles.trigger, compact && styles.triggerCompact]}
        onPress={() => setOpen(true)}
      >
        <Text style={styles.triggerText} numberOfLines={1}>{selectedLabel}</Text>
        <Ionicons name="chevron-down" size={14} color="#888" />
      </TouchableOpacity>

      {open && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <ScrollView style={styles.optionScroll}>
                {options.map(o => {
                  const selected = o.value === value;
                  return (
                    <TouchableOpacity
                      key={o.value}
                      style={[styles.optionRow, selected && styles.optionRowSelected]}
                      onPress={() => { onSelect(o.value); setOpen(false); }}
                    >
                      <Ionicons
                        name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                        size={18}
                        color={selected ? '#8B82E8' : '#666'}
                      />
                      <Text style={styles.optionText}>{o.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <TouchableOpacity style={styles.cancel} onPress={() => setOpen(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  triggerCompact: { paddingVertical: 6, paddingHorizontal: 10 },
  triggerText: { color: '#fff', fontSize: 13, fontWeight: '600' },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#1a1a1a', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, paddingBottom: 32 },
  optionScroll: { maxHeight: 380 },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#222',
    borderRadius: 10,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  optionRowSelected: { borderColor: '#534AB7', backgroundColor: '#2a2740' },
  optionText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cancel: { padding: 14, alignItems: 'center', marginTop: 4 },
  cancelText: { color: '#888', fontSize: 15 },
});
