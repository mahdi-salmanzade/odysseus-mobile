/**
 * Documents — read-only viewer for the server's RAG document library. Loads on
 * focus, renders one card per document (title + meta + snippet preview). Tapping
 * a card fetches the full body and opens it in a modal: markdown bodies render
 * through the Markdown component, code/other bodies as monospaced selectable
 * text. Copy the body via long-press on a card or the modal's Copy button.
 * Pull-to-refresh, plus empty/error/loading states.
 */
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Markdown from '@/components/markdown';
import { ScreenHeader } from '@/components/screen-header';
import { theme } from '@/constants/theme';
import {
  ApiError,
  getDocument,
  listDocuments,
  type DocumentDetail,
  type DocumentSummary,
} from '@/lib/api';
import { usePairing } from '@/lib/pairing-context';
import { useSidebar } from '@/lib/sidebar-context';

/** A markdown-ish body renders as rich text; anything else is treated as code. */
function isProse(language: string | null): boolean {
  if (language == null) return true;
  const l = language.toLowerCase();
  return l === 'markdown' || l === 'md' || l === 'text' || l === 'txt' || l === 'plain';
}

/** Show just the date portion of an ISO-ish timestamp; '' when absent/unparseable. */
function dateOnly(updatedAt: string | null): string {
  if (!updatedAt) return '';
  return updatedAt.slice(0, 10);
}

export default function DocumentsScreen() {
  const { pairing } = usePairing();
  const { openSidebar } = useSidebar();

  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Detail modal state. `detail` is the loaded body; `detailLoading` covers the
  // fetch in flight; `detailError` surfaces a failed open.
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Once loaded, refocus refreshes silently instead of blanking to a spinner.
  const loadedOnce = useRef(false);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (!pairing) return;
      if (mode === 'refresh') setRefreshing(true);
      else if (!loadedOnce.current) setLoading(true);
      setError(null);
      try {
        const next = await listDocuments(pairing);
        setDocuments(next);
        loadedOnce.current = true;
      } catch (e) {
        if (!loadedOnce.current) setError(e instanceof ApiError ? e.message : 'Could not load documents.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [pairing],
  );

  useFocusEffect(
    useCallback(() => {
      load('initial');
    }, [load]),
  );

  const openDocument = useCallback(
    async (doc: DocumentSummary) => {
      if (!pairing) return;
      setOpenId(doc.id);
      setDetail(null);
      setDetailError(null);
      setDetailLoading(true);
      try {
        const full = await getDocument(pairing, doc.id);
        setDetail(full);
      } catch (e) {
        setDetailError(e instanceof ApiError ? e.message : 'Could not open document.');
      } finally {
        setDetailLoading(false);
      }
    },
    [pairing],
  );

  const closeDocument = useCallback(() => {
    setOpenId(null);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(false);
  }, []);

  const copyBody = useCallback(async (body: string) => {
    if (!body) return;
    await Haptics.selectionAsync();
    await Clipboard.setStringAsync(body);
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Documents" onMenu={openSidebar} />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.color.accent} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retry} onPress={() => load('initial')}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={documents}
          keyExtractor={(d) => d.id}
          contentContainerStyle={documents.length === 0 ? styles.emptyWrap : styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load('refresh')}
              tintColor={theme.color.textDim}
            />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyTitle}>No documents</Text>
              <Text style={styles.emptyHint}>
                Documents in your Odysseus RAG library will appear here.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <DocumentCard
              doc={item}
              onOpen={() => openDocument(item)}
              onCopy={() => copyBody(item.snippet)}
            />
          )}
        />
      )}

      <Modal
        visible={openId !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeDocument}
      >
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <ScreenHeader
            title={detail?.title ?? 'Document'}
            onMenu={closeDocument}
            right={
              detail?.content ? (
                <Pressable
                  hitSlop={{ top: 13, bottom: 13, left: 13, right: 13 }}
                  onPress={() => copyBody(detail.content)}
                  accessibilityRole="button"
                  accessibilityLabel="Copy document"
                >
                  <Text style={styles.copyText}>Copy</Text>
                </Pressable>
              ) : undefined
            }
          />

          {detailLoading ? (
            <View style={styles.center}>
              <ActivityIndicator color={theme.color.accent} />
            </View>
          ) : detailError ? (
            <View style={styles.center}>
              <Text style={styles.errorText}>{detailError}</Text>
            </View>
          ) : detail ? (
            <ScrollView contentContainerStyle={styles.detailBody}>
              {isProse(detail.language) ? (
                <Markdown text={detail.content} />
              ) : (
                <Text style={styles.code} selectable>
                  {detail.content}
                </Text>
              )}
            </ScrollView>
          ) : null}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function DocumentCard({
  doc,
  onOpen,
  onCopy,
}: {
  doc: DocumentSummary;
  onOpen: () => void;
  onCopy: () => void;
}) {
  const date = dateOnly(doc.updated_at);
  const meta = [doc.language ?? undefined, date || undefined].filter(Boolean).join(' · ');
  return (
    <Pressable
      style={styles.card}
      onPress={onOpen}
      onLongPress={onCopy}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={`Open document ${doc.title || 'Untitled'}`}
    >
      <Text style={styles.cardTitle} numberOfLines={2}>
        {doc.title || 'Untitled'}
      </Text>
      {meta ? <Text style={styles.meta}>{meta}</Text> : null}
      {doc.snippet ? (
        <Text style={styles.snippet} numberOfLines={2}>
          {doc.snippet}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.bg },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  list: { padding: 16, gap: 12 },
  emptyWrap: { flexGrow: 1 },

  errorText: { color: theme.color.danger, fontSize: theme.font.body, textAlign: 'center' },
  retry: {
    marginTop: 4,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  retryText: { color: theme.color.accent, fontSize: theme.font.body, fontWeight: '600' },

  emptyTitle: { color: theme.color.textDim, fontSize: theme.font.body, fontWeight: '600' },
  emptyHint: { color: theme.color.textFaint, fontSize: theme.font.small, textAlign: 'center', lineHeight: 19 },

  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: 16,
    gap: 6,
  },
  cardTitle: { color: theme.color.text, fontSize: theme.font.body, fontWeight: '700' },
  meta: {
    color: theme.color.textFaint,
    fontSize: theme.font.small,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  snippet: { color: theme.color.textDim, fontSize: theme.font.small, lineHeight: 19 },

  copyText: { color: theme.color.accent, fontSize: theme.font.body, fontWeight: '600' },
  detailBody: { padding: 16 },
  code: {
    color: theme.color.textDim,
    fontFamily: 'Courier',
    fontSize: theme.font.mono,
    lineHeight: 19,
  },
});
