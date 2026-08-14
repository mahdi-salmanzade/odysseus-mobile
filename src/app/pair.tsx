import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OdysseusLogo } from '@/components/odysseus-logo';
import { QrScanner } from '@/components/qr-scanner';
import { theme } from '@/constants/theme';
import { ApiError, ping } from '@/lib/api';
import { isLanHost, manualPairing, parsePairingPayload, type Pairing } from '@/lib/pairing';
import { usePairing } from '@/lib/pairing-context';

type Mode = 'scan' | 'manual';

const LAN_PORT = '7000';
const TLS_PORT = '443';

const ODYSSEUS_REPO = 'https://github.com/pewdiepie-archdaemon/odysseus';

export default function PairScreen() {
  const { pair } = usePairing();
  const [showPairing, setShowPairing] = useState(false);
  const [mode, setMode] = useState<Mode>('scan');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [host, setHost] = useState('');
  const [port, setPort] = useState(LAN_PORT);
  const [token, setToken] = useState('');
  const [tls, setTls] = useState(false);

  // Clear any stale error when flipping tabs — a manual-entry failure shouldn't
  // linger over the scanner (and vice versa).
  function switchMode(next: Mode) {
    setError(null);
    setMode(next);
  }

  // HTTPS servers are almost always fronted on 443 by the reverse proxy, plain
  // LAN ones on Odysseus's own 7000 — move the port with the toggle, but only
  // while it's still the untouched default so we never clobber a typed value.
  function toggleTls(next: boolean) {
    setTls(next);
    if (next && port.trim() === LAN_PORT) setPort(TLS_PORT);
    if (!next && port.trim() === TLS_PORT) setPort(LAN_PORT);
  }

  /** A code pointing off-LAN is legitimate (Tailscale, reverse proxy) but worth
   *  one look before the token starts flying to it, since a scanned QR is
   *  untrusted input and the host isn't one the user typed. */
  function confirmRemote(p: Pairing): Promise<boolean> {
    if (isLanHost(p.host)) return Promise.resolve(true);
    return new Promise((resolve) => {
      Alert.alert(
        'Connect to a remote server?',
        `This code points at ${p.host}:${p.port} over HTTPS — outside your local network. Continue only if that's your own Odysseus.`,
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Connect', onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    });
  }

  async function tryPair(candidate: Pairing | null) {
    if (busy) return;
    if (!candidate) {
      setError('That doesn’t look like a valid Odysseus pairing code.');
      return;
    }
    setError(null);
    // Go busy *before* the confirmation prompt: it pauses the scanner, so a QR
    // still in frame can't stack a second alert behind the first.
    setBusy(true);
    try {
      if (mode === 'scan' && !(await confirmRemote(candidate))) return;
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
            This app is a remote for <Text style={styles.bold}>Odysseus</Text>, the
            self-hosted AI workspace. Run the server on a machine at home, then pair your
            phone over the same Wi-Fi — or over HTTPS from anywhere.
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
                Upstream ships only part of <Text style={styles.mono}>/api/companion/*</Text>{' '}
                (ping, info, models, pair). The rest lives in the fork below — the app’s
                README says which branch to merge. Keep{' '}
                <Text style={styles.mono}>AUTH_ENABLED=true</Text>; the bridge is exposed on
                your network.
              </>
            }
          />
          <CodeBlock
            lines={[
              'git remote add companion \\',
              '  github.com/mahdi-salmanzade/odysseus',
              'git fetch companion',
            ]}
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
                then scan the QR or enter the host, port, and token by hand. Away from home,
                put Odysseus behind HTTPS (<Text style={styles.mono}>tailscale serve</Text>,
                Caddy) and turn on <Text style={styles.bold}>Use HTTPS</Text> when you pair.
              </>
            }
          />

          <Pressable
            style={({ pressed }) => [styles.linkRow, pressed && { opacity: 0.6 }]}
            onPress={() => Linking.openURL(ODYSSEUS_REPO)}
            accessibilityRole="link"
          >
            <Text style={styles.linkText}>Open the Odysseus repo →</Text>
          </Pressable>
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            style={({ pressed }) => [styles.primary, pressed && { opacity: 0.85 }]}
            onPress={() => setShowPairing(true)}
          >
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
            style={({ pressed }) => pressed && { opacity: 0.6 }}
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
            <Field
              testID="pair-host"
              label="Host / IP"
              value={host}
              onChangeText={setHost}
              placeholder={tls ? 'odysseus.tail1234.ts.net' : '192.168.1.50'}
              autoCapitalize="none"
              autoCorrect={false}
              // `url`, not `numbers-and-punctuation`: that keyboard has no letters,
              // so it can't type a hostname — and a hostname is what Tailscale and
              // mDNS users need (see the hint below).
              keyboardType="url"
            />
            <Field testID="pair-port" label="Port" value={port} onChangeText={setPort} placeholder={tls ? TLS_PORT : LAN_PORT} keyboardType="number-pad" />
            <View style={styles.switchRow}>
              <View style={styles.switchLabel}>
                <Text style={styles.fieldLabel}>Use HTTPS</Text>
                <Text style={styles.hint}>
                  For a server behind a TLS proxy (<Text style={styles.mono}>tailscale serve</Text>,
                  Caddy, nginx). Required to reach it from outside your Wi-Fi — iOS blocks
                  plain <Text style={styles.mono}>http://</Text> to anything but the local network.
                </Text>
              </View>
              <Switch
                testID="pair-tls"
                value={tls}
                onValueChange={toggleTls}
                trackColor={{ true: theme.color.accentDim, false: theme.color.surfaceAlt }}
                thumbColor={tls ? theme.color.accent : theme.color.textFaint}
                accessibilityLabel="Use HTTPS"
              />
            </View>
            <Field testID="pair-token" label="Token" value={token} onChangeText={setToken} placeholder="ody_…" autoCapitalize="none" secureTextEntry />
            {!tls && (
              <Text style={styles.hint}>
                On Tailscale, type the machine name (<Text style={styles.mono}>my-mac</Text>) rather
                than its <Text style={styles.mono}>100.x.y.z</Text> address — iOS refuses cleartext
                to that range even though the name resolves to it.
              </Text>
            )}
            <Pressable
              testID="pair-connect"
              style={({ pressed }) => [
                styles.primary,
                busy && styles.primaryDisabled,
                pressed && !busy && { opacity: 0.85 },
              ]}
              disabled={busy}
              onPress={() => tryPair(manualPairing(host, port, token, tls))}
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
      style={({ pressed }) => [styles.tab, active && styles.tabActive, pressed && { opacity: 0.6 }]}
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
      <TextInput
        keyboardAppearance="dark"
        style={styles.input}
        placeholderTextColor={theme.color.textFaint}
        accessibilityLabel={label}
        {...rest}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.bg },
  fill: { flex: 1 },
  header: { paddingHorizontal: theme.space(6), paddingTop: theme.space(3), paddingBottom: theme.space(4), gap: theme.space(2) },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space(2.5) },
  title: { color: theme.color.accent, fontSize: 26, fontWeight: '700' },
  subtitle: { color: theme.color.textDim, fontSize: theme.font.body, lineHeight: 21 },
  bold: { color: theme.color.text, fontWeight: '700' },
  back: { color: theme.color.accent, fontSize: 30, fontWeight: '400', marginRight: 2, marginTop: -4 },
  mono: { color: theme.color.accent, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  introScroll: { padding: theme.space(6), gap: theme.space(4.5) },
  step: { flexDirection: 'row', gap: theme.space(3.5), alignItems: 'flex-start' },
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
    paddingHorizontal: theme.space(3.5),
    paddingVertical: theme.space(3),
    marginLeft: theme.space(10),
    gap: theme.space(0.5),
  },
  codeLine: {
    color: theme.color.text,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: theme.font.mono,
    lineHeight: 19,
  },
  linkRow: { paddingVertical: theme.space(2.5), minHeight: 44, justifyContent: 'center' },
  linkText: { color: theme.color.accent, fontSize: theme.font.body, fontWeight: '600' },
  footer: { paddingHorizontal: theme.space(6), paddingTop: theme.space(3), paddingBottom: theme.space(3), borderTopWidth: 1, borderTopColor: theme.color.border },
  tabs: { flexDirection: 'row', marginHorizontal: theme.space(6), backgroundColor: theme.color.surface, borderRadius: theme.radius.md, padding: theme.space(1), gap: theme.space(1) },
  tab: { flex: 1, paddingVertical: theme.space(2.5), borderRadius: theme.radius.sm, alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  tabActive: { backgroundColor: theme.color.surfaceAlt },
  tabText: { color: theme.color.textFaint, fontWeight: '600', fontSize: theme.font.small },
  tabTextActive: { color: theme.color.text },
  scanWrap: { flex: 1, margin: theme.space(6), borderRadius: theme.radius.lg, overflow: 'hidden', backgroundColor: theme.color.bg },
  scanBusy: { justifyContent: 'center', alignItems: 'center', gap: theme.space(3), backgroundColor: theme.color.scrim },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: theme.space(3) },
  dim: { color: theme.color.textDim },
  form: { padding: theme.space(6), gap: theme.space(4.5) },
  fieldWrap: { gap: theme.space(1.5) },
  fieldLabel: { color: theme.color.textDim, fontSize: theme.font.small, fontWeight: '600' },
  switchRow: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space(3.5) },
  switchLabel: { flex: 1, gap: theme.space(1.5) },
  hint: { color: theme.color.textFaint, fontSize: theme.font.small, lineHeight: 19 },
  input: {
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space(3.5),
    paddingVertical: theme.space(3),
    color: theme.color.text,
    fontSize: theme.font.body,
  },
  primary: { backgroundColor: theme.color.accent, borderRadius: theme.radius.md, paddingVertical: 15, alignItems: 'center', marginTop: theme.space(1.5) },
  primaryDisabled: { opacity: 0.6 },
  primaryText: { color: theme.color.onAccent, fontWeight: '700', fontSize: theme.font.body },
  errorBar: { margin: theme.space(6), marginTop: 0, backgroundColor: theme.color.dangerSurface, borderRadius: theme.radius.md, padding: theme.space(3.5) },
  errorText: { color: theme.color.danger, fontSize: theme.font.small },
});
