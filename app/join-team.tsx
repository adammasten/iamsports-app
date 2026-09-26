import { useTeamContext } from '@/context';
import { newRequestId } from '@/lib/core/requestId';
import { goBackOrHome } from '@/lib/nav';
import { alertThenGo, webAlert } from '@/lib/webAlert';
import { supabase } from '@/supabase';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Parent join flow (reworked in Slice D3 — EXISTING CHILD FIRST).
//
// THE INVERSION THIS FIXES: tapping a roster spot used to claim it immediately, which made the
// first adult to type a team code that child's permanent owner AND pushed a parent whose child
// is already in IamSports toward creating a SECOND record for the same human. So now:
//
//   1. "Your players" is shown FIRST, above the roster, unconditionally — never gated on name
//      similarity, because a parent recognises their own child and names are never identity.
//   2. Tapping an open roster spot asks "is this one of your players?" BEFORE linking. Picking
//      an existing child routes through claim_existing_child_for_roster_spot, which reconciles
//      the coach's record into the family's child (repoint + tombstone) instead of leaving two.
//   3. "Add a new player" is last, and goes through ONE transactional RPC with an idempotency
//      key, so a double-tap or a retry cannot create two children.
type PreviewPlayer = { player_id: string; first_name: string; jersey: string | null; claimed: boolean };
type Preview = { team_id: string; team_name: string; players: PreviewPlayer[] };
type MyChild = { player_id: string; name: string; teams: { team_id: string; team_name: string }[] };

