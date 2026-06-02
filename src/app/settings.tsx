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
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { theme } from '@/constants/theme';
import {
  ApiError,
  flattenModels,
  getInfo,
  listModels,
  type CompanionInfo,
  type ModelChoice,
} from '@/lib/api';
import { usePairing } from '@/lib/pairing-context';
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
  const { pairing, unpair } = usePairing();
  const [info, setInfo] = useState<CompanionInfo | null>(null);
  // The token was reachable but rejected (401) — distinct from a slow/offline
  // server, so we can tell the user to re-pair instead of just showing '…'.
  const [tokenRejected, setTokenRejected] = useState(false);

  const [models, setModels] = useState<ModelChoice[] | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ModelPref | null>(null);

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
        <Pressable hitSlop={12} onPress={() => router.back()}>
          <Text style={styles.close}>Done</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.section}>Connected server</Text>
        <View style={styles.card}>
          <Row label="Host" value={pairing ? `${pairing.host}:${pairing.port}` : '—'} />
          <Row label="Server" value={info ? `${info.name} ${info.version}` : tokenRejected ? 'Token rejected' : '…'} />
          <Row label="Paired as" value={info?.owner ?? '—'} last />
        </View>

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
                  style={[styles.modelRow, i === models.length - 1 && styles.rowLast]}
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

        <Pressable style={styles.danger} onPress={confirmUnpair}>
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
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  title: { color: theme.color.text, fontSize: theme.font.title, fontWeight: '700' },
  close: { color: theme.color.accent, fontSize: theme.font.body, fontWeight: '600' },
  body: { padding: 20, gap: 14 },
  section: { color: theme.color.textFaint, fontSize: theme.font.small, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  card: { backgroundColor: theme.color.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.color.border, gap: 12 },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: { color: theme.color.textDim, fontSize: theme.font.body },
  rowValue: { color: theme.color.text, fontSize: theme.font.body, flexShrink: 1, textAlign: 'right' },

  warn: { color: theme.color.danger, fontSize: theme.font.small, lineHeight: 19, marginTop: -4 },

  modelLoading: { padding: 18, alignItems: 'center' },
  modelError: { color: theme.color.textDim, fontSize: theme.font.small, padding: 16 },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
    gap: 12,
  },
  modelLabel: { color: theme.color.textDim, fontSize: theme.font.body, flexShrink: 1 },
  modelLabelOn: { color: theme.color.text, fontWeight: '600' },
  check: { color: theme.color.accent, fontSize: theme.font.body, fontWeight: '800' },
  hint: { color: theme.color.textFaint, fontSize: theme.font.small, marginTop: -6 },

  danger: { backgroundColor: theme.color.dangerSurface, borderRadius: theme.radius.md, paddingVertical: 14, alignItems: 'center', marginTop: 6 },
  dangerText: { color: theme.color.danger, fontWeight: '700', fontSize: theme.font.body },
  footnote: { color: theme.color.textFaint, fontSize: theme.font.small, lineHeight: 19, marginTop: 8 },
});
