/**
 * Web Search — run a one-shot web search against the paired Odysseus and view
 * the results: the synthesized `context` (rendered as markdown) plus the list of
 * `sources` it drew from. Unlike Research this is a single request, not a
 * server-side run: type a query → loading → results (or an empty/error state).
 */
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';

import Markdown from '@/components/markdown';
import { NavIcon } from '@/components/nav-icon';
import { ScreenHeader } from '@/components/screen-header';
import { theme } from '@/constants/theme';
import { ApiError, webSearch, type SearchResult } from '@/lib/api';
import { usePairing } from '@/lib/pairing-context';
import { useSidebar } from '@/lib/sidebar-context';

/** Open a URL only if it's http(s). Source URLs come from the server/LLM, i.e.
 * untrusted output — don't hand arbitrary schemes (tel:, custom deep links) to
 * the OS opener. */
function openExternal(url: string) {
  if (/^https?:\/\//i.test(url)) Linking.openURL(url).catch(() => {});
}

export default function SearchScreen() {
  const { pairing } = usePairing();
  const { openSidebar } = useSidebar();

  const [query, setQuery] = useState('');
  // The query that produced the current results — so the header reflects what
  // was actually run, not whatever's being typed for the next search.
  const [activeQuery, setActiveQuery] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (!pairing || loading) return;
    const q = query.trim();
    if (!q) return;
    Haptics.selectionAsync().catch(() => {});
    setLoading(true);
    setError(null);
    try {
      const r = await webSearch(pairing, q);
      // The route can return a 200 whose body carries an `error` (e.g. no
      // provider configured) — surface that instead of an empty result.
      if (r.error) {
        setError(r.error);
        setResult(null);
      } else {
        setResult(r);
        setActiveQuery(q);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not run the search.');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [pairing, loading, query]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Search" onMenu={openSidebar} />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
        keyboardVerticalOffset={8}
      >
        <View style={styles.searchBar}>
          <TextInput keyboardAppearance="dark"
            style={styles.input}
            placeholder="Search the web…"
            placeholderTextColor={theme.color.textFaint}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={run}
            returnKeyType="search"
            autoFocus
            accessibilityLabel="Search query"
          />
          <Pressable
            onPress={run}
            disabled={!query.trim() || loading}
            style={({ pressed }) => [
              styles.searchBtn,
              (!query.trim() || loading) && styles.searchBtnOff,
              pressed && query.trim() && !loading && { opacity: 0.85 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Run search"
          >
            {loading ? (
              <ActivityIndicator color={theme.color.onAccent} />
            ) : (
              <Text style={styles.searchBtnText}>Search</Text>
            )}
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.color.accent} />
          </View>
        ) : error ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable
              style={({ pressed }) => [styles.retry, pressed && { opacity: 0.6 }]}
              onPress={run}
              accessibilityRole="button"
              accessibilityLabel="Retry search"
            >
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : result ? (
          <ScrollView contentContainerStyle={styles.resultsWrap} keyboardShouldPersistTaps="handled">
            <Text style={styles.resultsQuery} numberOfLines={2}>
              {activeQuery}
            </Text>
            <View style={styles.divider} />

            {result.context ? (
              <Markdown text={result.context} />
            ) : (
              <Text style={styles.emptyHint}>No summary was returned for this search.</Text>
            )}

            {result.sources.length > 0 && (
              <View style={styles.sources}>
                <Text style={styles.sourcesTitle}>Sources ({result.sources.length})</Text>
                {result.sources.map((s, i) => (
                  <Pressable
                    key={`${s.url}-${i}`}
                    style={({ pressed }) => [styles.sourceRow, pressed && { opacity: 0.7 }]}
                    onPress={() => openExternal(s.url)}
                    accessibilityRole="link"
                    accessibilityLabel={`Open source: ${s.title || s.url}`}
                  >
                    <Text style={styles.sourceTitle} numberOfLines={1}>
                      {s.title || s.url}
                    </Text>
                    {!!s.url && (
                      <Text style={styles.sourceUrl} numberOfLines={1}>
                        {s.url}
                      </Text>
                    )}
                  </Pressable>
                ))}
              </View>
            )}
          </ScrollView>
        ) : (
          <View style={styles.center}>
            <NavIcon name="search" size={40} color={theme.color.textFaint} />
            <Text style={styles.emptyTitle}>Search the web</Text>
            <Text style={styles.emptyHint}>
              Run a web search on your Odysseus server and see the summary and sources here.
            </Text>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.bg },
  flex: { flex: 1 },

  // The header owns the gap below its hairline (marginBottom), so the bar needs
  // no top padding of its own — only the bottom gap before the results.
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(2),
    paddingHorizontal: theme.space(4),
    paddingBottom: theme.space(3),
  },
  input: {
    flex: 1,
    color: theme.color.text,
    fontSize: theme.font.body,
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space(4),
    paddingVertical: theme.space(3),
  },
  searchBtn: {
    backgroundColor: theme.color.accent,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space(4),
    paddingVertical: theme.space(3),
    minWidth: 76,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBtnOff: { opacity: 0.4 },
  searchBtnText: { color: theme.color.onAccent, fontSize: theme.font.body, fontWeight: '700' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.space(8), gap: theme.space(2.5) },

  errorText: { color: theme.color.danger, fontSize: theme.font.body, textAlign: 'center' },
  retry: {
    marginTop: theme.space(1),
    paddingHorizontal: theme.space(5),
    paddingVertical: theme.space(2.5),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  retryText: { color: theme.color.accent, fontSize: theme.font.body, fontWeight: '600' },

  emptyTitle: { color: theme.color.textDim, fontSize: theme.font.body, fontWeight: '600' },
  emptyHint: { color: theme.color.textFaint, fontSize: theme.font.small, textAlign: 'center', lineHeight: 19 },

  resultsWrap: { padding: theme.space(5) },
  resultsQuery: { color: theme.color.text, fontSize: theme.font.title, fontWeight: '700', lineHeight: 26 },
  divider: { height: 1, backgroundColor: theme.color.border, marginVertical: theme.space(4) },

  sources: { marginTop: theme.space(6), gap: theme.space(2.5) },
  sourcesTitle: { color: theme.color.text, fontSize: theme.font.body, fontWeight: '700', marginBottom: theme.space(1) },
  sourceRow: {
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.sm,
    padding: theme.space(3),
    gap: theme.space(0.5),
  },
  sourceTitle: { color: theme.color.text, fontSize: theme.font.small, fontWeight: '600' },
  sourceUrl: { color: theme.color.accent, fontSize: theme.font.small },
});
