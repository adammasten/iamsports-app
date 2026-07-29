import { colors } from '@/constants/theme';
import { SUPPORT_EMAIL, TERMS, TERMS_EFFECTIVE } from '@/constants/legal';
import { goBackOrHome } from '@/lib/nav';
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Standalone Terms / EULA reader (linked from the Account screen). The same
// TERMS content is shown in the acceptance gate on first login.
export default function TermsScreen() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <TouchableOpacity onPress={goBackOrHome} style={styles.back}><Text style={styles.backText}>← Back</Text></TouchableOpacity>
      <Text style={styles.title}>Terms of Use</Text>
      <Text style={styles.effective}>Effective {TERMS_EFFECTIVE}</Text>
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
        {TERMS.map(s => (
          <View key={s.heading} style={styles.section}>
            <Text style={styles.heading}>{s.heading}</Text>
            <Text style={styles.body}>{s.body}</Text>
          </View>
        ))}
        <TouchableOpacity onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}>
          <Text style={styles.mail}>{SUPPORT_EMAIL}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 20 },
  back: { paddingVertical: 8 },
  backText: { color: colors.brand, fontSize: 16 },
  title: { color: colors.text, fontSize: 28, fontWeight: '700', marginTop: 8 },
  effective: { color: colors.textMuted, fontSize: 13, marginBottom: 16 },
  section: { marginBottom: 18 },
  heading: { color: colors.text, fontSize: 15, fontWeight: '700', marginBottom: 6 },
  body: { color: colors.textSecondary, fontSize: 14, lineHeight: 21 },
  mail: { color: colors.brandLight, fontSize: 14, marginTop: 4 },
});
