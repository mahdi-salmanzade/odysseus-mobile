/**
 * Calendar — an agenda view over the owner's calendars. Loads the next ~60 days
 * of events on focus, groups them by day under a date header, and lists each in
 * chronological order (time/All day, summary, location + calendar meta, color
 * dot). Create via the header +, which opens a modal form (summary, calendar
 * picker, start/end ISO datetimes, location, all-day). Delete via long-press →
 * confirm, with optimistic removal + restore-on-failure. Pull-to-refresh, plus
 * loading/error/empty states.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
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
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { theme } from '@/constants/theme';
import {
  ApiError,
  createEvent,
  deleteEvent,
  listCalendars,
  listEvents,
  type CalendarCal,
  type CalendarEvent,
} from '@/lib/api';
import { usePairing } from '@/lib/pairing-context';
import { useSidebar } from '@/lib/sidebar-context';

// How far ahead the agenda looks by default.
const WINDOW_DAYS = 60;

/** One day's worth of events, plus the header label, for the section list. */
interface DayGroup {
  key: string; // YYYY-MM-DD (or 'undated')
  label: string;
  events: CalendarEvent[];
}

function startOfDayKey(iso: string | null): string {
  if (!iso) return 'undated';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'undated';
  // Local-day bucket (YYYY-MM-DD) so events group by the user's calendar day.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dayLabel(iso: string | null): string {
  if (!iso) return 'No date';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'No date';
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function timeLabel(ev: CalendarEvent): string {
  if (ev.all_day) return 'All day';
  if (!ev.dtstart) return '';
  const d = new Date(ev.dtstart);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Group events by local day and sort both groups and within-group rows. */
function groupEvents(events: CalendarEvent[]): DayGroup[] {
  const groups = new Map<string, DayGroup>();
  for (const ev of events) {
    const key = startOfDayKey(ev.dtstart);
    let g = groups.get(key);
    if (!g) {
      g = { key, label: dayLabel(ev.dtstart), events: [] };
      groups.set(key, g);
    }
    g.events.push(ev);
  }
  const ts = (e: CalendarEvent) => {
    const t = e.dtstart ? new Date(e.dtstart).getTime() : NaN;
    return Number.isNaN(t) ? Infinity : t;
  };
  for (const g of groups.values()) g.events.sort((a, b) => ts(a) - ts(b));
  // Undated last; otherwise chronological by the day's first event.
  return [...groups.values()].sort((a, b) => {
    if (a.key === 'undated') return 1;
    if (b.key === 'undated') return -1;
    return ts(a.events[0]) - ts(b.events[0]);
  });
}

export default function CalendarScreen() {
  const { pairing } = usePairing();
  const { openSidebar } = useSidebar();

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [calendars, setCalendars] = useState<CalendarCal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [composing, setComposing] = useState(false);

  // Once loaded, refocus refreshes silently instead of blanking to a spinner.
  const loadedOnce = useRef(false);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (!pairing) return;
      if (mode === 'refresh') setRefreshing(true);
      else if (!loadedOnce.current) setLoading(true);
      setError(null);
      try {
        const now = new Date();
        const end = new Date(now.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000);
        const [evs, cals] = await Promise.all([
          listEvents(pairing, { start: now.toISOString(), end: end.toISOString() }),
          listCalendars(pairing),
        ]);
        setEvents(evs);
        setCalendars(cals);
        loadedOnce.current = true;
      } catch (e) {
        if (!loadedOnce.current) setError(e instanceof ApiError ? e.message : 'Could not load calendar.');
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

  const groups = useMemo(() => groupEvents(events), [events]);

  const remove = useCallback(
    (ev: CalendarEvent) => {
      if (!pairing) return;
      Alert.alert('Delete event', ev.summary || 'This event', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            // Optimistic delete; on failure re-insert at the original spot from
            // live state rather than restoring a stale snapshot.
            let removed: CalendarEvent | undefined;
            let at = -1;
            setEvents((cur) => {
              at = cur.findIndex((e) => e.uid === ev.uid);
              if (at === -1) return cur;
              removed = cur[at];
              return cur.filter((e) => e.uid !== ev.uid);
            });
            try {
              await deleteEvent(pairing, ev.uid);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
            } catch (e) {
              if (removed) {
                setEvents((cur) => {
                  if (cur.some((x) => x.uid === ev.uid)) return cur;
                  const copy = cur.slice();
                  copy.splice(Math.min(at, copy.length), 0, removed!);
                  return copy;
                });
              }
              Alert.alert('Could not delete', e instanceof Error ? e.message : 'Unknown error.');
            }
          },
        },
      ]);
    },
    [pairing],
  );

  const onCreated = useCallback((ev: CalendarEvent) => {
    setEvents((cur) => [...cur, ev]);
    setComposing(false);
  }, []);

  // Map calendar id → color for the per-event dot.
  const calColor = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of calendars) if (c.color) m.set(c.id, c.color);
    return m;
  }, [calendars]);
  const calName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of calendars) m.set(c.id, c.name);
    return m;
  }, [calendars]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Calendar"
        onMenu={openSidebar}
        right={
          <Pressable
            hitSlop={{ top: 13, bottom: 13, left: 13, right: 13 }}
            onPress={() => setComposing(true)}
            style={styles.addBtn}
            accessibilityRole="button"
            accessibilityLabel="Add event"
          >
            <Text style={styles.addBtnText}>+</Text>
          </Pressable>
        }
      />

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
          data={groups}
          keyExtractor={(g) => g.key}
          contentContainerStyle={groups.length === 0 ? styles.emptyWrap : styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load('refresh')}
              tintColor={theme.color.textDim}
            />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyTitle}>No upcoming events</Text>
              <Text style={styles.emptyHint}>
                Events in the next {WINDOW_DAYS} days will appear here.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.daySection}>
              <Text style={styles.dayHeader}>{item.label}</Text>
              <View style={styles.dayEvents}>
                {item.events.map((ev) => (
                  <EventRow
                    key={ev.uid}
                    event={ev}
                    color={calColor.get(ev.calendar_id) ?? ev.color ?? null}
                    calendarName={calName.get(ev.calendar_id)}
                    onDelete={() => remove(ev)}
                  />
                ))}
              </View>
            </View>
          )}
        />
      )}

      <ComposeModal
        visible={composing}
        calendars={calendars}
        onClose={() => setComposing(false)}
        onCreated={onCreated}
      />
    </SafeAreaView>
  );
}

