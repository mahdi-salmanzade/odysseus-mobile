/**
 * One header for every screen: a hamburger that opens the sidebar, a centered
 * title, and an optional right action. Keeps the menu affordance, padding, and
 * the hairline divider identical across the app (DESIGN.md §5) — replacing the
 * per-screen hand-built headers that drifted into three different hamburgers,
 * three paddings, and a missing divider on four of seven screens.
 *
 * A settings gear lives in the top-right of every screen by default, so the
 * companion is one tap from Settings no matter where you are (matching the chat
 * screen's own gear). Pass `showSettings={false}` for drill-down/modal headers
 * where the hamburger is repurposed as a back/close button.
 */
import { router } from 'expo-router';
import { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MenuIcon, SettingsIcon } from '@/components/header-icons';
import { theme } from '@/constants/theme';

export function ScreenHeader({
  title,
  onMenu,
  right,
  showSettings = true,
}: {
  title?: string;
  onMenu?: () => void;
  right?: ReactNode;
  showSettings?: boolean;
}) {
  return (
    <View style={styles.header}>
      {onMenu ? (
        <Pressable
          onPress={onMenu}
          hitSlop={11}
          style={({ pressed }) => [styles.slot, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
          accessibilityLabel="Open menu"
        >
          <MenuIcon />
        </Pressable>
      ) : (
        <View style={styles.slot} />
      )}
      {title ? (
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
      ) : null}
      {/* Right cluster: a screen's own action (if any) followed by the shared
          settings gear. When only the gear is present it's 36px wide, matching
          the left slot so the title stays optically centered. */}
      <View style={styles.right}>
        {right}
        {showSettings ? (
          <Pressable
            onPress={() => router.push('/settings')}
            hitSlop={11}
            style={({ pressed }) => [styles.slot, pressed && { opacity: 0.6 }]}
            accessibilityRole="button"
            accessibilityLabel="Open settings"
          >
            <SettingsIcon size={20} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.space(4),
    paddingVertical: theme.space(3),
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
    // A consistent gap below the divider so content never butts the nav. Owned
    // here (not per-screen) so every screen breathes identically — the missing
    // version of this is what left the memory search bar flush against the rule.
    marginBottom: theme.space(4),
  },
  slot: { minWidth: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  right: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: theme.space(1) },
  title: { color: theme.color.text, fontSize: theme.font.title, fontWeight: '700' },
});
