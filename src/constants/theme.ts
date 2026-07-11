/**
 * Design tokens for the app. Colors are themeable: several named palettes share
 * one shape, and the active one is applied to the live `theme` object at module
 * load (synchronously, from device-prefs) so every `import { theme }` site — and
 * every module-level `StyleSheet.create` — sees the chosen palette on first
 * render. Switching themes at runtime mutates this same object in place and then
 * reloads the app (see `applyThemeId` / `theme-context`), which re-runs the
 * StyleSheets against the new palette without a per-component migration.
 */
import { readDevicePrefs, writeDevicePrefs } from '@/lib/device-prefs';

/** The shape every palette must satisfy. */
export interface Palette {
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textDim: string;
  textFaint: string;
  accent: string;
  accentDim: string;
  onAccent: string;
  scrim: string;
  userBubble: string;
  assistantBubble: string;
  danger: string;
  dangerSurface: string;
  warn: string;
  ok: string;
  okSurface: string;
}

export interface ThemeMeta {
  id: string;
  name: string;
  dark: boolean;
}

// ── Palettes ────────────────────────────────────────────────────────────────
// "odysseus-dark" is the original palette, verbatim. The rest keep the same
// tokens with different hues; each stays calm and readable, never pure black.

const odysseusDark: Palette = {
  bg: '#16161a',
  surface: '#1f1f25',
  surfaceAlt: '#26262e',
  border: '#2c2c35',
  text: '#e8e8e8',
  textDim: '#bdbdc7',
  textFaint: '#8a8a96',
  accent: '#e06c75',
  accentDim: '#9e4d54',
  onAccent: '#0e0e12',
  scrim: 'rgba(11,11,14,0.66)',
  userBubble: '#5a2f37',
  assistantBubble: '#1f1f25',
  danger: '#e0685e',
  dangerSurface: '#3a1f1f',
  warn: '#e0a85e',
  ok: '#5ec07c',
  okSurface: '#1c2e22',
};

const odysseusLight: Palette = {
  bg: '#f5f4f2',
  surface: '#ffffff',
  surfaceAlt: '#ecebe8',
  border: '#dcdad5',
  text: '#1f1f24',
  textDim: '#54545e',
  textFaint: '#8a8a96',
  accent: '#c0424c',
  accentDim: '#d98a90',
  onAccent: '#ffffff',
  scrim: 'rgba(40,38,36,0.34)',
  userBubble: '#f3d9dc',
  assistantBubble: '#ffffff',
  danger: '#c23a30',
  dangerSurface: '#f7e0dd',
  warn: '#b5791f',
  ok: '#2f8f52',
  okSurface: '#dcefe1',
};

const midnight: Palette = {
  ...odysseusDark,
  bg: '#0f1420',
  surface: '#171d2c',
  surfaceAlt: '#1e2537',
  border: '#28304a',
  accent: '#6c8cff',
  accentDim: '#465a9e',
  onAccent: '#0a0d16',
  scrim: 'rgba(8,10,18,0.7)',
  userBubble: '#2b3a63',
  assistantBubble: '#171d2c',
};

const forest: Palette = {
  ...odysseusDark,
  bg: '#121814',
  surface: '#161d18',
  surfaceAlt: '#1d251f',
  border: '#2a352c',
  accent: '#63c088',
  accentDim: '#3f7a57',
  onAccent: '#0b110d',
  userBubble: '#274434',
  assistantBubble: '#161d18',
};

const amber: Palette = {
  ...odysseusDark,
  bg: '#171310',
  surface: '#201a15',
  surfaceAlt: '#2a2119',
  border: '#372c22',
  accent: '#e0a85e',
  accentDim: '#9e7640',
  onAccent: '#120d08',
  userBubble: '#4a3620',
  assistantBubble: '#201a15',
};

const grape: Palette = {
  ...odysseusDark,
  bg: '#161320',
  surface: '#1e1a2c',
  surfaceAlt: '#262038',
  border: '#332c4a',
  accent: '#b57cff',
  accentDim: '#71519e',
  onAccent: '#0d0a16',
  userBubble: '#3d2e63',
  assistantBubble: '#1e1a2c',
};

const teal: Palette = {
  ...odysseusDark,
  bg: '#0f1a1a',
  surface: '#152525',
  surfaceAlt: '#1b2f2f',
  border: '#264040',
  accent: '#4fc7c7',
  accentDim: '#357f7f',
  onAccent: '#08110f',
  userBubble: '#204545',
  assistantBubble: '#152525',
};

const rose: Palette = {
  ...odysseusDark,
  bg: '#1a1315',
  surface: '#251a1e',
  surfaceAlt: '#2f2126',
  border: '#402c33',
  accent: '#ff8fab',
  accentDim: '#9e5869',
  onAccent: '#160a0d',
  userBubble: '#5a3040',
  assistantBubble: '#251a1e',
};

