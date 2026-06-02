/**
 * The Odysseus mark, rendered from react-native-svg primitives so it works
 * without a metro svg transformer. Source: odysseus-mobile/odysseus.svg.
 * Defaults to the brand accent color so it always matches the wordmark.
 */
import Svg, { Path } from 'react-native-svg';
import { theme } from '../constants/theme';

type Props = { size?: number; color?: string };

export function OdysseusLogo({ size = 22, color = theme.color.accent }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 283.46 283.46">
      <Path d="M141.73,27.08v187.61H37.51L141.73,27.08Z" fill={color} />
      <Path
        d="M141.73,68.77v145.92h83.38l-83.38-145.92h0Z"
        fill={color}
        opacity={0.6}
      />
      <Path
        d="M16.66,230.11c41.69-27.79,83.38-27.79,125.07,0s83.38,27.79,125.07,0"
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeWidth={16}
      />
    </Svg>
  );
}
