/**
 * Single source of truth for colors / spacing. Dark, calm, matches the
 * Odysseus pairing page palette so the phone feels like part of the same app.
 */
export const theme = {
  color: {
    bg: '#16161a',
    surface: '#1f1f25',
    surfaceAlt: '#26262e',
    border: '#2c2c35',
    text: '#e8e8e8',
    textDim: '#bdbdc7',
    textFaint: '#8a8a96',
    accent: '#e06c75',
    accentDim: '#9e4d54',
    // Near-black ink for glyphs sitting ON the accent "lamp" (the send button).
    // A token, not a literal, so the one-lamp ink stays consistent everywhere.
    onAccent: '#0e0e12',
    // Dimming layer behind the sidebar. Tinted toward Desk Black, never pure #000.
    scrim: 'rgba(11,11,14,0.66)',
    userBubble: '#5a2f37',
    assistantBubble: '#1f1f25',
    danger: '#e0685e',
    // Muted surfaces behind destructive / success affordances (error banners,
    // active "on" pills). Tokens so these stay consistent app-wide.
    dangerSurface: '#3a1f1f',
    warn: '#e0a85e',
    ok: '#5ec07c',
    okSurface: '#1c2e22',
  },
  radius: { sm: 8, md: 12, lg: 18, pill: 999 },
  space: (n: number) => n * 4,
  font: {
    body: 15,
    small: 13,
    title: 20,
    mono: 13,
  },
} as const;

export type Theme = typeof theme;
