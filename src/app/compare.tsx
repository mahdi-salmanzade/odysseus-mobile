/**
 * Model Compare — run the SAME prompt against two models side by side (stacked
 * on a phone), stream both replies, then vote a winner. The phone orchestrates
 * the run itself: two createSession calls (one per chosen model) feed two
 * parallel streamChat streams, each routed into its own pane. The server only
 * persists the OUTCOME via the compare/* companion endpoints — it never sees
 * the run. Below the runner, a refreshable history of past comparisons, each
 * deletable with a confirm.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Markdown from '@/components/markdown';
import { ScreenHeader } from '@/components/screen-header';
import { theme } from '@/constants/theme';
import {
  ApiError,
  createSession,
  deleteComparison,
  flattenModels,
  listCompareHistory,
  listModels,
  recordComparison,
  streamChat,
  type CompareRecord,
  type ModelChoice,
} from '@/lib/api';
import { usePairing } from '@/lib/pairing-context';
import { useSidebar } from '@/lib/sidebar-context';

type Winner = 'a' | 'b' | 'tie';

/** Per-pane streaming state. */
interface PaneState {
  text: string;
  streaming: boolean;
  error: string | null;
}

const EMPTY_PANE: PaneState = { text: '', streaming: false, error: null };

type Setup =
  | { kind: 'loading' }
  | { kind: 'no_models' }
  | { kind: 'error'; message: string }
  | { kind: 'ready' };