const mono: Palette = {
  ...odysseusDark,
  bg: '#141414',
  surface: '#1d1d1d',
  surfaceAlt: '#252525',
  border: '#333333',
  accent: '#d0d0d0',
  accentDim: '#7a7a7a',
  onAccent: '#111111',
  userBubble: '#3a3a3a',
  assistantBubble: '#1d1d1d',
};

const nord: Palette = {
  ...odysseusDark,
  bg: '#2e3440',
  surface: '#3b4252',
  surfaceAlt: '#434c5e',
  border: '#4c566a',
  text: '#eceff4',
  textDim: '#d8dee9',
  textFaint: '#9aa4b8',
  accent: '#88c0d0',
  accentDim: '#5e808c',
  onAccent: '#20242c',
  userBubble: '#4c566a',
  assistantBubble: '#3b4252',
};

const paper: Palette = {
  ...odysseusLight,
  bg: '#faf8f2',
  surface: '#ffffff',
  surfaceAlt: '#f0ece0',
  border: '#e0d9c8',
  accent: '#8a6d3b',
  accentDim: '#c2ab84',
  userBubble: '#efe4cf',
};

const solarizedLight: Palette = {
  ...odysseusLight,
  bg: '#fdf6e3',
  surface: '#fbf1d8',
  surfaceAlt: '#eee8d5',
  border: '#e0dabf',
  text: '#073642',
  textDim: '#586e75',
  textFaint: '#93a1a1',
  accent: '#268bd2',
  accentDim: '#96c4e5',
  onAccent: '#ffffff',
  userBubble: '#e5ddc4',
  assistantBubble: '#fbf1d8',
};

const THEMES: Record<string, { meta: ThemeMeta; color: Palette }> = {
  'odysseus-dark': { meta: { id: 'odysseus-dark', name: 'Odysseus Dark', dark: true }, color: odysseusDark },
  'odysseus-light': { meta: { id: 'odysseus-light', name: 'Odysseus Light', dark: false }, color: odysseusLight },
  midnight: { meta: { id: 'midnight', name: 'Midnight', dark: true }, color: midnight },
  forest: { meta: { id: 'forest', name: 'Forest', dark: true }, color: forest },
  amber: { meta: { id: 'amber', name: 'Amber', dark: true }, color: amber },
  grape: { meta: { id: 'grape', name: 'Grape', dark: true }, color: grape },
  teal: { meta: { id: 'teal', name: 'Teal', dark: true }, color: teal },
  rose: { meta: { id: 'rose', name: 'Rose', dark: true }, color: rose },
  mono: { meta: { id: 'mono', name: 'Mono', dark: true }, color: mono },
  nord: { meta: { id: 'nord', name: 'Nord', dark: true }, color: nord },
  paper: { meta: { id: 'paper', name: 'Paper', dark: false }, color: paper },
  'solarized-light': { meta: { id: 'solarized-light', name: 'Solarized Light', dark: false }, color: solarizedLight },
};

export const DEFAULT_THEME_ID = 'odysseus-dark';

/** Metadata for every selectable theme (for the Settings picker). */
export const themeList: ThemeMeta[] = Object.values(THEMES).map((t) => t.meta);

/** Static bg/accent swatch colors per theme id, for rendering the picker. */
export const themePreviews: Record<string, { bg: string; accent: string }> = Object.fromEntries(
  Object.entries(THEMES).map(([id, t]) => [id, { bg: t.color.bg, accent: t.color.accent }]),
);

export function isValidThemeId(id: string | undefined): id is string {
  return !!id && id in THEMES;
}

// ── Live theme object ─────────────────────────────────────────────────────────
// A single mutable object shared by every importer. `color` is replaced in place
// (same `theme` identity) so existing `import { theme }` call sites need no
// changes; a reload re-runs StyleSheets against the swapped palette.

function resolveInitialColor(): { id: string; color: Palette } {
  const stored = readDevicePrefs().themeId;
  const id = isValidThemeId(stored) ? stored : DEFAULT_THEME_ID;
  return { id, color: THEMES[id].color };
}

const initial = resolveInitialColor();

export const theme = {
  id: initial.id,
  color: { ...initial.color },
  radius: { sm: 8, md: 12, lg: 18, pill: 999 },
  space: (n: number) => n * 4,
  font: {
    body: 15,
    small: 13,
    title: 20,
    mono: 13,
  },
};

export type Theme = typeof theme;

/** True if the active theme is a dark palette (for status-bar style, etc.). */
export function isDarkTheme(id: string = theme.id): boolean {
  return THEMES[id]?.meta.dark ?? true;
}

/**
 * Persist and apply a theme id by mutating the live palette in place. Callers
 * that need already-mounted screens to restyle should reload the app afterwards
 * (see `theme-context.applyThemeAndReload`). Returns false for unknown ids.
 */
export function applyThemeId(id: string): boolean {
  if (!isValidThemeId(id)) return false;
  theme.id = id;
  Object.assign(theme.color, THEMES[id].color);
  writeDevicePrefs({ themeId: id });
  return true;
}
