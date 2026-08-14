import * as Application from 'expo-application';
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

import { useTranslation } from 'react-i18next';

import { theme, themeList, themePreviews as THEME_PREVIEW, applyThemeId } from '@/constants/theme';
import { reloadApp } from '@/lib/reload';
import { languages, currentLanguage, setLanguage } from '@/lib/i18n';
import {
  ApiError,
  flattenModels,
  getInfo,
  listModels,
  sendTestPush,
  type CompanionInfo,
  type ModelChoice,
} from '@/lib/api';
import { ScreenHeader } from '@/components/screen-header';
import { usePairing } from '@/lib/pairing-context';
import { enablePushForPairing } from '@/lib/push';
import { loadModelPref, saveModelPref, type ModelPref } from '@/lib/prefs';

// App version + native build number. Read these from the *running* binary via
// expo-application — Constants.expoConfig holds the manifest, and with EAS remote
// versioning the manifest carries no build number, so the old config lookup
// always rendered '—' on real builds. nativeBuildVersion is iOS CFBundleVersion /
// Android versionCode of the actual installed app; fall back to the embedded
// config (then '—') for environments where the native value is unavailable.
const APP_VERSION =
  Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '1.0.0';
const BUILD_NUMBER =
  Application.nativeBuildVersion ??
  Platform.select({
    ios: Constants.expoConfig?.ios?.buildNumber,
    android: Constants.expoConfig?.android?.versionCode?.toString(),
  }) ??
  '—';

