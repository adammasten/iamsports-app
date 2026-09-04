import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

type Props = {
  onSubmit: (first: string, last: string) => void;
  submitting: boolean;
  initialFirst?: string;
  initialLast?: string;
};

// First-run "what should we call you?" bottom sheet. Presentational only — it
// collects a first + last name and an 18+ confirmation, then calls onSubmit; the
// caller does the RPC (which also records the 18+ attestation). Dark bottom-sheet
// styling mirrors VisibilityPicker. Intentionally non-dismissible (no backdrop
// tap, no-op onRequestClose) — it's a required first-run step.
//
// IamSports is adults-only: kids are never users. The 18+ box is an affirmative
// gate — Continue stays disabled until it's checked, so no one gets past this
// screen without confirming they're an adult.
export default function NameCaptureSheet({ onSubmit, submitting, initialFirst = '', initialLast = '' }: Props) {
  const [first, setFirst] = useState(initialFirst);
  const [last, setLast] = useState(initialLast);
  const [isAdult, setIsAdult] = useState(false);
  const f = first.trim();
  const l = last.trim();
  const canSubmit = f.length > 0 && l.length > 0 && isAdult && !submitting;

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
            placeholder="First name"
            placeholderTextColor="#888"
            value={first}
            onChangeText={setFirst}
            autoFocus
            autoCapitalize="words"
            returnKeyType="next"
            editable={!submitting}
          />
          <TextInput
            style={styles.input}
            placeholder="Last name"
            placeholderTextColor="#888"
            value={last}
            onChangeText={setLast}
            autoCapitalize="words"
            returnKeyType="done"
            editable={!submitting}
            onSubmitEditing={() => { if (canSubmit) onSubmit(f, l); }}
          />
          <Text style={styles.helper}>This is shown when you share clips with players and their families.</Text>

          <Pressable
            style={styles.checkRow}
            onPress={() => { if (!submitting) setIsAdult(v => !v); }}
            disabled={submitting}
          >
            <View style={[styles.checkbox, isAdult && styles.checkboxOn]}>
              {isAdult ? <Text style={styles.checkmark}>✓</Text> : null}
            </View>
            <Text style={styles.checkLabel}>I confirm I am 18 years of age or older.</Text>
          </Pressable>

          <TouchableOpacity
            style={[styles.button, !canSubmit && styles.buttonDisabled]}
            onPress={() => onSubmit(f, l)}
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
  checkRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, borderColor: '#555', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  checkboxOn: { backgroundColor: '#534AB7', borderColor: '#534AB7' },
  checkmark: { color: '#fff', fontSize: 15, fontWeight: '800', lineHeight: 18 },
  checkLabel: { color: '#ddd', fontSize: 14, flex: 1 },
  button: { backgroundColor: '#534AB7', borderRadius: 10, padding: 16, alignItems: 'center' },
  buttonDisabled: { backgroundColor: '#2a2a2a' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  buttonTextDisabled: { color: '#666' },
});
