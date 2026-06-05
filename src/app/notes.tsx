/**
 * Notes — viewer + editor for the server's notes. Loads on focus, renders one
 * card per note (title + content, or a checklist when the note has items).
 * Pinned notes float to the top. Create via the header +, delete via long-press,
 * tap the pin to (un)pin, and tap a checklist item to toggle it. Pull-to-refresh,
 * plus empty/error/loading states.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
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
import Svg, { Path } from 'react-native-svg';

import { NavIcon } from '@/components/nav-icon';
import { ScreenHeader } from '@/components/screen-header';
import { SkeletonList } from '@/components/skeleton';
import { theme } from '@/constants/theme';
import {
  ApiError,
  createNote,
  deleteNote,
  listNotes,
  toggleNoteItem,
  toggleNotePin,
  type Note,
} from '@/lib/api';
import { usePairing } from '@/lib/pairing-context';
import { useSidebar } from '@/lib/sidebar-context';

function sortNotes(notes: Note[]): Note[] {
  // Pinned first; otherwise preserve server order.
  return [...notes].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
}

export default function NotesScreen() {
  const { pairing } = usePairing();
  const { openSidebar } = useSidebar();

  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Composer state.
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [checklist, setChecklist] = useState(false);
  const [saving, setSaving] = useState(false);

  // Once loaded, refocus refreshes silently instead of blanking to a spinner.
  const loadedOnce = useRef(false);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (!pairing) return;
      if (mode === 'refresh') setRefreshing(true);
      else if (!loadedOnce.current) setLoading(true);
      setError(null);
      try {
        const data = await listNotes(pairing);
        setNotes(sortNotes(data));
        loadedOnce.current = true;
      } catch (e) {
        if (!loadedOnce.current) setError(e instanceof ApiError ? e.message : 'Could not load notes.');
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

  const resetComposer = () => {
    setTitle('');
    setBody('');
    setChecklist(false);
    setComposing(false);
  };

  const save = useCallback(async () => {
    if (!pairing || saving) return;
    const t = title.trim();
    const b = body.trim();
    if (!t && !b) return;
    setSaving(true);
    try {
      const input = checklist
        ? {
            title: t,
            pinned: false,
            // Each non-empty line becomes an unchecked item.
            items: b
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean)
              .map((text) => ({ text, done: false })),
          }
        : { title: t, content: b, pinned: false };
      const created = await createNote(pairing, input);
      setNotes((prev) => sortNotes([created, ...prev]));
      resetComposer();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Unknown error.');
    } finally {
      setSaving(false);
    }
  }, [pairing, saving, title, body, checklist]);

  const remove = useCallback(
    (note: Note) => {
      if (!pairing) return;
      Alert.alert('Delete note', note.title || 'This note', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            // Optimistic delete; on failure re-insert at the original spot from
            // live state rather than restoring a stale snapshot.
            let removed: Note | undefined;
            let at = -1;
            setNotes((cur) => {
              at = cur.findIndex((n) => n.id === note.id);
              if (at === -1) return cur;
              removed = cur[at];
              return cur.filter((n) => n.id !== note.id);
            });
            try {
              await deleteNote(pairing, note.id);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
            } catch (e) {
              if (removed) {
                setNotes((cur) => {
                  if (cur.some((n) => n.id === note.id)) return cur;
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

  const togglePin = useCallback(
    async (note: Note) => {
      if (!pairing) return;
      // Optimistic flip + re-sort so the card jumps to/from the top.
      setNotes((cur) => sortNotes(cur.map((n) => (n.id === note.id ? { ...n, pinned: !n.pinned } : n))));
      try {
        // Reconcile to the server's authoritative pinned state rather than
        // trusting the optimistic flip.
        const pinned = await toggleNotePin(pairing, note.id);
        setNotes((cur) => sortNotes(cur.map((n) => (n.id === note.id ? { ...n, pinned } : n))));
      } catch {
        // Roll back this note by id from live state.
        setNotes((cur) => sortNotes(cur.map((n) => (n.id === note.id ? { ...n, pinned: note.pinned } : n))));
      }
    },
    [pairing],
  );

  const toggleItem = useCallback(
    async (note: Note, index: number) => {
      if (!pairing || !note.items) return;
      setNotes((cur) =>
        cur.map((n) =>
          n.id === note.id
            ? {
                ...n,
                items: n.items!.map((it, i) => (i === index ? { ...it, done: !it.done } : it)),
              }
            : n,
        ),
      );
      try {
        // Apply the server's returned item list (authoritative).
        const items = await toggleNoteItem(pairing, note.id, index);
        setNotes((cur) => cur.map((n) => (n.id === note.id ? { ...n, items } : n)));
      } catch {
        // Flip the one item back from live state.
        setNotes((cur) =>
          cur.map((n) =>
            n.id === note.id
              ? { ...n, items: n.items?.map((it, i) => (i === index ? { ...it, done: !it.done } : it)) }
              : n,
          ),
        );
      }
    },
    [pairing],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScreenHeader
        title="Notes"
        onMenu={openSidebar}
        right={
          <Pressable
            hitSlop={{ top: 13, bottom: 13, left: 13, right: 13 }}
            onPress={() => setComposing((v) => !v)}
            style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.6 }]}
            accessibilityRole="button"
            accessibilityLabel={composing ? 'Close composer' : 'New note'}
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
              style={styles.titleInput}
              placeholder="Title"
              placeholderTextColor={theme.color.textFaint}
              value={title}
              onChangeText={setTitle}
            />
            <TextInput keyboardAppearance="dark"
              style={styles.bodyInput}
              placeholder={checklist ? 'One item per line…' : 'Note…'}
              placeholderTextColor={theme.color.textFaint}
              value={body}
              onChangeText={setBody}
              multiline
            />
            <View style={styles.composerActions}>
              <Pressable
                onPress={() => setChecklist((v) => !v)}
                style={({ pressed }) => [
                  styles.modeChip,
                  checklist && styles.modeChipOn,
                  pressed && { opacity: 0.6 },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: checklist }}
              >
                <Text style={[styles.modeChipText, checklist && styles.modeChipTextOn]}>
                  Checklist
                </Text>
              </Pressable>
              <Pressable
                onPress={save}
                disabled={(!title.trim() && !body.trim()) || saving}
                style={({ pressed }) => [
                  styles.saveBtn,
                  (!title.trim() && !body.trim()) || saving ? styles.saveBtnOff : null,
                  pressed && (title.trim() || body.trim()) && !saving && { opacity: 0.85 },
                ]}
                accessibilityRole="button"
              >
                {saving ? (
                  <ActivityIndicator color={theme.color.bg} />
                ) : (
                  <Text style={styles.saveBtnText}>Save</Text>
                )}
              </Pressable>
            </View>
          </View>
        )}

        {loading ? (
          <SkeletonList />
        ) : error ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable
              style={({ pressed }) => [styles.retry, pressed && { opacity: 0.7 }]}
              onPress={() => load('initial')}
            >
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            data={notes}
            keyExtractor={(n) => n.id}
            contentContainerStyle={notes.length === 0 ? styles.emptyWrap : styles.list}
            renderItem={({ item }) => (
              <NoteCard
                note={item}
                onDelete={() => remove(item)}
                onTogglePin={() => togglePin(item)}
                onToggleItem={(i) => toggleItem(item, i)}
              />
            )}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => load('refresh')}
                tintColor={theme.color.accent}
              />
            }
            ListEmptyComponent={
              <View style={styles.empty}>
                <NavIcon name="notes" size={40} color={theme.color.textFaint} />
                <Text style={styles.emptyTitle}>No notes yet</Text>
                <Text style={styles.emptyHint}>Tap + to write a note or start a checklist.</Text>
              </View>
            }
          />
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** A pushpin, drawn in the app's line-icon family so it never reads as the
 * checklist's ○ glyph. Filled coral when pinned, a faint outline when not. */
