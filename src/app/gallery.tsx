/**
 * Gallery — a grid of the owner's generated/uploaded images with a fullscreen
 * viewer. Loads on focus, renders a 3-column thumbnail grid. Every image is
 * fetched with the Bearer token (the server's image endpoint is owner-scoped
 * and requires auth), so thumbnails use the authenticated source built by
 * api.imageSource rather than a plain uri. Tapping a thumbnail opens a modal
 * showing the image fit-to-screen plus its prompt (selectable) and dim meta
 * (model · date) and a ★ when favorited (display only — no toggle endpoint).
 * Pull-to-refresh, plus empty/error/loading states.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NavIcon } from '@/components/nav-icon';
import { ScreenHeader } from '@/components/screen-header';
import { SkeletonGrid } from '@/components/skeleton';
import { theme } from '@/constants/theme';
import { ApiError, imageSource, listGalleryImages, type GalleryImageItem } from '@/lib/api';
import { usePairing } from '@/lib/pairing-context';
import { useSidebar } from '@/lib/sidebar-context';

const COLUMNS = 3;
const GAP = 2;

/** Show just the date portion of an ISO-ish timestamp; '' when absent. */
function dateOnly(createdAt: string | null): string {
  if (!createdAt) return '';
  return createdAt.slice(0, 10);
}

export default function GalleryScreen() {
  const { pairing } = usePairing();
  const { openSidebar } = useSidebar();
  const { width } = useWindowDimensions();

  const [images, setImages] = useState<GalleryImageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The image currently open in the fullscreen viewer (null = closed).
  const [open, setOpen] = useState<GalleryImageItem | null>(null);

  // Once loaded, refocus refreshes silently instead of blanking to a spinner.
  const loadedOnce = useRef(false);
  // Guard against setting state after the screen blurs / unmounts mid-fetch.
  const cancelled = useRef(false);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (!pairing) return;
      if (mode === 'refresh') setRefreshing(true);
      else if (!loadedOnce.current) setLoading(true);
      setError(null);
      try {
        const next = await listGalleryImages(pairing);
        if (cancelled.current) return;
        setImages(next);
        loadedOnce.current = true;
      } catch (e) {
        if (cancelled.current) return;
        if (!loadedOnce.current) setError(e instanceof ApiError ? e.message : 'Could not load images.');
      } finally {
        if (cancelled.current) return;
        setLoading(false);
        setRefreshing(false);
      }
    },
    [pairing],
  );

  useFocusEffect(
    useCallback(() => {
      cancelled.current = false;
      load('initial');
      return () => {
        cancelled.current = true;
      };
    }, [load]),
  );

  // Edge-to-edge grid: subtract the inter-tile gaps, divide across columns.
  const tileSize = Math.floor((width - GAP * (COLUMNS - 1)) / COLUMNS);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Gallery" onMenu={openSidebar} />

      {loading ? (
        <SkeletonGrid columns={COLUMNS} gap={GAP} />
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable
            style={({ pressed }) => [styles.retry, pressed && { opacity: 0.6 }]}
            onPress={() => load('initial')}
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={images}
          keyExtractor={(i) => i.id}
          numColumns={COLUMNS}
          columnWrapperStyle={images.length > 0 ? styles.row : undefined}
          contentContainerStyle={images.length === 0 ? styles.emptyWrap : styles.grid}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load('refresh')}
              tintColor={theme.color.textDim}
            />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <NavIcon name="gallery" size={40} color={theme.color.textFaint} />
              <Text style={styles.emptyTitle}>No images</Text>
              <Text style={styles.emptyHint}>
                Images you generate or upload on your Odysseus server will appear here.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <Thumbnail
              item={item}
              size={tileSize}
              onOpen={() => {
                Haptics.selectionAsync().catch(() => {});
                setOpen(item);
              }}
            />
          )}
        />
      )}

      <Modal
        visible={open !== null}
        animationType="fade"
        transparent={false}
        onRequestClose={() => setOpen(null)}
        statusBarTranslucent
      >
        {open ? <Viewer item={open} onClose={() => setOpen(null)} /> : null}
      </Modal>
    </SafeAreaView>
  );
}

/** One grid thumbnail. Shows a placeholder background while loading and a faint
 *  broken-image box on error. */
