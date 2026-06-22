import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type Team = { id: string; name: string };

export type VisibilitySelection = {
  onlyMe: boolean;
  friendsFamily: boolean;
  public: boolean;
  teamWall: boolean;
  teamId?: string;
  teamName?: string;
};

type Props = {
  teams: Team[];
  onSelect: (selection: VisibilitySelection) => void;
  onCancel: () => void;
};

// Presentational multi-select picker only — it never calls post_to_wall or any
// RPC. It collects a SET of visibility choices (checkboxes) and hands them back
// via onSelect; the caller fans them out into one share row per selection.
// Bottom-sheet styling mirrors kid.tsx's picker so the two stay consistent.
export default function VisibilityPicker({ teams, onSelect, onCancel }: Props) {
  const [onlyMe, setOnlyMe] = useState(false);
  const [friendsFamily, setFriendsFamily] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const [teamWall, setTeamWall] = useState(false);
  // Exactly one team → auto-select it; >1 → user picks once "Team wall" is on.
  const [team, setTeam] = useState<Team | null>(teams.length === 1 ? teams[0] : null);

  const hasTeams = teams.length > 0;

  // "Only me" is exclusive: turning it on clears the other three, and turning
  // any of the other three on clears "Only me".
  function toggleOnlyMe() {
    if (onlyMe) { setOnlyMe(false); return; }
    setOnlyMe(true);
    setFriendsFamily(false);
    setIsPublic(false);
    setTeamWall(false);
  }
  function toggleShared(current: boolean, set: (b: boolean) => void) {
    if (current) { set(false); return; }
    set(true);
    setOnlyMe(false);
  }

  const anySelected = onlyMe || friendsFamily || isPublic || teamWall;
  // A team-wall post needs a chosen team; with one team that's automatic.
  const teamReady = !teamWall || !!team;
  const canPost = anySelected && teamReady;

  function submit() {
    if (!canPost) return;
    onSelect({
      onlyMe,
      friendsFamily,
      public: isPublic,
      teamWall,
      teamId: team?.id,
      teamName: team?.name,
    });
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.modalBackdrop} onPress={onCancel}>
        <Pressable style={styles.modalSheet} onPress={() => {}}>
          <Text style={styles.modalTitle}>Who can see this?</Text>

          <ScrollView style={styles.optionScroll}>
            <CheckRow
              label="Only me"
              helper="Private. No one else can see it."
              selected={onlyMe}
              onPress={toggleOnlyMe}
            />
            <CheckRow
              label="Friends & Family"
              helper="Your circle can see it."
              selected={friendsFamily}
              onPress={() => toggleShared(friendsFamily, setFriendsFamily)}
            />
            <CheckRow
              label="Public"
              helper="Anyone can see it."
              selected={isPublic}
              onPress={() => toggleShared(isPublic, setIsPublic)}
            />
            {hasTeams && (
              <CheckRow
                label="Team wall"
                helper="Your team can see it."
                selected={teamWall}
                onPress={() => toggleShared(teamWall, setTeamWall)}
              />
            )}

            {/* Reveal a team chooser only when it's ambiguous (>1 team). */}
            {teamWall && teams.length > 1 && (
              <View style={styles.teamSelectWrap}>
                <Text style={styles.teamSelectLabel}>Which team?</Text>
                {teams.map(t => {
                  const sel = team?.id === t.id;
                  return (
                    <TouchableOpacity
                      key={t.id}
                      style={[styles.teamRow, sel && styles.modalOptionSelected]}
                      onPress={() => setTeam(t)}
                    >
                      <Ionicons
                        name={sel ? 'checkmark-circle' : 'ellipse-outline'}
                        size={18}
                        color={sel ? '#8B82E8' : '#666'}
                      />
                      <Text style={styles.modalOptionText}>{t.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </ScrollView>

          <TouchableOpacity
            style={[styles.postButton, !canPost && styles.postButtonDisabled]}
            onPress={submit}
            disabled={!canPost}
          >
            <Text style={[styles.postButtonText, !canPost && styles.postButtonTextDisabled]}>Post</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.modalCancel} onPress={onCancel}>
            <Text style={styles.modalCancelText}>Cancel</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function CheckRow({
  label,
  helper,
  selected,
  onPress,
}: {
  label: string;
  helper: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={[styles.modalOption, selected && styles.modalOptionSelected]} onPress={onPress}>
      <Ionicons
        name={selected ? 'checkmark-circle' : 'ellipse-outline'}
        size={20}
        color={selected ? '#8B82E8' : '#666'}
      />
      <Text style={styles.modalOptionText}>{label}</Text>
      <Text style={styles.modalOptionHelper}>{helper}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#1a1a1a', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, paddingBottom: 32 },
  modalTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 14, textAlign: 'center' },
  optionScroll: { maxHeight: 380 },
  modalOption: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, backgroundColor: '#222', borderRadius: 10, padding: 16, marginBottom: 8, borderWidth: 1, borderColor: 'transparent' },
  modalOptionSelected: { borderColor: '#534AB7', backgroundColor: '#2a2740' },
  modalOptionText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  modalOptionHelper: { color: '#bbb', fontSize: 13, width: '100%' },
  teamSelectWrap: { marginTop: 4, marginBottom: 8, paddingLeft: 8 },
  teamSelectLabel: { color: '#888', fontSize: 13, fontWeight: '600', marginBottom: 6 },
  teamRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#222', borderRadius: 10, padding: 14, marginBottom: 6, borderWidth: 1, borderColor: 'transparent' },
  postButton: { backgroundColor: '#534AB7', borderRadius: 10, padding: 16, alignItems: 'center', marginTop: 8 },
  postButtonDisabled: { backgroundColor: '#2a2a2a' },
  postButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  postButtonTextDisabled: { color: '#666' },
  modalCancel: { padding: 14, alignItems: 'center', marginTop: 4 },
  modalCancelText: { color: '#888', fontSize: 15 },
});