function PinGlyph({ pinned }: { pinned?: boolean }) {
  const color = pinned ? theme.color.accent : theme.color.textFaint;
  return (
    <Svg width={17} height={17} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={pinned ? color : 'none'}
      />
    </Svg>
  );
}

function NoteCard({
  note,
  onDelete,
  onTogglePin,
  onToggleItem,
}: {
  note: Note;
  onDelete: () => void;
  onTogglePin: () => void;
  onToggleItem: (index: number) => void;
}) {
  const hasItems = Array.isArray(note.items) && note.items.length > 0;
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}
      onLongPress={onDelete}
      delayLongPress={350}
    >
      <View style={styles.cardHead}>
        {!!note.title && (
          <Text style={styles.cardTitle} numberOfLines={2}>
            {note.title}
          </Text>
        )}
        <Pressable
          hitSlop={{ top: 13, bottom: 13, left: 13, right: 13 }}
          onPress={onTogglePin}
          style={({ pressed }) => [styles.pinBtn, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
          accessibilityLabel={note.pinned ? 'Unpin note' : 'Pin note'}
          accessibilityState={{ selected: !!note.pinned }}
        >
          <PinGlyph pinned={note.pinned} />
        </Pressable>
      </View>

      {hasItems ? (
        <View style={styles.checklist}>
          {note.items!.map((it, i) => (
            <Pressable
              key={i}
              style={({ pressed }) => [styles.checkRow, pressed && { opacity: 0.6 }]}
              hitSlop={11}
              onPress={() => onToggleItem(i)}
              accessibilityRole="button"
              accessibilityLabel="Toggle item"
              accessibilityState={{ checked: it.done }}
            >
              <Text style={[styles.check, it.done && styles.checkDone]}>
                {it.done ? '✓' : '○'}
              </Text>
              <Text style={[styles.checkText, it.done && styles.checkTextDone]}>{it.text}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        !!note.content && <Text style={styles.content}>{note.content}</Text>
      )}

      {!note.title && !hasItems && !note.content && (
        <Text style={styles.contentDim}>Empty note</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.bg },
  flex: { flex: 1 },
  addBtn: { width: 24, height: 18, alignItems: 'center', justifyContent: 'center' },
  addBtnText: { color: theme.color.accent, fontSize: 26, fontWeight: '300', lineHeight: 26 },

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
  titleInput: {
    color: theme.color.text,
    fontSize: theme.font.body,
    fontWeight: '700',
    paddingVertical: 2,
  },
  bodyInput: {
    color: theme.color.text,
    fontSize: theme.font.body,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  composerActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modeChip: {
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  modeChipOn: { backgroundColor: theme.color.accentDim, borderColor: theme.color.accent },
  modeChipText: { color: theme.color.textDim, fontSize: theme.font.small, fontWeight: '600' },
  modeChipTextOn: { color: theme.color.text },
  saveBtn: {
    backgroundColor: theme.color.accent,
    borderRadius: theme.radius.md,
    paddingHorizontal: 22,
    paddingVertical: 9,
    alignItems: 'center',
  },
  saveBtnOff: { opacity: 0.4 },
  saveBtnText: { color: theme.color.bg, fontSize: theme.font.body, fontWeight: '700' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.space(8), gap: theme.space(4) },
  errorText: { color: theme.color.danger, fontSize: theme.font.body, textAlign: 'center', lineHeight: 21 },
  retry: {
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space(6),
    paddingVertical: theme.space(3),
  },
  retryText: { color: theme.color.accent, fontSize: theme.font.body, fontWeight: '600' },

  // No top padding: the shared ScreenHeader already owns the 16px gap below the
  // divider, so the first card sits at that one consistent gap, not double-spaced.
  list: { paddingHorizontal: theme.space(5), paddingBottom: theme.space(5), gap: theme.space(3) },
  emptyWrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', gap: theme.space(3), paddingHorizontal: theme.space(8) },
  emptyTitle: { color: theme.color.textDim, fontSize: theme.font.body, fontWeight: '600' },
  emptyHint: { color: theme.color.textFaint, fontSize: theme.font.small, textAlign: 'center', lineHeight: 19 },

  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space(4),
    gap: theme.space(2.5),
  },
  // Title flexes to fill; the pin sits at the trailing edge (marginLeft: auto),
  // so a title-less note shows just a quiet pin in the corner, not a lone glyph
  // masquerading as a broken checkbox. flex-start keeps the pin level with the
  // first line of a wrapping title.
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space(2), minHeight: 17 },
  pinBtn: { marginLeft: 'auto' },
  cardTitle: { color: theme.color.text, fontSize: theme.font.body, fontWeight: '700', flex: 1 },
  content: { color: theme.color.textDim, fontSize: theme.font.body, lineHeight: 21 },
  contentDim: { color: theme.color.textFaint, fontSize: theme.font.small, fontStyle: 'italic' },

  checklist: { gap: theme.space(2) },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space(2.5) },
  check: { color: theme.color.textFaint, fontSize: theme.font.body, lineHeight: 21 },
  checkDone: { color: theme.color.ok },
  checkText: { color: theme.color.textDim, fontSize: theme.font.body, lineHeight: 21, flexShrink: 1 },
  checkTextDone: { color: theme.color.textFaint, textDecorationLine: 'line-through' },
});
