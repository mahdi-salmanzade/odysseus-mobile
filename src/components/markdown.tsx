/**
 * Markdown renderer for assistant messages, backed by `react-native-marked`
 * (a GFM-compliant `marked` parser). Full fidelity: tables, nested/ordered
 * lists, task checkboxes, blockquotes, code blocks, inline emphasis and links.
 *
 * We render via the `useMarkdown` hook (not the default `<Markdown>` component)
 * so the output is a flat list of nodes we can drop straight into the chat
 * bubble — the default component wraps everything in its own FlatList, which
 * would nest a VirtualizedList inside the message ScrollView. The hook tolerates
 * partial/streaming text, so an in-flight reply renders cleanly as it grows.
 */
import { memo, type ReactNode } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { Renderer, useMarkdown, type MarkedStyles } from 'react-native-marked';

import { theme } from '@/constants/theme';

/** Open a markdown link, but only if it's http(s) — link targets come from
 * untrusted LLM output, so don't hand arbitrary schemes to the OS opener. */
function openLink(href: string) {
  if (/^https?:\/\//i.test(href)) Linking.openURL(href).catch(() => {});
}

/** Default renderer, but links are scheme-guarded and non-http(s) targets
 * render as inert text rather than becoming tappable. */
class SafeRenderer extends Renderer {
  link(children: string | ReactNode[], href: string, styles?: object): ReactNode {
    if (/^https?:\/\//i.test(href)) {
      return (
        <Text key={this.getKey()} style={styles} onPress={() => openLink(href)}>
          {children}
        </Text>
      );
    }
    return this.text(children, styles);
  }
}

const renderer = new SafeRenderer();

const markedColors = {
  text: theme.color.text,
  link: theme.color.accent,
  code: theme.color.textDim,
  border: theme.color.border,
};

function Markdown({ text }: { text: string }) {
  const nodes = useMarkdown(text, { renderer, theme: { colors: markedColors }, styles: markedStyles });
  return <View>{nodes}</View>;
}

export default memo(Markdown);

const markedStyles: MarkedStyles = {
  text: { color: theme.color.text, fontSize: theme.font.body, lineHeight: 21 },
  paragraph: { marginTop: 0, marginBottom: 6, paddingVertical: 0 },
  strong: { fontWeight: '700' },
  em: { fontStyle: 'italic' },
  strikethrough: { textDecorationLine: 'line-through', color: theme.color.textDim },
  link: { color: theme.color.accent, textDecorationLine: 'underline' },
  h1: { color: theme.color.text, fontSize: 19, fontWeight: '700', marginTop: 4, marginBottom: 2 },
  h2: { color: theme.color.text, fontSize: 17, fontWeight: '700', marginTop: 4, marginBottom: 2 },
  h3: { color: theme.color.text, fontSize: theme.font.body + 1, fontWeight: '700', marginTop: 4, marginBottom: 2 },
  h4: { color: theme.color.text, fontSize: theme.font.body, fontWeight: '700' },
  h5: { color: theme.color.text, fontSize: theme.font.body, fontWeight: '700' },
  h6: { color: theme.color.textDim, fontSize: theme.font.small, fontWeight: '700' },
  list: { marginVertical: 2 },
  li: { color: theme.color.text, fontSize: theme.font.body, lineHeight: 21 },
  blockquote: {
    borderLeftWidth: 3,
    borderLeftColor: theme.color.border,
    paddingLeft: 10,
    marginVertical: 2,
  },
  codespan: {
    fontFamily: 'Courier',
    fontSize: theme.font.mono,
    color: theme.color.accent,
    backgroundColor: theme.color.surfaceAlt,
  },
  code: {
    backgroundColor: theme.color.bg,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginVertical: 4,
  },
  hr: { backgroundColor: theme.color.border, height: StyleSheet.hairlineWidth, marginVertical: 8 },
  table: { borderWidth: 1, borderColor: theme.color.border, borderRadius: theme.radius.sm, marginVertical: 4 },
  tableRow: { borderColor: theme.color.border },
  tableCell: { padding: 8 },
};
