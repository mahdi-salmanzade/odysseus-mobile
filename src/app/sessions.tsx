/**
 * Sessions screen — browse, open, rename, and delete chat sessions.
 *
 * On focus it (re)loads the session list. Tapping a session navigates to the
 * chat screen with a `session` param (the chat screen can adopt it once wired).
 * Rename uses Alert.prompt on iOS and an inline editor elsewhere; delete
 * confirms first. Pull-to-refresh, plus empty and error states.
 */
import { router, useFocusEffect } from 'expo-router';
import { memo, useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { theme } from '@/constants/theme';
import { ApiError, deleteSession, listSessions, renameSession, type Session } from '@/lib/api';
import { usePairing } from '@/lib/pairing-context';
import { useSidebar } from '@/lib/sidebar-context';

type Status = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready' };

export default function SessionsScreen() {
  const { pairing } = usePairing();
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [sessions, setSessions] = useState<Session[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { openSidebar } = useSidebar();

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (!pairing) return;
      if (mode === 'initial') setStatus({ kind: 'loading' });
      try {
        const list = await listSessions(pairing);
        setSessions(list);
        setStatus({ kind: 'ready' });
      } catch (e) {
        const message = e instanceof ApiError ? e.message : 'Something went wrong.';
        setStatus({ kind: 'error', message });
      }
    },
    [pairing],
  );

  useFocusEffect(
    useCallback(() => {
      load('initial');
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load('refresh');
    setRefreshing(false);
  }, [load]);

  const open = useCallback((id: string) => {
    // navigate (not push) so opening a session adopts the EXISTING chat screen
    // with the new param instead of stacking another chat instance each tap.
    router.navigate({ pathname: '/', params: { session: id } });
  }, []);

  // The inline editor fires commit on BOTH onSubmitEditing and the blur that
  // follows — latch on the id so the rename (and its network call) runs once.
  const committedRef = useRef<string | null>(null);
  const commitRename = useCallback(
    async (id: string, name: string) => {
      if (committedRef.current === id) return;
      committedRef.current = id;
      const trimmed = name.trim();
      setEditingId(null);
      if (!pairing || !trimmed) return;
      const prev = sessions;
      // Optimistic update so the rename feels instant.
      setSessions((s) => s.map((x) => (x.id === id ? { ...x, name: trimmed } : x)));
      try {
        await renameSession(pairing, id, trimmed);
      } catch (e) {
        setSessions(prev);
        Alert.alert('Rename failed', e instanceof ApiError ? e.message : 'Could not rename the session.');
      }
    },
    [pairing, sessions],
  );

  const startRename = useCallback(
    (item: Session) => {
      committedRef.current = null; // fresh edit — re-arm the commit latch (both paths)
      if (Platform.OS === 'ios') {
        Alert.prompt(
          'Rename session',
          undefined,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Save', onPress: (value?: string) => commitRename(item.id, value ?? '') },
          ],
          'plain-text',
          item.name,
        );
      } else {
        setEditingId(item.id);
      }
    },
    [commitRename],
  );

  const confirmDelete = useCallback(
    (item: Session) => {
      Alert.alert('Delete session?', `“${item.name}” and its messages will be removed.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!pairing) return;
            const prev = sessions;
            setSessions((s) => s.filter((x) => x.id !== item.id));
            try {
              await deleteSession(pairing, item.id);
            } catch (e) {
              setSessions(prev);
              Alert.alert('Delete failed', e instanceof ApiError ? e.message : 'Could not delete the session.');
            }
          },
        },
      ]);
    },
    [pairing, sessions],
  );

  const renderItem = useCallback(
    ({ item }: { item: Session }) => {
      const editing = editingId === item.id;
      return (
        <View style={styles.card}>
          <Pressable
            style={styles.cardMain}
            onPress={() => open(item.id)}
            disabled={editing}
            android_ripple={{ color: theme.color.surfaceAlt }}
          >
            {editing ? (
              <RenameInput initial={item.name} onCommit={(name) => commitRename(item.id, name)} />
            ) : (
              <>
                <Text style={styles.name} numberOfLines={1}>
                  {item.name || 'Untitled'}
                </Text>
                <View style={styles.metaRow}>
                  <Text style={styles.model} numberOfLines={1}>
                    {item.model || 'no model'}
                  </Text>
                  {item.archived && <Text style={styles.tag}>archived</Text>}
                </View>
              </>
            )}
          </Pressable>

          {!editing && (
            <View style={styles.actions}>
              <Pressable
                hitSlop={8}
                style={styles.actionBtn}
                onPress={() => startRename(item)}
                accessibilityRole="button"
                accessibilityLabel="Rename session"
              >
                <Text style={styles.actionText}>Rename</Text>
              </Pressable>
              <Pressable
                hitSlop={8}
                style={styles.actionBtn}
                onPress={() => confirmDelete(item)}
                accessibilityRole="button"
                accessibilityLabel="Delete session"
              >
                <Text style={[styles.actionText, styles.deleteText]}>Delete</Text>
              </Pressable>
            </View>
          )}
        </View>
      );
    },
    [editingId, open, commitRename, startRename, confirmDelete],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScreenHeader title="Sessions" onMenu={openSidebar} />

      {status.kind === 'loading' && (
        <View style={styles.center}>
          <ActivityIndicator color={theme.color.accent} />
          <Text style={styles.dim}>Loading sessions…</Text>
        </View>
      )}

      {status.kind === 'error' && (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>Couldn’t load sessions</Text>
          <Text style={styles.dim}>{status.message}</Text>
          <Pressable style={styles.retry} onPress={() => load('initial')}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      )}

      {status.kind === 'ready' && (
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.color.accent} />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyTitle}>No sessions yet</Text>
              <Text style={styles.dim}>Start a conversation from the chat tab — it’ll show up here.</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

/**
 * Inline rename editor. Holds its OWN draft state so each keystroke re-renders
 * just this row, not the whole FlatList (the draft used to live on the screen
 * and was in renderItem's deps, invalidating every row per keystroke).
 */
const RenameInput = memo(function RenameInput({
  initial,
  onCommit,
}: {
  initial: string;
  onCommit: (name: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <TextInput
      style={styles.editInput}
      value={value}
      onChangeText={setValue}
      autoFocus
      onSubmitEditing={() => onCommit(value)}
      onBlur={() => onCommit(value)}
      placeholder="Session name"
      placeholderTextColor={theme.color.textFaint}
      returnKeyType="done"
    />
  );
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 10 },
  dim: { color: theme.color.textDim, textAlign: 'center', fontSize: theme.font.body, lineHeight: 21 },
  emptyTitle: { color: theme.color.text, fontSize: 18, fontWeight: '600' },
  retry: {
    marginTop: 6,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  retryText: { color: theme.color.accent, fontSize: theme.font.body, fontWeight: '600' },
  listContent: { padding: 14, gap: 10, flexGrow: 1 },
  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    overflow: 'hidden',
  },
  cardMain: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12, gap: 6 },
  name: { color: theme.color.text, fontSize: theme.font.body, fontWeight: '600' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  model: { color: theme.color.textFaint, fontSize: theme.font.small, flexShrink: 1 },
  tag: {
    color: theme.color.warn,
    fontSize: theme.font.small,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  editInput: {
    color: theme.color.text,
    fontSize: theme.font.body,
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  actions: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
  },
  actionBtn: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  actionText: { color: theme.color.textDim, fontSize: theme.font.small, fontWeight: '600' },
  deleteText: { color: theme.color.danger },
});
