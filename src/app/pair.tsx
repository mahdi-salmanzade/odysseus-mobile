import * as Haptics from 'expo-haptics';
import { useState } from 'react';
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
import { SafeAreaView } from 'react-native-safe-area-context';

import { OdysseusLogo } from '@/components/odysseus-logo';
import { QrScanner } from '@/components/qr-scanner';
import { theme } from '@/constants/theme';
import { ApiError, ping } from '@/lib/api';
import { manualPairing, parsePairingPayload, type Pairing } from '@/lib/pairing';
import { usePairing } from '@/lib/pairing-context';

type Mode = 'scan' | 'manual';

const ODYSSEUS_REPO = 'https://github.com/pewdiepie-archdaemon/odysseus';

export default function PairScreen() {
  const { pair } = usePairing();
  const [showPairing, setShowPairing] = useState(false);
  const [mode, setMode] = useState<Mode>('scan');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [host, setHost] = useState('');
  const [port, setPort] = useState('7000');
  const [token, setToken] = useState('');

  // Clear any stale error when flipping tabs — a manual-entry failure shouldn't
  // linger over the scanner (and vice versa).
  function switchMode(next: Mode) {
    setError(null);
    setMode(next);
  }

  async function tryPair(candidate: Pairing | null) {
    if (busy) return;
    if (!candidate) {
      setError('That doesn’t look like a valid Odysseus pairing code.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await ping(candidate);
      // Reached the server but it didn't return ok — distinct from "couldn't
      // reach it at all", so give it its own message rather than the network one.
      if (!res?.ok) throw new ApiError('The server responded, but rejected the pairing.', 'bad_response');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await pair(candidate); // flips the gate → chat screen
    } catch (e: unknown) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const msg = e instanceof ApiError ? e.message : null;
      setError(msg ?? 'Could not reach that server. Check the host, port, and network.');
    } finally {
      setBusy(false);
    }
  }

  if (!showPairing) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.introScroll}>
          <View style={styles.titleRow}>
            <OdysseusLogo size={28} />
            <Text style={styles.title}>Set up Odysseus</Text>
          </View>
          <Text style={styles.subtitle}>
            This app is a LAN remote for{' '}
            <Text style={styles.bold}>Odysseus</Text>, the self-hosted AI workspace. Run
            the server on a machine at home, then pair your phone over the same Wi-Fi.
          </Text>

          <Step
            n={1}
            title="Clone & run the server"
            body={
              <>
                On your home machine, clone and start Odysseus from the official repo. Bind
                it to <Text style={styles.mono}>0.0.0.0</Text> so the phone can reach it on
                the LAN.
              </>
            }
          />
          <CodeBlock
            lines={[
              'git clone \\',
              '  github.com/pewdiepie-archdaemon/odysseus',
              'cd odysseus',
              'APP_BIND=0.0.0.0 ./run.sh',
            ]}
          />

          <Step
            n={2}
            title="Add the companion bridge"
            body={
              <>
                The mobile pairing endpoints live in{' '}
                <Text style={styles.mono}>companion/</Text>. Keep{' '}
                <Text style={styles.mono}>AUTH_ENABLED=true</Text> — the bridge is exposed
                on your local network.
              </>
            }
          />

          <Step
            n={3}
            title="Mint a pairing code"
            body={
              <>
                Run the helper to create a token and print a QR code in your terminal:
              </>
            }
          />
          <CodeBlock lines={['python scripts/pair_mobile.py']} />

          <Step
            n={4}
            title="Pair this phone"
            body={
              <>
                Make sure your phone is on the <Text style={styles.bold}>same Wi-Fi</Text>,
                then scan the QR or enter the host, port, and token by hand.
              </>
            }
          />

          <Pressable
            style={styles.linkRow}
            onPress={() => Linking.openURL(ODYSSEUS_REPO)}
            accessibilityRole="link"
          >
            <Text style={styles.linkText}>Open the Odysseus repo →</Text>
          </Pressable>
        </ScrollView>

        <View style={styles.footer}>
          <Pressable style={styles.primary} onPress={() => setShowPairing(true)}>
            <Text style={styles.primaryText}>Scan QR or enter manually</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Pressable
            hitSlop={12}
            onPress={() => setShowPairing(false)}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Text style={styles.back}>‹</Text>
          </Pressable>
          <OdysseusLogo size={28} />
          <Text style={styles.title}>Pair with Odysseus</Text>
        </View>
        <Text style={styles.subtitle}>
          Scan the QR from{' '}
          <Text style={styles.mono}>pair_mobile.py</Text>, or enter the details manually.
        </Text>
      </View>

      <View style={styles.tabs}>
        <Tab label="Scan QR" active={mode === 'scan'} onPress={() => switchMode('scan')} />
        <Tab label="Enter manually" active={mode === 'manual'} onPress={() => switchMode('manual')} />
      </View>

      {mode === 'scan' ? (
        <View style={styles.scanWrap}>
          {/* Keep the scanner mounted while verifying — `paused` stops it from
              re-firing. Unmounting it on a failed parse was what wedged the
              camera dead after a single bad scan. */}
          <QrScanner paused={busy} onScan={(d) => tryPair(parsePairingPayload(d))} />
          {busy && (
            <View style={[StyleSheet.absoluteFill, styles.scanBusy]}>
              <ActivityIndicator color={theme.color.accent} />
              <Text style={styles.dim}>Connecting…</Text>
            </View>
          )}
        </View>
      ) : (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
          <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
            <Field label="Host / IP" value={host} onChangeText={setHost} placeholder="192.168.1.50" autoCapitalize="none" keyboardType="numbers-and-punctuation" />
            <Field label="Port" value={port} onChangeText={setPort} placeholder="7000" keyboardType="number-pad" />
            <Field label="Token" value={token} onChangeText={setToken} placeholder="ody_…" autoCapitalize="none" secureTextEntry />
            <Pressable
              style={[styles.primary, busy && styles.primaryDisabled]}
              disabled={busy}
              onPress={() => tryPair(manualPairing(host, port, token))}
            >
              {busy ? <ActivityIndicator color={theme.color.onAccent} /> : <Text style={styles.primaryText}>Connect</Text>}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {error && (
        <View style={styles.errorBar}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: React.ReactNode }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepBadge}>
        <Text style={styles.stepBadgeText}>{n}</Text>
      </View>
      <View style={styles.stepBody}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={styles.stepText}>{body}</Text>
      </View>
    </View>
  );
}

