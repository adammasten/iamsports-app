// Per-player stat editor. Opens as a pageSheet modal from Box Score's edit
// mode. Coach edits one player's line, saves (upserts into game_stat_lines),
// cancels, or reverts (deletes the manual row → player falls back to tagged
// derivation, or disappears if no tagged data). PTS is derived-live from
// FGM/FG3M/FTM — not editable — so a saved line can never be internally
// inconsistent ("10 pts on 2-of-5" is impossible to save).
//
// The initial row can be either an existing resolved_game_stats row (tagged
// or manual) or a zero-row for a roster player who has no stats yet.
// isManual tells the sheet whether to show the Revert button.
import { supabase } from '@/supabase';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

export type StatValues = {
  fgm: number; fga: number;
  fg3m: number; fg3a: number;
  ftm: number; fta: number;
  oreb: number; dreb: number;
  ast: number; tov: number; stl: number; blk: number;
  pf: number; tf: number;
};

export type EditorTarget = {
  gameId: string;
  playerId: string | null;              // NULL = TEAM row
  playerName: string;                   // display label; "TEAM" for team row
  jersey?: string | null;
  statSide: 'own' | 'opponent';
  initial: StatValues;
  isManual: boolean;                    // true = a game_stat_lines row exists; enables Revert
};

type Props = {
  target: EditorTarget | null;
  userId: string | null;
  onClose: () => void;
  onSaved: () => void;                  // fires after save/revert so parent can refetch
};

const ZERO: StatValues = {
  fgm: 0, fga: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0,
  oreb: 0, dreb: 0, ast: 0, tov: 0, stl: 0, blk: 0, pf: 0, tf: 0,
};

function toStr(n: number): string { return n === 0 ? '' : String(n); }
function toNum(s: string): number { const n = parseInt(s, 10); return Number.isFinite(n) && n >= 0 ? n : 0; }