export default function SettingsScreen() {
  const { pairing, unpair, setAddress } = usePairing();
  const { t } = useTranslation();
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
  const [applyingTheme, setApplyingTheme] = useState<string | null>(null);
  const activeLang = currentLanguage();

  function chooseLanguage(code: string) {
    if (code === activeLang) return;
    Haptics.selectionAsync().catch(() => {});
    // setLanguage reloads only if it flips text direction (LTR↔RTL); otherwise
    // it applies live and the screen re-renders via the i18n listener.
    setLanguage(code);
  }

  function chooseTheme(id: string) {
    if (id === theme.id || applyingTheme) return;
    // Applying swaps the live palette and reloads so every already-mounted
    // screen restyles; warn since it briefly blanks the app.
    Alert.alert(t('settings.applyTheme'), t('settings.applyThemePrompt'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.apply'),
        onPress: async () => {
          setApplyingTheme(id);
          Haptics.selectionAsync().catch(() => {});
          applyThemeId(id);
          await reloadApp();
        },
      },
    ]);
  }

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
    // Show the scheme when it isn't the default, so the field round-trips: an
    // https pairing that's edited back in stays https.
    setHostIn(pairing.tls ? `https://${pairing.host}` : pairing.host);
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
        Alert.alert(
          'Invalid address',
          'Enter a LAN IP/host (e.g. 192.168.1.21), or a full https:// address for a server behind a TLS proxy, plus a port from 1–65535.',
        );
        return;
      }
      Haptics.selectionAsync().catch(() => {});
      setEditAddr(false); // pairing changed → the info/models effects re-run and reconnect
    } finally {
      setSavingAddr(false);
    }
  }

  function confirmUnpair() {
    Alert.alert(t('settings.unpairTitle'), t('settings.unpairPrompt'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.unpair'),
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
      <ScreenHeader
        title={t('settings.title')}
        showSettings={false}
        right={
          <Pressable
            hitSlop={12}
            onPress={() => router.back()}
            style={({ pressed }) => [styles.doneSlot, pressed && { opacity: 0.6 }]}
            accessibilityRole="button"
            accessibilityLabel="Done"
          >
            <Text style={styles.close}>{t('common.done')}</Text>
          </Pressable>
        }
      />

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.group}>
          <Text style={styles.section}>{t('settings.connectedServer')}</Text>
          <View style={styles.card}>
            {editAddr ? (
              <View style={styles.editAddr}>
                <Text style={styles.editLabel}>{t('settings.serverIpHost')}</Text>
                <TextInput
                  style={styles.input}
                  value={hostIn}
                  onChangeText={setHostIn}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  placeholder="192.168.1.21 or https://box.tail1234.ts.net"
                  placeholderTextColor={theme.color.textFaint}
                  accessibilityLabel="Server IP or host"
                />
                <Text style={styles.editLabel}>{t('settings.port')}</Text>
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
                      <Text style={styles.editSaveText}>{t('settings.saveReconnect')}</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            ) : (
              <>
                <Row
                  labelKey="settings.host"
                  value={
                    pairing
                      ? `${pairing.tls ? 'https://' : ''}${pairing.host}:${pairing.port}`
                      : '—'
                  }
                />
                <Row
                  labelKey="settings.server"
                  value={info ? `${info.name} ${info.version}` : tokenRejected ? t('settings.tokenRejected') : '…'}
                />
                <Row labelKey="settings.pairedAs" value={info?.owner ?? '—'} last />
              </>
            )}
          </View>

          {!editAddr && (
            <Pressable
              onPress={startEditAddr}
              style={({ pressed }) => pressed && { opacity: 0.6 }}
              accessibilityRole="button"
            >
              <Text style={styles.changeAddr}>{t('settings.changeAddress')}</Text>
            </Pressable>
          )}

          {tokenRejected && (
            <Text style={styles.warn}>
              {t('settings.tokenRejectedHint')}
            </Text>
          )}
        </View>

        <View style={styles.group}>
          <Text style={styles.section}>{t('settings.model')}</Text>
          <View style={styles.card}>
            {modelsError ? (
              <Text style={styles.modelError}>{modelsError}</Text>
            ) : models === null ? (
              <View style={styles.modelLoading}>
                <ActivityIndicator color={theme.color.accent} />
              </View>
            ) : models.length === 0 ? (
              <Text style={styles.modelError}>{t('settings.noModels')}</Text>
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
          <Text style={styles.hint}>{t('settings.modelHint')}</Text>
        </View>

        <View style={styles.group}>
          <Text style={styles.section}>{t('settings.language')}</Text>
          <View style={styles.swatchWrap}>
            {languages.map((l) => {
              const on = l.code === activeLang;
              return (
                <Pressable
                  key={l.code}
                  style={({ pressed }) => [styles.swatch, on && styles.swatchOn, pressed && { opacity: 0.7 }]}
                  onPress={() => chooseLanguage(l.code)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={l.name}
                >
                  <Text style={[styles.swatchLabel, on && styles.swatchLabelOn]} numberOfLines={1}>
                    {l.name}
                  </Text>
                  {on && <Text style={styles.check}>✓</Text>}
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.hint}>{t('settings.languageHint')}</Text>
        </View>

        <View style={styles.group}>
          <Text style={styles.section}>{t('settings.appearance')}</Text>
          <View style={styles.swatchWrap}>
            {themeList.map((t) => {
              const on = t.id === theme.id;
              const busy = applyingTheme === t.id;
              return (
                <Pressable
                  key={t.id}
                  style={({ pressed }) => [styles.swatch, on && styles.swatchOn, pressed && { opacity: 0.7 }]}
                  onPress={() => chooseTheme(t.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${t.name} theme`}
                >
                  <View style={styles.swatchDots}>
                    <View style={[styles.swatchDot, { backgroundColor: THEME_PREVIEW[t.id]?.bg }]} />
                    <View style={[styles.swatchDot, { backgroundColor: THEME_PREVIEW[t.id]?.accent }]} />
                  </View>
                  <Text style={[styles.swatchLabel, on && styles.swatchLabelOn]} numberOfLines={1}>
                    {t.name}
                  </Text>
                  {busy && <ActivityIndicator size="small" color={theme.color.accent} />}
                  {on && !busy && <Text style={styles.check}>✓</Text>}
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.hint}>{t('settings.themeHint')}</Text>
        </View>

        <View style={styles.group}>
          <Text style={styles.section}>{t('settings.notifications')}</Text>
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
              <Text style={[styles.modelLabel, styles.modelLabelOn]}>{t('settings.sendTestNotification')}</Text>
              {testingPush ? <ActivityIndicator color={theme.color.accent} /> : <Text style={styles.check}>→</Text>}
            </Pressable>
          </View>
          <Text style={styles.hint}>
            {t('settings.notificationsHint')}
          </Text>
        </View>

        <Pressable
          style={({ pressed }) => [styles.danger, pressed && { opacity: 0.85 }]}
          onPress={confirmUnpair}
          accessibilityRole="button"
        >
          <Text style={styles.dangerText}>{t('settings.unpair')}</Text>
        </Pressable>

        <View style={styles.group}>
          <Text style={styles.section}>{t('settings.app')}</Text>
          <View style={styles.card}>
            <Row labelKey="settings.version" value={`v${APP_VERSION}`} />
            <Row labelKey="settings.build" value={BUILD_NUMBER} last />
          </View>
        </View>

        <Text style={styles.footnote}>
          {t('settings.footnote')}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ labelKey, value, last }: { labelKey: string; value: string; last?: boolean }) {
  const { t } = useTranslation();
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <Text style={styles.rowLabel}>{t(labelKey)}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.bg },
  // The "Done" control fills ScreenHeader's 36px-tall right slot so it stays
  // vertically centered and keeps a comfortable tap target.
  doneSlot: { height: 36, justifyContent: 'center' },
  close: { color: theme.color.accent, fontSize: theme.font.body, fontWeight: '600' },
  // No paddingTop: ScreenHeader already owns the 16px gap below its divider.
  // Gutter is space(4) so the section labels and card edges line up with the
  // "Settings" title above them. The 20px gap is between groups; within a group
  // (label → card → hint) the spacing is tight (see `group`), so each hint reads
  // as belonging to the card above it, not floating toward the next section.
  body: { paddingHorizontal: theme.space(4), paddingBottom: theme.space(5), gap: theme.space(5) },
  group: { gap: theme.space(2) },
  section: { color: theme.color.textFaint, fontSize: theme.font.small, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  card: { backgroundColor: theme.color.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: theme.space(4), paddingVertical: theme.space(3.5), borderBottomWidth: 1, borderBottomColor: theme.color.border, gap: theme.space(3) },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: { color: theme.color.textDim, fontSize: theme.font.body },
  rowValue: { color: theme.color.text, fontSize: theme.font.body, flexShrink: 1, textAlign: 'right' },

  warn: { color: theme.color.danger, fontSize: theme.font.small, lineHeight: 19 },

  changeAddr: { color: theme.color.accent, fontSize: theme.font.small, fontWeight: '600' },
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
  hint: { color: theme.color.textFaint, fontSize: theme.font.small },

  swatchWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space(2) },
  swatch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(2),
    paddingHorizontal: theme.space(3),
    paddingVertical: theme.space(2.5),
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.color.border,
    backgroundColor: theme.color.surface,
  },
  swatchOn: { borderColor: theme.color.accent },
  swatchDots: { flexDirection: 'row' },
  swatchDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1, borderColor: theme.color.border },
  swatchLabel: { color: theme.color.textDim, fontSize: theme.font.small },
  swatchLabelOn: { color: theme.color.text, fontWeight: '600' },

  danger: { backgroundColor: theme.color.dangerSurface, borderRadius: theme.radius.md, paddingVertical: theme.space(3.5), alignItems: 'center' },
  dangerText: { color: theme.color.danger, fontWeight: '700', fontSize: theme.font.body },
  footnote: { color: theme.color.textFaint, fontSize: theme.font.small, lineHeight: 19 },
});
