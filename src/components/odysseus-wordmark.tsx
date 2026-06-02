/**
 * The "Odysseus" wordmark with the desktop hero's left-to-right accent→light
 * gradient. Drawn as react-native-svg text so the gradient fill works without a
 * masked-view dependency. Pair it with <OdysseusLogo/> for the empty-state hero.
 */
import Svg, { Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';

import { theme } from '@/constants/theme';

export function OdysseusWordmark({ size = 40 }: { size?: number }) {
  // Box wide enough to hold "Odysseus" at bold weight, tall enough for the
  // 'y' descender below the baseline.
  const w = size * 5.4;
  const h = size * 1.3;
  return (
    <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <Defs>
        <LinearGradient id="odyWordmark" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={theme.color.accent} />
          <Stop offset="1" stopColor={theme.color.text} />
        </LinearGradient>
      </Defs>
      <SvgText x="0" y={size} fontSize={size} fontWeight="700" fill="url(#odyWordmark)">
        Odysseus
      </SvgText>
    </Svg>
  );
}
