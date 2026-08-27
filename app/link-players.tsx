// Coach-side "Link players across teams" (cross-team identity, Slice 1).
// Same human on multiple teams = multiple `players` rows; here a coach marks them
// as one identity (shared lineage). Records identity only — the cross-team
// viewing / unified claim that USE it are later slices. Never auto-links.
import { COACH_ROLES, useTeamContext } from '@/context';
import { goBackOrHome } from '@/lib/nav';
import { webAlert } from '@/lib/webAlert';
import {
  groupIdentities, linkPlayers, loadCoachPlayers, unlinkPlayer,
  type Identity, type LinkablePlayer,
} from '@/lib/core/player-links';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const C = { bg: '#0e1b2c', card: '#12202e', border: '#1f2f3d', text: '#f1f4f6', dim: '#8b96a3', brand: '#6ea8ff', good: '#3ec46d', warn: '#e0a52e', danger: '#e2574a' };

export default function LinkPlayersScreen() {
  const insets = useSafeAreaInsets();
  const { userTeams } = useTeamContext();
  const coachTeams = useMemo(() => userTeams.filter(t => COACH_ROLES.includes(t.role)), [userTeams]);
  const teamNameById = useMemo(() => new Map(coachTeams.map(t => [t.team_id, t.name])), [coachTeams]);
  const teamIds = useMemo(() => Array.from(new Set(coachTeams.map(t => t.team_id))), [coachTeams]);

  const [rows, setRows] = useState<LinkablePlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [linkFrom, setLinkFrom] = useState<LinkablePlayer | null>(null);   // picking a match for this player
  const [confirmTo, setConfirmTo] = useState<LinkablePlayer | null>(null); // pending confirmation

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await loadCoachPlayers(teamIds, teamNameById)); }
    catch (e: any) { webAlert('Couldn’t load players', e?.message ?? 'Try again.'); }
    setLoading(false);
  }, [teamIds, teamNameById]);
  useEffect(() => { load(); }, [load]);

  const identities = useMemo(() => groupIdentities(rows), [rows]);

  // Candidate matches when linking: rows in a DIFFERENT identity; same-name first.
  const candidates = useMemo(() => {
    if (!linkFrom) return [];
    return rows
      .filter(r => r.lineageId !== linkFrom.lineageId)
      .sort((a, b) => {
        const an = a.name.toLowerCase() === linkFrom.name.toLowerCase() ? 0 : 1;
        const bn = b.name.toLowerCase() === linkFrom.name.toLowerCase() ? 0 : 1;
        return an - bn || a.name.localeCompare(b.name);
      });
  }, [linkFrom, rows]);

  const doLink = useCallback(async () => {
    if (!linkFrom || !confirmTo) return;
    setBusy(true);
    try {
      await linkPlayers(linkFrom.id, confirmTo.id);
      setLinkFrom(null); setConfirmTo(null);
      await load();
    } catch (e: any) { webAlert('Couldn’t link', e?.message ?? 'Try again.'); }
    setBusy(false);
  }, [linkFrom, confirmTo, load]);

  const doUnlink = useCallback(async (p: LinkablePlayer) => {
    setBusy(true);
    try { await unlinkPlayer(p.id); await load(); }
    catch (e: any) { webAlert('Couldn’t unlink', e?.message ?? 'Try again.'); }
    setBusy(false);
  }, [load]);

  const label = (p: LinkablePlayer) => `${p.teamName}${p.jersey ? ` · #${p.jersey}` : ''}`;

  const Frame = ({ children }: { children: React.ReactNode }) => (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      <View style={styles.wrap}>
        <TouchableOpacity onPress={() => (linkFrom ? setLinkFrom(null) : goBackOrHome())} style={styles.back} hitSlop={8}>
          <Text style={styles.backTxt}>← {linkFrom ? 'Cancel' : 'Back'}</Text>
        </TouchableOpacity>
        {children}
      </View>
    </View>
  );

  if (coachTeams.length === 0) return <Frame><Text style={styles.empty}>Only coaches can link players.</Text></Frame>;

  // ── Confirm step ──
  if (linkFrom && confirmTo) {
    return (
      <Frame>
        <Text style={styles.title}>Same kid?</Text>
        <Text style={styles.hint}>Link these two roster entries as one player. Only do this if they are the same human.</Text>
        <View style={styles.confirmCard}>
          <Text style={styles.confirmName}>{linkFrom.name}</Text>
          <Text style={styles.confirmSub}>{label(linkFrom)}</Text>
          <Text style={styles.confirmPlus}>＋</Text>
          <Text style={styles.confirmName}>{confirmTo.name}</Text>
          <Text style={styles.confirmSub}>{label(confirmTo)}</Text>
        </View>
        <TouchableOpacity style={[styles.primary, busy && { opacity: 0.5 }]} onPress={doLink} disabled={busy}>
          <Text style={styles.primaryTxt}>{busy ? 'Linking…' : 'Yes, link them'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setConfirmTo(null)} style={styles.secondary}>
          <Text style={styles.secondaryTxt}>Pick a different one</Text>
        </TouchableOpacity>
      </Frame>
    );
  }

  // ── Pick-a-match step ──
  if (linkFrom) {
    return (
      <Frame>
        <Text style={styles.title}>Link {linkFrom.name}</Text>
        <Text style={styles.hint}>Pick the SAME kid on another team. {linkFrom.name} on {label(linkFrom)}.</Text>
        <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
          {candidates.map(c => (
            <TouchableOpacity key={c.id} style={styles.row} onPress={() => setConfirmTo(c)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{c.name}{c.name.toLowerCase() === linkFrom.name.toLowerCase() ? <Text style={styles.match}>  same name</Text> : null}</Text>
                <Text style={styles.rowSub}>{label(c)}</Text>
              </View>
              <Text style={styles.rowArrow}>›</Text>
            </TouchableOpacity>
          ))}
          {candidates.length === 0 ? <Text style={styles.empty}>No other players to link to.</Text> : null}
        </ScrollView>
      </Frame>
    );
  }

  // ── Main list ──
  return (
    <Frame>
      <Text style={styles.title}>Link players</Text>
      <Text style={styles.hint}>Mark the same kid on different teams as one player. Names alone can collide — only link kids you know are the same person.</Text>
      {loading ? <ActivityIndicator color={C.brand} style={{ marginTop: 30 }} /> : (
        <ScrollView contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
          {identities.map(id => (
            <IdentityCard key={id.lineageId} identity={id} busy={busy}
              onLink={() => setLinkFrom(id.rows[0])} onUnlink={doUnlink} label={label} />
          ))}
          {identities.length === 0 ? <Text style={styles.empty}>No players on your teams yet.</Text> : null}
        </ScrollView>
      )}
    </Frame>
  );
}

