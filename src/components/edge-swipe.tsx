/**
 * Invisible left-edge capture strip that opens the navigation drawer on a
 * rightward swipe — the same panel the hamburger opens. Rendered once in the
 * root layout (a sibling of <Sidebar/>) so every paired screen gets the gesture
 * identically, instead of each screen wiring its own. activeOffsetX gates on a
 * deliberate horizontal pull; failOffsetY yields to vertical scrolling so the
 * strip never steals a list scroll that starts near the edge.
 *
 * This replaces the native Stack back-swipe (disabled in _layout) as the app's
 * left-edge gesture: the app navigates via the drawer, not a push/pop stack, so
 * a back-swipe only ever popped you to the chat screen by surprise.
 */
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

import { theme } from '@/constants/theme';
import { useSidebar } from '@/lib/sidebar-context';

export function EdgeSwipe() {
  const { open, openSidebar } = useSidebar();

  const gesture = Gesture.Pan()
    .activeOffsetX(18)
    .failOffsetY([-16, 16])
    .onEnd((e) => {
      if (e.translationX > 56 || e.velocityX > 600) runOnJS(openSidebar)();
    });

  // While the drawer is open it owns the gestures (swipe-to-close); the strip
  // must not sit in front of its backdrop, so drop it entirely until closed.
  if (open) return null;

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.strip} />
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  // Thin transparent capture zone pinned to the left edge, above screen content
  // but below the drawer overlay (zIndex 100).
  strip: { position: 'absolute', left: 0, top: 0, bottom: 0, width: theme.space(5.5), zIndex: 20 },
});