export default function CompareScreen() {
  const { pairing } = usePairing();
  const { openSidebar } = useSidebar();

  const [setup, setSetup] = useState<Setup>({ kind: 'loading' });
  const [choices, setChoices] = useState<ModelChoice[]>([]);
  const [choiceA, setChoiceA] = useState<ModelChoice | null>(null);
  const [choiceB, setChoiceB] = useState<ModelChoice | null>(null);

  const [prompt, setPrompt] = useState('');
  // The prompt the current/last run actually used (frozen at Run time).
  const [ranPrompt, setRanPrompt] = useState('');
  const [running, setRunning] = useState(false);
  // Set once both streams have finished a run; gates the vote UI.
  const [finished, setFinished] = useState(false);
  const [paneA, setPaneA] = useState<PaneState>(EMPTY_PANE);
  const [paneB, setPaneB] = useState<PaneState>(EMPTY_PANE);
  const [voted, setVoted] = useState<Winner | null>(null);
  const [voteError, setVoteError] = useState<string | null>(null);

  // History
  const [history, setHistory] = useState<CompareRecord[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Abort handles for the two live streams. Refs so cleanup + Stop reach the
  // latest handles without re-subscribing every render.
  const abortA = useRef<(() => void) | null>(null);
  const abortB = useRef<(() => void) | null>(null);
  // Token-coalescing flush timers (mirrors index.tsx — appending per token
  // re-parses the whole markdown string each tick).
  const flushA = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushB = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards setState-after-unmount across the async run + stream callbacks.
  const mounted = useRef(true);

  const stopStreams = useCallback(() => {
    abortA.current?.();
    abortB.current?.();
    abortA.current = null;
    abortB.current = null;
    if (flushA.current) {
      clearTimeout(flushA.current);
      flushA.current = null;
    }
    if (flushB.current) {
      clearTimeout(flushB.current);
      flushB.current = null;
    }
  }, []);

  // Tear down both streams + pending flushes if the screen unmounts.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopStreams();
    };
  }, [stopStreams]);

  // Bootstrap the model list. We do NOT create sessions here — that's deferred
  // to Run so we never persist sessions for a comparison that never happens.
  useEffect(() => {
    if (!pairing) return;
    let cancelled = false;
    (async () => {
      setSetup({ kind: 'loading' });
      try {
        const endpoints = await listModels(pairing);
        if (cancelled) return;
        const list = flattenModels(endpoints);
        if (list.length === 0) {
          setSetup({ kind: 'no_models' });
          return;
        }
        setChoices(list);
        setChoiceA(list[0]);
        // Default B to the first choice distinct from A, else fall back to A.
        setChoiceB(list.find((c, i) => i > 0) ?? list[0]);
        setSetup({ kind: 'ready' });
      } catch (e) {
        if (cancelled) return;
        setSetup({ kind: 'error', message: e instanceof ApiError ? e.message : 'Something went wrong.' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pairing]);

  const loadHistory = useCallback(
    async (mode: 'silent' | 'refresh') => {
      if (!pairing) return;
      if (mode === 'refresh') setRefreshing(true);
      setHistoryError(null);
      try {
        const items = await listCompareHistory(pairing);
        if (!mounted.current) return;
        setHistory(items);
      } catch (e) {
        if (!mounted.current) return;
        setHistoryError(e instanceof ApiError ? e.message : 'Could not load past comparisons.');
      } finally {
        if (mounted.current) setRefreshing(false);
      }
    },
    [pairing],
  );

  useFocusEffect(
    useCallback(() => {
      loadHistory('silent');
    }, [loadHistory]),
  );

  // Stream one side into its pane, coalescing tokens. Resolves when the stream
  // finishes (done or error) so Run can await both before showing the vote.
  const runPane = useCallback(
    (
      sessionId: string,
      text: string,
      setPane: React.Dispatch<React.SetStateAction<PaneState>>,
      abortRef: React.MutableRefObject<(() => void) | null>,
      flushRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
    ): Promise<void> => {
      if (!pairing) return Promise.resolve();
      return new Promise<void>((resolve) => {
        let settled = false;
        let buffer = '';
        const flush = () => {
          flushRef.current = null;
          if (!buffer) return;
          const chunk = buffer;
          buffer = '';
          if (mounted.current) setPane((cur) => ({ ...cur, text: cur.text + chunk }));
        };
        const settle = () => {
          if (settled) return;
          settled = true;
          if (flushRef.current) {
            clearTimeout(flushRef.current);
            flushRef.current = null;
          }
          flush();
          abortRef.current = null;
          if (mounted.current) setPane((cur) => ({ ...cur, streaming: false }));
          resolve();
        };
        abortRef.current = streamChat(
          pairing,
          { message: text, session: sessionId, mode: 'chat' },
          {
            onDelta: (delta) => {
              buffer += delta;
              if (!flushRef.current) flushRef.current = setTimeout(flush, 33);
            },
            onDone: settle,
            onError: (err) => {
              if (mounted.current) setPane((cur) => ({ ...cur, error: err.message }));
              settle();
            },
          },
        );
      });
    },
    [pairing],
  );

  const onRun = useCallback(() => {
    const text = prompt.trim();
    if (!text || !pairing || !choiceA || !choiceB || running) return;

    // Fresh run: cancel anything lingering, reset both panes + the vote.
    stopStreams();
    setRunning(true);
    setFinished(false);
    setVoted(null);
    setVoteError(null);
    setRanPrompt(text);
    setPaneA({ ...EMPTY_PANE, streaming: true });
    setPaneB({ ...EMPTY_PANE, streaming: true });

    (async () => {
      let sessionA: string;
      let sessionB: string;
      try {
        // Two owner-scoped sessions, one per chosen model. Named so they're
        // recognizable in the server's session list.
        const [sa, sb] = await Promise.all([
          createSession(pairing, choiceA, `Compare A · ${choiceA.label}`),
          createSession(pairing, choiceB, `Compare B · ${choiceB.label}`),
        ]);
        sessionA = sa.id;
        sessionB = sb.id;
      } catch (e) {
        if (!mounted.current) return;
        const msg = e instanceof ApiError ? e.message : 'Could not start the comparison.';
        setPaneA((cur) => ({ ...cur, streaming: false, error: msg }));
        setPaneB((cur) => ({ ...cur, streaming: false, error: msg }));
        setRunning(false);
        setFinished(true);
        return;
      }

      // Run both streams in parallel; await both before unlocking the vote.
      await Promise.all([
        runPane(sessionA, text, setPaneA, abortA, flushA),
        runPane(sessionB, text, setPaneB, abortB, flushB),
      ]);
      if (!mounted.current) return;
      setRunning(false);
      setFinished(true);
    })();
  }, [prompt, pairing, choiceA, choiceB, running, stopStreams, runPane]);

  const onStop = useCallback(() => {
    stopStreams();
    setPaneA((cur) => ({ ...cur, streaming: false }));
    setPaneB((cur) => ({ ...cur, streaming: false }));
    setRunning(false);
    // Allow voting on whatever streamed so far.
    setFinished(true);
  }, [stopStreams]);

  const vote = useCallback(
    async (winner: Winner) => {
      if (!pairing || !choiceA || !choiceB || voted) return;
      setVoted(winner); // optimistic lock
      setVoteError(null);
      try {
        await recordComparison(pairing, {
          prompt: ranPrompt,
          modelA: choiceA.label,
          modelB: choiceB.label,
          winner,
          isBlind: false,
        });
        loadHistory('silent');
      } catch (e) {
        if (!mounted.current) return;
        setVoted(null); // unlock so the user can retry
        setVoteError(e instanceof ApiError ? e.message : 'Could not record the vote.');
      }
    },
    [pairing, choiceA, choiceB, voted, ranPrompt, loadHistory],
  );

  const confirmDelete = useCallback(
    (item: CompareRecord) => {
      Alert.alert('Delete comparison', 'Remove this comparison from your history?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!pairing) return;
            // Optimistic removal; restore on failure.
            const prev = history;
            setHistory((cur) => cur.filter((c) => c.id !== item.id));
            try {
              await deleteComparison(pairing, item.id);
            } catch {
              if (mounted.current) {
                setHistory(prev);
                setHistoryError('Could not delete that comparison.');
              }
            }
          },
        },
      ]);
    },
    [pairing, history],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Compare" onMenu={openSidebar} />

      {setup.kind === 'loading' ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.color.accent} />
        </View>
      ) : setup.kind === 'no_models' ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>No models available</Text>
          <Text style={styles.emptyHint}>
            Add and enable at least one model endpoint in Odysseus on the server, then reopen this screen.
          </Text>
        </View>
      ) : setup.kind === 'error' ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{setup.message}</Text>
        </View>
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={8}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => loadHistory('refresh')}
                tintColor={theme.color.textDim}
              />
            }
          >
            {/* Prompt */}
            <TextInput
              style={styles.promptInput}
              placeholder="Prompt to send to both models…"
              placeholderTextColor={theme.color.textFaint}
              value={prompt}
              onChangeText={setPrompt}
              multiline
              editable={!running}
              accessibilityLabel="Comparison prompt"
            />

            {/* Model pickers */}
            <ModelPicker
              label="Model A"
              choices={choices}
              selected={choiceA}
              disabled={running}
              onSelect={setChoiceA}
            />
            <ModelPicker
              label="Model B"
              choices={choices}
              selected={choiceB}
              disabled={running}
              onSelect={setChoiceB}
            />

            {/* Run / Stop */}
            {running ? (
              <Pressable
                style={[styles.primaryBtn, styles.stopBtn]}
                onPress={onStop}
                accessibilityRole="button"
                accessibilityLabel="Stop comparison"
              >
                <Text style={styles.stopText}>Stop</Text>
              </Pressable>
            ) : (
              <Pressable
                style={[styles.primaryBtn, !prompt.trim() && styles.primaryBtnOff]}
                onPress={onRun}
                disabled={!prompt.trim()}
                accessibilityRole="button"
                accessibilityLabel="Run comparison"
              >
                <Text style={styles.primaryBtnText}>Run</Text>
              </Pressable>
            )}

            {/* Panes (shown once a run has started) */}
            {(running || finished) && (
              <>
                <Pane label={choiceA?.label ?? 'Model A'} pane={paneA} />
                <Pane label={choiceB?.label ?? 'Model B'} pane={paneB} />

                {/* Vote — available once both streams finished. */}
                {finished && (
                  <View style={styles.voteWrap}>
                    <Text style={styles.voteTitle}>Which reply won?</Text>
                    <View style={styles.voteRow}>
                      <VoteBtn label="A wins" active={voted === 'a'} disabled={!!voted} onPress={() => vote('a')} />
                      <VoteBtn label="Tie" active={voted === 'tie'} disabled={!!voted} onPress={() => vote('tie')} />
                      <VoteBtn label="B wins" active={voted === 'b'} disabled={!!voted} onPress={() => vote('b')} />
                    </View>
                    {voted && <Text style={styles.voteDone}>Vote recorded.</Text>}
                    {voteError && <Text style={styles.errorText}>{voteError}</Text>}
                  </View>
                )}
              </>
            )}

            {/* History */}
            <View style={styles.historyHead}>
              <Text style={styles.historyTitle}>Past comparisons</Text>
            </View>
            {historyError ? (
              <Text style={styles.errorText}>{historyError}</Text>
            ) : history.length === 0 ? (
              <Text style={styles.emptyHint}>
                Comparisons you vote on are saved here. Pull to refresh.
              </Text>
            ) : (
              history.map((item) => (
                <HistoryRow key={item.id} item={item} onDelete={() => confirmDelete(item)} />
              ))
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

function ModelPicker({
  label,
  choices,
  selected,
  disabled,
  onSelect,
}: {
  label: string;
  choices: ModelChoice[];
  selected: ModelChoice | null;
  disabled?: boolean;
  onSelect: (c: ModelChoice) => void;
}) {
  return (
    <View style={styles.pickerBlock}>
      <Text style={styles.pickerLabel}>{label}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pickerRow}
      >
        {choices.map((c) => {
          const on = selected?.endpoint_id === c.endpoint_id && selected?.model === c.model;
          return (
            <Pressable
              key={`${c.endpoint_id}:${c.model}`}
              style={[styles.chip, on && styles.chipOn, disabled && styles.chipDisabled]}
              onPress={() => onSelect(c)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityState={{ selected: on, disabled: !!disabled }}
              accessibilityLabel={`${label}: ${c.label}`}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>
                {c.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function Pane({ label, pane }: { label: string; pane: PaneState }) {
  return (
    <View style={styles.pane}>
      <View style={styles.paneHead}>
        <Text style={styles.paneLabel} numberOfLines={1}>
          {label}
        </Text>
        {pane.streaming && <Text style={styles.cursor}>▍</Text>}
      </View>
      <View style={styles.paneBody}>
        {pane.error ? (
          <Text style={styles.errorText}>{pane.error}</Text>
        ) : pane.text ? (
          <Markdown text={pane.text} />
        ) : (
          <Text style={styles.paneIdle}>{pane.streaming ? '…' : 'No reply.'}</Text>
        )}
      </View>
    </View>
  );
}

function VoteBtn({
  label,
  active,
  disabled,
  onPress,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.voteBtn, active && styles.voteBtnOn, disabled && !active && styles.voteBtnOff]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled: !!disabled }}
      accessibilityLabel={label}
    >
      <Text style={[styles.voteBtnText, active && styles.voteBtnTextOn]}>{label}</Text>
    </Pressable>
  );
}

function HistoryRow({ item, onDelete }: { item: CompareRecord; onDelete: () => void }) {
  const winnerLabel =
    item.winner === 'a' ? 'A won' : item.winner === 'b' ? 'B won' : item.winner === 'tie' ? 'Tie' : 'No vote';
  return (
    <View style={styles.histCard}>
      <View style={styles.histTop}>
        <Text style={styles.histPrompt} numberOfLines={2}>
          {item.prompt}
        </Text>
        <Pressable
          hitSlop={10}
          onPress={onDelete}
          accessibilityRole="button"
          accessibilityLabel="Delete comparison"
        >
          <Text style={styles.histDelete}>Delete</Text>
        </Pressable>
      </View>
      <View style={styles.histMatch}>
        <Text style={styles.histModel} numberOfLines={1}>
          {item.model_a}
        </Text>
        <Text style={styles.histVs}>vs</Text>
        <Text style={styles.histModel} numberOfLines={1}>
          {item.model_b}
        </Text>
      </View>
      <View style={[styles.histPill, item.winner ? styles.histPillVoted : styles.histPillNone]}>
        <Text style={[styles.histPillText, item.winner ? styles.histPillTextVoted : styles.histPillTextNone]}>
          {winnerLabel}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.bg },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.space(8), gap: theme.space(2.5) },

  scroll: { padding: theme.space(4), gap: theme.space(4) },

  emptyTitle: { color: theme.color.text, fontSize: 18, fontWeight: '600' },
  emptyHint: { color: theme.color.textFaint, fontSize: theme.font.small, textAlign: 'center', lineHeight: 19 },
  errorText: { color: theme.color.danger, fontSize: theme.font.small, lineHeight: 19 },

  promptInput: {
    color: theme.color.text,
    fontSize: theme.font.body,
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    padding: theme.space(4),
    minHeight: 80,
    textAlignVertical: 'top',
    lineHeight: 21,
  },

  pickerBlock: { gap: theme.space(2) },
  pickerLabel: {
    color: theme.color.textFaint,
    fontSize: theme.font.small,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  pickerRow: { gap: theme.space(2), paddingRight: theme.space(2) },
  chip: {
    paddingHorizontal: theme.space(3),
    paddingVertical: theme.space(2),
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.color.border,
    backgroundColor: theme.color.surface,
    maxWidth: 220,
  },
  chipOn: { backgroundColor: theme.color.accentDim, borderColor: theme.color.accent },
  chipDisabled: { opacity: 0.5 },
  chipText: { color: theme.color.textDim, fontSize: theme.font.small, fontWeight: '600' },
  chipTextOn: { color: theme.color.text },

  primaryBtn: {
    backgroundColor: theme.color.accent,
    borderRadius: theme.radius.md,
    paddingVertical: theme.space(3.5),
    alignItems: 'center',
  },
  primaryBtnOff: { opacity: 0.4 },
  primaryBtnText: { color: theme.color.onAccent, fontSize: theme.font.body, fontWeight: '700' },
  stopBtn: { backgroundColor: theme.color.danger },
  stopText: { color: theme.color.onAccent, fontSize: theme.font.body, fontWeight: '700' },

  pane: {
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    overflow: 'hidden',
  },
  paneHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.space(3.5),
    paddingVertical: theme.space(2.5),
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
    backgroundColor: theme.color.surfaceAlt,
    gap: theme.space(2),
  },
  paneLabel: { color: theme.color.text, fontSize: theme.font.small, fontWeight: '700', flexShrink: 1 },
  cursor: { color: theme.color.accent, fontSize: theme.font.body, fontWeight: '700' },
  paneBody: { padding: theme.space(3.5), minHeight: 56 },
  paneIdle: { color: theme.color.textFaint, fontSize: theme.font.body },

  voteWrap: { gap: theme.space(2.5) },
  voteTitle: { color: theme.color.text, fontSize: theme.font.body, fontWeight: '700' },
  voteRow: { flexDirection: 'row', gap: theme.space(2) },
  voteBtn: {
    flex: 1,
    paddingVertical: theme.space(3),
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    backgroundColor: theme.color.surface,
    alignItems: 'center',
  },
  voteBtnOn: { backgroundColor: theme.color.accentDim, borderColor: theme.color.accent },
  voteBtnOff: { opacity: 0.4 },
  voteBtnText: { color: theme.color.textDim, fontSize: theme.font.small, fontWeight: '700' },
  voteBtnTextOn: { color: theme.color.text },
  voteDone: { color: theme.color.ok, fontSize: theme.font.small, fontWeight: '600' },

  historyHead: { marginTop: theme.space(2) },
  historyTitle: { color: theme.color.text, fontSize: theme.font.body, fontWeight: '700' },

  histCard: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space(3.5),
    gap: theme.space(2),
  },
  histTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: theme.space(3) },
  histPrompt: { flex: 1, color: theme.color.text, fontSize: theme.font.body, fontWeight: '600', lineHeight: 20 },
  histDelete: { color: theme.color.danger, fontSize: theme.font.small, fontWeight: '700' },
  histMatch: { flexDirection: 'row', alignItems: 'center', gap: theme.space(2) },
  histModel: { flex: 1, color: theme.color.textDim, fontSize: theme.font.small },
  histVs: { color: theme.color.textFaint, fontSize: theme.font.small, fontStyle: 'italic' },
  histPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: theme.space(2.5),
    paddingVertical: theme.space(1),
    borderRadius: theme.radius.pill,
    borderWidth: 1,
  },
  histPillVoted: { backgroundColor: theme.color.okSurface, borderColor: theme.color.ok },
  histPillNone: { backgroundColor: theme.color.surfaceAlt, borderColor: theme.color.border },
  histPillText: { fontSize: theme.font.small, fontWeight: '700' },
  histPillTextVoted: { color: theme.color.ok },
  histPillTextNone: { color: theme.color.textFaint },
});
