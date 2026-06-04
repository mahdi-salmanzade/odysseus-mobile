import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Link, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MenuIcon, MicIcon, SettingsIcon } from '@/components/header-icons';
import Markdown from '@/components/markdown';
import { OdysseusLogo } from '@/components/odysseus-logo';
import { OdysseusWordmark } from '@/components/odysseus-wordmark';
import { theme } from '@/constants/theme';
import {
  ApiError,
  createSession,
  flattenModels,
  getHistory,
  listModels,
  listSessions,
  sourcesFromMetadata,
  streamChat,
  type ChatMessage,
  type ChatSources,
  type ModelChoice,
  type Session,
} from '@/lib/api';
import { useDictation } from '@/lib/dictation';
import { usePairing } from '@/lib/pairing-context';
import { loadModelPref } from '@/lib/prefs';
import { useSidebar } from '@/lib/sidebar-context';

/** A rendered chat row — a message plus any citations the server attached. */
type ChatRow = ChatMessage & { id: string; sources?: ChatSources };

// Monotonic row id. We locate the in-flight assistant row by id rather than by
// a frozen array index, so a stream callback can never append tokens to the
// wrong row if the list shifts underneath it.
let _rowSeq = 0;
const newRowId = () => `r${++_rowSeq}`;

// Shown in the assistant bubble while a background research task runs — research
// streams no answer text (the report lands in history when it finishes).
const RESEARCHING = 'Researching the web… this can take a minute.';

/** Open a URL only if it's http(s). Source URLs come from the server/LLM, i.e.
 * untrusted output — don't hand arbitrary schemes (tel:, custom deep links) to
 * the OS opener. */
function openExternal(url: string) {
  if (/^https?:\/\//i.test(url)) Linking.openURL(url).catch(() => {});
}

/** Merge a streamed source slice into a row's accumulated sources, deduping URLs. */
function mergeSources(existing: ChatSources | undefined, partial: ChatSources): ChatSources {
  const out: ChatSources = { ...existing };
  if (partial.web) out.web = dedupeByUrl([...(out.web ?? []), ...partial.web]);
  if (partial.research) out.research = dedupeByUrl([...(out.research ?? []), ...partial.research]);
  if (partial.rag) out.rag = [...(out.rag ?? []), ...partial.rag];
  if (partial.memories) out.memories = [...(out.memories ?? []), ...partial.memories];
  return out;
}

function dedupeByUrl<T extends { url: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    if (it.url && seen.has(it.url)) continue;
    if (it.url) seen.add(it.url);
    out.push(it);
  }
  return out;
}

type Status =
  | { kind: 'loading' }
  | { kind: 'searching' } // scanning the LAN for the server after its IP moved
  | { kind: 'no_models' }
  | { kind: 'error'; message: string }
  | { kind: 'ready' };

