/**
 * Loading placeholders shown while a screen's data loads — a calmer, more
 * informative wait than a bare centered spinner (product UIs use skeletons, not
 * mid-content spinners). A faint surface-tinted block pulses between two
 * opacities; the pulse flattens to a static tint under reduce-motion.
 */
import { useEffect } from 'react';
import {
  StyleSheet,
  useWindowDimensions,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { theme } from '@/constants/theme';

/** A single pulsing bar/block. */
export function Skeleton({
  width = '100%',
  height = 12,
  radius = theme.radius.sm,
  style,
}: {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const pulse = useSharedValue(0.45);
  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(0.85, { duration: 850, easing: Easing.inOut(Easing.quad), reduceMotion: ReduceMotion.System }),
      -1,
      true,
    );
  }, [pulse]);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return (
    <Animated.View
      style={[{ width, height, borderRadius: radius, backgroundColor: theme.color.surfaceAlt }, animatedStyle, style]}
    />
  );
}

/** A card-shaped placeholder that mirrors the real list cards (surface fill,
 * hairline border, a title bar plus a couple of content lines). */
export function SkeletonCard() {
  return (
    <View style={styles.card}>
      <Skeleton width="55%" height={14} />
      <Skeleton width="92%" height={12} />
      <Skeleton width="38%" height={12} />
    </View>
  );
}

/** A short stack of card placeholders, used in place of an initial-load spinner. */
export function SkeletonList({ count = 6 }: { count?: number }) {
  return (
    <View style={styles.list}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </View>
  );
}

/** Square placeholders laid out edge-to-edge, matching the image gallery's grid. */
export function SkeletonGrid({ columns = 3, gap = 2, rows = 4 }: { columns?: number; gap?: number; rows?: number }) {
  const { width } = useWindowDimensions();
  const size = Math.floor((width - gap * (columns - 1)) / columns);
  return (
    <View style={[styles.grid, { gap }]}>
      {Array.from({ length: columns * rows }).map((_, i) => (
        <Skeleton key={i} width={size} height={size} radius={0} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: theme.space(5), gap: theme.space(3) },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space(4),
    gap: theme.space(2.5),
  },
});
