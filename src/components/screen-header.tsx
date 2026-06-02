/**
 * One header for every screen: a hamburger that opens the sidebar, a centered
 * title, and an optional right action. Keeps the menu affordance, padding, and
 * the hairline divider identical across the app (DESIGN.md §5) — replacing the
 * per-screen hand-built headers that drifted into three different hamburgers,
 * three paddings, and a missing divider on four of seven screens.
 */
import { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MenuIcon } from '@/components/header-icons';
import { theme } from '@/constants/theme';

export function ScreenHeader({
  title,
  onMenu,
  right,
}: {
  title?: string;
  onMenu?: () => void;
  right?: ReactNode;
}) {
  return (
    <View style={styles.header}>
      {onMenu ? (
        <Pressable
          onPress={onMenu}
          hitSlop={11}
          style={styles.slot}
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
      {/* Equal-width right slot keeps the title optically centered. */}
      <View style={styles.slot}>{right}</View>
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
  },
  slot: { minWidth: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { color: theme.color.text, fontSize: theme.font.title, fontWeight: '700' },
});
