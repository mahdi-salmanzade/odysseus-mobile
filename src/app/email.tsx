/**
 * Email — browse one of the owner's configured mail accounts and send a message.
 * On load fetches the accounts and picks the default (or first); a compact chip
 * row switches accounts when there's more than one. The inbox lists message
 * headers (from / subject / date); tapping a row opens a Modal reader that
 * fetches the full body and renders it as plain selectable text. The header +
 * opens a compose Modal (To / Subject / Body). Pull-to-refresh, long-press a row
 * to copy its subject, plus empty/error/loading states. A 502 (mailbox
 * unreachable) surfaces as a friendly "try again" rather than a crash.
 */
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NavIcon } from '@/components/nav-icon';
import { ScreenHeader } from '@/components/screen-header';
import { SkeletonList } from '@/components/skeleton';
import { theme } from '@/constants/theme';
import {
  ApiError,
  listEmailAccounts,
  listEmailMessages,
  readEmailMessage,
  sendEmail,
  type EmailAccount,
  type EmailHeader,
  type EmailMessage,
} from '@/lib/api';
import { usePairing } from '@/lib/pairing-context';
import { useSidebar } from '@/lib/sidebar-context';

/** Show just the date portion of an ISO-ish timestamp; '' when absent/unparseable. */
function dateOnly(date: string | null): string {
  if (!date) return '';
  return date.slice(0, 10);
}

/** A 502 means the mailbox (IMAP/SMTP) is unreachable — phrase that for humans. */
function friendlyError(e: unknown, fallback: string): string {
  if (e instanceof ApiError) {
    if (e.status === 502) return 'Mailbox unreachable. Try again.';
    return e.message;
  }
  return fallback;
}