function EventRow({
  event,
  color,
  calendarName,
  onDelete,
}: {
  event: CalendarEvent;
  color: string | null;
  calendarName?: string;
  onDelete: () => void;
}) {
  const time = timeLabel(event);
  const meta = [event.location, calendarName].filter(Boolean).join(' · ');
  return (
    <Pressable
      style={styles.eventRow}
      onLongPress={onDelete}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={`Event ${event.summary || 'Untitled'}${time ? `, ${time}` : ''}. Long press to delete.`}
    >
      <View style={styles.eventLead}>
        <View style={[styles.dot, { backgroundColor: color ?? theme.color.textFaint }]} />
        <Text style={styles.eventTime}>{time || '—'}</Text>
      </View>
      <View style={styles.eventBody}>
        <Text style={styles.eventTitle} numberOfLines={2}>
          {event.summary || 'Untitled'}
        </Text>
        {meta ? (
          <Text style={styles.eventMeta} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function isoIn(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function ComposeModal({
  visible,
  calendars,
  onClose,
  onCreated,
}: {
  visible: boolean;
  calendars: CalendarCal[];
  onClose: () => void;
  onCreated: (ev: CalendarEvent) => void;
}) {
  const { pairing } = usePairing();

  const [summary, setSummary] = useState('');
  const [calendarId, setCalendarId] = useState<string | null>(null);
  const [start, setStart] = useState(() => isoIn(0));
  const [end, setEnd] = useState(() => isoIn(1));
  const [location, setLocation] = useState('');
  const [allDay, setAllDay] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Default the picker to the first calendar once they load.
  const effectiveCal = calendarId ?? calendars[0]?.id ?? null;
  const noCalendars = calendars.length === 0;

  const reset = useCallback(() => {
    setSummary('');
    setCalendarId(null);
    setStart(isoIn(0));
    setEnd(isoIn(1));
    setLocation('');
    setAllDay(false);
    setFormError(null);
  }, []);

  const close = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const submit = useCallback(async () => {
    if (!pairing || saving) return;
    const s = summary.trim();
    if (!s) {
      setFormError('A summary is required.');
      return;
    }
    if (!effectiveCal) {
      setFormError('Pick a calendar.');
      return;
    }
    const startD = new Date(start);
    const endD = new Date(end);
    if (Number.isNaN(startD.getTime())) {
      setFormError('Start is not a valid date/time.');
      return;
    }
    if (Number.isNaN(endD.getTime())) {
      setFormError('End is not a valid date/time.');
      return;
    }
    if (endD.getTime() < startD.getTime()) {
      setFormError('End must be after start.');
      return;
    }
    setFormError(null);
    setSaving(true);
    try {
      const res = await createEvent(pairing, {
        calendarId: effectiveCal,
        summary: s,
        dtstart: startD.toISOString(),
        dtend: endD.toISOString(),
        location: location.trim() || undefined,
        allDay,
      });
      // Build the row locally from what we sent + the server's uid, so the new
      // event appears immediately without a full refetch.
      onCreated({
        uid: res.uid,
        calendar_id: effectiveCal,
        summary: s,
        description: '',
        location: location.trim(),
        dtstart: startD.toISOString(),
        dtend: endD.toISOString(),
        all_day: allDay,
        rrule: '',
        status: res.status ?? '',
        importance: '',
        event_type: null,
        color: null,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      reset();
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Unknown error.');
    } finally {
      setSaving(false);
    }
  }, [pairing, saving, summary, effectiveCal, start, end, location, allDay, onCreated, reset]);

  const canSubmit = !noCalendars && !saving && summary.trim().length > 0;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <View style={styles.modalRoot}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalSheet}
        >
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>New event</Text>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.form}>
            <Text style={styles.fieldLabel}>Summary</Text>
            <TextInput
              style={styles.input}
              placeholder="Event title"
              placeholderTextColor={theme.color.textFaint}
              value={summary}
              onChangeText={setSummary}
              accessibilityLabel="Event summary"
            />

            <Text style={styles.fieldLabel}>Calendar</Text>
            {noCalendars ? (
              <Text style={styles.hint}>
                No calendars available. Add a calendar on your Odysseus server first.
              </Text>
            ) : (
              <View style={styles.calPicker}>
                {calendars.map((c) => {
                  const selected = effectiveCal === c.id;
                  return (
                    <Pressable
                      key={c.id}
                      style={[styles.calChip, selected && styles.calChipOn]}
                      onPress={() => setCalendarId(c.id)}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`Calendar ${c.name}`}
                    >
                      <View style={[styles.dot, { backgroundColor: c.color || theme.color.textFaint }]} />
                      <Text style={[styles.calChipText, selected && styles.calChipTextOn]} numberOfLines={1}>
                        {c.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            <View style={styles.switchRow}>
              <Text style={styles.fieldLabel}>All day</Text>
              <Switch
                value={allDay}
                onValueChange={setAllDay}
                trackColor={{ true: theme.color.accentDim, false: theme.color.surfaceAlt }}
                thumbColor={allDay ? theme.color.accent : theme.color.textFaint}
                accessibilityLabel="All day"
              />
            </View>

            <Text style={styles.fieldLabel}>Start</Text>
            <TextInput
              style={styles.input}
              placeholder="YYYY-MM-DDTHH:MM"
              placeholderTextColor={theme.color.textFaint}
              value={start}
              onChangeText={setStart}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Start date and time"
            />

            <Text style={styles.fieldLabel}>End</Text>
            <TextInput
              style={styles.input}
              placeholder="YYYY-MM-DDTHH:MM"
              placeholderTextColor={theme.color.textFaint}
              value={end}
              onChangeText={setEnd}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="End date and time"
            />

            <Text style={styles.fieldLabel}>Location</Text>
            <TextInput
              style={styles.input}
              placeholder="Optional"
              placeholderTextColor={theme.color.textFaint}
              value={location}
              onChangeText={setLocation}
              accessibilityLabel="Location"
            />

            {formError ? <Text style={styles.formError}>{formError}</Text> : null}
          </ScrollView>

          <View style={styles.modalActions}>
            <Pressable
              style={styles.cancelBtn}
              onPress={close}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.saveBtn, !canSubmit && styles.saveBtnOff]}
              onPress={submit}
              disabled={!canSubmit}
              accessibilityRole="button"
              accessibilityLabel="Save event"
            >
              {saving ? (
                <ActivityIndicator color={theme.color.onAccent} />
              ) : (
                <Text style={styles.saveBtnText}>Save</Text>
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.bg },

  addBtn: { width: 24, height: 18, alignItems: 'center', justifyContent: 'center' },
  addBtnText: { color: theme.color.accent, fontSize: 26, fontWeight: '300', lineHeight: 26 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  list: { padding: 16, gap: 20 },
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

  daySection: { gap: 8 },
  dayHeader: {
    color: theme.color.textFaint,
    fontSize: theme.font.small,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  dayEvents: { gap: 8 },

  eventRow: {
    flexDirection: 'row',
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: 14,
    gap: 12,
  },
  eventLead: { width: 78, gap: 6 },
  dot: { width: 9, height: 9, borderRadius: 999 },
  eventTime: { color: theme.color.textDim, fontSize: theme.font.small, fontWeight: '600' },
  eventBody: { flex: 1, gap: 3 },
  eventTitle: { color: theme.color.text, fontSize: theme.font.body, fontWeight: '600' },
  eventMeta: { color: theme.color.textFaint, fontSize: theme.font.small },

  // Compose modal.
  modalRoot: { flex: 1, justifyContent: 'flex-end', backgroundColor: theme.color.scrim },
  modalSheet: {
    backgroundColor: theme.color.surface,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    paddingHorizontal: theme.space(5),
    paddingTop: theme.space(3),
    paddingBottom: theme.space(6),
    maxHeight: '88%',
  },
  modalHandle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 999,
    backgroundColor: theme.color.border,
    marginBottom: theme.space(3),
  },
  modalTitle: {
    color: theme.color.text,
    fontSize: theme.font.title,
    fontWeight: '700',
    marginBottom: theme.space(3),
  },
  form: { gap: theme.space(2), paddingBottom: theme.space(2) },
  fieldLabel: {
    color: theme.color.textFaint,
    fontSize: theme.font.small,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: theme.space(2),
  },
  input: {
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    color: theme.color.text,
    fontSize: theme.font.body,
    paddingHorizontal: theme.space(3),
    paddingVertical: theme.space(3),
  },
  hint: { color: theme.color.textFaint, fontSize: theme.font.small, lineHeight: 19 },

  calPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space(2) },
  calChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(2),
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.color.border,
    paddingHorizontal: theme.space(3),
    paddingVertical: theme.space(2),
    maxWidth: '100%',
  },
  calChipOn: { backgroundColor: theme.color.accentDim, borderColor: theme.color.accent },
  calChipText: { color: theme.color.textDim, fontSize: theme.font.small, fontWeight: '600', flexShrink: 1 },
  calChipTextOn: { color: theme.color.text },

  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: theme.space(2),
  },

  formError: { color: theme.color.danger, fontSize: theme.font.small, marginTop: theme.space(2) },

  modalActions: { flexDirection: 'row', gap: theme.space(3), marginTop: theme.space(4) },
  cancelBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: theme.space(3),
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    backgroundColor: theme.color.surfaceAlt,
  },
  cancelText: { color: theme.color.textDim, fontSize: theme.font.body, fontWeight: '600' },
  saveBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: theme.space(3),
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.accent,
  },
  saveBtnOff: { opacity: 0.4 },
  saveBtnText: { color: theme.color.onAccent, fontSize: theme.font.body, fontWeight: '700' },
});
