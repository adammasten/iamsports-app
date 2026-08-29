import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  durationSeconds?: number | null;
  // Optional extra single-select dimensions (event type, season, tournament, …)
  // keyed by the same key used in the extraFilters prop. An item missing a key
  // never matches a specific selection, so it drops out when that dim is filtered.
  extra?: Record<string, string | null | undefined>;
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
  // Optional extra single-select dimensions, rendered after Sort. Each renders a
  // dropdown when its options list has more than one entry (an 'all' entry + at
  // least one value); filtering matches item.extra[key] === selected value.
  extraFilters?: { key: string; label: string; options: DropdownOption[] }[];
  // Optional caller-owned dropdown rendered right after the Team dropdown (e.g.
  // Home's "Players" lens, whose membership filtering lives on the caller).
  playerSlot?: ReactNode;
  searchPlaceholder?: string;
  onVisibleChange: (visible: FilterableItem[]) => void;
};

// Stable empty default. Without this, callers that don't pass `extraFilters`
// would get a FRESH `[]` every render — and since `extraFilters` is in the
// `visible` memo's deps, that churns the memo, refires the onVisibleChange
// effect every render, and infinite-loops ("Maximum update depth exceeded").
// One shared identity fixes it for all no-prop callers (team wall, Coaches').
const NO_EXTRA_FILTERS: NonNullable<Props['extraFilters']> = [];

// Reusable filter bar: a search field + a horizontal row of single-select
// dropdowns (Team / Type / Sort + per-category tag filters). Presentational +
// in-memory filtering only — it never loads data. The parent passes items + tag
// data in and receives the filtered+sorted list out via onVisibleChange.
// Extracted from coaches-corner.tsx; behavior identical.
export default function FilterBar({
  items, tagsById, tagMeta, teamOptions, typeOptions, sortOptions,
  extraFilters = NO_EXTRA_FILTERS,
  playerSlot,
  searchPlaceholder = 'Search', onVisibleChange,
}: Props) {
  const [search, setSearch] = useState('');
  const [teamFilter, setTeamFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  // Extra-dimension selections, keyed by filter key ('all'/absent = no constraint).
  const [extraValues, setExtraValues] = useState<Record<string, string>>({});

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
      // Extra single-select dimensions (event type, season, tournament, …). AND.
      for (const f of extraFilters) {
        const v = extraValues[f.key] ?? 'all';
        if (v !== 'all' && it.extra?.[f.key] !== v) return false;
      }
      return true;
    });
    const sorted = [...filtered];
    if (sortBy === 'az') {
      sorted.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortBy === 'oldest') {
      sorted.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    } else if (sortBy === 'longest') {
      sorted.sort((a, b) => (b.durationSeconds ?? 0) - (a.durationSeconds ?? 0));
    } else {
      sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // newest
    }
    return sorted;
  }, [items, search, teamFilter, typeFilter, sortBy, playerFilter, offenseFilter, defenseFilter, playsFilter, tagsById, extraFilters, extraValues]);

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
        {teamOptions.length > 1 && (
          <Dropdown compact value={teamFilter} options={teamOptions} onSelect={setTeamFilter} placeholder="Team" />
        )}
        {playerSlot}
        {typeOptions.length > 1 && (
          <Dropdown compact value={typeFilter} options={typeOptions} onSelect={setTypeFilter} placeholder="Type" />
        )}
        <Dropdown compact value={sortBy} options={sortOptions} onSelect={setSortBy} placeholder="Sort" />
        {extraFilters.map(f => (
          f.options.length > 1 ? (
            <Dropdown
              key={f.key}
              compact
              value={extraValues[f.key] ?? 'all'}
              options={f.options}
              onSelect={v => setExtraValues(prev => ({ ...prev, [f.key]: v }))}
              placeholder={f.label}
            />
          ) : null
        ))}
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
