import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { theme } from '@/constants/theme';
import {
  ApiError,
  flattenModels,
  getInfo,
  listModels,
  sendTestPush,
  type CompanionInfo,
  type ModelChoice,
} from '@/lib/api';
import { usePairing } from '@/lib/pairing-context';
import { enablePushForPairing } from '@/lib/push';
import { loadModelPref, saveModelPref, type ModelPref } from '@/lib/prefs';

// App version + native build number, read from the embedded app config. With
// EAS remote versioning the build number is assigned at build time, so fall back
// to '—' rather than a misleading hardcoded value.
const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';
const BUILD_NUMBER =
  Platform.select({
    ios: Constants.expoConfig?.ios?.buildNumber,
    android: Constants.expoConfig?.android?.versionCode?.toString(),
  }) ?? '—';

export default function SettingsScreen() {
  const { pairing, unpair, setAddress } = usePairing();
  const [info, setInfo] = useState<CompanionInfo | null>(null);
  // Manual "the server's IP changed" editor — updates host/port, keeps the token.
  const [editAddr, setEditAddr] = useState(false);
  const [hostIn, setHostIn] = useState('');
  const [portIn, setPortIn] = useState('');
  const [savingAddr, setSavingAddr] = useState(false);
  // The token was reachable but rejected (401) — distinct from a slow/offline
  // server, so we can tell the user to re-pair instead of just showing '…'.
  const [tokenRejected, setTokenRejected] = useState(false);

  const [models, setModels] = useState<ModelChoice[] | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ModelPref | null>(null);
  const [testingPush, setTestingPush] = useState(false);

  useEffect(() => {
    if (!pairing) return;
    let active = true;
    getInfo(pairing)
      .then((i) => {
        if (!active) return;
        setInfo(i);
        setTokenRejected(false);
      })
      .catch((e) => {
        if (!active) return;
        setInfo(null);
        setTokenRejected(e instanceof ApiError && e.kind === 'unauthorized');
      });
    return () => {
      active = false;
    };
  }, [pairing]);

  useEffect(() => {
    if (!pairing) return;
    let active = true;
    loadModelPref().then((p) => active && setSelected(p));
    listModels(pairing)
      .then((eps) => active && setModels(flattenModels(eps)))
      .catch((e) => active && setModelsError(e instanceof ApiError ? e.message : 'Could not load models.'));
    return () => {
      active = false;
    };
  }, [pairing]);

  async function pickModel(c: ModelChoice) {
    const pref = { endpoint_id: c.endpoint_id, model: c.model };
    setSelected(pref);
    await saveModelPref(pref);
    Haptics.selectionAsync().catch(() => {});
  }

  async function testPush() {
    if (!pairing || testingPush) return;
    setTestingPush(true);
    try {
      // Make sure this device is registered (prompts for permission the first
      // time), then ask the server to push a test to all of the owner's devices.
      const ready = await enablePushForPairing(pairing);
      if (!ready) {
        Alert.alert(
          'Notifications unavailable',
          'Allow notifications for Odysseus in system settings, on a physical device, then try again.',
        );
        return;
      }
      const sent = await sendTestPush(pairing);
      if (sent > 0) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        Alert.alert('Test sent', `Pushed a test notification to ${sent} device${sent === 1 ? '' : 's'}.`);
      } else {
        Alert.alert('No devices registered', 'This device isn’t registered for push yet.');
      }
    } catch (e) {
      Alert.alert('Could not send', e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setTestingPush(false);
    }
  }

  function startEditAddr() {
    if (!pairing) return;
    setHostIn(pairing.host);
    setPortIn(String(pairing.port));
    setEditAddr(true);
  }

  async function saveAddr() {
    if (savingAddr) return;
    const port = parseInt(portIn.trim(), 10);
    setSavingAddr(true);
    try {
      const ok = await setAddress(hostIn, port);
      if (!ok) {
        Alert.alert('Invalid address', 'Enter a LAN IP/host (e.g. 192.168.1.21) and a port from 1–65535.');
        return;
      }
      Haptics.selectionAsync().catch(() => {});
      setEditAddr(false); // pairing changed → the info/models effects re-run and reconnect
    } finally {
      setSavingAddr(false);
    }
  }

  function confirmUnpair() {
    Alert.alert('Unpair this server?', 'You’ll need to scan the pairing code again to reconnect.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unpair',
        style: 'destructive',
        onPress: async () => {
          // The Stack.Protected guard swaps to the pair screen as soon as
          // `pairing` clears — no explicit navigation needed (and an explicit
          // replace from this modal competes with that, causing a double
          // transition).
          await unpair();
        },
      },
    ]);
  }

  // The effective selection: the saved pref if it's still in the list, else the
  // first model (what the chat screen falls back to).
  const effective =
    (selected && models?.find((m) => m.endpoint_id === selected.endpoint_id && m.model === selected.model)) ||
    models?.[0] ||
    null;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
        <Pressable
          hitSlop={12}
          onPress={() => router.back()}
          style={({ pressed }) => pressed && { opacity: 0.6 }}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Text style={styles.close}>Done</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.section}>Connected server</Text>
        <View style={styles.card}>
          {editAddr ? (
            <View style={styles.editAddr}>
              <Text style={styles.editLabel}>Server IP / host</Text>
              <TextInput
                style={styles.input}
                value={hostIn}
                onChangeText={setHostIn}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="numbers-and-punctuation"
                placeholder="192.168.1.21"
                placeholderTextColor={theme.color.textFaint}
                accessibilityLabel="Server IP or host"
              />
              <Text style={styles.editLabel}>Port</Text>
              <TextInput
                style={styles.input}
                value={portIn}
                onChangeText={setPortIn}
                keyboardType="number-pad"
                placeholder="7860"
                placeholderTextColor={theme.color.textFaint}
                accessibilityLabel="Server port"
              />
              <View style={styles.editBtns}>
                <Pressable
                  style={({ pressed }) => [styles.editCancel, pressed && { opacity: 0.6 }]}
                  onPress={() => setEditAddr(false)}
                  accessibilityRole="button"
                >
                  <Text style={styles.editCancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.editSave, pressed && { opacity: 0.8 }]}
                  onPress={saveAddr}
                  disabled={savingAddr}
                  accessibilityRole="button"
                >
                  {savingAddr ? (
                    <ActivityIndicator color={theme.color.onAccent} />
                  ) : (
                    <Text style={styles.editSaveText}>Save &amp; reconnect</Text>
                  )}
                </Pressable>
              </View>
            </View>
          ) : (
            <>
              <Row label="Host" value={pairing ? `${pairing.host}:${pairing.port}` : '—'} />
              <Row
                label="Server"
                value={info ? `${info.name} ${info.version}` : tokenRejected ? 'Token rejected' : '…'}
              />
              <Row label="Paired as" value={info?.owner ?? '—'} last />
            </>
          )}
        </View>

        {!editAddr && (
          <Pressable
            onPress={startEditAddr}
            style={({ pressed }) => pressed && { opacity: 0.6 }}
            accessibilityRole="button"
          >
            <Text style={styles.changeAddr}>Change server address (IP changed?)</Text>
          </Pressable>
        )}

        {tokenRejected && (
          <Text style={styles.warn}>
            This server rejected the pairing token. Unpair and scan a fresh code to reconnect.
          </Text>
        )}

        <Text style={styles.section}>Model</Text>
        <View style={styles.card}>
          {modelsError ? (
            <Text style={styles.modelError}>{modelsError}</Text>
          ) : models === null ? (
            <View style={styles.modelLoading}>
              <ActivityIndicator color={theme.color.accent} />
            </View>
          ) : models.length === 0 ? (
            <Text style={styles.modelError}>No models available on this server.</Text>
          ) : (
            models.map((m, i) => {
              const on = effective?.endpoint_id === m.endpoint_id && effective?.model === m.model;
              return (
                <Pressable
                  key={`${m.endpoint_id}:${m.model}`}
                  style={({ pressed }) => [
                    styles.modelRow,
                    i === models.length - 1 && styles.rowLast,
                    pressed && { opacity: 0.7 },
                  ]}
                  onPress={() => pickModel(m)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[styles.modelLabel, on && styles.modelLabelOn]} numberOfLines={1}>
                    {m.label}
                  </Text>
                  {on && <Text style={styles.check}>✓</Text>}
                </Pressable>
              );
            })
          )}
        </View>
        <Text style={styles.hint}>The selected model is used for new chats.</Text>

        <Text style={styles.section}>Notifications</Text>
        <View style={styles.card}>
          <Pressable
            style={({ pressed }) => [
              styles.modelRow,
              styles.rowLast,
              pressed && !testingPush && { opacity: 0.7 },
            ]}
            onPress={testPush}
            disabled={testingPush}
            accessibilityRole="button"
          >
            <Text style={[styles.modelLabel, styles.modelLabelOn]}>Send a test notification</Text>
            {testingPush ? <ActivityIndicator color={theme.color.accent} /> : <Text style={styles.check}>→</Text>}
          </Pressable>
        </View>
        <Text style={styles.hint}>
          Get a push when research finishes or a new memory, note, or document is saved.
        </Text>

        <Pressable
          style={({ pressed }) => [styles.danger, pressed && { opacity: 0.85 }]}
          onPress={confirmUnpair}
          accessibilityRole="button"
        >
          <Text style={styles.dangerText}>Unpair</Text>
        </Pressable>

        <Text style={styles.section}>App</Text>
        <View style={styles.card}>
          <Row label="Version" value={`v${APP_VERSION}`} />
          <Row label="Build" value={BUILD_NUMBER} last />
        </View>

        <Text style={styles.footnote}>
          Odysseus Mobile talks to your self-hosted server over your local network. Nothing leaves
          your network, and the pairing token is stored only on this device.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.space(5),
    paddingVertical: theme.space(3.5),
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
    // Mirror ScreenHeader: a consistent 16px gap below the divider so the first
    // section never butts the rule, identical to every other screen.
    marginBottom: theme.space(4),
  },
  title: { color: theme.color.text, fontSize: theme.font.title, fontWeight: '700' },
  close: { color: theme.color.accent, fontSize: theme.font.body, fontWeight: '600' },
  // No paddingTop: the header already owns the 16px gap below its divider.
  body: { paddingHorizontal: theme.space(5), paddingBottom: theme.space(5), gap: theme.space(3.5) },
  section: { color: theme.color.textFaint, fontSize: theme.font.small, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  card: { backgroundColor: theme.color.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: theme.space(4), paddingVertical: theme.space(3.5), borderBottomWidth: 1, borderBottomColor: theme.color.border, gap: theme.space(3) },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: { color: theme.color.textDim, fontSize: theme.font.body },
  rowValue: { color: theme.color.text, fontSize: theme.font.body, flexShrink: 1, textAlign: 'right' },

  warn: { color: theme.color.danger, fontSize: theme.font.small, lineHeight: 19, marginTop: theme.space(1.5) },

  changeAddr: { color: theme.color.accent, fontSize: theme.font.small, fontWeight: '600', marginTop: theme.space(1.5) },
  editAddr: { padding: theme.space(4), gap: theme.space(2) },
  editLabel: { color: theme.color.textFaint, fontSize: theme.font.small, fontWeight: '600' },
  input: {
    backgroundColor: theme.color.bg,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.space(3),
    paddingVertical: theme.space(2.5),
    color: theme.color.text,
    fontSize: theme.font.body,
  },
  editBtns: { flexDirection: 'row', gap: theme.space(2.5), marginTop: theme.space(1.5) },
  editCancel: {
    flex: 1,
    paddingVertical: theme.space(3),
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    alignItems: 'center',
  },
  editCancelText: { color: theme.color.textDim, fontSize: theme.font.body, fontWeight: '600' },
  editSave: {
    flex: 1,
    paddingVertical: theme.space(3),
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.accent,
    alignItems: 'center',
  },
  editSaveText: { color: theme.color.onAccent, fontSize: theme.font.body, fontWeight: '700' },

  modelLoading: { padding: theme.space(4.5), alignItems: 'center' },
  modelError: { color: theme.color.textDim, fontSize: theme.font.small, padding: theme.space(4) },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.space(4),
    paddingVertical: theme.space(3.5),
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
    gap: theme.space(3),
  },
  modelLabel: { color: theme.color.textDim, fontSize: theme.font.body, flexShrink: 1 },
  modelLabelOn: { color: theme.color.text, fontWeight: '600' },
  check: { color: theme.color.accent, fontSize: theme.font.body, fontWeight: '800' },
  hint: { color: theme.color.textFaint, fontSize: theme.font.small, marginTop: theme.space(1.5) },

  danger: { backgroundColor: theme.color.dangerSurface, borderRadius: theme.radius.md, paddingVertical: theme.space(3.5), alignItems: 'center', marginTop: theme.space(1.5) },
  dangerText: { color: theme.color.danger, fontWeight: '700', fontSize: theme.font.body },
  footnote: { color: theme.color.textFaint, fontSize: theme.font.small, lineHeight: 19, marginTop: theme.space(2) },
});
