import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { EdgeSwipe } from '@/components/edge-swipe';
import { Sidebar } from '@/components/sidebar';
import { theme } from '@/constants/theme';
import { PairingProvider, usePairing } from '@/lib/pairing-context';
import { setupNotificationTapHandler } from '@/lib/push';
import { SidebarProvider } from '@/lib/sidebar-context';

function RootNavigator() {
  const { pairing, ready } = usePairing();

  // Route notification taps to the relevant screen, app-wide.
  useEffect(() => setupNotificationTapHandler(), []);

  // While the keychain read is in flight, paint our own background instead of
  // the pairing screen — so an already-paired user never flashes the pairing
  // UI on cold start. (There's no native splash to fall back on anymore.)
  if (!ready) return <View style={{ flex: 1, backgroundColor: theme.color.bg }} />;

  const paired = !!pairing;

  return (
    <>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.color.bg },
          animation: 'fade',
          // The app navigates via the drawer, not a push/pop stack, so the iOS
          // native back-swipe only ever popped you to chat by surprise — and it
          // hijacked the left-edge open-drawer swipe on every non-index screen.
          // Disable it app-wide; the drawer's EdgeSwipe owns the left edge now.
          gestureEnabled: false,
        }}
      >
        <Stack.Protected guard={paired}>
          <Stack.Screen name="index" />
          <Stack.Screen name="sessions" />
          <Stack.Screen name="notes" />
          <Stack.Screen name="documents" />
          <Stack.Screen name="gallery" />
          <Stack.Screen name="tasks" />
          <Stack.Screen name="calendar" />
          <Stack.Screen name="email" />
          <Stack.Screen name="memory" />
          <Stack.Screen name="assistant" />
          <Stack.Screen name="skills" />
          <Stack.Screen name="research" />
          <Stack.Screen name="search" />
          <Stack.Screen name="compare" />
          <Stack.Screen name="presets" />
          <Stack.Screen name="admin" />
          {/* Modal keeps its swipe-down-to-dismiss; re-enable the gesture the
              global default turns off. */}
          <Stack.Screen
            name="settings"
            options={{ presentation: 'modal', gestureEnabled: true }}
          />
        </Stack.Protected>

        <Stack.Protected guard={!paired}>
          <Stack.Screen name="pair" />
        </Stack.Protected>
      </Stack>

      {/* Left-edge open-drawer gesture for every paired screen (below Sidebar). */}
      {paired && <EdgeSwipe />}

      {/* Overlay above every paired screen; renders nothing while closed. */}
      {paired && <Sidebar />}
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PairingProvider>
          <SidebarProvider>
            <StatusBar style="light" />
            <RootNavigator />
          </SidebarProvider>
        </PairingProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
