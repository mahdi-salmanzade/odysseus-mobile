/**
 * Deep Research — launch a server-side research run from the phone, watch its
 * progress live, then read the finished report. A run keeps going on the server
 * even if you leave: on focus we re-attach to any run still in flight (including
 * one kicked off elsewhere), so this screen is a window onto the work, not its
 * owner. Compose → running (with progress + cancel) → done (report + sources).
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';

import Markdown from '@/components/markdown';
import { NavIcon } from '@/components/nav-icon';
import { ScreenHeader } from '@/components/screen-header';
import { theme } from '@/constants/theme';
import {
  ApiError,
  cancelResearch,
  getResearchResult,
  listActiveResearch,
  startResearch,
  streamResearch,
  type ResearchProgressEvent,
  type ResearchResult,
} from '@/lib/api';
import { usePairing } from '@/lib/pairing-context';
import { useSidebar } from '@/lib/sidebar-context';
import { loadModelPref } from '@/lib/prefs';

type Phase = 'compose' | 'running' | 'done';

/** A human, defensive one-liner from a progress frame whose shape varies by server. */
function progressLine(evt: ResearchProgressEvent): string {
  const p = evt as Record<string, unknown>;
  if (typeof p.message === 'string' && p.message) return p.message;
  const parts: string[] = [];
  if (typeof p.phase === 'string' && p.phase) parts.push(p.phase);
  if (typeof p.round === 'number') {
    parts.push(typeof p.max_rounds === 'number' ? `round ${p.round}/${p.max_rounds}` : `round ${p.round}`);
  }
  if (typeof p.sources === 'number') parts.push(`${p.sources} sources`);
  else if (typeof p.sources_found === 'number') parts.push(`${p.sources_found} sources`);
  if (parts.length) return parts.join(' · ');
  if (typeof p.status === 'string') return p.status;
  return 'Working…';
}

