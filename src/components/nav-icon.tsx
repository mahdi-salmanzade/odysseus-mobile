/**
 * One small, consistent line-icon family for the sidebar nav, drawn from
 * react-native-svg primitives (Feather-style: 24px grid, stroke, round caps).
 * Monochrome and currentColor-driven so the active route can tint with the
 * accent and the rest stay quiet. Replaces emoji, which render in inconsistent
 * platform styles and read as cartoonish against The Night Desk.
 */
import Svg, { Path } from 'react-native-svg';

import { theme } from '@/constants/theme';

export type NavIconName =
  | 'chat'
  | 'sessions'
  | 'notes'
  | 'tasks'
  | 'memory'
  | 'research'
  | 'settings';

const PATHS: Record<NavIconName, string> = {
  chat: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  sessions: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  notes: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5',
  tasks: 'M9 11l3 3 9-9M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  memory:
    'M5 5h14v14H5zM9 9h6v6H9zM9 2v3M15 2v3M9 19v3M15 19v3M19 9h3M19 14h3M2 9h3M2 14h3',
  research: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  settings: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
};

export function NavIcon({
  name,
  size = 19,
  color = theme.color.textDim,
}: {
  name: NavIconName;
  size?: number;
  color?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d={PATHS[name]}
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