function IdentityCard({ identity, busy, onLink, onUnlink, label }: {
  identity: Identity; busy: boolean;
  onLink: () => void; onUnlink: (p: LinkablePlayer) => void; label: (p: LinkablePlayer) => string;
}) {
  const linked = identity.rows.length > 1;
  return (
    <View style={styles.card}>
      <Text style={styles.cardName}>{identity.name}</Text>
      {linked ? (
        <>
          <Text style={styles.linkedTag}>🔗 Linked across {identity.rows.length} teams</Text>
          {identity.rows.map(r => (
            <View key={r.id} style={styles.linkedRow}>
              <Text style={styles.linkedRowTxt}>{label(r)}</Text>
              <TouchableOpacity onPress={() => onUnlink(r)} disabled={busy} hitSlop={8}>
                <Text style={styles.unlink}>unlink</Text>
              </TouchableOpacity>
            </View>
          ))}
        </>
      ) : (
        <View style={styles.singleRow}>
          <Text style={styles.rowSub}>{label(identity.rows[0])}</Text>
          <TouchableOpacity style={styles.linkBtn} onPress={onLink} disabled={busy}>
            <Text style={styles.linkBtnTxt}>Link</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 20 },
  wrap: { flex: 1, width: '100%', maxWidth: 640, alignSelf: 'center' },
  back: { paddingVertical: 8 }, backTxt: { color: C.brand, fontSize: 16, fontWeight: '600' },
  title: { color: C.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.4, marginTop: 4, marginBottom: 6 },
  hint: { color: C.dim, fontSize: 13.5, lineHeight: 20, marginBottom: 16 },
  empty: { color: C.dim, fontSize: 15, textAlign: 'center', marginTop: 40 },

  card: { backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 10 },
  cardName: { color: C.text, fontSize: 17, fontWeight: '700' },
  singleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  rowSub: { color: C.dim, fontSize: 13.5 },
  linkBtn: { backgroundColor: C.brand, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  linkBtnTxt: { color: '#08101c', fontSize: 14, fontWeight: '800' },
  linkedTag: { color: C.good, fontSize: 13, fontWeight: '700', marginTop: 6, marginBottom: 4 },
  linkedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  linkedRowTxt: { color: '#c7d2dc', fontSize: 14 },
  unlink: { color: C.danger, fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' },

  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 10, padding: 13, marginBottom: 8 },
  rowName: { color: C.text, fontSize: 15.5, fontWeight: '600' },
  match: { color: C.warn, fontSize: 12, fontWeight: '700' },
  rowArrow: { color: '#3a4b5a', fontSize: 20 },

  confirmCard: { backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 14, padding: 20, alignItems: 'center', marginBottom: 18 },
  confirmName: { color: C.text, fontSize: 18, fontWeight: '800' },
  confirmSub: { color: C.dim, fontSize: 13.5, marginTop: 2 },
  confirmPlus: { color: C.brand, fontSize: 22, fontWeight: '800', marginVertical: 10 },
  primary: { backgroundColor: C.good, borderRadius: 10, padding: 15, alignItems: 'center' },
  primaryTxt: { color: '#08130b', fontSize: 16, fontWeight: '800' },
  secondary: { padding: 12, alignItems: 'center' },
  secondaryTxt: { color: C.dim, fontSize: 14, fontWeight: '600' },
});