export default function EmailScreen() {
  const { pairing } = usePairing();
  const { openSidebar } = useSidebar();

  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<EmailHeader[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reader modal state. `detail` is the loaded message; `detailLoading` covers
  // the fetch in flight; `detailError` surfaces a failed open (incl. a 502).
  const [openUid, setOpenUid] = useState<string | null>(null);
  const [detail, setDetail] = useState<EmailMessage | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Compose modal state.
  const [composing, setComposing] = useState(false);
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Guard async resolutions against an unmounted/blurred screen.
  const mounted = useRef(true);
  // Once accounts load, refocus refreshes silently instead of blanking to a spinner.
  const loadedOnce = useRef(false);

  // Load the message list for a given account (no account => clear).
  const loadMessages = useCallback(
    async (accountId: string, mode: 'initial' | 'refresh') => {
      if (!pairing) return;
      if (mode === 'refresh') setRefreshing(true);
      else if (!loadedOnce.current) setLoading(true);
      setError(null);
      try {
        const next = await listEmailMessages(pairing, { accountId, folder: 'INBOX' });
        if (!mounted.current) return;
        setMessages(next);
        loadedOnce.current = true;
      } catch (e) {
        if (!mounted.current) return;
        if (!loadedOnce.current) setError(friendlyError(e, 'Could not load messages.'));
      } finally {
        if (!mounted.current) return;
        setLoading(false);
        setRefreshing(false);
      }
    },
    [pairing],
  );

  // Load accounts, then the active account's inbox. Picks default (or first).
  const loadAccounts = useCallback(async () => {
    if (!pairing) return;
    if (!loadedOnce.current) setLoading(true);
    setError(null);
    try {
      const accts = await listEmailAccounts(pairing);
      if (!mounted.current) return;
      setAccounts(accts);
      if (accts.length === 0) {
        setActiveId(null);
        setMessages([]);
        loadedOnce.current = true;
        setLoading(false);
        return;
      }
      // Keep the current selection if it still exists; else default/first.
      const keep = activeId && accts.some((a) => a.id === activeId) ? activeId : null;
      const next = keep ?? accts.find((a) => a.is_default)?.id ?? accts[0].id;
      setActiveId(next);
      await loadMessages(next, 'initial');
    } catch (e) {
      if (!mounted.current) return;
      if (!loadedOnce.current) setError(friendlyError(e, 'Could not load email accounts.'));
      setLoading(false);
    }
  }, [pairing, activeId, loadMessages]);

  useFocusEffect(
    useCallback(() => {
      mounted.current = true;
      loadAccounts();
      return () => {
        mounted.current = false;
      };
      // Only re-run when pairing changes; activeId churn shouldn't re-trigger the
      // whole account reload on focus.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pairing]),
  );

  const switchAccount = useCallback(
    (id: string) => {
      if (id === activeId) return;
      setActiveId(id);
      setMessages([]);
      loadedOnce.current = false;
      loadMessages(id, 'initial');
    },
    [activeId, loadMessages],
  );

  const openMessage = useCallback(
    async (header: EmailHeader) => {
      if (!pairing || !activeId) return;
      setOpenUid(header.uid);
      setDetail(null);
      setDetailError(null);
      setDetailLoading(true);
      try {
        const full = await readEmailMessage(pairing, { accountId: activeId, uid: header.uid });
        if (!mounted.current) return;
        setDetail(full);
      } catch (e) {
        if (!mounted.current) return;
        setDetailError(friendlyError(e, 'Could not open message.'));
      } finally {
        if (mounted.current) setDetailLoading(false);
      }
    },
    [pairing, activeId],
  );

  const closeMessage = useCallback(() => {
    setOpenUid(null);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(false);
  }, []);

  const copySubject = useCallback(async (text: string) => {
    if (!text) return;
    await Haptics.selectionAsync();
    await Clipboard.setStringAsync(text);
  }, []);

  const resetCompose = useCallback(() => {
    setComposing(false);
    setTo('');
    setSubject('');
    setBody('');
    setSendError(null);
  }, []);

  const send = useCallback(async () => {
    if (!pairing || !activeId || sending) return;
    const recipients = to.trim();
    if (!recipients) {
      setSendError('Enter at least one recipient.');
      return;
    }
    setSending(true);
    setSendError(null);
    try {
      await sendEmail(pairing, { accountId: activeId, to: recipients, subject, body });
      if (!mounted.current) return;
      resetCompose();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Alert.alert('Sent', 'Your message was sent.');
      loadMessages(activeId, 'refresh');
    } catch (e) {
      if (!mounted.current) return;
      setSendError(friendlyError(e, 'Could not send the message.'));
    } finally {
      if (mounted.current) setSending(false);
    }
  }, [pairing, activeId, sending, to, subject, body, resetCompose, loadMessages]);

  const noAccounts = !loading && !error && accounts.length === 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Email"
        onMenu={openSidebar}
        right={
          accounts.length > 0 ? (
            <Pressable
              hitSlop={{ top: 13, bottom: 13, left: 13, right: 13 }}
              onPress={() => setComposing(true)}
              style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.6 }]}
              accessibilityRole="button"
              accessibilityLabel="Compose message"
            >
              <Text style={styles.addBtnText}>+</Text>
            </Pressable>
          ) : undefined
        }
      />

      {accounts.length > 1 && (
        <View style={styles.switcher}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.switcherRow}
          >
            {accounts.map((a) => {
              const active = a.id === activeId;
              return (
                <Pressable
                  key={a.id}
                  onPress={() => switchAccount(a.id)}
                  style={({ pressed }) => [styles.chip, active && styles.chipOn, pressed && { opacity: 0.6 }]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Account ${a.name || a.from_address}`}
                >
                  <Text style={[styles.chipText, active && styles.chipTextOn]} numberOfLines={1}>
                    {a.name || a.from_address}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      {loading ? (
        <SkeletonList />
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable
            style={({ pressed }) => [styles.retry, pressed && { opacity: 0.6 }]}
            onPress={() => loadAccounts()}
          >
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : noAccounts ? (
        <View style={styles.center}>
          <NavIcon name="email" size={40} color={theme.color.textFaint} />
          <Text style={styles.emptyTitle}>No email accounts</Text>
          <Text style={styles.emptyHint}>
            Mail accounts are configured on your Odysseus server. Once added, they appear here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={messages}
          keyExtractor={(m) => m.uid}
          contentContainerStyle={messages.length === 0 ? styles.emptyWrap : styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => activeId && loadMessages(activeId, 'refresh')}
              tintColor={theme.color.textDim}
            />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <NavIcon name="email" size={40} color={theme.color.textFaint} />
              <Text style={styles.emptyTitle}>Inbox empty</Text>
              <Text style={styles.emptyHint}>No messages in this folder.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <MessageRow
              header={item}
              onOpen={() => openMessage(item)}
              onCopy={() => copySubject(item.subject)}
            />
          )}
        />
      )}

      {/* Reader */}
      <Modal
        visible={openUid !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeMessage}
      >
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <ScreenHeader title={detail?.subject || 'Message'} onMenu={closeMessage} showSettings={false} />
          {detailLoading ? (
            <View style={styles.center}>
              <ActivityIndicator color={theme.color.accent} />
            </View>
          ) : detailError ? (
            <View style={styles.center}>
              <Text style={styles.errorText}>{detailError}</Text>
              <Pressable
                style={({ pressed }) => [styles.retry, pressed && { opacity: 0.6 }]}
                onPress={() => openUid && openMessage({ uid: openUid } as EmailHeader)}
              >
                <Text style={styles.retryText}>Try again</Text>
              </Pressable>
            </View>
          ) : detail ? (
            <ScrollView contentContainerStyle={styles.detailBody}>
              <Text style={styles.readSubject} selectable>
                {detail.subject || '(no subject)'}
              </Text>
              <View style={styles.readMeta}>
                <Text style={styles.readMetaLine} selectable>
                  From: {detail.from}
                </Text>
                {!!detail.to && (
                  <Text style={styles.readMetaLine} selectable>
                    To: {detail.to}
                  </Text>
                )}
                {!!dateOnly(detail.date) && (
                  <Text style={styles.readMetaLine}>{dateOnly(detail.date)}</Text>
                )}
              </View>
              <Text style={styles.readText} selectable>
                {detail.body}
              </Text>
            </ScrollView>
          ) : null}
        </SafeAreaView>
      </Modal>

      {/* Compose */}
      <Modal
        visible={composing}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={resetCompose}
      >
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <ScreenHeader
            title="New message"
            onMenu={resetCompose}
            showSettings={false}
            right={
              <Pressable
                hitSlop={{ top: 13, bottom: 13, left: 13, right: 13 }}
                onPress={send}
                disabled={!to.trim() || sending}
                style={({ pressed }) => pressed && !(!to.trim() || sending) ? { opacity: 0.6 } : undefined}
                accessibilityRole="button"
                accessibilityLabel="Send message"
              >
                {sending ? (
                  <ActivityIndicator color={theme.color.accent} />
                ) : (
                  <Text style={[styles.sendText, !to.trim() && styles.sendTextOff]}>Send</Text>
                )}
              </Pressable>
            }
          />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.flex}
            keyboardVerticalOffset={8}
          >
            <ScrollView contentContainerStyle={styles.composeBody} keyboardShouldPersistTaps="handled">
              <TextInput keyboardAppearance="dark"
                style={styles.field}
                placeholder="To (comma-separated)"
                placeholderTextColor={theme.color.textFaint}
                value={to}
                onChangeText={setTo}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                accessibilityLabel="Recipients"
              />
              <TextInput keyboardAppearance="dark"
                style={styles.field}
                placeholder="Subject"
                placeholderTextColor={theme.color.textFaint}
                value={subject}
                onChangeText={setSubject}
                accessibilityLabel="Subject"
              />
              <TextInput keyboardAppearance="dark"
                style={[styles.field, styles.bodyField]}
                placeholder="Message…"
                placeholderTextColor={theme.color.textFaint}
                value={body}
                onChangeText={setBody}
                multiline
                textAlignVertical="top"
                accessibilityLabel="Message body"
              />
              {!!sendError && <Text style={styles.errorText}>{sendError}</Text>}
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function MessageRow({
  header,
  onOpen,
  onCopy,
}: {
  header: EmailHeader;
  onOpen: () => void;
  onCopy: () => void;
}) {
  const date = dateOnly(header.date);
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
      onPress={onOpen}
      onLongPress={onCopy}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={`Open message from ${header.from || 'unknown'}: ${header.subject || 'no subject'}`}
    >
      <View style={styles.rowHead}>
        <Text style={styles.from} numberOfLines={1}>
          {header.from || '(unknown sender)'}
        </Text>
        {!!date && <Text style={styles.date}>{date}</Text>}
      </View>
      <Text style={styles.subject} numberOfLines={1}>
        {header.subject || '(no subject)'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.bg },
  flex: { flex: 1 },

  addBtn: { width: 24, height: 18, alignItems: 'center', justifyContent: 'center' },
  addBtnText: { color: theme.color.accent, fontSize: 26, fontWeight: '300', lineHeight: 26 },

  switcher: { borderBottomWidth: 1, borderBottomColor: theme.color.border },
  switcherRow: {
    paddingTop: 0,
    paddingHorizontal: theme.space(3),
    paddingBottom: theme.space(3),
    gap: theme.space(2),
  },
  chip: {
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.space(3.5),
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: theme.color.border,
    maxWidth: 200,
    minHeight: 44,
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: theme.color.accentDim, borderColor: theme.color.accent },
  chipText: { color: theme.color.textDim, fontSize: theme.font.small, fontWeight: '600' },
  chipTextOn: { color: theme.color.text },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.space(8), gap: theme.space(2.5) },
  list: {
    paddingTop: 0,
    paddingHorizontal: theme.space(4),
    paddingBottom: theme.space(4),
    gap: theme.space(3),
  },
  emptyWrap: { flexGrow: 1 },

  errorText: { color: theme.color.danger, fontSize: theme.font.body, textAlign: 'center', lineHeight: 21 },
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

  row: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space(4),
    gap: theme.space(1.5),
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space(2.5) },
  from: { color: theme.color.text, fontSize: theme.font.body, fontWeight: '700', flexShrink: 1 },
  date: { color: theme.color.textFaint, fontSize: theme.font.small, fontWeight: '600' },
  subject: { color: theme.color.textDim, fontSize: theme.font.small, lineHeight: 19 },

  detailBody: { padding: theme.space(4), gap: theme.space(3) },
  readSubject: { color: theme.color.text, fontSize: theme.font.title, fontWeight: '700', lineHeight: 26 },
  readMeta: {
    gap: 3,
    paddingBottom: theme.space(3),
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
  },
  readMetaLine: { color: theme.color.textFaint, fontSize: theme.font.small, lineHeight: 18 },
  readText: { color: theme.color.textDim, fontSize: theme.font.body, lineHeight: 22 },

  composeBody: { padding: theme.space(4), gap: theme.space(3) },
  field: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    paddingHorizontal: theme.space(3.5),
    paddingVertical: theme.space(3),
    color: theme.color.text,
    fontSize: theme.font.body,
  },
  bodyField: { minHeight: 200 },

  sendText: { color: theme.color.accent, fontSize: theme.font.body, fontWeight: '700' },
  sendTextOff: { opacity: 0.4 },
});