export default function ChatScreen() {
  const { pairing, relocate } = usePairing();
  const { openSidebar } = useSidebar();
  const dictation = useDictation();
  // Stable across dictation start/stop, so depending on it doesn't rebuild send().
  const cancelDictation = dictation.cancel;
  // `?session=<id>` (from the Sessions screen) opens an existing conversation;
  // absent (New Chat) starts a fresh one with no server-side session yet.
  const params = useLocalSearchParams<{ session?: string }>();
  const sessionParam = typeof params.session === 'string' ? params.session : undefined;
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [choices, setChoices] = useState<ModelChoice[]>([]);
  const [choice, setChoice] = useState<ModelChoice | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<ChatRow[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  // A failure loading an existing conversation shows as an inline banner over
  // the chat instead of replacing the whole screen with the error state.
  const [convoError, setConvoError] = useState<string | null>(null);
  const [convoReload, setConvoReload] = useState(0);

  // Composer toggles, wired into the streamChat args.
  const [useWeb, setUseWeb] = useState(false);
  const [useResearch, setUseResearch] = useState(false);
  const [agentMode, setAgentMode] = useState(false);

  const abortRef = useRef<(() => void) | null>(null);
  // Cancellation token for the CURRENT send. A New Chat's first send awaits
  // createSession before the stream (and abortRef) exist; flipping this lets
  // Stop and a conversation-switch cancel the whole operation across that await,
  // so we never start an unstoppable, orphaned stream.
  const sendRef = useRef<{ cancelled: boolean } | null>(null);
  // A New Chat creates its server session lazily on first send; we then write
  // that id into the route param. This ref tells the param-change effect to
  // treat that write-back as adoption (keep the live stream), not a switch.
  const lazyCreatedRef = useRef<string | null>(null);
  const listRef = useRef<FlatList<ChatRow>>(null);
  // Whether the user is pinned near the bottom. While they've scrolled up to
  // read history mid-stream, we DON'T yank them back down on every token.
  const atBottomRef = useRef(true);
  const scrollPending = useRef(false);
  // Bumped to force a reconnect attempt (after a manual or auto LAN rescan that
  // found the server at the same IP — no pairing change to re-trigger on).
  const [reloadTick, setReloadTick] = useState(0);
  // We auto-rescan the LAN at most once per failed-connection episode; reset on
  // a successful connect so a later network switch can auto-rescan again.
  const triedRelocateRef = useRef(false);

  // Bootstrap: discover an available model. We do NOT create a session here —
  // that's deferred to the first send so we never persist empty conversations.
  useEffect(() => {
    if (!pairing) return;
    let cancelled = false;
    (async () => {
      setStatus({ kind: 'loading' });
      try {
        const [endpoints, pref] = await Promise.all([listModels(pairing), loadModelPref()]);
        const list = flattenModels(endpoints);
        if (cancelled) return;
        if (list.length === 0) {
          setStatus({ kind: 'no_models' });
          return;
        }
        setChoices(list);
        // Honor the model chosen in Settings, falling back to the first available.
        const preferred = pref
          ? list.find((c) => c.endpoint_id === pref.endpoint_id && c.model === pref.model)
          : undefined;
        setChoice(preferred ?? list[0]);
        triedRelocateRef.current = false; // connected — re-arm auto-rescan for next time
        setStatus({ kind: 'ready' });
      } catch (e) {
        if (cancelled) return;
        // Couldn't reach the host — likely a moved IP after a Wi-Fi switch. Scan
        // the LAN once to relocate the server before surfacing a hard error.
        const isNetwork = e instanceof ApiError && e.kind === 'network';
        if (isNetwork && !triedRelocateRef.current) {
          triedRelocateRef.current = true;
          setStatus({ kind: 'searching' });
          let found = false;
          try {
            found = await relocate();
          } catch {
            /* fall through to error */
          }
          if (cancelled) return; // a host change already re-ran this effect
          if (found) {
            setReloadTick((n) => n + 1); // server located at the same IP — retry
            return;
          }
        }
        const message = e instanceof ApiError ? e.message : 'Something went wrong.';
        setStatus({ kind: 'error', message });
      }
    })();
    return () => {
      cancelled = true;
      abortRef.current?.();
    };
  }, [pairing, reloadTick, relocate]);

  // Manual LAN rescan (from the "Couldn't connect" state). Finds the server on
  // the current network and updates the stored IP, then forces a reconnect.
  const searchNetwork = useCallback(async () => {
    setStatus({ kind: 'searching' });
    let found = false;
    try {
      found = await relocate();
    } catch {
      /* treated as not-found below */
    }
    if (found) {
      setReloadTick((n) => n + 1); // host may be unchanged → re-run the bootstrap
    } else {
      setStatus({
        kind: 'error',
        message: 'No Odysseus found on this Wi-Fi. Check the server is running and on the same network.',
      });
    }
  }, [relocate]);

  // Re-apply the saved model preference when this screen regains focus (e.g.
  // after changing it in Settings). Only affects the model used for the NEXT new
  // chat — an existing session's model is fixed server-side.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      loadModelPref().then((pref) => {
        if (!active || choices.length === 0) return;
        const next = pref
          ? choices.find((c) => c.endpoint_id === pref.endpoint_id && c.model === pref.model)
          : choices[0];
        if (next) setChoice(next);
      });
      return () => {
        active = false;
      };
    }, [choices]),
  );

  // Coalesced scroll-to-bottom. Token-cadence calls are gated on the user being
  // near the bottom and use a non-animated jump (animating per-token stutters);
  // `force` is for explicit moments (send, opening a conversation).
  const scrollToEnd = useCallback((opts?: { force?: boolean; animated?: boolean }) => {
    if (!opts?.force && !atBottomRef.current) return;
    if (scrollPending.current) return;
    scrollPending.current = true;
    requestAnimationFrame(() => {
      scrollPending.current = false;
      listRef.current?.scrollToEnd({ animated: opts?.animated ?? false });
      atBottomRef.current = true;
    });
  }, []);

  const onScroll = useCallback(
    (e: { nativeEvent: { layoutMeasurement: { height: number }; contentOffset: { y: number }; contentSize: { height: number } } }) => {
      const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
      atBottomRef.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 80;
    },
    [],
  );

  // React to the `session` param: load an existing conversation's history, or
  // reset to a clean (lazy) New Chat when none is present.
  useEffect(() => {
    if (!pairing) return;
    // send() just created this session and pushed its id into the route param.
    // That's not a conversation switch — keep the live stream and messages.
    if (sessionParam && sessionParam === lazyCreatedRef.current) {
      lazyCreatedRef.current = null;
      return;
    }
    let cancelled = false;
    // Switching conversations cancels any in-flight stream AND any send that's
    // still awaiting its createSession (so it won't start a stream afterward).
    abortRef.current?.();
    abortRef.current = null;
    if (sendRef.current) sendRef.current.cancelled = true;
    sendRef.current = null;
    /* eslint-disable react-hooks/set-state-in-effect --
       Resetting the streaming UI and conversation rows when the active session
       param changes is deliberate synchronization, not a cascading-render smell. */
    setStreaming(false);

    if (!sessionParam) {
      setSession(null);
      setMessages([]);
      setConvoError(null);
      return;
    }
    /* eslint-enable react-hooks/set-state-in-effect */

    (async () => {
      try {
        const [history, list] = await Promise.all([
          getHistory(pairing, sessionParam),
          listSessions(pairing).catch(() => [] as Session[]),
        ]);
        if (cancelled) return;
        const rows: ChatRow[] = history
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({
            id: newRowId(),
            role: m.role,
            content: m.content,
            // Rehydrate the citation footer the server persisted with this reply.
            sources: m.role === 'assistant' ? sourcesFromMetadata(m.metadata) : undefined,
          }));
        const meta = list.find((s) => s.id === sessionParam) ?? null;
        setSession(
          meta ?? { id: sessionParam, name: 'Chat', model: '', rag: false, archived: false },
        );
        setMessages(rows);
        setConvoError(null);
        scrollToEnd({ force: true });
      } catch (e) {
        if (cancelled) return;
        // Don't tear down the whole screen — surface an inline, retryable
        // banner so a transient history fetch doesn't strand the user.
        setConvoError(e instanceof ApiError ? e.message : 'Could not load this conversation.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pairing, sessionParam, scrollToEnd, convoReload]);

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || !pairing || !choice || streaming) return;
    // End any live dictation first so a late transcript can't repopulate the
    // input we're about to clear (cancel mutes the sink, unlike stop).
    cancelDictation();
    setInput('');
    setStreaming(true);

    // This send's cancellation token. Stop / conversation-switch flip it.
    const token = { cancelled: false };
    sendRef.current = token;

    const assistantId = newRowId();
    setMessages((prev) => [
      ...prev,
      { id: newRowId(), role: 'user', content: text },
      { id: assistantId, role: 'assistant', content: '' },
    ]);
    scrollToEnd({ force: true, animated: true });

    // Update the in-flight assistant row, located by its stable id.
    const updateAssistant = (fn: (cur: ChatRow) => ChatRow) =>
      setMessages((prev) => {
        const i = prev.findIndex((r) => r.id === assistantId);
        if (i === -1) return prev;
        const copy = prev.slice();
        copy[i] = fn(copy[i]);
        return copy;
      });

    // Coalesce streamed tokens: appending per-token re-parses the whole markdown
    // string on every tick (O(n²) over a long reply). Flushing on a short timer
    // batches them. A late flush is harmless — updateAssistant is id-guarded, so
    // it no-ops if the row is gone (switched away).
    let buffer = '';
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      flushTimer = null;
      if (!buffer) return;
      const chunk = buffer;
      buffer = '';
      updateAssistant((cur) => ({ ...cur, content: cur.content + chunk }));
      scrollToEnd();
    };

    const settle = () => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      flush();
      setStreaming(false);
      abortRef.current = null;
      if (sendRef.current === token) sendRef.current = null;
    };

    const failAssistant = (msg: string) => {
      settle();
      // Append the error if the reply had already started, so a mid-stream
      // failure is never silently swallowed as a truncated-but-clean answer.
      updateAssistant((cur) =>
        cur.content && cur.content !== RESEARCHING
          ? { ...cur, content: `${cur.content}\n\n${msg}` }
          : { ...cur, content: `${msg}` },
      );
    };

    (async () => {
      // Create the session on demand the first time the user sends — this is
      // what keeps empty sessions from ever being persisted on the server.
      let active = session;
      if (!active) {
        try {
          active = await createSession(pairing, choice);
        } catch (e) {
          if (token.cancelled) return;
          failAssistant(e instanceof ApiError ? e.message : 'Could not start a session.');
          return;
        }
        // Stopped or switched away while creating — don't start the stream or
        // mutate state for a conversation the user has left.
        if (token.cancelled) return;
        setSession(active);
        // Reflect the live session in the URL so re-opening it from Sessions (or
        // a back navigation) targets the right conversation. The param-change
        // effect recognizes this id and won't tear down the stream.
        lazyCreatedRef.current = active.id;
        router.setParams({ session: active.id });
      }

      if (token.cancelled) return;
      const activeId = active.id;
      abortRef.current = streamChat(
        pairing,
        {
          message: text,
          session: activeId,
          mode: agentMode ? 'agent' : 'chat',
          useWeb,
          useResearch,
        },
        {
          onDelta: (delta) => {
            buffer += delta;
            if (!flushTimer) flushTimer = setTimeout(flush, 33);
          },
          onModel: (model) => {
            // Reflect the model the server actually used in the header.
            setSession((s) => (s && s.id === activeId ? { ...s, model } : s));
          },
          onSources: (partial) => {
            updateAssistant((cur) => ({ ...cur, sources: mergeSources(cur.sources, partial) }));
          },
          // Research streams progress but no answer text — show activity so the
          // bubble doesn't look frozen for the minute+ a research run takes.
          onResearchProgress: () => {
            updateAssistant((cur) => (cur.content ? cur : { ...cur, content: RESEARCHING }));
            scrollToEnd();
          },
          // The finished report is persisted to the session history server-side;
          // pull it and render it into the bubble.
          onResearchDone: () => {
            (async () => {
              try {
                const hist = await getHistory(pairing, activeId);
                const report = [...hist].reverse().find((m) => m.role === 'assistant')?.content;
                updateAssistant((cur) => ({
                  ...cur,
                  content: report || 'Research finished but returned no report.',
                }));
                scrollToEnd();
              } catch {
                updateAssistant((cur) => ({
                  ...cur,
                  content: 'Research finished, but the report could not be loaded.',
                }));
              }
            })();
          },
          onDone: settle,
          onError: (err) => {
            settle();
            updateAssistant((cur) =>
              cur.content && cur.content !== RESEARCHING
                ? { ...cur, content: `${cur.content}\n\n${err.message}` }
                : { ...cur, content: `${err.message}` },
            );
          },
        },
      );
    })();
  }, [input, pairing, choice, session, streaming, scrollToEnd, agentMode, useWeb, useResearch, cancelDictation]);

  const stop = useCallback(() => {
    // Cancel a send that's still awaiting createSession, then abort the stream.
    if (sendRef.current) sendRef.current.cancelled = true;
    sendRef.current = null;
    abortRef.current?.();
    abortRef.current = null;
    setStreaming(false);
  }, []);

  // Start/stop voice dictation, streaming the transcript into the composer.
  const toggleDictation = useCallback(() => {
    Haptics.selectionAsync();
    dictation.toggle(input, setInput);
  }, [dictation, input]);

  const copyMessage = useCallback(async (content: string) => {
    if (!content) return;
    await Haptics.selectionAsync();
    await Clipboard.setStringAsync(content);
  }, []);

  // Swipe right from the left edge to reveal the navigation drawer — the same
  // panel the hamburger opens. activeOffsetX gates on a rightward drag, while
  // failOffsetY yields to the chat list's vertical scroll, so the gesture only
  // ever fires on a deliberate horizontal pull from the edge.
  const edgeSwipe = Gesture.Pan()
    .activeOffsetX(18)
    .failOffsetY([-16, 16])
    .onEnd((e) => {
      if (e.translationX > 56 || e.velocityX > 600) runOnJS(openSidebar)();
    });

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Invisible left-edge strip: a swipe-right here opens the drawer. */}
      <GestureDetector gesture={edgeSwipe}>
        <View style={styles.edgeSwipe} />
      </GestureDetector>

      <View style={styles.header}>
        <Pressable
          hitSlop={12}
          onPress={openSidebar}
          style={({ pressed }) => [styles.hamburger, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
          accessibilityLabel="Open menu"
        >
          <MenuIcon size={23} color={theme.color.textDim} />
        </Pressable>
        <View style={styles.headerCenter}>
          <View style={styles.brandRow}>
            <OdysseusLogo size={22} />
            <Text style={styles.brand}>Odysseus</Text>
          </View>
          <Text style={styles.model} numberOfLines={1}>
            {session?.model || choice?.label || '…'}
          </Text>
        </View>
        <Link href="/settings" asChild>
          <Pressable
            hitSlop={12}
            style={({ pressed }) => pressed && { opacity: 0.6 }}
            accessibilityRole="button"
            accessibilityLabel="Open settings"
          >
            <SettingsIcon size={22} color={theme.color.textDim} />
          </Pressable>
        </Link>
      </View>

      {status.kind === 'loading' && (
        <View style={styles.center}>
          <ActivityIndicator color={theme.color.accent} />
          <Text style={styles.dim}>Connecting to your Odysseus…</Text>
        </View>
      )}

      {status.kind === 'no_models' && (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>No models available</Text>
          <Text style={styles.dim}>
            Add and enable a model endpoint in Odysseus → Settings on the server, then reopen the app.
          </Text>
        </View>
      )}

      {status.kind === 'searching' && (
        <View style={styles.center}>
          <ActivityIndicator color={theme.color.accent} />
          <Text style={styles.dim}>Looking for your Odysseus on this Wi-Fi…</Text>
        </View>
      )}

      {status.kind === 'error' && (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>Couldn’t connect</Text>
          <Text style={styles.dim}>{status.message}</Text>
          <Text style={styles.dim}>
            On a new Wi-Fi network the server’s IP may have changed. Search for it without re-pairing.
          </Text>
          <Pressable
            style={styles.retry}
            onPress={searchNetwork}
            accessibilityRole="button"
            accessibilityLabel="Search the network for the server"
          >
            <Text style={styles.retryText}>Search the network</Text>
          </Pressable>
        </View>
      )}

      {status.kind === 'ready' && (
        <KeyboardAvoidingView
          style={styles.fill}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
        >
          {convoError && (
            <View style={styles.banner}>
              <Text style={styles.bannerText} numberOfLines={2}>
                {convoError}
              </Text>
              <Pressable
                hitSlop={8}
                onPress={() => {
                  setConvoError(null);
                  setConvoReload((n) => n + 1);
                }}
                style={({ pressed }) => pressed && { opacity: 0.6 }}
                accessibilityRole="button"
              >
                <Text style={styles.bannerRetry}>Retry</Text>
              </Pressable>
            </View>
          )}

          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <Bubble message={item} onCopy={copyMessage} />}
            contentContainerStyle={styles.listContent}
            onScroll={onScroll}
            scrollEventThrottle={100}
            ListEmptyComponent={
              <View style={styles.center}>
                <View style={styles.emptyBrandRow}>
                  <OdysseusLogo size={40} />
                  <OdysseusWordmark size={40} />
                </View>
                <Text style={styles.emptyTagline}>Yours for the voyage.</Text>
              </View>
            }
          />

          <View style={styles.toolbar}>
            <Toggle label="Web" active={useWeb} disabled={streaming} onPress={() => setUseWeb((v) => !v)} />
            <Toggle label="Research" active={useResearch} disabled={streaming} onPress={() => setUseResearch((v) => !v)} />
            <Toggle
              label={agentMode ? 'Agent' : 'Chat'}
              active={agentMode}
              disabled={streaming}
              onPress={() => setAgentMode((v) => !v)}
            />
          </View>

          <View style={styles.composer}>
            <TextInput keyboardAppearance="dark"
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder={dictation.recognizing ? 'Listening…' : 'Message Odysseus…'}
              placeholderTextColor={theme.color.textFaint}
              multiline
              editable={!streaming}
            />
            {dictation.available && !streaming && (
              <Pressable
                style={({ pressed }) => [
                  styles.micBtn,
                  dictation.recognizing && styles.micBtnActive,
                  pressed && { opacity: 0.6 },
                ]}
                onPress={toggleDictation}
                accessibilityRole="button"
                accessibilityLabel={dictation.recognizing ? 'Stop dictation' : 'Dictate message'}
                accessibilityState={{ selected: dictation.recognizing }}
              >
                <MicIcon
                  size={20}
                  color={dictation.recognizing ? theme.color.onAccent : theme.color.textDim}
                />
              </Pressable>
            )}
            {streaming ? (
              <Pressable
                style={({ pressed }) => [styles.sendBtn, styles.stopBtn, pressed && { opacity: 0.85 }]}
                onPress={stop}
              >
                <Text style={styles.stopText}>■</Text>
              </Pressable>
            ) : (
              <Pressable
                style={({ pressed }) => [
                  styles.sendBtn,
                  !input.trim() && styles.sendDisabled,
                  pressed && !!input.trim() && { opacity: 0.85 },
                ]}
                onPress={send}
                disabled={!input.trim()}
              >
                <Text style={styles.sendText}>↑</Text>
              </Pressable>
            )}
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

function Toggle({
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
      onPress={onPress}
      disabled={disabled}
      // The pill is short; extend the tap area vertically so it clears the 44pt
      // touch-target floor without making the composer toolbar look chunky.
      hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
      // Toggles only take effect at send time; mid-stream they'd silently do
      // nothing to the in-flight request, so dim + disable them while streaming.
      style={({ pressed }) => [
        styles.toggle,
        active && styles.toggleActive,
        disabled && styles.toggleDisabled,
        pressed && !disabled && { opacity: 0.6 },
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled: !!disabled }}
    >
      <Text style={[styles.toggleText, active && styles.toggleTextActive]}>{label}</Text>
    </Pressable>
  );
}

/** User messages stay plain; assistant content goes through the markdown renderer. */
function Bubble({ message, onCopy }: { message: ChatRow; onCopy: (content: string) => void }) {
  const isUser = message.role === 'user';
  return (
    <Pressable
      onLongPress={() => onCopy(message.content)}
      delayLongPress={300}
      style={[styles.row, isUser ? styles.rowUser : styles.rowAssistant]}
    >
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}>
        {isUser ? (
          <Text style={styles.userText} selectable>
            {message.content}
          </Text>
        ) : message.content ? (
          <Markdown text={message.content} />
        ) : (
          <Text style={styles.userText}>…</Text>
        )}
        {!isUser && message.sources ? <Sources sources={message.sources} /> : null}
      </View>
    </Pressable>
  );
}

/** Citations the server attached to a reply: web/research links, RAG docs, memories. */
function Sources({ sources }: { sources: ChatSources }) {
  const links = [...(sources.web ?? []), ...(sources.research ?? [])];
  const hasAnything =
    links.length > 0 || (sources.rag?.length ?? 0) > 0 || (sources.memories?.length ?? 0) > 0;
  if (!hasAnything) return null;

  return (
    <View style={styles.sources}>
      {links.length > 0 && (
        <>
          <Text style={styles.sourcesLabel}>Sources</Text>
          {links.map((s, i) => (
            <Pressable
              key={`${s.url}-${i}`}
              onPress={() => openExternal(s.url)}
              hitSlop={11}
              accessibilityRole="link"
              accessibilityLabel={`Open source ${i + 1}: ${s.title || s.url}`}
            >
              <Text style={styles.sourceLink} numberOfLines={2}>
                {i + 1}. {s.title || s.url}
              </Text>
            </Pressable>
          ))}
        </>
      )}

      {sources.rag && sources.rag.length > 0 && (
        <>
          <Text style={styles.sourcesLabel}>Documents</Text>
          {sources.rag.map((d, i) => (
            <Text key={`${d.filename}-${i}`} style={styles.sourceDoc} numberOfLines={1}>
              {d.filename}
            </Text>
          ))}
        </>
      )}

      {sources.memories && sources.memories.length > 0 && (
        <Text style={styles.sourceMeta}>
          {sources.memories.length} {sources.memories.length === 1 ? 'memory' : 'memories'} used
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.bg },
  fill: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.space(4.5),
    paddingVertical: theme.space(3),
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
    gap: theme.space(3),
    // Match the shared ScreenHeader's gap so the chat hero breathes below the
    // nav exactly like every other screen.
    marginBottom: theme.space(4),
  },
  // Thin transparent capture zone pinned to the left edge for the open-drawer
  // swipe. Sits above content but only ~22px wide; non-pan taps fall through.
  edgeSwipe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: theme.space(5.5), zIndex: 20 },
  hamburger: { paddingRight: theme.space(0.5) },
  headerCenter: { flex: 1 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space(2) },
  brand: { color: theme.color.accent, fontSize: theme.font.title, fontWeight: '700' },
  model: { color: theme.color.textFaint, fontSize: theme.font.small },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: theme.space(8), gap: theme.space(2.5) },
  dim: { color: theme.color.textDim, textAlign: 'center', fontSize: theme.font.body, lineHeight: 21 },
  emptyTitle: { color: theme.color.text, fontSize: 18, fontWeight: '600' },
  retry: {
    marginTop: theme.space(1),
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  retryText: { color: theme.color.accent, fontSize: theme.font.body, fontWeight: '600' },
  // Empty state: the mark sits inline to the left of the gradient wordmark,
  // mirroring the desktop hero (its eye glyph beside a gradient name).
  emptyBrandRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space(2), marginBottom: theme.space(1) },
  emptyTagline: {
    color: theme.color.textDim,
    fontSize: theme.font.body,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
  // Header owns the top gap (its marginBottom); list keeps only side + bottom.
  listContent: { paddingHorizontal: theme.space(3.5), paddingBottom: theme.space(3.5), flexGrow: 1 },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.space(3),
    marginHorizontal: theme.space(3),
    marginTop: theme.space(2),
    paddingHorizontal: theme.space(3.5),
    paddingVertical: theme.space(2.5),
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.dangerSurface,
    borderWidth: 1,
    borderColor: theme.color.danger,
  },
  bannerText: { flex: 1, color: theme.color.text, fontSize: theme.font.small, lineHeight: 18 },
  bannerRetry: { color: theme.color.accent, fontSize: theme.font.small, fontWeight: '700' },

  // Message bubbles (inline, so assistant content can host the markdown view).
  row: { width: '100%', marginVertical: theme.space(1), flexDirection: 'row' },
  rowUser: { justifyContent: 'flex-end' },
  rowAssistant: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '85%', paddingHorizontal: theme.space(3.5), paddingVertical: theme.space(2.5), borderRadius: theme.radius.lg },
  userBubble: { backgroundColor: theme.color.userBubble, borderBottomRightRadius: theme.radius.sm },
  assistantBubble: {
    backgroundColor: theme.color.assistantBubble,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderBottomLeftRadius: theme.radius.sm,
  },
  userText: { color: theme.color.text, fontSize: theme.font.body, lineHeight: 21 },

  // Citation block under an assistant bubble.
  sources: {
    marginTop: theme.space(2.5),
    paddingTop: theme.space(2.5),
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
    gap: theme.space(1),
  },
  sourcesLabel: {
    color: theme.color.textFaint,
    fontSize: theme.font.small,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: theme.space(0.5),
  },
  sourceLink: { color: theme.color.accent, fontSize: theme.font.small, lineHeight: 19 },
  sourceDoc: { color: theme.color.textDim, fontSize: theme.font.small, lineHeight: 19 },
  sourceMeta: { color: theme.color.textFaint, fontSize: theme.font.small, marginTop: theme.space(0.5) },

  toolbar: {
    flexDirection: 'row',
    gap: theme.space(2),
    paddingHorizontal: theme.space(3),
    paddingTop: theme.space(2),
  },
  toggle: {
    paddingHorizontal: theme.space(3),
    paddingVertical: theme.space(1.5),
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.color.border,
    backgroundColor: theme.color.surface,
  },
  toggleActive: { backgroundColor: theme.color.accentDim, borderColor: theme.color.accent },
  toggleDisabled: { opacity: 0.4 },
  toggleText: { color: theme.color.textDim, fontSize: theme.font.small, fontWeight: '600' },
  toggleTextActive: { color: theme.color.text },

  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: theme.space(2.5),
    paddingHorizontal: theme.space(3),
    paddingVertical: theme.space(2.5),
    borderTopWidth: 0,
  },
  input: {
    flex: 1,
    maxHeight: 130,
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.lg,
    paddingHorizontal: theme.space(3.5),
    paddingTop: theme.space(2.5),
    paddingBottom: theme.space(2.5),
    color: theme.color.text,
    fontSize: theme.font.body,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  micBtn: {
    width: 42,
    height: 42,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.color.border,
    backgroundColor: theme.color.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Listening: light the mic like the send "lamp" so it's clearly recording.
  micBtnActive: { backgroundColor: theme.color.accent, borderColor: theme.color.accent },
  sendDisabled: { opacity: 0.4 },
  sendText: { color: theme.color.onAccent, fontSize: 20, fontWeight: '800' },
  stopBtn: { backgroundColor: theme.color.danger },
  stopText: { color: theme.color.onAccent, fontSize: 16, fontWeight: '800' },
});
