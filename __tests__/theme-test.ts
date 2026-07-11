/**
 * Theme invariants: every palette is complete (same keys as the default), the
 * picker metadata/previews stay in sync, and applying a theme mutates the live
 * object in place (same identity — so existing `import { theme }` sites update).
 */

// device-prefs touches expo-file-system, which isn't available under jest; stub
// it so theme.ts can load. The persistence path is exercised via the mock.
const writes: any[] = [];
jest.mock('@/lib/device-prefs', () => ({
  readDevicePrefs: () => ({}),
  writeDevicePrefs: (patch: any) => writes.push(patch),
}));

import {
  theme,
  themeList,
  themePreviews,
  applyThemeId,
  isValidThemeId,
  isDarkTheme,
  DEFAULT_THEME_ID,
  type Palette,
} from '@/constants/theme';

const REQUIRED_KEYS: (keyof Palette)[] = [
  'bg', 'surface', 'surfaceAlt', 'border', 'text', 'textDim', 'textFaint',
  'accent', 'accentDim', 'onAccent', 'scrim', 'userBubble', 'assistantBubble',
  'danger', 'dangerSurface', 'warn', 'ok', 'okSurface',
];

describe('theme palettes', () => {
  it('has at least 10 selectable themes including a light one', () => {
    expect(themeList.length).toBeGreaterThanOrEqual(10);
    expect(themeList.some((t) => !t.dark)).toBe(true);
  });

  it('exposes a preview swatch for every theme', () => {
    for (const t of themeList) {
      expect(themePreviews[t.id]).toBeDefined();
      expect(themePreviews[t.id].bg).toMatch(/^#|rgba/);
      expect(themePreviews[t.id].accent).toMatch(/^#|rgba/);
    }
  });

  it('default theme id is valid', () => {
    expect(isValidThemeId(DEFAULT_THEME_ID)).toBe(true);
  });
});

describe('applyThemeId', () => {
  it('rejects unknown ids without mutating', () => {
    const before = theme.id;
    expect(applyThemeId('does-not-exist')).toBe(false);
    expect(theme.id).toBe(before);
  });

  it('swaps the palette in place (same object identity) and persists', () => {
    const colorRef = theme.color;
    const target = themeList.find((t) => t.id !== theme.id)!;
    expect(applyThemeId(target.id)).toBe(true);
    expect(theme.id).toBe(target.id);
    expect(theme.color).toBe(colorRef); // mutated in place, not replaced
    expect(theme.color.bg).toBe(themePreviews[target.id].bg);
    expect(writes.at(-1)).toEqual({ themeId: target.id });
    expect(isDarkTheme(target.id)).toBe(target.dark);
    // every token present after the swap
    for (const k of REQUIRED_KEYS) expect(theme.color[k]).toBeTruthy();
  });
});
