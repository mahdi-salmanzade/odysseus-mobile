import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NavIcon } from '@/components/nav-icon';
import { ScreenHeader } from '@/components/screen-header';
import { SkeletonList } from '@/components/skeleton';
import { theme } from '@/constants/theme';
import {
  addMemory,
  deleteMemory,
  listMemories,
  MEMORY_CATEGORIES,
  type Memory,
  type MemoryCategory,
} from '@/lib/api';
import { usePairing } from '@/lib/pairing-context';
import { useSidebar } from '@/lib/sidebar-context';

export default function MemoryScreen() {
  const { pairing } = usePairing();
  const { openSidebar } = useSidebar();

  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  // Composer state.
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');
  const [category, setCategory] = useState<MemoryCategory>('fact');
  const [saving, setSaving] = useState(false);

  // True once we've successfully loaded at least once. Subsequent focuses
  // refresh silently in the background instead of blanking the list with a
  // full-screen spinner on every navigation back to this screen.
  const loadedOnce = useRef(false);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (!pairing) return;
      if (mode === 'refresh') setRefreshing(true);
      else if (!loadedOnce.current) setLoading(true);
      setError(null);
      try {
        const list = await listMemories(pairing);
        setMemories(list);
        loadedOnce.current = true;
      } catch (e) {
        // Don't replace an already-loaded list with an error screen when a
        // background refresh fails — keep the stale data visible.
        if (!loadedOnce.current) setError(e instanceof Error ? e.message : 'Failed to load memories.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [pairing],
  );

  useFocusEffect(
    useCallback(() => {
      load('initial');
    }, [load]),
  );

  const save = useCallback(async () => {
    if (!pairing) return;
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    try {
      const created = await addMemory(pairing, text, category);
      // Prepend — the list is newest-first server-side.
      setMemories((prev) => [created, ...prev]);
      setDraft('');
      setComposing(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Unknown error.');
    } finally {
      setSaving(false);
    }
  }, [pairing, draft, category, saving]);

  const remove = useCallback(
    (m: Memory) => {
      if (!pairing) return;
      Alert.alert('Delete memory', m.text, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            // Optimistic — drop it, and on failure re-insert it at its original
            // spot using LIVE state (not a stale closure snapshot that could
            // clobber edits made while the confirm dialog was open).
            let removed: Memory | undefined;
            let at = -1;
            setMemories((cur) => {
              at = cur.findIndex((x) => x.id === m.id);
              if (at === -1) return cur;
              removed = cur[at];
              return cur.filter((x) => x.id !== m.id);
            });
            try {
              await deleteMemory(pairing, m.id);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
            } catch (e) {
              if (removed) {
                setMemories((cur) => {
                  if (cur.some((x) => x.id === m.id)) return cur;
                  const copy = cur.slice();
                  copy.splice(Math.min(at, copy.length), 0, removed!);
                  return copy;
                });
              }
              Alert.alert('Could not delete', e instanceof Error ? e.message : 'Unknown error.');
            }
          },
        },
      ]);
    },
    [pairing],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return memories;
    return memories.filter(
      (m) =>
        m.text.toLowerCase().includes(q) ||
        (m.category ? m.category.toLowerCase().includes(q) : false),
    );
  }, [memories, query]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScreenHeader
        title="Memory"
        onMenu={openSidebar}
        right={
          <Pressable
            hitSlop={{ top: 13, bottom: 13, left: 13, right: 13 }}
            onPress={() => setComposing((v) => !v)}
            style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.6 }]}
            accessibilityRole="button"
            accessibilityLabel={composing ? 'Close composer' : 'New memory'}
          >
            <Text style={styles.addBtnText}>{composing ? '×' : '+'}</Text>
          </Pressable>
        }
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
        keyboardVerticalOffset={8}
      >
        {composing && (
          <View style={styles.composer}>
            <TextInput keyboardAppearance="dark"
              style={styles.composerInput}
              placeholder="Something to remember…"
              placeholderTextColor={theme.color.textFaint}
              value={draft}
              onChangeText={setDraft}
              multiline
              autoFocus
            />
            <View style={styles.catRow}>
              {MEMORY_CATEGORIES.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => setCategory(c)}
                  style={({ pressed }) => [
                    styles.catChip,
                    category === c && styles.catChipOn,
                    pressed && { opacity: 0.6 },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: category === c }}
                >
                  <Text style={[styles.catChipText, category === c && styles.catChipTextOn]}>
                    {c}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              onPress={save}
              disabled={!draft.trim() || saving}
              style={({ pressed }) => [
                styles.saveBtn,
                (!draft.trim() || saving) && styles.saveBtnOff,
                pressed && draft.trim() && !saving && { opacity: 0.85 },
              ]}
              accessibilityRole="button"
            >
              {saving ? (
                <ActivityIndicator color={theme.color.bg} />
              ) : (
                <Text style={styles.saveBtnText}>Save memory</Text>
              )}
            </Pressable>
          </View>
        )}

        <View style={styles.searchWrap}>
          <TextInput keyboardAppearance="dark"
            style={styles.search}
            placeholder="Search memories"
            placeholderTextColor={theme.color.textFaint}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>

        {loading ? (
          <SkeletonList />
        ) : error ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable
              style={({ pressed }) => [styles.retry, pressed && { opacity: 0.7 }]}
              onPress={() => load('initial')}
            >
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.list}
            keyboardDismissMode="on-drag"
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => load('refresh')}
                tintColor={theme.color.accent}
              />
            }
            ListEmptyComponent={
              <View style={[styles.center, styles.empty]}>
                {query.trim() ? null : (
                  <NavIcon name="memory" size={40} color={theme.color.textFaint} />
                )}
                <Text style={styles.emptyTitle}>
                  {query.trim() ? 'No matching memories' : 'No memories yet'}
                </Text>
                {query.trim() ? null : (
                  <Text style={styles.emptyHint}>Tap + to save something worth remembering.</Text>
                )}
              </View>
            }
            renderItem={({ item }) => <MemoryCard memory={item} onDelete={() => remove(item)} />}
          />
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function MemoryCard({ memory, onDelete }: { memory: Memory; onDelete: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}
      onLongPress={onDelete}
      delayLongPress={350}
    >
      <Text style={styles.cardText}>{memory.text}</Text>
      {memory.category ? (
        <View style={styles.chipRow}>
          <View style={styles.chip}>
            <Text style={styles.chipText}>{memory.category}</Text>
          </View>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.bg },
  flex: { flex: 1 },
  addBtn: { width: 28, height: 22, alignItems: 'center', justifyContent: 'center' },
  addBtnText: { color: theme.color.accent, fontSize: 26, fontWeight: '300', lineHeight: 28 },

  composer: {
    marginHorizontal: theme.space(5),
    marginBottom: theme.space(3),
    padding: theme.space(4),
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    gap: theme.space(3),
  },
  composerInput: {
    color: theme.color.text,
    fontSize: theme.font.body,
    minHeight: 52,
    textAlignVertical: 'top',
  },
  catRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space(2) },
  catChip: {
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.space(3),
    paddingVertical: theme.space(1.5),
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  catChipOn: { backgroundColor: theme.color.accentDim, borderColor: theme.color.accent },
  catChipText: { color: theme.color.textDim, fontSize: theme.font.small, fontWeight: '600' },
  catChipTextOn: { color: theme.color.text },
  saveBtn: {
    backgroundColor: theme.color.accent,
    borderRadius: theme.radius.md,
    paddingVertical: theme.space(3),
    alignItems: 'center',
  },
  saveBtnOff: { opacity: 0.4 },
  saveBtnText: { color: theme.color.bg, fontSize: theme.font.body, fontWeight: '700' },

  // No paddingTop: ScreenHeader already owns the gap below its divider
  // (marginBottom 16px), so the search field sits at the same one-gap distance
  // as every other screen instead of being double-spaced.
  searchWrap: { paddingHorizontal: theme.space(5), paddingTop: 0, paddingBottom: theme.space(3) },
  search: {
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space(3.5),
    paddingVertical: theme.space(2.5),
    color: theme.color.text,
    fontSize: theme.font.body,
  },
  list: { padding: theme.space(5), paddingTop: theme.space(1), gap: theme.space(3), flexGrow: 1 },
  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space(4),
    gap: theme.space(2.5),
  },
  cardText: { color: theme.color.text, fontSize: theme.font.body, lineHeight: 21 },
  chipRow: { flexDirection: 'row' },
  chip: {
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.space(2.5),
    paddingVertical: theme.space(1),
  },
  // A passive category tag, not an action — quiet neutral, so the accent stays
  // reserved for live actions (The One Ember Rule).
  chipText: {
    color: theme.color.textDim,
    fontSize: theme.font.small,
    fontWeight: '600',
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.space(8), gap: theme.space(2) },
  empty: { gap: theme.space(3) },
  emptyTitle: { color: theme.color.textDim, fontSize: theme.font.body, fontWeight: '600' },
  emptyHint: { color: theme.color.textFaint, fontSize: theme.font.small, textAlign: 'center', lineHeight: 19 },
  errorText: { color: theme.color.danger, fontSize: theme.font.body, textAlign: 'center' },
  retry: {
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space(5),
    paddingVertical: theme.space(2.5),
  },
  retryText: { color: theme.color.accent, fontSize: theme.font.body, fontWeight: '600' },
});
