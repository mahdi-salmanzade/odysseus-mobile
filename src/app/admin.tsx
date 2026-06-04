/**
 * Admin — a single hub for the server's admin-only tools, surfaced only when the
 * server says they're reachable for this caller. The gate is three-fold: an
 * admin turned the feature on, the paired token's owner is an admin, and the
 * token carries the companion scope. /admin/status collapses all three into one
 * `available` flag; if it's false we explain why and render nothing else.
 *
 * When available, the tools live as a segmented selector switching among five
 * sections within this one screen. Terminal is the primary tool (most room);
 * Contacts, Vault, MCP, and Cookbook follow. Each section fetches lazily the
 * first time it's opened.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { theme } from '@/constants/theme';
import {
  ApiError,
  getAdminStatus,
  getCookbookState,
  getVaultStatus,
  listContacts,
  listMcpServers,
  runCommand,
  unlockVault,
  type AdminStatus,
  type Contact,
  type McpServer,
  type TerminalResult,
  type VaultStatus,
} from '@/lib/api';
import { usePairing } from '@/lib/pairing-context';
import { useSidebar } from '@/lib/sidebar-context';

type Tool = 'terminal' | 'contacts' | 'vault' | 'mcp' | 'cookbook';

const TOOLS: { id: Tool; label: string }[] = [
  { id: 'terminal', label: 'Terminal' },
  { id: 'contacts', label: 'Contacts' },
  { id: 'vault', label: 'Vault' },
  { id: 'mcp', label: 'MCP' },
  { id: 'cookbook', label: 'Cookbook' },
];

export default function AdminScreen() {
  const { pairing } = usePairing();
  const { openSidebar } = useSidebar();

  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('terminal');

  // Guard async writes against an unmounted/navigated-away screen.
  const cancelled = useRef(false);

  const loadStatus = useCallback(async () => {
    if (!pairing) return;
    cancelled.current = false;
    setLoading(true);
    setError(null);
    try {
      const s = await getAdminStatus(pairing);
      if (cancelled.current) return;
      setStatus(s);
    } catch (e) {
      if (cancelled.current) return;
      setError(e instanceof ApiError ? e.message : 'Could not check admin access.');
    } finally {
      if (!cancelled.current) setLoading(false);
    }
  }, [pairing]);

  useFocusEffect(
    useCallback(() => {
      loadStatus();
      return () => {
        cancelled.current = true;
      };
    }, [loadStatus]),
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Admin" onMenu={openSidebar} />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.color.accent} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retry} onPress={loadStatus} accessibilityRole="button">
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : status && !status.available ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>Admin tools unavailable</Text>
          <Text style={styles.emptyHint}>
            {!status.enabled
              ? 'Admin features are turned off on the server.'
              : !status.is_admin
                ? "This paired account isn't an admin."
                : 'These tools are not available for this account.'}
          </Text>
          <Pressable style={styles.retry} onPress={loadStatus} accessibilityRole="button">
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.flex}>
          <View style={styles.tabs}>
            {TOOLS.map((t) => {
              const active = tool === t.id;
              return (
                <Pressable
                  key={t.id}
                  onPress={() => setTool(t.id)}
                  style={[styles.tab, active && styles.tabActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${t.label} tool`}
                >
                  <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {tool === 'terminal' && <TerminalSection />}
          {tool === 'contacts' && <ContactsSection />}
          {tool === 'vault' && <VaultSection />}
          {tool === 'mcp' && <McpSection />}
          {tool === 'cookbook' && <CookbookSection />}
        </View>
      )}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Terminal — the primary tool. Type a command, run it, see stdout/stderr/exit.
// ---------------------------------------------------------------------------

function TerminalSection() {
  const { pairing } = usePairing();

  const [command, setCommand] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TerminalResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cancelled = useRef(false);
  useFocusEffect(
    useCallback(() => {
      cancelled.current = false;
      return () => {
        cancelled.current = true;
      };
    }, []),
  );

  const run = useCallback(async () => {
    if (!pairing || running) return;
    const cmd = command.trim();
    if (!cmd) {
      setError('Enter a command to run.');
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const r = await runCommand(pairing, cmd);
      if (cancelled.current) return;
      setResult(r);
    } catch (e) {
      if (cancelled.current) return;
      if (e instanceof ApiError && e.status === 504) {
        setError('The command timed out on the server.');
      } else if (e instanceof ApiError && e.status === 400) {
        setError('The server rejected an empty command.');
      } else {
        setError(e instanceof ApiError ? e.message : 'Could not run the command.');
      }
    } finally {
      if (!cancelled.current) setRunning(false);
    }
  }, [pairing, running, command]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.flex}
      keyboardVerticalOffset={8}
    >
      <View style={styles.cmdBar}>
        <TextInput
          style={styles.cmdInput}
          placeholder="Command to run on the server…"
          placeholderTextColor={theme.color.textFaint}
          value={command}
          onChangeText={setCommand}
          onSubmitEditing={run}
          returnKeyType="go"
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Command"
        />
        <Pressable
          onPress={run}
          disabled={!command.trim() || running}
          style={[styles.runBtn, (!command.trim() || running) && styles.runBtnOff]}
          accessibilityRole="button"
          accessibilityLabel="Run command"
        >
          {running ? (
            <ActivityIndicator color={theme.color.onAccent} />
          ) : (
            <Text style={styles.runBtnText}>Run</Text>
          )}
        </Pressable>
      </View>

      <Text style={styles.warnNote}>Commands run on the server with the owner&apos;s privileges.</Text>

      {error && <Text style={styles.inlineError}>{error}</Text>}

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.outputWrap}
        keyboardShouldPersistTaps="handled"
      >
        {result ? (
          <>
            <View style={styles.exitRow}>
              <Text style={styles.label}>Exit code</Text>
              <Text style={[styles.exitCode, result.exit_code !== 0 && styles.exitCodeBad]}>
                {result.exit_code}
              </Text>
            </View>

            {result.stdout ? (
              <Text style={styles.mono} selectable>
                {result.stdout}
              </Text>
            ) : (
              <Text style={styles.emptyHint}>No output.</Text>
            )}

            {result.stderr ? (
              <>
                <Text style={[styles.label, styles.stderrLabel]}>stderr</Text>
                <Text style={[styles.mono, styles.monoDanger]} selectable>
                  {result.stderr}
                </Text>
              </>
            ) : null}
          </>
        ) : (
          <Text style={styles.emptyHint}>Run a command to see its output here.</Text>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ---------------------------------------------------------------------------
// Contacts — search box + read-only name/emails list.
// ---------------------------------------------------------------------------

function ContactsSection() {
  const { pairing } = usePairing();

  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cancelled = useRef(false);

  const load = useCallback(
    async (q: string) => {
      if (!pairing) return;
      setLoading(true);
      setError(null);
      try {
        const list = await listContacts(pairing, q);
        if (cancelled.current) return;
        setItems(list);
      } catch (e) {
        if (cancelled.current) return;
        setError(e instanceof ApiError ? e.message : 'Could not load contacts.');
      } finally {
        if (!cancelled.current) setLoading(false);
      }
    },
    [pairing],
  );

  useFocusEffect(
    useCallback(() => {
      cancelled.current = false;
      load('');
      return () => {
        cancelled.current = true;
      };
    }, [load]),
  );

  return (
    <View style={styles.flex}>
      <View style={styles.searchBar}>
        <TextInput
          style={styles.input}
          placeholder="Search contacts…"
          placeholderTextColor={theme.color.textFaint}
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => load(query)}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Contact search"
        />
        <Pressable
          onPress={() => load(query)}
          disabled={loading}
          style={[styles.runBtn, loading && styles.runBtnOff]}
          accessibilityRole="button"
          accessibilityLabel="Search contacts"
        >
          <Text style={styles.runBtnText}>Search</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.color.accent} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retry} onPress={() => load(query)} accessibilityRole="button">
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyHint}>No contacts found.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.listWrap} keyboardShouldPersistTaps="handled">
          {items.map((c, i) => (
            <View key={`${c.name}-${i}`} style={styles.card}>
              <Text style={styles.cardTitle}>{c.name || 'Unnamed'}</Text>
              {c.emails.length > 0 ? (
                c.emails.map((em, j) => (
                  <Text key={`${em}-${j}`} style={styles.cardSub} selectable>
                    {em}
                  </Text>
                ))
              ) : (
                <Text style={styles.cardFaint}>No email addresses</Text>
              )}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Vault — show lock state; unlock with the master password (never stored).
// ---------------------------------------------------------------------------

function VaultSection() {
  const { pairing } = usePairing();

  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);

  const cancelled = useRef(false);

  const load = useCallback(async () => {
    if (!pairing) return;
    setLoading(true);
    setError(null);
    try {
      const s = await getVaultStatus(pairing);
      if (cancelled.current) return;
      setStatus(s);
    } catch (e) {
      if (cancelled.current) return;
      setError(e instanceof ApiError ? e.message : 'Could not load the vault status.');
    } finally {
      if (!cancelled.current) setLoading(false);
    }
  }, [pairing]);

  useFocusEffect(
    useCallback(() => {
      cancelled.current = false;
      load();
      return () => {
        cancelled.current = true;
      };
    }, [load]),
  );

  const unlock = useCallback(async () => {
    if (!pairing || unlocking || !password) return;
    setUnlocking(true);
    setUnlockError(null);
    try {
      const r = await unlockVault(pairing, password);
      if (cancelled.current) return;
      if (!r.ok) {
        setUnlockError(r.error ?? 'Could not unlock the vault.');
        return;
      }
      // Never keep the password around once it's been used.
      setPassword('');
      await load();
    } catch (e) {
      if (cancelled.current) return;
      setUnlockError(e instanceof ApiError ? e.message : 'Could not unlock the vault.');
    } finally {
      if (!cancelled.current) setUnlocking(false);
    }
  }, [pairing, unlocking, password, load]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.color.accent} />
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable style={styles.retry} onPress={load} accessibilityRole="button">
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.flex}
      keyboardVerticalOffset={8}
    >
      <ScrollView contentContainerStyle={styles.listWrap} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.label}>Status</Text>
          {!status?.configured ? (
            <Text style={styles.cardSub}>Not configured</Text>
          ) : status.unlocked ? (
            <>
              <Text style={[styles.cardTitle, styles.okText]}>Unlocked</Text>
              {status.unlocked_at ? (
                <Text style={styles.cardFaint}>Unlocked at {status.unlocked_at}</Text>
              ) : null}
            </>
          ) : (
            <Text style={[styles.cardTitle, styles.dangerText]}>Locked</Text>
          )}
        </View>

        {status?.configured && !status.unlocked ? (
          <View style={styles.card}>
            <Text style={styles.label}>Master password</Text>
            <TextInput
              style={[styles.input, styles.cardInput]}
              placeholder="Master password"
              placeholderTextColor={theme.color.textFaint}
              value={password}
              onChangeText={(t) => {
                setPassword(t);
                setUnlockError(null);
              }}
              onSubmitEditing={unlock}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="go"
              accessibilityLabel="Master password"
            />
            {unlockError && <Text style={styles.inlineError}>{unlockError}</Text>}
            <Pressable
              onPress={unlock}
              disabled={!password || unlocking}
              style={[styles.fullBtn, (!password || unlocking) && styles.runBtnOff]}
              accessibilityRole="button"
              accessibilityLabel="Unlock vault"
            >
              {unlocking ? (
                <ActivityIndicator color={theme.color.onAccent} />
              ) : (
                <Text style={styles.runBtnText}>Unlock</Text>
              )}
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ---------------------------------------------------------------------------
// MCP — read-only list of configured servers.
// ---------------------------------------------------------------------------

function McpSection() {
  const { pairing } = usePairing();

  const [items, setItems] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cancelled = useRef(false);

  const load = useCallback(async () => {
    if (!pairing) return;
    setLoading(true);
    setError(null);
    try {
      const list = await listMcpServers(pairing);
      if (cancelled.current) return;
      setItems(list);
    } catch (e) {
      if (cancelled.current) return;
      setError(e instanceof ApiError ? e.message : 'Could not load MCP servers.');
    } finally {
      if (!cancelled.current) setLoading(false);
    }
  }, [pairing]);

  useFocusEffect(
    useCallback(() => {
      cancelled.current = false;
      load();
      return () => {
        cancelled.current = true;
      };
    }, [load]),
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.color.accent} />
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable style={styles.retry} onPress={load} accessibilityRole="button">
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }
  if (items.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyHint}>No MCP servers configured.</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.listWrap}>
      {items.map((s) => (
        <View key={s.id} style={styles.card}>
          <View style={styles.cardHeadRow}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {s.name}
            </Text>
            <View style={[styles.pill, s.enabled ? styles.pillOn : styles.pillOff]}>
              <Text style={[styles.pillText, s.enabled ? styles.pillTextOn : styles.pillTextOff]}>
                {s.enabled ? 'Enabled' : 'Disabled'}
              </Text>
            </View>
          </View>
          <Text style={styles.cardFaint}>{s.transport}</Text>
          {s.command ? (
            <Text style={styles.cardSub} selectable numberOfLines={2}>
              {s.command}
            </Text>
          ) : null}
          {s.url ? (
            <Text style={styles.cardSub} selectable numberOfLines={2}>
              {s.url}
            </Text>
          ) : null}
        </View>
      ))}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Cookbook — pretty-printed state JSON (already secret-stripped server-side).
// ---------------------------------------------------------------------------

function CookbookSection() {
  const { pairing } = usePairing();

  const [state, setState] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cancelled = useRef(false);

  const load = useCallback(async () => {
    if (!pairing) return;
    setLoading(true);
    setError(null);
    try {
      const s = await getCookbookState(pairing);
      if (cancelled.current) return;
      setState(s);
    } catch (e) {
      if (cancelled.current) return;
      setError(e instanceof ApiError ? e.message : 'Could not load the cookbook state.');
    } finally {
      if (!cancelled.current) setLoading(false);
    }
  }, [pairing]);

  useFocusEffect(
    useCallback(() => {
      cancelled.current = false;
      load();
      return () => {
        cancelled.current = true;
      };
    }, [load]),
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.color.accent} />
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable style={styles.retry} onPress={load} accessibilityRole="button">
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const pretty = JSON.stringify(state ?? {}, null, 2);
  const empty = !state || Object.keys(state).length === 0;

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.outputWrap}>
      {empty ? (
        <Text style={styles.emptyHint}>The cookbook state is empty.</Text>
      ) : (
        <Text style={styles.mono} selectable>
          {pretty}
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.bg },
  flex: { flex: 1 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },

  errorText: { color: theme.color.danger, fontSize: theme.font.body, textAlign: 'center' },
  retry: {
    marginTop: 4,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  retryText: { color: theme.color.accent, fontSize: theme.font.body, fontWeight: '600' },

  emptyTitle: { color: theme.color.textDim, fontSize: theme.font.body, fontWeight: '600' },
  emptyHint: { color: theme.color.textFaint, fontSize: theme.font.small, textAlign: 'center', lineHeight: 19 },

  // Segmented tool selector.
  tabs: {
    flexDirection: 'row',
    gap: theme.space(1),
    paddingHorizontal: theme.space(4),
    paddingVertical: theme.space(3),
  },
  tab: {
    flex: 1,
    paddingVertical: theme.space(2),
    borderRadius: theme.radius.sm,
    alignItems: 'center',
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  tabActive: { backgroundColor: theme.color.surfaceAlt, borderColor: theme.color.accentDim },
  tabText: { color: theme.color.textDim, fontSize: theme.font.small, fontWeight: '600' },
  tabTextActive: { color: theme.color.text },

  // Command + search bars.
  cmdBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(2),
    paddingHorizontal: theme.space(4),
    paddingTop: theme.space(1),
  },
  cmdInput: {
    flex: 1,
    color: theme.color.text,
    fontSize: theme.font.mono,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space(4),
    paddingVertical: theme.space(3),
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(2),
    paddingHorizontal: theme.space(4),
    paddingVertical: theme.space(3),
  },
  input: {
    flex: 1,
    color: theme.color.text,
    fontSize: theme.font.body,
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space(4),
    paddingVertical: theme.space(3),
  },
  runBtn: {
    backgroundColor: theme.color.accent,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space(4),
    paddingVertical: theme.space(3),
    minWidth: 76,
    alignItems: 'center',
    justifyContent: 'center',
  },
  runBtnOff: { opacity: 0.4 },
  runBtnText: { color: theme.color.onAccent, fontSize: theme.font.body, fontWeight: '700' },
  fullBtn: {
    backgroundColor: theme.color.accent,
    borderRadius: theme.radius.md,
    paddingVertical: theme.space(3),
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: theme.space(3),
  },

  warnNote: {
    color: theme.color.textFaint,
    fontSize: theme.font.small,
    paddingHorizontal: theme.space(4),
    paddingTop: theme.space(2),
  },
  inlineError: {
    color: theme.color.danger,
    fontSize: theme.font.small,
    paddingHorizontal: theme.space(4),
    paddingTop: theme.space(2),
  },

  // Terminal output.
  outputWrap: { padding: theme.space(4), paddingBottom: theme.space(8), gap: theme.space(2) },
  exitRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space(2) },
  label: { color: theme.color.textFaint, fontSize: theme.font.small, fontWeight: '600' },
  exitCode: { color: theme.color.ok, fontSize: theme.font.body, fontWeight: '700' },
  exitCodeBad: { color: theme.color.danger },
  stderrLabel: { marginTop: theme.space(3) },
  mono: {
    color: theme.color.text,
    fontSize: theme.font.mono,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 19,
  },
  monoDanger: { color: theme.color.danger },

  // Cards (contacts / vault / mcp).
  listWrap: { padding: theme.space(4), paddingBottom: theme.space(8), gap: theme.space(3) },
  card: {
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    padding: theme.space(3),
    gap: theme.space(1),
  },
  cardHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space(2) },
  cardTitle: { color: theme.color.text, fontSize: theme.font.body, fontWeight: '600', flexShrink: 1 },
  cardSub: { color: theme.color.textDim, fontSize: theme.font.small },
  cardFaint: { color: theme.color.textFaint, fontSize: theme.font.small },
  cardInput: { marginTop: theme.space(1) },
  okText: { color: theme.color.ok },
  dangerText: { color: theme.color.danger },

  pill: {
    paddingHorizontal: theme.space(2),
    paddingVertical: 2,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
  },
  pillOn: { backgroundColor: theme.color.okSurface, borderColor: theme.color.ok },
  pillOff: { backgroundColor: theme.color.surfaceAlt, borderColor: theme.color.border },
  pillText: { fontSize: theme.font.small, fontWeight: '700' },
  pillTextOn: { color: theme.color.ok },
  pillTextOff: { color: theme.color.textFaint },
});