export default function ResearchScreen() {
  const { pairing } = usePairing();
  const { openSidebar } = useSidebar();

  const [phase, setPhase] = useState<Phase>('compose');
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [lines, setLines] = useState<string[]>([]);
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  // The current run's id + its live stream's abort handle. Refs because the
  // stream callbacks and unmount cleanup need the latest value without
  // re-subscribing the focus effect on every progress tick.
  const sidRef = useRef<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  const stopStream = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
  }, []);

  const fetchReport = useCallback(
    async (sid: string) => {
      if (!pairing) return;
      try {
        const r = await getResearchResult(pairing, sid);
        setResult(r);
        if (r.query) setActiveQuery(r.query);
        setPhase('done');
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Could not load the finished report.');
        setPhase('compose');
      }
    },
    [pairing],
  );

  const reset = useCallback(() => {
    stopStream();
    sidRef.current = null;
    setPhase('compose');
    setLines([]);
    setResult(null);
    setError(null);
    setCancelling(false);
  }, [stopStream]);

  const watch = useCallback(
    (sid: string) => {
      if (!pairing) return;
      sidRef.current = sid;
      stopStream();
      stopRef.current = streamResearch(pairing, sid, {
        onProgress: (evt) => {
          const line = progressLine(evt);
          // Keep a short rolling log; dedupe consecutive identical lines so a
          // stalled phase doesn't spam the same row.
          setLines((cur) => (cur[cur.length - 1] === line ? cur : [...cur, line].slice(-12)));
        },
        onDone: (evt) => {
          stopStream();
          if (evt.status === 'done') {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            fetchReport(sid);
          } else if (evt.status === 'cancelled') {
            reset();
          } else {
            setError(evt.error || `Research ${evt.status || 'failed'}.`);
            setPhase('compose');
          }
        },
        onError: (err) => {
          stopStream();
          setError(err.message);
          setPhase('compose');
        },
      });
    },
    [pairing, stopStream, fetchReport, reset],
  );

  // On focus, re-attach to a run still in flight (resume watching after the app
  // backgrounded, or pick up a run started from the chat screen).
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        if (!pairing || sidRef.current) return;
        try {
          const active = await listActiveResearch(pairing);
          if (cancelled || !active.length) return;
          const run = active[0];
          setActiveQuery(run.query);
          setLines([]);
          setError(null);
          setPhase('running');
          watch(run.session_id);
        } catch {
          /* no active run / unreachable — stay on compose */
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [pairing, watch]),
  );

  // Tear down the stream if the screen unmounts entirely.
  useEffect(() => stopStream, [stopStream]);

  const launch = useCallback(async () => {
    if (!pairing || starting) return;
    const q = query.trim();
    if (!q) return;
    setStarting(true);
    setError(null);
    try {
      // Reuse the model picked for chat when set; otherwise the server resolves
      // its own research/default endpoint.
      const pref = await loadModelPref();
      const { session_id } = await startResearch(pairing, {
        query: q,
        endpointId: pref?.endpoint_id,
        model: pref?.model,
      });
      setActiveQuery(q);
      setQuery('');
      setLines([]);
      setResult(null);
      setPhase('running');
      watch(session_id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not start research.');
    } finally {
      setStarting(false);
    }
  }, [pairing, starting, query, watch]);

  const onCancel = useCallback(async () => {
    const sid = sidRef.current;
    if (!pairing || !sid || cancelling) return;
    setCancelling(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    await cancelResearch(pairing, sid);
    // The stream emits a final `cancelled` frame → reset(); fall back to reset
    // here if it never arrives.
    setTimeout(() => {
      if (sidRef.current === sid) reset();
    }, 4000);
  }, [pairing, cancelling, reset]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScreenHeader title="Research" onMenu={openSidebar} />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
        keyboardVerticalOffset={8}
      >
        {phase === 'compose' && (
          <ScrollView contentContainerStyle={styles.composeWrap} keyboardShouldPersistTaps="handled">
            <View style={styles.leadHead}>
              <NavIcon name="research" size={40} color={theme.color.textFaint} />
              <Text style={styles.lead}>
                Kick off a deep research run on your Odysseus. It searches the web across
                multiple rounds, which takes a minute or two. You can leave; it keeps going.
              </Text>
            </View>
            <TextInput keyboardAppearance="dark"
              style={styles.queryInput}
              placeholder="What do you want researched?"
              placeholderTextColor={theme.color.textFaint}
              value={query}
              onChangeText={setQuery}
              multiline
              autoFocus
            />
            {error && <Text style={styles.errorText}>{error}</Text>}
            <Pressable
              onPress={launch}
              disabled={!query.trim() || starting}
              style={({ pressed }) => [
                styles.primaryBtn,
                (!query.trim() || starting) && styles.primaryBtnOff,
                pressed && query.trim() && !starting && { opacity: 0.85 },
              ]}
            >
              {starting ? (
                <ActivityIndicator color={theme.color.bg} />
              ) : (
                <Text style={styles.primaryBtnText}>Start research</Text>
              )}
            </Pressable>
          </ScrollView>
        )}

        {phase === 'running' && (
          <View style={styles.runningWrap}>
            <View style={styles.runningHead}>
              <ActivityIndicator color={theme.color.accent} />
              <Text style={styles.runningQuery} numberOfLines={3}>
                {activeQuery}
              </Text>
            </View>
            <ScrollView style={styles.log} contentContainerStyle={styles.logInner}>
              {lines.length === 0 ? (
                <Text style={styles.logLineDim}>Starting…</Text>
              ) : (
                lines.map((l, i) => (
                  <Text
                    key={i}
                    style={[styles.logLine, i === lines.length - 1 && styles.logLineActive]}
                  >
                    {l}
                  </Text>
                ))
              )}
            </ScrollView>
            <Pressable
              onPress={onCancel}
              disabled={cancelling}
              style={({ pressed }) => [styles.cancelBtn, pressed && !cancelling && { opacity: 0.6 }]}
              accessibilityRole="button"
              accessibilityLabel="Cancel research"
            >
              <Text style={styles.cancelText}>{cancelling ? 'Cancelling…' : 'Cancel run'}</Text>
            </Pressable>
          </View>
        )}

        {phase === 'done' && result && (
          <ScrollView contentContainerStyle={styles.reportWrap}>
            <Text style={styles.reportQuery}>{activeQuery}</Text>
            <View style={styles.divider} />
            <Markdown text={result.result || '_The run finished but returned no report._'} />
            {result.sources.length > 0 && (
              <View style={styles.sources}>
                <Text style={styles.sourcesTitle}>Sources ({result.sources.length})</Text>
                {result.sources.map((s, i) => (
                  <Pressable
                    key={`${s.url}-${i}`}
                    style={({ pressed }) => [styles.sourceRow, pressed && { opacity: 0.7 }]}
                    onPress={() => s.url && Linking.openURL(s.url).catch(() => {})}
                    accessibilityRole="link"
                    accessibilityLabel={`Open source: ${s.title || s.url}`}
                  >
                    <Text style={styles.sourceTitle} numberOfLines={1}>
                      {s.title || s.url}
                    </Text>
                    {!!s.url && (
                      <Text style={styles.sourceUrl} numberOfLines={1}>
                        {s.url}
                      </Text>
                    )}
                  </Pressable>
                ))}
              </View>
            )}
            <Pressable
              onPress={reset}
              style={({ pressed }) => [styles.primaryBtn, styles.newBtn, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.primaryBtnText}>New research</Text>
            </Pressable>
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.bg },
  flex: { flex: 1 },

  composeWrap: { paddingHorizontal: theme.space(5), paddingBottom: theme.space(5), gap: theme.space(4) },
  leadHead: { alignItems: 'center', gap: theme.space(3) },
  lead: { color: theme.color.textDim, fontSize: theme.font.body, lineHeight: 21, textAlign: 'center' },
  queryInput: {
    color: theme.color.text,
    fontSize: theme.font.body,
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    padding: theme.space(4),
    minHeight: 96,
    textAlignVertical: 'top',
    lineHeight: 21,
  },
  primaryBtn: {
    backgroundColor: theme.color.accent,
    borderRadius: theme.radius.md,
    paddingVertical: theme.space(3.5),
    alignItems: 'center',
  },
  primaryBtnOff: { opacity: 0.4 },
  primaryBtnText: { color: theme.color.bg, fontSize: theme.font.body, fontWeight: '700' },
  newBtn: { marginTop: theme.space(6) },

  errorText: { color: theme.color.danger, fontSize: theme.font.body, lineHeight: 21 },

  runningWrap: { flex: 1, paddingHorizontal: theme.space(5), paddingBottom: theme.space(5), gap: theme.space(4) },
  runningHead: { flexDirection: 'row', alignItems: 'center', gap: theme.space(3) },
  runningQuery: { color: theme.color.text, fontSize: theme.font.body, fontWeight: '600', flexShrink: 1, lineHeight: 21 },
  log: {
    flex: 1,
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
  },
  logInner: { padding: theme.space(4), gap: theme.space(2) },
  logLine: { color: theme.color.textFaint, fontSize: theme.font.small, lineHeight: 19 },
  logLineActive: { color: theme.color.textDim },
  logLineDim: { color: theme.color.textFaint, fontSize: theme.font.small, fontStyle: 'italic' },
  cancelBtn: {
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingVertical: theme.space(3),
    alignItems: 'center',
  },
  cancelText: { color: theme.color.danger, fontSize: theme.font.body, fontWeight: '600' },

  reportWrap: { paddingHorizontal: theme.space(5), paddingBottom: theme.space(5) },
  reportQuery: { color: theme.color.text, fontSize: theme.font.title, fontWeight: '700', lineHeight: 26 },
  divider: { height: 1, backgroundColor: theme.color.border, marginVertical: theme.space(4) },
  sources: { marginTop: theme.space(6), gap: theme.space(2.5) },
  sourcesTitle: { color: theme.color.text, fontSize: theme.font.body, fontWeight: '700', marginBottom: theme.space(1) },
  sourceRow: {
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.sm,
    padding: theme.space(3),
    gap: theme.space(0.5),
  },
  sourceTitle: { color: theme.color.text, fontSize: theme.font.small, fontWeight: '600' },
  sourceUrl: { color: theme.color.accent, fontSize: theme.font.small },
});
