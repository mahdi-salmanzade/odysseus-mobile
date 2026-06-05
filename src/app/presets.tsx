import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NavIcon } from '@/components/nav-icon';
import { ScreenHeader } from '@/components/screen-header';
import { SkeletonList } from '@/components/skeleton';
import { theme } from '@/constants/theme';
import { ApiError, listPresets, type Preset } from '@/lib/api';
import { usePairing } from '@/lib/pairing-context';
import { useSidebar } from '@/lib/sidebar-context';

export default function PresetsScreen() {
  const { pairing } = usePairing();
  const { openSidebar } = useSidebar();

  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Once loaded, refocus refreshes silently instead of blanking to a spinner.
  const loadedOnce = useRef(false);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (!pairing) return;
      if (mode === 'refresh') setRefreshing(true);
      else if (!loadedOnce.current) setLoading(true);
      setError(null);
      try {
        const next = await listPresets(pairing);
        setPresets(next);
        loadedOnce.current = true;
      } catch (e) {
        if (!loadedOnce.current) setError(e instanceof ApiError ? e.message : 'Could not load presets.');
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

  // Long-press a card to copy its system prompt to the clipboard.
  const copyPrompt = useCallback(async (prompt: string) => {
    if (!prompt) return;
    await Haptics.selectionAsync();
    await Clipboard.setStringAsync(prompt);
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Presets" onMenu={openSidebar} />

      {loading ? (
        <SkeletonList />
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
          data={presets}
          keyExtractor={(p) => p.id}
          contentContainerStyle={presets.length === 0 ? styles.emptyWrap : styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load('refresh')}
              tintColor={theme.color.textDim}
            />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <NavIcon name="presets" size={40} color={theme.color.textFaint} />
              <Text style={styles.emptyTitle}>No presets</Text>
              <Text style={styles.emptyHint}>
                Presets are configured on your Odysseus server and will appear here.
              </Text>
            </View>
          }
          renderItem={({ item }) => <PresetCard preset={item} onCopy={copyPrompt} />}
        />
      )}
    </SafeAreaView>
  );
}

function PresetCard({
  preset,
  onCopy,
}: {
  preset: Preset;
  onCopy: (prompt: string) => void;
}) {
  // Only flag a preset when it's explicitly disabled; everything else reads as
  // a normal, active preset (no pill).
  const disabled = preset.enabled === false;
  const temp = preset.temperature != null ? String(preset.temperature) : '—';
  // max_tokens of 0 means "unlimited/unset" — don't show a misleading "0".
  const maxTokens = preset.max_tokens ? String(preset.max_tokens) : '—';
  const prompt = preset.system_prompt ?? '';

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}
      onLongPress={() => onCopy(prompt)}
      delayLongPress={300}
      accessibilityRole="button"
      accessibilityLabel={`Preset ${preset.name}. Long press to copy system prompt.`}
    >
      <View style={styles.cardHead}>
        <Text style={styles.name} numberOfLines={2}>
          {preset.name}
        </Text>
        {disabled ? (
          <View style={[styles.pill, styles.pillOff]}>
            <Text style={[styles.pillText, styles.pillTextOff]}>Disabled</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.meta}>temp {temp}</Text>
        <Text style={styles.meta}>max {maxTokens}</Text>
      </View>

      {prompt ? (
        <Text style={styles.prompt} numberOfLines={6} selectable>
          {prompt}
        </Text>
      ) : (
        <Text style={styles.promptEmpty}>No system prompt</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.bg },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.space(8), gap: theme.space(2.5) },
  list: { paddingHorizontal: theme.space(4), paddingBottom: theme.space(4), gap: theme.space(3) },
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

  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space(4),
    gap: theme.space(3),
  },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: theme.space(3) },
  name: { color: theme.color.text, fontSize: theme.font.body, fontWeight: '600', flexShrink: 1 },

  pill: {
    paddingHorizontal: theme.space(2.5),
    paddingVertical: theme.space(1),
    borderRadius: theme.radius.pill,
    borderWidth: 1,
  },
  pillOff: { backgroundColor: theme.color.surfaceAlt, borderColor: theme.color.border },
  pillText: { fontSize: theme.font.small, fontWeight: '700' },
  pillTextOff: { color: theme.color.textFaint },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space(4) },
  meta: {
    color: theme.color.textFaint,
    fontSize: theme.font.small,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },

  prompt: { color: theme.color.textDim, fontSize: theme.font.small, lineHeight: 20 },
  promptEmpty: { color: theme.color.textFaint, fontSize: theme.font.small, fontStyle: 'italic' },
});
