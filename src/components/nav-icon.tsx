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
  | 'documents'
  | 'gallery'
  | 'tasks'
  | 'calendar'
  | 'email'
  | 'memory'
  | 'assistant'
  | 'research'
  | 'search'
  | 'compare'
  | 'presets'
  | 'settings';

const PATHS: Record<NavIconName, string> = {
  chat: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  sessions: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  notes: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5',
  documents: 'M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9zM13 3v6h6M9 13h6M9 17h6',
  // A framed picture: rounded rect, a sun (small circle), and a "mountain"
  // diagonal rising to the frame edge.
  gallery:
    'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM9 9a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM3 17l5-5 4 4 3-3 6 6',
  tasks: 'M9 11l3 3 9-9M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  // A month grid: rounded frame, top binding posts, header rule, and day dots.
  calendar:
    'M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM8 2v4M16 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01',
  // An envelope: rounded rect body + the two diagonal flap lines meeting at center.
  email: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM3 7l9 6 9-6',
  memory:
    'M5 5h14v14H5zM9 9h6v6H9zM9 2v3M15 2v3M9 19v3M15 19v3M19 9h3M19 14h3M2 9h3M2 14h3',
  // A friendly robot: an antenna stalk + bulb above a rounded-square head with
  // two dot eyes.
  assistant:
    'M12 3v3M12 2.2a.8.8 0 1 0 0 .01M7 7h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM9.5 13h.01M14.5 13h.01',
  research: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  search: 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-6-6',
  // Two panels side by side (a split rectangle) — the compare layout in glyph form.
  compare: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM12 5v14',
  presets: 'M4 6h10M18 6h2M4 12h2M10 12h10M4 18h12M20 18h0M16 4v4M8 10v4M14 16v4',
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
