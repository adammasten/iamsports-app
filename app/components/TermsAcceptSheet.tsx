import { TERMS } from '@/constants/legal';
import { colors } from '@/constants/theme';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// First-login Terms/EULA gate. Blocks the app until the user accepts (or
// declines → signs out). Shown by TermsGate in app/_layout.tsx.
export default function TermsAcceptSheet({ onAccept, onDecline, submitting }: {
  onAccept: () => void; onDecline: () => void; submitting: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible animationType="slide" onRequestClose={onDecline}>
      <View style={[styles.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 12 }]}>
        <Text style={styles.title}>Welcome to IamSports</Text>
        <Text style={styles.intro}>Before you start, please review and accept our Terms of Use.</Text>
        <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 20 }}>
          {TERMS.map(s => (
            <View key={s.heading} style={styles.section}>
              <Text style={styles.heading}>{s.heading}</Text>
              <Text style={styles.body}>{s.body}</Text>
            </View>
          ))}
        </ScrollView>
        <Text style={styles.agreeNote}>By tapping “I Agree” you accept these Terms, including zero tolerance for objectionable content and abusive behavior.</Text>
        <TouchableOpacity style={[styles.agreeBtn, submitting && styles.dim]} onPress={onAccept} disabled={submitting}>
          <Text style={styles.agreeText}>{submitting ? 'One moment…' : 'I Agree'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.declineBtn} onPress={onDecline} disabled={submitting}>
          <Text style={styles.declineText}>Decline and sign out</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 20 },
  title: { color: colors.text, fontSize: 24, fontWeight: '800' },
  intro: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 6, marginBottom: 12 },
  scroll: { flex: 1, borderTopWidth: 1, borderTopColor: colors.border },
  section: { marginTop: 16 },
  heading: { color: colors.text, fontSize: 14, fontWeight: '700', marginBottom: 5 },
  body: { color: colors.textSecondary, fontSize: 13.5, lineHeight: 20 },
  agreeNote: { color: colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 12, marginBottom: 10 },
  agreeBtn: { backgroundColor: colors.brand, borderRadius: 10, padding: 16, alignItems: 'center' },
  agreeText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  dim: { opacity: 0.6 },
  declineBtn: { padding: 12, alignItems: 'center', marginTop: 6 },
  declineText: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
});
