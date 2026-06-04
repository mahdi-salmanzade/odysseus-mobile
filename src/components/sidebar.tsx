/**
 * Slide-in navigation drawer. Rendered once in the root layout as an absolute
 * overlay above the Stack, so it covers every screen. Custom-built on Reanimated 4
 * (no @react-navigation/drawer): a backdrop fades in and a panel translates in from
 * the left. Tap the backdrop or swipe the panel left to dismiss. The panel stays
 * mounted through its exit animation, and all motion honors the OS reduce-motion
 * setting via ReduceMotion.System.
 */
import { router, usePathname, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import Animated, {
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NavIcon, type NavIconName } from '@/components/nav-icon';
import { OdysseusLogo } from '@/components/odysseus-logo';
import { theme } from '@/constants/theme';
import { usePairing } from '@/lib/pairing-context';
import { useSidebar } from '@/lib/sidebar-context';

const PANEL_WIDTH = 288;
const OPEN_MS = 240;
const CLOSE_MS = 200;

type NavItem = { icon: NavIconName; label: string; href: Href };

const NAV_ITEMS: NavItem[] = [
  { icon: 'chat', label: 'New Chat', href: '/' },
  { icon: 'sessions', label: 'Sessions', href: '/sessions' },
  { icon: 'notes', label: 'Notes', href: '/notes' },
  { icon: 'documents', label: 'Documents', href: '/documents' },
  { icon: 'gallery', label: 'Gallery', href: '/gallery' },
  { icon: 'tasks', label: 'Tasks', href: '/tasks' },
  { icon: 'calendar', label: 'Calendar', href: '/calendar' },
  { icon: 'email', label: 'Email', href: '/email' },
  { icon: 'presets', label: 'Presets', href: '/presets' },
  { icon: 'memory', label: 'Memory', href: '/memory' },
  { icon: 'assistant', label: 'Assistant', href: '/assistant' },
  { icon: 'skills', label: 'Skills', href: '/skills' },
  { icon: 'research', label: 'Research', href: '/research' },
  { icon: 'search', label: 'Search', href: '/search' },
  { icon: 'compare', label: 'Compare', href: '/compare' },
  { icon: 'admin', label: 'Admin', href: '/admin' },
  { icon: 'settings', label: 'Settings', href: '/settings' },
];

export function Sidebar() {
  const { open, closeSidebar } = useSidebar();
  const { pairing, unpair } = usePairing();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  // Keep the panel mounted while it animates out, so the close slide is visible.
  const [mounted, setMounted] = useState(open);
  // -PANEL_WIDTH = fully hidden off-screen left; 0 = fully open.
  const translateX = useSharedValue(-PANEL_WIDTH);

  useEffect(() => {
    if (open) {
      // Mount immediately on open; the close path unmounts from the animation's
      // completion callback (runOnJS below). This is the drawer's mount lifecycle,
      // not derivable state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMounted(true);
      translateX.value = withTiming(0, { duration: OPEN_MS, reduceMotion: ReduceMotion.System });
    } else if (mounted) {
      translateX.value = withTiming(
        -PANEL_WIDTH,
        { duration: CLOSE_MS, reduceMotion: ReduceMotion.System },
        (finished) => {
          if (finished) runOnJS(setMounted)(false);
        },
      );
    }
  }, [open, mounted, translateX]);

  // While the drawer is open, the Android hardware-back button should close it
  // rather than navigating the underlying Stack (or exiting the app).
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeSidebar();
      return true;
    });
    return () => sub.remove();
  }, [open, closeSidebar]);

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    // Fade the dim layer in lock-step with the panel's travel.
    opacity: (translateX.value + PANEL_WIDTH) / PANEL_WIDTH,
  }));

  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .onUpdate((e) => {
      // Only allow dragging the panel further left (toward closed). Writing a
      // Reanimated shared value here is intentional; the compiler's immutability
      // rule doesn't model shared values.
      // eslint-disable-next-line react-hooks/immutability
      translateX.value = Math.min(0, Math.max(-PANEL_WIDTH, e.translationX));
    })
    .onEnd((e) => {
      const shouldClose = e.translationX < -PANEL_WIDTH / 3 || e.velocityX < -500;
      if (shouldClose) {
        // Let the open->false effect drive the exit slide + unmount.
        runOnJS(closeSidebar)();
      } else {
        // eslint-disable-next-line react-hooks/immutability
        translateX.value = withTiming(0, { duration: CLOSE_MS, reduceMotion: ReduceMotion.System });
      }
    });

  if (!mounted) return null;

  const go = (href: Href) => {
    closeSidebar();
    // navigate (not push) so tapping a destination — including the one you're
    // already on — adopts that screen instead of stacking another instance.
    router.navigate(href);
  };

  const onUnpair = async () => {
    // The Stack.Protected guard routes to /pair once `pairing` clears.
    closeSidebar();
    await unpair();
  };

  return (
    <View style={[StyleSheet.absoluteFill, styles.root]} accessibilityViewIsModal>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={closeSidebar}
        accessibilityRole="button"
        accessibilityLabel="Close menu"
      >
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]} />
      </Pressable>

      <GestureDetector gesture={pan}>
        <Animated.View
          style={[
            styles.panel,
            { width: Math.min(PANEL_WIDTH, width * 0.86), paddingTop: insets.top + theme.space(4) },
            panelStyle,
          ]}
        >
          <View style={styles.brandRow}>
            <OdysseusLogo size={24} />
            <Text style={styles.brand}>Odysseus</Text>
          </View>

          {/* Scrolls independently of the pinned footer — the item list now
              exceeds a phone's height, so without this it overlapped Unpair. */}
          <ScrollView
            style={styles.nav}
            contentContainerStyle={styles.navContent}
            showsVerticalScrollIndicator={false}
          >
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.href;
              return (
                <Pressable
                  key={String(item.href)}
                  style={({ pressed }) => [
                    styles.navItem,
                    active && styles.navItemActive,
                    pressed && styles.navItemPressed,
                  ]}
                  onPress={() => go(item.href)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <NavIcon
                    name={item.icon}
                    color={active ? theme.color.accent : theme.color.textFaint}
                  />
                  <Text style={[styles.navLabel, active && styles.navLabelActive]}>
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={[styles.footer, { paddingBottom: insets.bottom + theme.space(4) }]}>
            <Text style={styles.footerLabel}>Paired with</Text>
            <Text style={styles.footerHost} numberOfLines={1}>
              {pairing ? `${pairing.host}:${pairing.port}` : '—'}
            </Text>
            <Pressable
              style={({ pressed }) => [styles.unpairBtn, pressed && styles.unpairPressed]}
              onPress={onUnpair}
              accessibilityRole="button"
            >
              <Text style={styles.unpairText}>Unpair</Text>
            </Pressable>
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { zIndex: 100, elevation: 100 },
  backdrop: { backgroundColor: theme.color.scrim },
  panel: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    backgroundColor: theme.color.surface,
    borderRightWidth: 1,
    borderRightColor: theme.color.border,
    paddingHorizontal: theme.space(4),
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(2),
    marginBottom: theme.space(6),
    paddingHorizontal: theme.space(2),
  },
  brand: {
    color: theme.color.accent,
    fontSize: theme.font.title,
    fontWeight: '700',
  },
  // The ScrollView fills the space between the brand row and the pinned footer;
  // its items live in navContent so the gap applies to the scrolled content.
  nav: { flex: 1 },
  navContent: { gap: theme.space(1), paddingBottom: theme.space(2) },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(3),
    paddingVertical: theme.space(3),
    paddingHorizontal: theme.space(3),
    borderRadius: theme.radius.md,
  },
  navItemActive: { backgroundColor: theme.color.surfaceAlt },
  navItemPressed: { backgroundColor: theme.color.surfaceAlt },
  navLabel: { color: theme.color.textDim, fontSize: theme.font.body, fontWeight: '500' },
  navLabelActive: { color: theme.color.text, fontWeight: '600' },
  footer: {
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
    paddingTop: theme.space(4),
    gap: theme.space(1),
  },
  footerLabel: {
    color: theme.color.textFaint,
    fontSize: theme.font.small,
    paddingHorizontal: theme.space(2),
  },
  footerHost: {
    color: theme.color.textDim,
    fontSize: theme.font.body,
    fontWeight: '600',
    paddingHorizontal: theme.space(2),
    marginBottom: theme.space(2),
  },
  unpairBtn: {
    paddingVertical: theme.space(3),
    paddingHorizontal: theme.space(2),
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    alignItems: 'center',
  },
  unpairPressed: { backgroundColor: theme.color.surfaceAlt },
  unpairText: { color: theme.color.danger, fontSize: theme.font.body, fontWeight: '600' },
});