function CodeBlock({ lines }: { lines: string[] }) {
  return (
    <View style={styles.codeBlock}>
      {lines.map((line, i) => (
        <Text key={i} style={styles.codeLine}>
          {line}
        </Text>
      ))}
    </View>
  );
}

function Tab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={[styles.tab, active && styles.tabActive]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) {
  const { label, ...rest } = props;
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput style={styles.input} placeholderTextColor={theme.color.textFaint} {...rest} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.bg },
  fill: { flex: 1 },
  header: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 16, gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { color: theme.color.accent, fontSize: 26, fontWeight: '700' },
  subtitle: { color: theme.color.textDim, fontSize: theme.font.body, lineHeight: 21 },
  bold: { color: theme.color.text, fontWeight: '700' },
  back: { color: theme.color.accent, fontSize: 30, fontWeight: '400', marginRight: 2, marginTop: -4 },
  mono: { color: theme.color.accent, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  introScroll: { padding: 24, gap: 18 },
  step: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  stepBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: theme.color.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  stepBadgeText: { color: theme.color.onAccent, fontWeight: '700', fontSize: theme.font.small },
  stepBody: { flex: 1, gap: 3 },
  stepTitle: { color: theme.color.text, fontSize: theme.font.body, fontWeight: '700' },
  stepText: { color: theme.color.textDim, fontSize: theme.font.small, lineHeight: 20 },
  codeBlock: {
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginLeft: 40,
    gap: 2,
  },
  codeLine: {
    color: theme.color.text,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: theme.font.mono,
    lineHeight: 19,
  },
  linkRow: { paddingVertical: 4 },
  linkText: { color: theme.color.accent, fontSize: theme.font.body, fontWeight: '600' },
  footer: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 12, borderTopWidth: 1, borderTopColor: theme.color.border },
  tabs: { flexDirection: 'row', marginHorizontal: 24, backgroundColor: theme.color.surface, borderRadius: theme.radius.md, padding: 4, gap: 4 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: theme.radius.sm, alignItems: 'center' },
  tabActive: { backgroundColor: theme.color.surfaceAlt },
  tabText: { color: theme.color.textFaint, fontWeight: '600', fontSize: theme.font.small },
  tabTextActive: { color: theme.color.text },
  scanWrap: { flex: 1, margin: 24, borderRadius: theme.radius.lg, overflow: 'hidden', backgroundColor: theme.color.bg },
  scanBusy: { justifyContent: 'center', alignItems: 'center', gap: 12, backgroundColor: theme.color.scrim },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  dim: { color: theme.color.textDim },
  form: { padding: 24, gap: 18 },
  fieldWrap: { gap: 6 },
  fieldLabel: { color: theme.color.textDim, fontSize: theme.font.small, fontWeight: '600' },
  input: {
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: theme.color.text,
    fontSize: theme.font.body,
  },
  primary: { backgroundColor: theme.color.accent, borderRadius: theme.radius.md, paddingVertical: 15, alignItems: 'center', marginTop: 6 },
  primaryDisabled: { opacity: 0.6 },
  primaryText: { color: theme.color.onAccent, fontWeight: '700', fontSize: theme.font.body },
  errorBar: { margin: 24, marginTop: 0, backgroundColor: theme.color.dangerSurface, borderRadius: theme.radius.md, padding: 14 },
  errorText: { color: theme.color.danger, fontSize: theme.font.small },
});
