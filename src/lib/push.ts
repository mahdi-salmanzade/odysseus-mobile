/**
 * Mobile push: turn Odysseus lifecycle events into native notifications.
 *
 * The server (companion bridge) delivers owner-scoped events — research done,
 * a new memory/document, etc. — to Expo's push gateway, which wakes this phone.
 * Here we obtain the device's Expo push token, register it with the paired
 * server, and route a notification tap to the matching screen.
 *
 * Everything is best-effort: push is a nicety layered on top of the LAN app, so
 * a denied permission, a simulator without push support, or an offline server
 * must never block pairing or crash a screen — failures degrade to "no pushes".
 */
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { Platform } from 'react-native';

import { registerPushToken, unregisterPushToken } from '@/lib/api';
import type { Pairing } from '@/lib/pairing';

// Foreground presentation: still show a banner while the app is open. SDK 56
// uses shouldShowBanner/shouldShowList (the old shouldShowAlert was removed).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function projectId(): string | undefined {
  return (
    Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId
  );
}

/**
 * Obtain this device's Expo push token, prompting for permission if needed.
 * Returns null when push isn't available (simulator, denied permission, no
 * project id) — callers treat that as "push disabled", not an error.
 */
export async function getExpoPushToken(): Promise<string | null> {
  // Push tokens only exist on real hardware (or a push-capable simulator).
  if (!Device.isDevice) return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#e06c75',
    }).catch(() => {});
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (existing !== 'granted') {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== 'granted') return null;

  const pid = projectId();
  if (!pid) return null;

  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId: pid });
    return data || null;
  } catch {
    return null;
  }
}

/**
 * Register this device for push against the paired server. Returns true if a
 * token was obtained and accepted. Best-effort: never throws.
 */
export async function enablePushForPairing(p: Pairing): Promise<boolean> {
  try {
    const token = await getExpoPushToken();
    if (!token) return false;
    await registerPushToken(p, token);
    return true;
  } catch {
    return false;
  }
}

/**
 * Unregister this device from the paired server (e.g. just before unpairing).
 * Re-derives the same stable token rather than persisting it. Best-effort.
 */
export async function disablePushForPairing(p: Pairing): Promise<void> {
  try {
    if (!Device.isDevice) return;
    const pid = projectId();
    if (!pid) return;
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: pid });
    if (token) await unregisterPushToken(p, token);
  } catch {
    /* best-effort */
  }
}

// A notification's data carries the event name; route a tap to the screen that
// shows the thing that changed. Literal returns keep typed-routes happy.
function routeForEvent(event?: string) {
  switch (event) {
    case 'research.completed':
      return '/research' as const;
    case 'memory.added':
      return '/memory' as const;
    default:
      return '/' as const;
  }
}

/**
 * Route notification taps to the relevant screen. Call once from the root
 * layout; returns a cleanup that removes the listener.
 */
export function setupNotificationTapHandler(): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as { event?: string } | undefined;
    router.navigate(routeForEvent(data?.event));
  });
  return () => sub.remove();
}
