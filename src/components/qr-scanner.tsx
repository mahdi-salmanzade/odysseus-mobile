/**
 * Camera QR scanner for pairing. `onBarcodeScanned` fires continuously while a
 * code is in frame, so we latch on each read. Critically, the latch is NOT
 * permanent: it re-arms after a short cooldown (and immediately when the parent
 * un-pauses) so a single mis-scan of a non-Odysseus code can never wedge the
 * scanner dead for the session. The parent pauses us during verification via
 * `paused`, so a good scan won't re-fire before it navigates away.
 */
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useRef } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from '@/constants/theme';

const REARM_MS = 1500;

export function QrScanner({ onScan, paused = false }: { onScan: (data: string) => void; paused?: boolean }) {
  const [permission, requestPermission] = useCameraPermissions();
  const locked = useRef(false);
  const rearmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (rearmTimer.current) clearTimeout(rearmTimer.current);
    };
  }, []);

  // Re-arm the moment the parent un-pauses (e.g. after a failed verify) so the
  // user can immediately try again without leaving the screen.
  useEffect(() => {
    if (!paused) locked.current = false;
  }, [paused]);

  if (!permission) {
    return <View style={styles.fill} />;
  }

  if (!permission.granted) {
    // Once the OS won't show the prompt again (iOS, or Android "Don't ask
    // again"), requestPermission resolves silently and the button looks broken.
    // Send the user to system Settings instead.
    const canAsk = permission.canAskAgain;
    return (
      <View style={styles.center}>
        <Text style={styles.msg}>
          {canAsk
            ? 'Camera access is needed to scan the pairing QR code.'
            : 'Camera access is off. Enable it for Odysseus in Settings, then come back.'}
        </Text>
        <Pressable
          style={styles.btn}
          onPress={canAsk ? requestPermission : () => Linking.openSettings()}
        >
          <Text style={styles.btnText}>{canAsk ? 'Grant camera access' : 'Open Settings'}</Text>
        </Pressable>
      </View>
    );
  }

  const handleScan = ({ data }: { data: string }) => {
    if (paused || locked.current) return;
    locked.current = true;
    onScan(data);
    if (rearmTimer.current) clearTimeout(rearmTimer.current);
    rearmTimer.current = setTimeout(() => {
      locked.current = false;
    }, REARM_MS);
  };

  return (
    <View style={styles.fill}>
      <CameraView
        style={styles.fill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={paused ? undefined : handleScan}
      />
      <View pointerEvents="none" style={styles.reticleWrap}>
        <View style={styles.reticle} />
        <Text style={styles.hint}>Point at the QR on your Odysseus pairing page</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: theme.space(6), gap: theme.space(4) },
  msg: { color: theme.color.textDim, textAlign: 'center', fontSize: theme.font.body },
  btn: {
    backgroundColor: theme.color.accent,
    paddingHorizontal: theme.space(5),
    paddingVertical: theme.space(3),
    borderRadius: theme.radius.md,
    minHeight: 44,
    justifyContent: 'center',
  },
  btnText: { color: theme.color.onAccent, fontWeight: '600', fontSize: theme.font.body },
  reticleWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', gap: theme.space(5) },
  reticle: {
    width: 230,
    height: 230,
    borderColor: theme.color.accent,
    borderWidth: 3,
    borderRadius: theme.radius.lg,
  },
  hint: { color: theme.color.text, backgroundColor: theme.color.scrim, paddingHorizontal: theme.space(3), paddingVertical: theme.space(1.5), borderRadius: theme.radius.pill, fontSize: theme.font.small },
});