function Thumbnail({
  item,
  size,
  onOpen,
}: {
  item: GalleryImageItem;
  size: number;
  onOpen: () => void;
}) {
  const { pairing } = usePairing();
  const [failed, setFailed] = useState(false);
  if (!pairing) return null;

  const label = item.prompt ? `Image: ${item.prompt}` : 'Image';
  return (
    <Pressable
      style={({ pressed }) => [styles.tile, { width: size, height: size }, pressed && { opacity: 0.7 }]}
      onPress={onOpen}
      accessibilityRole="imagebutton"
      accessibilityLabel={label}
    >
      {failed ? (
        <View style={styles.broken}>
          <NavIcon name="gallery" size={22} color={theme.color.textFaint} />
        </View>
      ) : (
        <Image
          source={imageSource(pairing, item.image_url)}
          style={styles.thumb}
          resizeMode="cover"
          onError={() => setFailed(true)}
          accessible={false}
        />
      )}
      {item.favorite ? <Text style={styles.tileStar}>★</Text> : null}
    </Pressable>
  );
}

/** Fullscreen viewer: image fit to screen + prompt caption and dim meta. */
function Viewer({ item, onClose }: { item: GalleryImageItem; onClose: () => void }) {
  const { pairing } = usePairing();
  const [failed, setFailed] = useState(false);
  if (!pairing) return null;

  const date = dateOnly(item.created_at);
  const meta = [item.model ?? undefined, date || undefined].filter(Boolean).join(' · ');
  return (
    <SafeAreaView style={styles.viewerSafe} edges={['top', 'bottom']}>
      <View style={styles.viewerBar}>
        {item.favorite ? (
          <Text style={styles.viewerStar} accessibilityLabel="Favorited">
            ★
          </Text>
        ) : (
          <View style={styles.viewerBarSlot} />
        )}
        <Pressable
          onPress={onClose}
          hitSlop={{ top: 13, bottom: 13, left: 13, right: 13 }}
          style={({ pressed }) => [styles.viewerBarSlot, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
          accessibilityLabel="Close image"
        >
          <Text style={styles.closeText}>Close</Text>
        </Pressable>
      </View>

      <View style={styles.viewerImageWrap}>
        {failed ? (
          <View style={styles.viewerBroken}>
            <NavIcon name="gallery" size={48} color={theme.color.textFaint} />
            <Text style={styles.emptyHint}>This image could not be loaded.</Text>
          </View>
        ) : (
          <Image
            source={imageSource(pairing, item.image_url)}
            style={styles.viewerImage}
            resizeMode="contain"
            onError={() => setFailed(true)}
            accessibilityLabel={item.prompt ? `Image: ${item.prompt}` : 'Image'}
          />
        )}
      </View>

      {meta ? <Text style={styles.viewerMeta}>{meta}</Text> : null}
      {item.prompt ? (
        <ScrollView style={styles.captionScroll} contentContainerStyle={styles.captionBody}>
          <Text style={styles.caption} selectable>
            {item.prompt}
          </Text>
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.bg },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.space(8), gap: theme.space(2.5) },
  grid: { paddingBottom: theme.space(4) },
  row: { gap: GAP, marginBottom: GAP },
  emptyWrap: { flexGrow: 1 },

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

  tile: { backgroundColor: theme.color.surfaceAlt, overflow: 'hidden' },
  thumb: { width: '100%', height: '100%' },
  broken: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.surface },
  tileStar: {
    position: 'absolute',
    top: theme.space(1),
    right: theme.space(1.5),
    color: theme.color.accent,
    fontSize: 16,
    // Legibility over arbitrary photo content, not surface separation.
    textShadowColor: theme.color.onAccent,
    textShadowRadius: 3,
  },

  viewerSafe: { flex: 1, backgroundColor: theme.color.bg },
  viewerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.space(4),
    paddingVertical: theme.space(3),
  },
  viewerBarSlot: { minWidth: 44, height: 28, alignItems: 'flex-end', justifyContent: 'center' },
  viewerStar: { color: theme.color.accent, fontSize: theme.font.title },
  closeText: { color: theme.color.accent, fontSize: theme.font.body, fontWeight: '600' },

  viewerImageWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  viewerImage: { width: '100%', height: '100%' },
  viewerBroken: { alignItems: 'center', justifyContent: 'center', gap: theme.space(3), padding: theme.space(8) },

  viewerMeta: {
    color: theme.color.textFaint,
    fontSize: theme.font.small,
    fontWeight: '600',
    letterSpacing: 0.3,
    paddingHorizontal: theme.space(4),
    paddingTop: theme.space(2),
  },
  captionScroll: { maxHeight: 160 },
  captionBody: { paddingHorizontal: theme.space(4), paddingVertical: theme.space(3) },
  caption: { color: theme.color.textDim, fontSize: theme.font.body, lineHeight: 21 },
});
