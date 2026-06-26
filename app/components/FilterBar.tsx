import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import Dropdown, { type DropdownOption } from './Dropdown';

// Generic item the filter bar operates on. Screens map their own rows to this
// shape; `id` is whatever unique key the screen uses to look an item back up.
export type FilterableItem = {
  id: string;
  teamId: string;
  teamName: string;
  contentType: string;
  title: string;
  createdAt: string;
};

// Tag-filter categories — each renders as a dropdown ONLY when the current items
// have at least one tag of that category. Order matches the filter bar.
const TAG_CATEGORIES: { key: string; label: string; allLabel: string }[] = [
  { key: 'players', label: 'Player', allLabel: 'All players' },
  { key: 'offense', label: 'Offense', allLabel: 'All offense' },
  { key: 'defense', label: 'Defense', allLabel: 'All defense' },
  { key: 'plays', label: 'Plays', allLabel: 'All plays' },
];

type Props = {
  items: FilterableItem[];
  tagsById: Map<string, Set<string>>;
  tagMeta: Map<string, { name: string; category: string }>;
  teamOptions: DropdownOption[];
  typeOptions: DropdownOption[];
  sortOptions: DropdownOption[];
  searchPlaceholder?: string;
  onVisibleChange: (visible: FilterableItem[]) => void;
};

// Reusable filter bar: a search field + a horizontal row of single-select
// dropdowns (Team / Type / Sort + per-category tag filters). Presentational +
// in-memory filtering only — it never loads data. The parent passes items + tag
// data in and receives the filtered+sorted list out via onVisibleChange.
// Extracted from coaches-corner.tsx; behavior identical.
export default function FilterBar({
  items, tagsById, tagMeta, teamOptions, typeOptions, sortOptions,
  searchPlaceholder = 'Search', onVisibleChange,
}: Props) {
  const [search, setSearch] = useState('');
  const [teamFilter, setTeamFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sortBy, setSortBy] = useState('newest');

  // Per-category tag filters (single-select; 'all' = no constraint). Rendered
  // only when the items have tags of that category.
  const [playerFilter, setPlayerFilter] = useState('all');
  const [offenseFilter, setOffenseFilter] = useState('all');
  const [defenseFilter, setDefenseFilter] = useState('all');
  const [playsFilter, setPlaysFilter] = useState('all');

  // Per-category tag options derived from tags actually present on the items.
  // Categories with zero item tags yield an empty list → no dropdown rendered.
  const tagOptionsByCategory = useMemo<Record<string, DropdownOption[]>>(() => {
    const present = new Set<string>();
    items.forEach(it => tagsById.get(it.id)?.forEach(tid => present.add(tid)));
    const byCat: Record<string, DropdownOption[]> = {};
    for (const cat of TAG_CATEGORIES) {
      byCat[cat.key] = [...present]
        .filter(tid => tagMeta.get(tid)?.category === cat.key)
        .map(tid => ({ value: tid, label: tagMeta.get(tid)!.name }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }
    return byCat;
  }, [items, tagsById, tagMeta]);

  // Map each category to its filter value + setter so the dropdowns render in a loop.
  const tagFilterByCategory: Record<string, { value: string; set: (v: string) => void }> = {
    players: { value: playerFilter, set: setPlayerFilter },
    offense: { value: offenseFilter, set: setOffenseFilter },
    defense: { value: defenseFilter, set: setDefenseFilter },
    plays: { value: playsFilter, set: setPlaysFilter },
  };

  // Apply team / type / search + per-category tag filters (AND), then sort.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const activeTags = [playerFilter, offenseFilter, defenseFilter, playsFilter].filter(v => v !== 'all');
    const filtered = items.filter(it => {
      if (!(teamFilter === 'all' || it.teamId === teamFilter)) return false;
      if (!(typeFilter === 'all' || it.contentType === typeFilter)) return false;
      if (!(q === '' || it.title.toLowerCase().includes(q) || it.teamName.toLowerCase().includes(q))) return false;
      // AND across categories: the item must carry EVERY selected tag. An item with
      // no tags (e.g. a video/game, or untagged) fails any active tag filter.
      if (activeTags.length > 0) {
        const tagSet = tagsById.get(it.id);
        if (!activeTags.every(tid => tagSet?.has(tid))) return false;
      }
      return true;
    });
    const sorted = [...filtered];
    if (sortBy === 'az') {
      sorted.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortBy === 'oldest') {
      sorted.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    } else {
      sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // newest
    }
    return sorted;
  }, [items, search, teamFilter, typeFilter, sortBy, playerFilter, offenseFilter, defenseFilter, playsFilter, tagsById]);

  // Hand the recomputed list to the parent whenever it changes. The ref
  // indirection makes the effect immune to an unstable onVisibleChange prop
  // (e.g. an inline arrow) — only `visible` is in the dep array.
  const onVisibleChangeRef = useRef(onVisibleChange);
  onVisibleChangeRef.current = onVisibleChange;
  useEffect(() => { onVisibleChangeRef.current(visible); }, [visible]);

  return (
    <>
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color="#888" />
        <TextInput
          style={styles.searchInput}
          placeholder={searchPlaceholder}
          placeholderTextColor="#666"
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={16} color="#666" />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow} contentContainerStyle={styles.filterRowContent}>
        <Dropdown compact value={teamFilter} options={teamOptions} onSelect={setTeamFilter} placeholder="Team" />
        <Dropdown compact value={typeFilter} options={typeOptions} onSelect={setTypeFilter} placeholder="Type" />
        <Dropdown compact value={sortBy} options={sortOptions} onSelect={setSortBy} placeholder="Sort" />
        {TAG_CATEGORIES.map(cat => {
          const opts = tagOptionsByCategory[cat.key];
          if (!opts || opts.length === 0) return null;
          const f = tagFilterByCategory[cat.key];
          return (
            <Dropdown
              key={cat.key}
              compact
              value={f.value}
              options={[{ value: 'all', label: cat.allLabel }, ...opts]}
              onSelect={f.set}
              placeholder={cat.label}
            />
          );
        })}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#1a1a1a', borderRadius: 10, borderWidth: 1, borderColor: '#333',
    paddingHorizontal: 12, height: 42,
  },
  searchInput: { flex: 1, color: '#fff', fontSize: 15, padding: 0 },
  filterRow: { marginTop: 12, marginBottom: 8, flexGrow: 0 },
  filterRowContent: { flexDirection: 'row', gap: 8, paddingRight: 8 },
});