export default function JoinTeamScreen() {
  const insets = useSafeAreaInsets();
  const { refreshKids, refreshTeams } = useTeamContext();

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [myChildren, setMyChildren] = useState<MyChild[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  // The roster spot the parent tapped, awaiting "is this one of your players?"
  const [pending, setPending] = useState<PreviewPlayer | null>(null);

  // ONE id per form open (plan v2 §3.1). Reset after a success so the next child gets a fresh
  // key; reused across retries so a retry cannot create a second child.
  const requestId = useRef(newRequestId());

  const cleanCode = () => code.trim().toUpperCase();

  const params = useLocalSearchParams();
  useEffect(() => {
    const c = (Array.isArray(params.code) ? params.code[0] : params.code) as string | undefined;
    if (c && !preview) { setCode(c.toUpperCase()); lookup(c); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function lookup(override?: string) {
    const cc = (override ?? code).trim().toUpperCase();
    if (!cc) return;
    setLoading(true);
    const [{ data, error }, { data: mine, error: mineErr }] = await Promise.all([
      supabase.rpc('preview_roster_by_code', { p_code: cc }),
      supabase.rpc('my_claimable_children'),
    ]);
    setLoading(false);
    if (error || !data) {
      webAlert('Team code not found', 'That didn’t match a team join code.\n\nIf it’s a PLAYER’S invite code (to be added as a guardian of one kid), go back and use “Have a code?” instead.');
      return;
    }
    // Surfacing the failure rather than defaulting to an empty list: an empty "Your players"
    // section would quietly push the parent toward creating a duplicate, which is the exact
    // bug this screen exists to prevent.
    if (mineErr) webAlert('Your players', `Could not load your existing players, so this screen can only offer to add a new one.\n\n${mineErr.message}`);
    setMyChildren(((mine ?? []) as any[]).map(r => ({
      player_id: r.player_id, name: r.name, teams: (r.teams ?? []) as MyChild['teams'],
    })));
    setPreview(data as Preview);
  }

  async function finish(msg: string) {
    requestId.current = newRequestId();
    await Promise.all([refreshKids(), refreshTeams()]);
    alertThenGo('Joined', msg, goBackOrHome);
  }

  // The parent said the tapped roster spot IS a child they already have: consolidate rather
  // than create a second identity. The RPC re-checks authority server-side and refuses if the
  // spot turns out to belong to another family.
  async function claimAsExisting(spot: PreviewPlayer, child: MyChild) {
    if (!preview) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('claim_existing_child_for_roster_spot', {
      p_code: cleanCode(),
      p_roster_player_id: spot.player_id,
      p_existing_player_id: child.player_id,
      p_request_id: requestId.current,
    });
    setBusy(false);
    setPending(null);
    if (error) { webAlert('Claim', error.message); return; }
    const reconciled = (data as any)?.status === 'reconciled';
    finish(reconciled
      ? `${child.name} is on ${preview.team_name}. Their coach's roster entry has been combined into ${child.name}, so their film, tags and stats all live on one player now.`
      : `${child.name} is on ${preview.team_name}.`);
  }

  // A genuinely new child for this family: the old direct-claim path.
  async function claimAsNew(spot: PreviewPlayer) {
    if (!preview) return;
    setBusy(true);
    const { error } = await supabase.rpc('claim_roster_spot', { p_code: cleanCode(), p_player_id: spot.player_id });
    setBusy(false);
    setPending(null);
    if (error) { webAlert('Claim', error.message); return; }
    finish(`${spot.first_name} is on ${preview.team_name}. Their coach will confirm you as ${spot.first_name}'s guardian.`);
  }

  // One of the parent's children who is not on this roster at all.
  async function attachMyKid(child: MyChild) {
    if (!preview) return;
    setBusy(true);
    const { error } = await supabase.rpc('join_team_with_code', { p_code: cleanCode(), p_player_id: child.player_id });
    setBusy(false);
    if (error) { webAlert('Join', error.message); return; }
    finish(`${child.name} is on ${preview.team_name}.`);
  }

  async function addNewAndJoin() {
    const name = newName.trim();
    if (!name || !preview) { webAlert('Add player', 'Enter your player’s name.'); return; }
    setBusy(true);
    // ONE transaction (was two sequential RPCs, which could leave a child attached to nothing
    // if the second failed), and idempotent on the request id.
    const { error } = await supabase.rpc('create_kid_and_join_team', {
      p_name: name, p_code: cleanCode(), p_request_id: requestId.current,
    });
    setBusy(false);
    if (error) { webAlert('Add player', error.message); return; }
    finish(`${name} is on ${preview.team_name}.`);
  }

  const rosterIds = new Set((preview?.players ?? []).map(p => p.player_id));
  const myKidsNotHere = myChildren.filter(k => !rosterIds.has(k.player_id));

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <TouchableOpacity onPress={goBackOrHome} style={styles.back} hitSlop={8}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      {!preview ? (
        <View style={styles.pad}>
          <Text style={styles.title}>Join a team</Text>
          <Text style={styles.sub}>Enter the code your coach gave you.</Text>
          <TextInput
            style={styles.codeInput}
            placeholder="TEAM CODE"
            placeholderTextColor="#666"
            value={code}
            onChangeText={t => setCode(t.toUpperCase())}
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            maxLength={8}
          />
          <TouchableOpacity style={styles.primaryBtn} onPress={() => lookup()} disabled={loading || !code.trim()}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Continue</Text>}
          </TouchableOpacity>
        </View>
      ) : pending ? (
        // STEP 2 — existing child first, for the spot they tapped.
        <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Is this one of your players?</Text>
          <Text style={styles.sub}>
            Your coach added <Text style={styles.bold}>{pending.first_name}</Text> to {preview.team_name}. If this is
            a player you already have in IamSports, pick them — we’ll combine the two into one player so their film,
            tags and stats stay together.
          </Text>

          {myChildren.length > 0 ? (
            <>
              <Text style={styles.mineLabel}>Your players</Text>
              {myChildren.map(k => (
                <TouchableOpacity key={k.player_id} style={styles.mineRow} disabled={busy} onPress={() => claimAsExisting(pending, k)}>
                  <View style={styles.grow}>
                    <Text style={styles.mineName} numberOfLines={1}>{k.name}</Text>
                    {k.teams.length > 0 && (
                      <Text style={styles.mineTeams} numberOfLines={1}>{k.teams.map(t => t.team_name).join(' · ')}</Text>
                    )}
                  </View>
                  <Text style={styles.claim}>This is them →</Text>
                </TouchableOpacity>
              ))}
            </>
          ) : (
            <Text style={styles.sub}>You don’t have any players in IamSports yet.</Text>
          )}

          <TouchableOpacity style={styles.secondaryBtn} disabled={busy} onPress={() => claimAsNew(pending)}>
            <Text style={styles.secondaryBtnText}>
              {busy ? 'Working…' : `No — ${pending.first_name} is new to me`}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.linkRow} onPress={() => setPending(null)} disabled={busy}>
            <Text style={styles.link}>Cancel</Text>
          </TouchableOpacity>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>{preview.team_name}</Text>

          {/* EXISTING CHILDREN FIRST — before the roster, always. */}
          {myKidsNotHere.length > 0 && (
            <View style={styles.mineBox}>
              <Text style={styles.mineLabel}>Your players</Text>
              {myKidsNotHere.map(k => (
                <TouchableOpacity key={k.player_id} style={styles.mineRow} disabled={busy} onPress={() => attachMyKid(k)}>
                  <View style={styles.grow}>
                    <Text style={styles.mineName} numberOfLines={1}>{k.name}</Text>
                    {k.teams.length > 0 && (
                      <Text style={styles.mineTeams} numberOfLines={1}>{k.teams.map(t => t.team_name).join(' · ')}</Text>
                    )}
                  </View>
                  <Text style={styles.claim}>Add to this team →</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <Text style={styles.sub}>Or tap the player your coach already added. A player that already has a family is locked — ask them for that player’s code to be added as a co-guardian.</Text>

          {preview.players.map(p => (
            <TouchableOpacity
              key={p.player_id}
              style={[styles.playerRow, p.claimed && styles.playerRowLocked]}
              disabled={p.claimed || busy}
              onPress={() => setPending(p)}
            >
              <View style={styles.jersey}><Text style={styles.jerseyText}>{p.jersey || '—'}</Text></View>
              <Text style={styles.playerName} numberOfLines={1}>{p.first_name}</Text>
              {p.claimed
                ? <Text style={styles.locked}>Taken</Text>
                : <Text style={styles.claim}>This is my player →</Text>}
            </TouchableOpacity>
          ))}

          {preview.players.length === 0 && (
            <Text style={styles.sub}>No players on this roster yet — add yours below.</Text>
          )}

          {!showNew ? (
            <TouchableOpacity style={styles.linkRow} onPress={() => setShowNew(true)}>
              <Text style={styles.link}>My player isn’t listed</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.mineBox}>
              <Text style={styles.mineLabel}>Add a new player</Text>
              <TextInput style={styles.input} placeholder="Player’s name" placeholderTextColor="#666" value={newName} onChangeText={setNewName} />
              <TouchableOpacity style={styles.primaryBtn} onPress={addNewAndJoin} disabled={busy}>
                <Text style={styles.primaryBtnText}>{busy ? 'Adding…' : 'Add & join'}</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  back: { paddingHorizontal: 16, paddingVertical: 8 },
  backText: { color: '#888', fontSize: 16 },
  pad: { padding: 20, gap: 14 },
  title: { color: '#fff', fontSize: 26, fontWeight: '800' },
  sub: { color: '#999', fontSize: 14, lineHeight: 20 },
  bold: { color: '#fff', fontWeight: '800' },
  codeInput: { backgroundColor: '#17171d', color: '#fff', fontSize: 24, fontWeight: '800', letterSpacing: 6, textAlign: 'center', borderRadius: 12, paddingVertical: 16, marginTop: 8 },
  input: { backgroundColor: '#17171d', color: '#fff', fontSize: 16, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
  primaryBtn: { backgroundColor: '#534AB7', borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 4 },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  secondaryBtn: { backgroundColor: '#17171d', borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 4 },
  secondaryBtnText: { color: '#ccc', fontWeight: '700', fontSize: 15 },

  playerRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#17171d', borderRadius: 12, padding: 14, gap: 12 },
  playerRowLocked: { opacity: 0.45 },
  jersey: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#2a2a33', alignItems: 'center', justifyContent: 'center' },
  jerseyText: { color: '#ccc', fontWeight: '800' },
  playerName: { color: '#fff', fontSize: 17, fontWeight: '700', flex: 1 },
  claim: { color: '#8b83e6', fontWeight: '700', fontSize: 13 },
  locked: { color: '#777', fontWeight: '700', fontSize: 13 },

  linkRow: { paddingVertical: 12, alignItems: 'center' },
  link: { color: '#8b83e6', fontWeight: '700', fontSize: 15 },
  mineBox: { backgroundColor: '#0f0f14', borderRadius: 12, padding: 14, gap: 10 },
  mineLabel: { color: '#888', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 },
  mineRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#17171d', borderRadius: 10, padding: 12, gap: 10 },
  mineName: { color: '#fff', fontSize: 16, fontWeight: '600' },
  mineTeams: { color: '#777', fontSize: 12, marginTop: 2 },
  grow: { flex: 1 },
});
