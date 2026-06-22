import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';

type Props = {
  onSubmit: (name: string) => void;
  submitting: boolean;
};

// First-run "what should we call you?" bottom sheet. Presentational only — it
// collects a name and calls onSubmit; the caller does the RPC. Dark bottom-sheet
// styling mirrors VisibilityPicker. Intentionally non-dismissible (no backdrop
// tap, no-op onRequestClose) — it's a required first-run step.
export default function NameCaptureSheet({ onSubmit, submitting }: Props) {
  const [name, setName] = useState('');
  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && !submitting;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => {}}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.title}>What should we call you?</Text>
          <TextInput
            style={styles.input}
            placeholder="Your name"
            placeholderTextColor="#888"
            value={name}
            onChangeText={setName}
            autoFocus
            autoCapitalize="words"
            returnKeyType="done"
            editable={!submitting}
            onSubmitEditing={() => { if (canSubmit) onSubmit(trimmed); }}
          />
          <Text style={styles.helper}>This is shown when you share clips with players and their families.</Text>
          <TouchableOpacity
            style={[styles.button, !canSubmit && styles.buttonDisabled]}
            onPress={() => onSubmit(trimmed)}
            disabled={!canSubmit}
          >
            <Text style={[styles.buttonText, !canSubmit && styles.buttonTextDisabled]}>
              {submitting ? 'Saving…' : 'Continue'}
            </Text>
          </TouchableOpacity>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#1a1a1a', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, paddingBottom: 32 },
  title: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 14, textAlign: 'center' },
  input: { width: '100%', borderWidth: 1, borderColor: '#333', borderRadius: 8, padding: 14, fontSize: 16, color: '#fff', marginBottom: 10 },
  helper: { color: '#888', fontSize: 13, marginBottom: 16 },
  button: { backgroundColor: '#534AB7', borderRadius: 10, padding: 16, alignItems: 'center' },
  buttonDisabled: { backgroundColor: '#2a2a2a' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  buttonTextDisabled: { color: '#666' },
});