export function StatEditorSheet({ target, userId, onClose, onSaved }: Props) {
  const visible = target != null;

  // Field strings (not numbers) so empty input works cleanly. Coerced on save.
  const [f, setF] = useState<Record<keyof StatValues, string>>({
    fgm: '', fga: '', fg3m: '', fg3a: '', ftm: '', fta: '',
    oreb: '', dreb: '', ast: '', tov: '', stl: '', blk: '', pf: '', tf: '',
  });
  const [busy, setBusy] = useState(false);

  // Prefill whenever a new player opens the sheet.
  useEffect(() => {
    if (!target) return;
    const v = target.initial;
    setF({
      fgm: toStr(v.fgm), fga: toStr(v.fga),
      fg3m: toStr(v.fg3m), fg3a: toStr(v.fg3a),
      ftm: toStr(v.ftm), fta: toStr(v.fta),
      oreb: toStr(v.oreb), dreb: toStr(v.dreb),
      ast: toStr(v.ast), tov: toStr(v.tov),
      stl: toStr(v.stl), blk: toStr(v.blk),
      pf: toStr(v.pf), tf: toStr(v.tf),
    });
  }, [target]);

  const nums: StatValues = {
    fgm: toNum(f.fgm), fga: toNum(f.fga),
    fg3m: toNum(f.fg3m), fg3a: toNum(f.fg3a),
    ftm: toNum(f.ftm), fta: toNum(f.fta),
    oreb: toNum(f.oreb), dreb: toNum(f.dreb),
    ast: toNum(f.ast), tov: toNum(f.tov),
    stl: toNum(f.stl), blk: toNum(f.blk),
    pf: toNum(f.pf), tf: toNum(f.tf),
  };
  // PTS derived live: 2·(FGM − FG3M) + 3·FG3M + FTM
  const pts = 2 * (nums.fgm - nums.fg3m) + 3 * nums.fg3m + nums.ftm;

  // Client-side validation mirrors the CHECK constraints on game_stat_lines.
  // If any fires we don't send to the DB (would just get an ugly Postgres err).
  function validationError(): string | null {
    if (nums.fgm > nums.fga) return 'Field goals made can’t exceed attempted.';
    if (nums.fg3m > nums.fg3a) return '3-pointers made can’t exceed attempted.';
    if (nums.fg3m > nums.fgm) return '3-pointers made can’t exceed total field goals made.';
    if (nums.fg3a > nums.fga) return '3-pointers attempted can’t exceed total field goals attempted.';
    if (nums.ftm > nums.fta) return 'Free throws made can’t exceed attempted.';
    return null;
  }

  async function save() {
    if (!target) return;
    const err = validationError();
    if (err) { Alert.alert('Check the numbers', err); return; }
    setBusy(true);
    // Try UPDATE first (matches on game/player/stat_side). If no row matched,
    // INSERT. Simpler than working around partial-index limitations in
    // PostgREST's upsert.
    const patch = {
      fgm: nums.fgm, fga: nums.fga, fg3m: nums.fg3m, fg3a: nums.fg3a,
      ftm: nums.ftm, fta: nums.fta, oreb: nums.oreb, dreb: nums.dreb,
      ast: nums.ast, tov: nums.tov, stl: nums.stl, blk: nums.blk,
      pf: nums.pf, tf: nums.tf,
    };
    let updateQ = supabase
      .from('game_stat_lines')
      .update(patch)
      .eq('game_id', target.gameId)
      .eq('stat_side', target.statSide);
    updateQ = target.playerId ? updateQ.eq('player_id', target.playerId) : updateQ.is('player_id', null);
    const { data: updated, error: uerr } = await updateQ.select('id');
    if (uerr) { setBusy(false); Alert.alert('Save failed', uerr.message); return; }
    if (!updated || updated.length === 0) {
      const { error: ierr } = await supabase.from('game_stat_lines').insert({
        game_id: target.gameId,
        player_id: target.playerId,
        stat_side: target.statSide,
        created_by_user_id: userId,
        ...patch,
      });
      if (ierr) { setBusy(false); Alert.alert('Save failed', ierr.message); return; }
    }
    setBusy(false);
    onSaved();
  }

  function revert() {
    if (!target) return;
    Alert.alert(
      'Revert this line?',
      `Remove your manual entry for ${target.playerName}. If the game was tagged, the tagged stats will show again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Revert', style: 'destructive', onPress: async () => {
          setBusy(true);
          let q = supabase.from('game_stat_lines').delete()
            .eq('game_id', target.gameId)
            .eq('stat_side', target.statSide);
          q = target.playerId ? q.eq('player_id', target.playerId) : q.is('player_id', null);
          const { error } = await q;
          setBusy(false);
          if (error) { Alert.alert('Revert failed', error.message); return; }
          onSaved();
        }},
      ]
    );
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {target && (
          <>
            <View style={styles.headerRow}>
              <TouchableOpacity onPress={onClose} disabled={busy}>
                <Text style={styles.headerBtn}>Cancel</Text>
              </TouchableOpacity>
              <View style={styles.headerCenter}>
                <Text style={styles.headerName} numberOfLines={1}>
                  {target.playerName}{target.jersey ? ` #${target.jersey}` : ''}
                </Text>
                <Text style={styles.headerSide}>{target.statSide === 'own' ? 'Team' : 'Opponent'}</Text>
              </View>
              <TouchableOpacity onPress={save} disabled={busy}>
                <Text style={[styles.headerBtn, styles.headerBtnPrimary]}>{busy ? '…' : 'Save'}</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
              <View style={styles.ptsBox}>
                <Text style={styles.ptsLabel}>PTS (derived)</Text>
                <Text style={styles.ptsValue}>{pts}</Text>
              </View>

              <Text style={styles.sectionLabel}>Shooting</Text>
              <PairRow label="FG"  m={f.fgm}  a={f.fga}  onM={v => setF({...f, fgm:v})}  onA={v => setF({...f, fga:v})}  disabled={busy} />
              <PairRow label="3FG" m={f.fg3m} a={f.fg3a} onM={v => setF({...f, fg3m:v})} onA={v => setF({...f, fg3a:v})} disabled={busy} />
              <PairRow label="FT"  m={f.ftm}  a={f.fta}  onM={v => setF({...f, ftm:v})}  onA={v => setF({...f, fta:v})}  disabled={busy} />

              <Text style={styles.sectionLabel}>Rebounds</Text>
              <View style={styles.grid2}>
                <NumField label="OREB" value={f.oreb} onChange={v => setF({...f, oreb:v})} disabled={busy} />
                <NumField label="DREB" value={f.dreb} onChange={v => setF({...f, dreb:v})} disabled={busy} />
              </View>

              <Text style={styles.sectionLabel}>Other</Text>
              <View style={styles.grid2}>
                <NumField label="AST" value={f.ast} onChange={v => setF({...f, ast:v})} disabled={busy} />
                <NumField label="TO"  value={f.tov} onChange={v => setF({...f, tov:v})} disabled={busy} />
                <NumField label="STL" value={f.stl} onChange={v => setF({...f, stl:v})} disabled={busy} />
                <NumField label="BLK" value={f.blk} onChange={v => setF({...f, blk:v})} disabled={busy} />
                <NumField label="PF"  value={f.pf}  onChange={v => setF({...f, pf:v})}  disabled={busy} />
                <NumField label="TF"  value={f.tf}  onChange={v => setF({...f, tf:v})}  disabled={busy} />
              </View>

              {target.isManual && (
                <TouchableOpacity style={styles.revertBtn} onPress={revert} disabled={busy}>
                  <Text style={styles.revertText}>Revert to tagged</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

function PairRow({ label, m, a, onM, onA, disabled }: { label: string; m: string; a: string; onM: (v: string) => void; onA: (v: string) => void; disabled: boolean }) {
  return (
    <View style={styles.pairRow}>
      <Text style={styles.pairLabel}>{label}</Text>
      <TextInput style={styles.pairInput} value={m} onChangeText={onM} keyboardType="number-pad" placeholder="0" placeholderTextColor="#bbb" editable={!disabled} />
      <Text style={styles.pairSlash}>/</Text>
      <TextInput style={styles.pairInput} value={a} onChangeText={onA} keyboardType="number-pad" placeholder="0" placeholderTextColor="#bbb" editable={!disabled} />
    </View>
  );
}

function NumField({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled: boolean }) {
  return (
    <View style={styles.numFieldWrap}>
      <Text style={styles.numLabel}>{label}</Text>
      <TextInput style={styles.numInput} value={value} onChangeText={onChange} keyboardType="number-pad" placeholder="0" placeholderTextColor="#bbb" editable={!disabled} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e5e5e5' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerName: { fontSize: 16, fontWeight: '800', color: '#1a1a1a' },
  headerSide: { fontSize: 11, color: '#888', marginTop: 2, textTransform: 'uppercase', fontWeight: '700', letterSpacing: 0.5 },
  headerBtn: { fontSize: 15, color: '#888', fontWeight: '600', minWidth: 60 },
  headerBtnPrimary: { color: '#534AB7', fontWeight: '800', textAlign: 'right' },

  body: { padding: 16, paddingBottom: 40 },

  ptsBox: { backgroundColor: '#f5f4fb', borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 18 },
  ptsLabel: { fontSize: 11, color: '#534AB7', fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' },
  ptsValue: { fontSize: 44, fontWeight: '800', color: '#1a1a1a', marginTop: 2 },

  sectionLabel: { fontSize: 11, fontWeight: '800', color: '#888', letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 14, marginBottom: 8 },

  pairRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 8 },
  pairLabel: { width: 44, fontSize: 15, fontWeight: '700', color: '#333' },
  pairInput: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, textAlign: 'center', color: '#1a1a1a', backgroundColor: '#fff' },
  pairSlash: { fontSize: 18, fontWeight: '700', color: '#888' },

  grid2: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  numFieldWrap: { flexBasis: '48%', flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  numLabel: { width: 44, fontSize: 14, fontWeight: '700', color: '#333' },
  numInput: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, textAlign: 'center', color: '#1a1a1a', backgroundColor: '#fff' },

  revertBtn: { marginTop: 24, paddingVertical: 14, borderRadius: 10, borderWidth: 1, borderColor: '#c0392b', alignItems: 'center' },
  revertText: { color: '#c0392b', fontWeight: '700', fontSize: 15 },
});
