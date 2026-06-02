import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Sidebar } from '@/components/sidebar';
import { theme } from '@/constants/theme';
import { PairingProvider, usePairing } from '@/lib/pairing-context';
import { SidebarProvider } from '@/lib/sidebar-context';

// Keep the native splash up until we've read the keychain, so an already-paired
// user never flashes the pairing screen (or a blank frame) on cold start.
SplashScreen.preventAutoHideAsync().catch(() => {});

function RootNavigator() {
  const { pairing, ready } = usePairing();

  // Hide the splash only once the keychain read resolves.
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  // Until then, paint the splash-colored background ourselves rather than
  // returning null — returning null would rely on the native splash still
  // covering the screen, which isn't guaranteed once the JS layout has mounted.
  if (!ready) return <View style={{ flex: 1, backgroundColor: theme.color.bg }} />;

  const paired = !!pairing;

  return (
    <>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.color.bg },
          animation: 'fade',
        }}
      >
        <Stack.Protected guard={paired}>
          <Stack.Screen name="index" />
          <Stack.Screen name="sessions" />
          <Stack.Screen name="notes" />
          <Stack.Screen name="tasks" />
          <Stack.Screen name="memory" />
          <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
        </Stack.Protected>

        <Stack.Protected guard={!paired}>
          <Stack.Screen name="pair" />
        </Stack.Protected>
      </Stack>

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
