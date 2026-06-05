/**
 * Skills — read-only browser for the owner's learned skills. Loads on focus,
 * renders one card per skill (name + optional category pill + description).
 * Tapping a card fetches its SKILL.md source and opens it in a modal, rendered
 * through the Markdown component. Long-press a card to copy its name.
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
import { NavIcon } from '@/components/nav-icon';
import { ScreenHeader } from '@/components/screen-header';
import { SkeletonList } from '@/components/skeleton';
import { theme } from '@/constants/theme';
import { ApiError, getSkillMarkdown, listSkills, type Skill } from '@/lib/api';
import { usePairing } from '@/lib/pairing-context';
import { useSidebar } from '@/lib/sidebar-context';

export default function SkillsScreen() {
  const { pairing } = usePairing();
  const { openSidebar } = useSidebar();

  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Detail modal state. `markdown` is the loaded SKILL.md source; `detailLoading`
  // covers the fetch in flight; `detailError` surfaces a failed open.
  const [openName, setOpenName] = useState<string | null>(null);
  const [markdown, setMarkdown] = useState<string | null>(null);
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
        const next = await listSkills(pairing);
        setSkills(next);
        loadedOnce.current = true;
      } catch (e) {
        if (!loadedOnce.current) setError(e instanceof ApiError ? e.message : 'Could not load skills.');
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

  const openSkill = useCallback(
    async (skill: Skill) => {
      if (!pairing) return;
      setOpenName(skill.name);
      setMarkdown(null);
      setDetailError(null);
      setDetailLoading(true);
      try {
        const full = await getSkillMarkdown(pairing, skill.name);
        setMarkdown(full.markdown);
      } catch (e) {
        setDetailError(e instanceof ApiError ? e.message : 'Could not open skill.');
      } finally {
        setDetailLoading(false);
      }
    },
    [pairing],
  );

  const closeSkill = useCallback(() => {
    setOpenName(null);
    setMarkdown(null);
    setDetailError(null);
    setDetailLoading(false);
  }, []);

  const copyName = useCallback(async (name: string) => {
    if (!name) return;
    await Haptics.selectionAsync();
    await Clipboard.setStringAsync(name);
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Skills" onMenu={openSidebar} />

      {loading ? (
        <SkeletonList />
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable
            style={({ pressed }) => [styles.retry, pressed && { opacity: 0.7 }]}
            onPress={() => load('initial')}
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={skills}
          keyExtractor={(s) => s.name}
          contentContainerStyle={skills.length === 0 ? styles.emptyWrap : styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load('refresh')}
              tintColor={theme.color.textDim}
            />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <NavIcon name="skills" size={40} color={theme.color.textFaint} />
              <Text style={styles.emptyTitle}>No skills</Text>
              <Text style={styles.emptyHint}>
                Skills you teach Odysseus on the server will appear here.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <SkillCard
              skill={item}
              onOpen={() => openSkill(item)}
              onCopy={() => copyName(item.name)}
            />
          )}
        />
      )}

      <Modal
        visible={openName !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeSkill}
      >
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <ScreenHeader title={openName ?? 'Skill'} onMenu={closeSkill} />

          {detailLoading ? (
            <View style={styles.center}>
              <ActivityIndicator color={theme.color.accent} />
            </View>
          ) : detailError ? (
            <View style={styles.center}>
              <Text style={styles.errorText}>{detailError}</Text>
            </View>
          ) : markdown != null ? (
            <ScrollView contentContainerStyle={styles.detailBody}>
              <Markdown text={markdown} />
            </ScrollView>
          ) : null}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function SkillCard({
  skill,
  onOpen,
  onCopy,
}: {
  skill: Skill;
  onOpen: () => void;
  onCopy: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}
      onPress={onOpen}
      onLongPress={onCopy}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={`Open skill ${skill.name}`}
    >
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {skill.name}
        </Text>
        {skill.category ? (
          <Text style={styles.pill} numberOfLines={1}>
            {skill.category}
          </Text>
        ) : null}
      </View>
      {skill.description ? (
        <Text style={styles.description} numberOfLines={2}>
          {skill.description}
        </Text>
      ) : null}
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
    gap: theme.space(1.5),
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: theme.space(2) },
  cardTitle: { color: theme.color.text, fontSize: theme.font.body, fontWeight: '700', flexShrink: 1 },
  pill: {
    color: theme.color.textDim,
    fontSize: theme.font.small,
    fontWeight: '600',
    letterSpacing: 0.3,
    paddingHorizontal: theme.space(2),
    paddingVertical: theme.space(0.5),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.color.border,
    overflow: 'hidden',
  },
  description: { color: theme.color.textDim, fontSize: theme.font.small, lineHeight: 19 },

  detailBody: { padding: theme.space(4) },
});
