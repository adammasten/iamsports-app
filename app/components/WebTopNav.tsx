// Web-only top navigation bar. On the web the phone's bottom tab bar reads as an
// afterthought, so desktop gets a standard top nav instead: wordmark left, the
// primary destinations as links, and global actions (search, notifications,
// account) + an Upload CTA on the right — the pattern every mature web app uses.
// Rendered ONLY on web (callers gate on Platform.OS); native keeps its bottom tabs.
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

const C = {
  bar: '#14161c', line: '#262a34', text: '#f2f3f6', dim: '#9096a3',
  accent: '#6c5ce7', badge: '#EF5350',
};

type Dest = 'home' | 'filmroom' | 'coaches';
const LINKS: { key: Dest; label: string; href: string }[] = [
  { key: 'home', label: 'Home', href: '/select-team' },
  { key: 'filmroom', label: 'Film Room', href: '/my-work' },
  { key: 'coaches', label: "Coaches' Corner", href: '/coaches-corner' },
];

export default function WebTopNav({ active, unseenNotif = 0 }: { active?: Dest; unseenNotif?: number }) {
  return (
    <View style={styles.bar}>
      <Pressable onPress={() => router.replace('/select-team')} style={styles.brandBtn}>
        <Text style={styles.brand}>🏀 IamSports</Text>
      </Pressable>

      <View style={styles.links}>
        {LINKS.map(l => {
          const on = active === l.key;
          return (
            <Pressable key={l.key} onPress={() => router.push(l.href as any)} style={styles.link}>
              <Text style={[styles.linkTxt, on && styles.linkOn]}>{l.label}</Text>
              {on ? <View style={styles.underline} /> : null}
            </Pressable>
          );
        })}
      </View>

      <View style={styles.spacer} />

      <View style={styles.actions}>
        <Pressable onPress={() => router.push('/search')} style={styles.iconBtn} hitSlop={6}>
          <Ionicons name="search-outline" size={20} color={C.text} />
        </Pressable>
        <Pressable onPress={() => router.push('/notifications')} style={styles.iconBtn} hitSlop={6}>
          <Ionicons name="notifications-outline" size={20} color={C.text} />
          {unseenNotif > 0 ? (
            <View style={styles.badge}><Text style={styles.badgeTxt}>{unseenNotif > 99 ? '99+' : unseenNotif}</Text></View>
          ) : null}
        </Pressable>
        <Pressable onPress={() => router.push('/upload')} style={styles.cta}>
          <Ionicons name="cloud-upload-outline" size={16} color="#fff" />
          <Text style={styles.ctaTxt}>Upload film</Text>
        </Pressable>
        <Pressable onPress={() => router.push('/account')} style={styles.avatar} hitSlop={6}>
          <Ionicons name="person-outline" size={17} color={C.dim} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 22, backgroundColor: C.bar, borderBottomWidth: 1, borderBottomColor: C.line, gap: 8 },
  brandBtn: { marginRight: 26 },
  brand: { color: C.text, fontSize: 16, fontWeight: '800', letterSpacing: -0.3 },
  links: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  link: { paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center' },
  linkTxt: { color: C.dim, fontSize: 14, fontWeight: '600' },
  linkOn: { color: C.text, fontWeight: '700' },
  underline: { position: 'absolute', bottom: -1, left: 12, right: 12, height: 2, borderRadius: 2, backgroundColor: C.accent },
  spacer: { flex: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBtn: { padding: 6 },
  badge: { position: 'absolute', top: 0, right: 0, minWidth: 15, height: 15, borderRadius: 8, backgroundColor: C.badge, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  badgeTxt: { color: '#fff', fontSize: 9, fontWeight: '800' },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: C.accent, paddingHorizontal: 18, height: 38, borderRadius: 10 },
  ctaTxt: { color: '#fff', fontSize: 14, fontWeight: '800' },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#1b1e26', borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
});
