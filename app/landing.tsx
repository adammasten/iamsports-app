import { router } from 'expo-router';
import { useRef } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

// Public marketing landing — the web front door (logged-out web users land here;
// AuthGate routes native users straight to /login). Rebuilt from the iamsports.com
// marketing site so the whole experience can live under one domain. "Log in" /
// "Get started" go to the app's real /login. Barlow fonts come from app/+html.tsx.

const C = {
  bg: '#FAF9F6', ink: '#0E1B2C', inkSoft: '#415062', orange: '#F25C1F',
  orangeDark: '#D14A12', line: '#E4E0D8', panelBlue: '#9fb0c6', footDim: '#7284a0',
};
const DISPLAY = Platform.select({ web: 'Barlow Condensed', default: undefined });
const BODY = Platform.select({ web: 'Barlow', default: undefined });

const STEPS = [
  { n: '1', title: 'Upload the game', body: 'Film on any phone. Upload one video or the whole game in pieces — IamSports keeps them together as one game.' },
  { n: '2', title: 'Tag the moments', body: 'Tap the timeline while you watch. Stars for highlights, POE for teaching moments, your own categories for everything else.' },
  { n: '3', title: 'Share the reel', body: 'Export a clean highlight reel or a full film breakdown, and post it to the team wall where parents actually see it.' },
];

const FEATURES = [
  { title: 'Tagging built for the sideline', body: 'One-thumb tagging designed for a coach holding a phone at a tournament, not an analyst at a desk.' },
  { title: 'Highlight reels parents share', body: "Star a clip and it's in the reel. Export polished highlights your families will send to grandma — and to recruiters." },
  { title: 'A team wall, not a group chat', body: "Games, reels, and clips live on the team's wall. No more hunting through a 400-message thread for the film link." },
  { title: 'Kid-safe by design', body: 'Coach-controlled permissions decide who sees what. Full games stay inside the team. The public never gets the team wall.' },
];

const PLANS = [
  { name: 'Universal', price: '$4.99', per: '/mo', alt: 'or $39/yr', tagline: 'Parents & players', features: ['Watch shared games & reels', "Follow your kid's wall", 'Save highlight reels'], featured: false },
  { name: 'Pro Coach', price: '$19.99', per: '/mo', alt: 'or $149/yr', tagline: 'The full film room', features: ['Unlimited tagging & exports', 'Team walls & permissions', 'Multi-video games', 'Highlight reel builder'], featured: true },
  { name: 'Team Pass', price: '$200', per: '/4 mo', alt: 'one-time, no auto-renew', tagline: 'One team, one season', features: ['Team-scoped access for the season', 'Every parent sees the film', 'No subscriptions to manage'], featured: false },
  { name: 'Org', price: '$49.99+', per: '/mo', alt: 'clubs & programs', tagline: 'Whole program', features: ['Multiple teams & coaches', 'Org-level admin', 'Priority support'], featured: false },
];

function Wordmark({ size, light }: { size: number; light?: boolean }) {
  return (
    <Text style={{ fontFamily: DISPLAY, fontWeight: '800', fontStyle: 'italic', fontSize: size, letterSpacing: -0.5, color: light ? '#fff' : C.ink }}>
      IAM<Text style={{ color: C.orange }}>SPORTS</Text>
    </Text>
  );
}

