import * as Haptics from 'expo-haptics';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NavIcon } from '@/components/nav-icon';
import { ScreenHeader } from '@/components/screen-header';
import { SkeletonList } from '@/components/skeleton';
import { theme } from '@/constants/theme';
import { ApiError, controlTask, listTasks, type Task, type TaskAction } from '@/lib/api';
import type { Pairing } from '@/lib/pairing';
import { usePairing } from '@/lib/pairing-context';
import { useSidebar } from '@/lib/sidebar-context';

export default function TasksScreen() {
  const { pairing } = usePairing();
  const { openSidebar } = useSidebar();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Once loaded, refocus refreshes silently instead of blanking to a spinner.
  const loadedOnce = useRef(false);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (!pairing) return;
      if (mode === 'refresh') setRefreshing(true);
      else if (!loadedOnce.current) setLoading(true);
      setError(null);
      try {
        const next = await listTasks(pairing);
        setTasks(next);
        loadedOnce.current = true;
      } catch (e) {
        if (!loadedOnce.current) setError(e instanceof ApiError ? e.message : 'Could not load tasks.');
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

  // Tasks with an in-flight control action, so their row can disable + spin.
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const control = useCallback(
    async (task: Task, action: TaskAction) => {
      if (!pairing || busy[task.id]) return;
      setBusy((b) => ({ ...b, [task.id]: true }));
      try {
        await controlTask(pairing, task.id, action);
        Haptics.selectionAsync().catch(() => {});
        await load('refresh');
      } catch (e) {
        Alert.alert('Task', e instanceof ApiError ? e.message : 'Could not update the task.');
      } finally {
        setBusy((b) => ({ ...b, [task.id]: false }));
      }
    },
    [pairing, busy, load],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Tasks" onMenu={openSidebar} />

      {loading ? (
        <SkeletonList />
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable
            style={({ pressed }) => [styles.retry, pressed && { opacity: 0.6 }]}
            onPress={() => load('initial')}
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={tasks}
          keyExtractor={(t) => t.id}
          contentContainerStyle={tasks.length === 0 ? styles.emptyWrap : styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load('refresh')}
              tintColor={theme.color.textDim}
            />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <NavIcon name="tasks" size={40} color={theme.color.textFaint} />
              <Text style={styles.emptyTitle}>No scheduled tasks</Text>
              <Text style={styles.emptyHint}>
                Tasks you schedule on your Odysseus server will appear here.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <TaskRow task={item} busy={!!busy[item.id]} onControl={control} />
          )}
        />
      )}
    </SafeAreaView>
  );
}

function TaskRow({
  task,
  busy,
  onControl,
}: {
  task: Task;
  busy: boolean;
  onControl: (task: Task, action: TaskAction) => void;
}) {
  const enabled = task.enabled !== false;
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.name} numberOfLines={2}>
          {task.name}
        </Text>
        <View style={[styles.pill, enabled ? styles.pillOn : styles.pillOff]}>
          <Text style={[styles.pillText, enabled ? styles.pillTextOn : styles.pillTextOff]}>
            {enabled ? 'Enabled' : 'Disabled'}
          </Text>
        </View>
      </View>

      {task.schedule ? (
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Schedule</Text>
          <Text style={styles.metaValue} numberOfLines={1}>
            {task.schedule}
          </Text>
        </View>
      ) : null}

      {task.last_run ? (
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Last run</Text>
          <Text style={styles.metaValue} numberOfLines={1}>
            {task.last_run}
          </Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        {busy ? (
          <ActivityIndicator size="small" color={theme.color.textDim} style={styles.actionSpinner} />
        ) : (
          <>
            <ActionButton label="Run" primary disabled={busy} onPress={() => onControl(task, 'run')} />
            {enabled ? (
              <ActionButton label="Pause" disabled={busy} onPress={() => onControl(task, 'pause')} />
            ) : (
              <ActionButton label="Resume" disabled={busy} onPress={() => onControl(task, 'resume')} />
            )}
            <ActionButton label="Stop" disabled={busy} onPress={() => onControl(task, 'stop')} />
          </>
        )}
      </View>
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  primary,
  disabled,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.action,
        primary && styles.actionPrimary,
        pressed && { opacity: 0.6 },
      ]}
    >
      <Text style={[styles.actionText, primary && styles.actionTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.bg },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.space(8), gap: theme.space(2.5) },
  list: { paddingHorizontal: theme.space(4), paddingBottom: theme.space(4), gap: theme.space(3) },
  emptyWrap: { flexGrow: 1 },

  errorText: { color: theme.color.danger, fontSize: theme.font.body, textAlign: 'center' },
  retry: {
    marginTop: theme.space(1),
    paddingHorizontal: theme.space(5),
    paddingVertical: theme.space(2.5),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  retryText: { color: theme.color.accent, fontSize: theme.font.body, fontWeight: '600' },

  emptyTitle: { color: theme.color.textDim, fontSize: theme.font.body, fontWeight: '600' },
  emptyHint: { color: theme.color.textFaint, fontSize: theme.font.small, textAlign: 'center', lineHeight: 19 },

  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space(4),
    gap: theme.space(3),
  },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: theme.space(3) },
  name: { color: theme.color.text, fontSize: theme.font.body, fontWeight: '600', flexShrink: 1 },

  pill: {
    paddingHorizontal: theme.space(2.5),
    paddingVertical: theme.space(1),
    borderRadius: theme.radius.pill,
    borderWidth: 1,
  },
  pillOn: { backgroundColor: theme.color.okSurface, borderColor: theme.color.ok },
  pillOff: { backgroundColor: theme.color.surfaceAlt, borderColor: theme.color.border },
  pillText: { fontSize: theme.font.small, fontWeight: '700' },
  pillTextOn: { color: theme.color.ok },
  pillTextOff: { color: theme.color.textFaint },

  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(2),
    marginTop: theme.space(1),
  },
  actionSpinner: { paddingVertical: theme.space(1.5) },
  action: {
    paddingHorizontal: theme.space(3.5),
    paddingVertical: theme.space(1.5),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  actionPrimary: { borderColor: theme.color.accent },
  actionText: { color: theme.color.textDim, fontSize: theme.font.small, fontWeight: '600' },
  actionTextPrimary: { color: theme.color.accent },

  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space(3) },
  metaLabel: {
    color: theme.color.textFaint,
    fontSize: theme.font.small,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  metaValue: { color: theme.color.textDim, fontSize: theme.font.small, flexShrink: 1, textAlign: 'right' },
});
