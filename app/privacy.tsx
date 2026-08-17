import { colors } from '@/constants/theme';
import { PRIVACY, PRIVACY_EFFECTIVE, SUPPORT_EMAIL } from '@/constants/legal';
import { goBackOrHome } from '@/lib/nav';
import { Linking, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Standalone Privacy Policy reader — linked from the landing footer + the Account
// screen. Same content as the public /privacy page (constants/legal.ts PRIVACY).
export default function PrivacyScreen() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <View style={Platform.OS === 'web' ? styles.webWrap : styles.nativeWrap}>
        <TouchableOpacity onPress={goBackOrHome} style={styles.back}><Text style={styles.backText}>← Back</Text></TouchableOpacity>
        <Text style={styles.title}>Privacy Policy</Text>
        <Text style={styles.effective}>Last updated {PRIVACY_EFFECTIVE}</Text>
        <ScrollView contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
          {PRIVACY.map(s => (
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 20 },
  nativeWrap: { flex: 1 },
  webWrap: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center' },
  back: { paddingVertical: 8 },
  backText: { color: colors.brand, fontSize: 16 },
  title: { color: colors.text, fontSize: 28, fontWeight: '700', marginTop: 8 },
  effective: { color: colors.textMuted, fontSize: 13, marginBottom: 16 },
  section: { marginBottom: 18 },
  heading: { color: colors.text, fontSize: 15, fontWeight: '700', marginBottom: 6 },
  body: { color: colors.textSecondary, fontSize: 14, lineHeight: 21 },
  mail: { color: colors.brandLight, fontSize: 14, marginTop: 4 },
});