export default function Landing() {
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const howY = useRef(0);
  const pricingY = useRef(0);
  const narrow = width < 760;

  const goLogin = () => router.push('/login');
  const scrollTo = (y: number) => scrollRef.current?.scrollTo({ y: y - 60, animated: true });

  // Column widths for the wrap-grids (percent-ish via flexBasis).
  const stepBasis = narrow ? '100%' : '31%';
  const featBasis = narrow ? '100%' : '48%';
  const planBasis = width < 640 ? '100%' : width < 1040 ? '47%' : '23%';

  return (
    <View style={styles.root}>
      {/* NAV */}
      <View style={styles.nav}>
        <View style={styles.navInner}>
          <Wordmark size={24} />
          <View style={styles.navRight}>
            {!narrow && (
              <>
                <Pressable onPress={() => scrollTo(howY.current)}><Text style={styles.navLink}>How it works</Text></Pressable>
                <Pressable onPress={() => scrollTo(pricingY.current)}><Text style={styles.navLink}>Pricing</Text></Pressable>
              </>
            )}
            <Pressable onPress={goLogin} style={styles.navLoginBtn}><Text style={styles.navLoginTxt}>Log in</Text></Pressable>
            <Pressable onPress={goLogin} style={styles.navCta}><Text style={styles.navCtaTxt}>Get started</Text></Pressable>
          </View>
        </View>
      </View>

      <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.scrollBody} showsVerticalScrollIndicator={false}>
        {/* HERO */}
        <View style={[styles.section, styles.heroWrap, narrow && { flexDirection: 'column' }]}>
          <View style={{ flex: 1, minWidth: 280 }}>
            <View style={styles.badge}><Text style={styles.badgeTxt}>Because highlights shouldn&apos;t cost $1,500</Text></View>
            <Text style={styles.h1}>PROFESSIONAL TAGGING.{'\n'}<Text style={{ color: C.orange }}>WITHOUT THE PROFESSIONAL COST.</Text></Text>
            <Text style={styles.heroSub}>IamSports turns your phone into a film room. Tag game film courtside, build highlight reels in minutes, and share it all on a team wall your parents actually check.</Text>
            <View style={styles.heroBtns}>
              <Pressable onPress={goLogin} style={styles.ctaOrange}><Text style={styles.ctaOrangeTxt}>Start free</Text></Pressable>
              <Pressable onPress={() => scrollTo(howY.current)} style={styles.ctaOutline}><Text style={styles.ctaOutlineTxt}>See how it works</Text></Pressable>
            </View>
            <Text style={styles.heroFoot}>iPhone + web at launch. Your first game breakdown is free.</Text>
          </View>
          {/* Film-frame visual placeholder */}
          <View style={styles.filmFrame}>
            <Text style={styles.filmFrameTxt}>▶  Game film</Text>
          </View>
        </View>

        {/* HOW IT WORKS */}
        <View style={styles.bandWhite} onLayout={e => { howY.current = e.nativeEvent.layout.y; }}>
          <View style={styles.section}>
            <Text style={styles.h2}>FILM TO REEL IN <Text style={{ color: C.orange }}>THREE STEPS</Text></Text>
            <View style={styles.grid}>
              {STEPS.map(s => (
                <View key={s.n} style={{ flexBasis: stepBasis, flexGrow: 1 }}>
                  <View style={styles.stepNum}><Text style={styles.stepNumTxt}>{s.n}</Text></View>
                  <Text style={styles.h3}>{s.title}</Text>
                  <Text style={styles.body}>{s.body}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* FEATURES */}
        <View style={styles.section}>
          <Text style={styles.h2}>MADE FOR YOUTH BALL, <Text style={{ color: C.orange }}>NOT THE PROS</Text></Text>
          <Text style={[styles.body, { maxWidth: 640, marginTop: 12 }]}>Pro tools price out youth teams and bury coaches in features built for paid staff. IamSports does the part that matters — film, tags, reels — at a price a volunteer coach can say yes to.</Text>
          <View style={styles.grid}>
            {FEATURES.map(f => (
              <View key={f.title} style={[styles.featCard, { flexBasis: featBasis, flexGrow: 1 }]}>
                <Text style={styles.h3}>{f.title}</Text>
                <Text style={styles.body}>{f.body}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* SEE IT IN ACTION */}
        <View style={styles.bandWhite}>
          <View style={styles.section}>
            <Text style={styles.h2}>SEE IT IN <Text style={{ color: C.orange }}>ACTION</Text></Text>
            <View style={[styles.grid, { marginTop: 24 }]}>
              {['TAGGING', 'FILM ROOM', 'TEAM WALL', 'HIGHLIGHT REEL'].map(l => (
                <View key={l} style={[styles.shot, { flexBasis: narrow ? '47%' : '23%', flexGrow: 1 }]}>
                  <Text style={styles.shotTxt}>{l}</Text>
                  <Text style={styles.shotSub}>App screenshot</Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* PRICING */}
        <View style={styles.section} onLayout={e => { pricingY.current = e.nativeEvent.layout.y; }}>
          <Text style={styles.h2}>PRICING THAT FITS A <Text style={{ color: C.orange }}>TEAM BUDGET</Text></Text>
          <View style={styles.grid}>
            {PLANS.map(p => (
              <View key={p.name} style={[styles.plan, { flexBasis: planBasis, flexGrow: 1, borderColor: p.featured ? C.orange : C.line, backgroundColor: p.featured ? C.ink : '#fff' }]}>
                {p.featured && <View style={styles.planTag}><Text style={styles.planTagTxt}>MOST POPULAR</Text></View>}
                <Text style={[styles.planName, { color: p.featured ? '#fff' : C.ink }]}>{p.name}</Text>
                <Text style={[styles.planTagline, { color: p.featured ? C.panelBlue : C.inkSoft }]}>{p.tagline}</Text>
                <View style={styles.planPriceRow}>
                  <Text style={[styles.planPrice, { color: p.featured ? '#fff' : C.ink }]}>{p.price}</Text>
                  <Text style={[styles.planPer, { color: p.featured ? C.panelBlue : C.inkSoft }]}>{p.per}</Text>
                </View>
                <Text style={[styles.planAlt, { color: p.featured ? C.panelBlue : C.inkSoft }]}>{p.alt}</Text>
                <View style={{ marginTop: 14, gap: 8, flex: 1 }}>
                  {p.features.map(f => (
                    <View key={f} style={styles.planFeatRow}>
                      <Text style={{ color: C.orange, fontWeight: '800' }}>▸ </Text>
                      <Text style={[styles.planFeat, { color: p.featured ? '#dbe4ef' : C.inkSoft }]}>{f}</Text>
                    </View>
                  ))}
                </View>
                <Pressable onPress={goLogin} style={[styles.planBtn, { backgroundColor: p.featured ? C.orange : C.ink }]}>
                  <Text style={styles.planBtnTxt}>Get started</Text>
                </Pressable>
              </View>
            ))}
          </View>
        </View>

        {/* FINAL CTA + FOOTER */}
        <View style={styles.finalBand}>
          <View style={[styles.section, { alignItems: 'center' }]}>
            <Text style={[styles.h2, { color: '#fff', textAlign: 'center' }]}>YOUR NEXT GAME DESERVES A <Text style={{ color: C.orange }}>FILM ROOM</Text></Text>
            <Text style={[styles.body, { color: C.panelBlue, textAlign: 'center', maxWidth: 520, marginTop: 12 }]}>Free to start. Tag your first game tonight and see what your team&apos;s been missing.</Text>
            <Pressable onPress={goLogin} style={[styles.ctaOrange, { marginTop: 24 }]}><Text style={styles.ctaOrangeTxt}>Start free</Text></Pressable>
          </View>
          <View style={styles.footer}>
            <View style={[styles.section, styles.footerInner, narrow && { flexDirection: 'column', gap: 8 }]}>
              <Wordmark size={18} light />
              <View style={styles.footLinks}>
                <Text style={styles.footDim}>© 2026 IamSports LLC</Text>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { flex: 1 },
  scrollBody: { paddingBottom: 0 },
  section: { width: '100%', maxWidth: 1100, alignSelf: 'center', paddingHorizontal: 20, paddingVertical: 56 },

  nav: { backgroundColor: 'rgba(250,249,246,0.95)', borderBottomWidth: 1, borderBottomColor: C.line, ...(Platform.OS === 'web' ? { position: 'sticky' as any, top: 0, zIndex: 40 } : {}) },
  navInner: { width: '100%', maxWidth: 1100, alignSelf: 'center', paddingHorizontal: 20, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navRight: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  navLink: { fontFamily: BODY, fontSize: 14, fontWeight: '600', color: C.inkSoft },
  navLoginBtn: { borderWidth: 1, borderColor: C.ink, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  navLoginTxt: { fontFamily: BODY, fontSize: 14, fontWeight: '700', color: C.ink },
  navCta: { backgroundColor: C.orange, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  navCtaTxt: { fontFamily: BODY, fontSize: 14, fontWeight: '700', color: '#fff' },

  heroWrap: { flexDirection: 'row', gap: 40, alignItems: 'center' },
  badge: { alignSelf: 'flex-start', backgroundColor: C.ink, borderRadius: 5, paddingHorizontal: 8, paddingVertical: 5, marginBottom: 16 },
  badgeTxt: { fontFamily: BODY, color: '#fff', fontSize: 11, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' },
  h1: { fontFamily: DISPLAY, fontStyle: 'italic', fontWeight: '800', color: C.ink, fontSize: 52, lineHeight: 50, letterSpacing: -1 },
  heroSub: { fontFamily: BODY, fontSize: 18, lineHeight: 27, color: C.inkSoft, marginTop: 20 },
  heroBtns: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 26 },
  heroFoot: { fontFamily: BODY, fontSize: 14, color: C.inkSoft, marginTop: 16 },
  filmFrame: { flex: 1, minWidth: 280, aspectRatio: 16 / 10, backgroundColor: C.ink, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  filmFrameTxt: { fontFamily: DISPLAY, fontStyle: 'italic', fontWeight: '800', color: '#fff', fontSize: 22, opacity: 0.85 },

  ctaOrange: { backgroundColor: C.orange, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 14 },
  ctaOrangeTxt: { fontFamily: BODY, color: '#fff', fontWeight: '700', fontSize: 16 },
  ctaOutline: { borderWidth: 2, borderColor: C.ink, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 },
  ctaOutlineTxt: { fontFamily: BODY, color: C.ink, fontWeight: '700', fontSize: 16 },

  bandWhite: { backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: C.line, width: '100%' },
  finalBand: { backgroundColor: C.ink, width: '100%' },

  h2: { fontFamily: DISPLAY, fontStyle: 'italic', fontWeight: '800', color: C.ink, fontSize: 36, letterSpacing: -0.5 },
  h3: { fontFamily: DISPLAY, fontWeight: '800', color: C.ink, fontSize: 22, marginTop: 14 },
  body: { fontFamily: BODY, fontSize: 16, lineHeight: 24, color: C.inkSoft, marginTop: 8 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 24, marginTop: 32 },

  stepNum: { width: 48, height: 48, borderRadius: 24, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' },
  stepNumTxt: { fontFamily: DISPLAY, fontWeight: '800', color: '#fff', fontSize: 22 },

  featCard: { borderWidth: 1, borderColor: C.line, borderRadius: 18, padding: 24, backgroundColor: '#fff' },

  shot: { aspectRatio: 3 / 4, borderWidth: 1, borderColor: C.line, borderRadius: 14, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', gap: 4 },
  shotTxt: { fontFamily: DISPLAY, fontWeight: '800', color: C.ink, fontSize: 16 },
  shotSub: { fontFamily: BODY, fontSize: 11, color: C.inkSoft },

  plan: { borderWidth: 2, borderRadius: 18, padding: 22, minWidth: 220 },
  planTag: { alignSelf: 'flex-start', backgroundColor: C.orange, borderRadius: 5, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 8 },
  planTagTxt: { fontFamily: BODY, color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  planName: { fontFamily: DISPLAY, fontWeight: '800', fontSize: 24 },
  planTagline: { fontFamily: BODY, fontSize: 12, fontWeight: '600', marginTop: 2 },
  planPriceRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, marginTop: 16 },
  planPrice: { fontFamily: DISPLAY, fontWeight: '800', fontSize: 38 },
  planPer: { fontFamily: BODY, fontSize: 14, fontWeight: '600', marginBottom: 6 },
  planAlt: { fontFamily: BODY, fontSize: 12, fontWeight: '500', marginTop: 2 },
  planFeatRow: { flexDirection: 'row', alignItems: 'flex-start' },
  planFeat: { fontFamily: BODY, fontSize: 14, flexShrink: 1 },
  planBtn: { marginTop: 20, borderRadius: 9, paddingVertical: 11, alignItems: 'center' },
  planBtnTxt: { fontFamily: BODY, color: '#fff', fontWeight: '700', fontSize: 14 },

  footer: { borderTopWidth: 1, borderTopColor: '#22334b', width: '100%' },
  footerInner: { paddingVertical: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  footLinks: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  footDim: { fontFamily: BODY, fontSize: 12, color: C.footDim },
});
