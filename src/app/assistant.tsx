import { useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NavIcon } from '@/components/nav-icon';
import { ScreenHeader } from '@/components/screen-header';
import { theme } from '@/constants/theme';
import { ApiError, getAssistant, updateAssistant, type Assistant } from '@/lib/api';
import { usePairing } from '@/lib/pairing-context';
import { useSidebar } from '@/lib/sidebar-context';

// The editable text fields, in render order. Tracking them as one record keeps
// dirty-checking and the PATCH body trivial — each maps 1:1 to an Assistant key
// the bridge accepts.
type Field = 'name' | 'user_name' | 'personality' | 'greeting' | 'model' | 'timezone';
type Form = Record<Field, string>;

const EMPTY: Form = {
  name: '',
  user_name: '',
  personality: '',
  greeting: '',
  model: '',
  timezone: '',
};

// Map a loaded assistant (nullable fields) into the form's all-strings shape.
function toForm(a: Assistant | null): Form {
  return {
    name: a?.name ?? '',
    user_name: a?.user_name ?? '',
    personality: a?.personality ?? '',
    greeting: a?.greeting ?? '',
    model: a?.model ?? '',
    timezone: a?.timezone ?? '',
  };
}

export default function AssistantScreen() {
  const { pairing } = usePairing();
  const { openSidebar } = useSidebar();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // null = not set up yet (GET returned null); drives the intro banner.
  const [exists, setExists] = useState(false);

  const [form, setForm] = useState<Form>(EMPTY);
  // The values as they are on the server, so we can compute dirty + reset Save.
  const [saved, setSaved] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  // Guard async writes against an unmounted/navigated-away screen.
  const cancelled = useRef(false);

  const load = useCallback(async () => {
    if (!pairing) return;
    cancelled.current = false;
    setLoading(true);
    setError(null);
    try {
      const a = await getAssistant(pairing);
      if (cancelled.current) return;
      const next = toForm(a);
      setExists(a !== null);
      setForm(next);
      setSaved(next);
    } catch (e) {
      if (cancelled.current) return;
      setError(e instanceof ApiError ? e.message : 'Could not load your assistant.');
    } finally {
      if (!cancelled.current) setLoading(false);
    }
  }, [pairing]);

  useFocusEffect(
    useCallback(() => {
      load();
      return () => {
        cancelled.current = true;
      };
    }, [load]),
  );

  const set = useCallback((field: Field, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setSavedFlash(false);
    setSaveError(null);
  }, []);

  // Dirty = any field differs from the last-saved values.
  const dirty = (Object.keys(form) as Field[]).some((k) => form[k] !== saved[k]);

  const save = useCallback(async () => {
    if (!pairing || saving || !dirty) return;
    setSaving(true);
    setSaveError(null);
    setSavedFlash(false);
    try {
      // Send only the fields that changed; the bridge leaves omitted keys alone.
      const changed: Partial<Record<Field, string>> = {};
      for (const k of Object.keys(form) as Field[]) {
        if (form[k] !== saved[k]) changed[k] = form[k];
      }
      const updated = await updateAssistant(pairing, changed);
      if (cancelled.current) return;
      const next = toForm(updated);
      setExists(true);
      setForm(next);
      setSaved(next);
      setSavedFlash(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e) {
      if (cancelled.current) return;
      setSaveError(e instanceof ApiError ? e.message : 'Could not save your assistant.');
    } finally {
      if (!cancelled.current) setSaving(false);
    }
  }, [pairing, saving, dirty, form, saved]);

  const saveDisabled = saving || !dirty;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Assistant"
        onMenu={openSidebar}
        right={
          <Pressable
            hitSlop={{ top: 13, bottom: 13, left: 13, right: 13 }}
            onPress={save}
            disabled={saveDisabled}
            style={({ pressed }) => [styles.saveSlot, pressed && !saveDisabled && { opacity: 0.6 }]}
            accessibilityRole="button"
            accessibilityLabel="Save assistant"
            accessibilityState={{ disabled: saveDisabled }}
          >
            {saving ? (
              <ActivityIndicator color={theme.color.accent} />
            ) : (
              <Text style={[styles.saveText, saveDisabled && styles.saveTextOff]}>Save</Text>
            )}
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
          <Pressable
            style={({ pressed }) => [styles.retry, pressed && { opacity: 0.7 }]}
            onPress={load}
            accessibilityRole="button"
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.flex}
          keyboardVerticalOffset={8}
        >
          <ScrollView
            contentContainerStyle={styles.body}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
          >
            {!exists && (
              <View style={styles.intro}>
                <NavIcon name="assistant" size={40} color={theme.color.textFaint} />
                <Text style={styles.introTitle}>Set up your assistant</Text>
                <Text style={styles.introHint}>
                  Give your assistant a name, a personality, and tell it what to call you. Saving
                  creates it on your Odysseus server.
                </Text>
              </View>
            )}

            <FormField
              label="Name"
              value={form.name}
              onChangeText={(v) => set('name', v)}
              placeholder="e.g. Ody"
              accessibilityLabel="Assistant name"
            />

            <FormField
              label="What it calls you"
              value={form.user_name}
              onChangeText={(v) => set('user_name', v)}
              placeholder="e.g. Captain"
              accessibilityLabel="What the assistant calls you"
            />

            <FormField
              label="Personality / system prompt"
              value={form.personality}
              onChangeText={(v) => set('personality', v)}
              placeholder="Describe how your assistant should think, speak, and behave…"
              accessibilityLabel="Personality or system prompt"
              multiline
              minHeight={140}
            />

            <FormField
              label="Greeting"
              value={form.greeting}
              onChangeText={(v) => set('greeting', v)}
              placeholder="The first thing it says when you start a chat…"
              accessibilityLabel="Greeting"
              multiline
              minHeight={72}
            />

            <FormField
              label="Model"
              value={form.model}
              onChangeText={(v) => set('model', v)}
              placeholder="Optional, leave blank for the server default"
              accessibilityLabel="Model"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <FormField
              label="Timezone"
              value={form.timezone}
              onChangeText={(v) => set('timezone', v)}
              placeholder="Optional, e.g. America/New_York"
              accessibilityLabel="Timezone"
              autoCapitalize="none"
              autoCorrect={false}
            />

            {saveError ? <Text style={styles.saveErrorText}>{saveError}</Text> : null}
            {savedFlash ? <Text style={styles.savedText}>Saved.</Text> : null}

            <Pressable
              onPress={save}
              disabled={saveDisabled}
              style={({ pressed }) => [
                styles.saveBtn,
                saveDisabled && styles.saveBtnOff,
                pressed && !saveDisabled && { opacity: 0.85 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Save assistant"
              accessibilityState={{ disabled: saveDisabled }}
            >
              {saving ? (
                <ActivityIndicator color={theme.color.bg} />
              ) : (
                <Text style={styles.saveBtnText}>{exists ? 'Save changes' : 'Create assistant'}</Text>
              )}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
  multiline,
  minHeight,
  autoCapitalize,
  autoCorrect,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  accessibilityLabel: string;
  multiline?: boolean;
  minHeight?: number;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoCorrect?: boolean;
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput keyboardAppearance="dark"
        style={[styles.input, multiline && styles.inputMultiline, minHeight ? { minHeight } : null]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.color.textFaint}
        accessibilityLabel={accessibilityLabel}
        multiline={multiline}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.bg },
  flex: { flex: 1 },

  saveSlot: { minWidth: 36, height: 36, alignItems: 'flex-end', justifyContent: 'center' },
  saveText: { color: theme.color.accent, fontSize: theme.font.body, fontWeight: '700' },
  saveTextOff: { color: theme.color.textFaint },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.space(8), gap: theme.space(3) },
  errorText: { color: theme.color.danger, fontSize: theme.font.body, textAlign: 'center' },
  retry: {
    paddingHorizontal: theme.space(5),
    paddingVertical: theme.space(2.5),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  retryText: { color: theme.color.accent, fontSize: theme.font.body, fontWeight: '600' },

  body: {
    paddingHorizontal: theme.space(5),
    paddingBottom: theme.space(5),
    gap: theme.space(4.5),
  },

  intro: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space(5),
    alignItems: 'center',
    gap: theme.space(2),
  },
  introTitle: { color: theme.color.text, fontSize: theme.font.body, fontWeight: '700' },
  introHint: { color: theme.color.textFaint, fontSize: theme.font.small, lineHeight: 19, textAlign: 'center' },

  fieldWrap: { gap: theme.space(2) },
  fieldLabel: {
    color: theme.color.textFaint,
    fontSize: theme.font.small,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space(3.5),
    paddingVertical: theme.space(3),
    color: theme.color.text,
    fontSize: theme.font.body,
  },
  inputMultiline: { textAlignVertical: 'top', lineHeight: 21 },

  saveErrorText: { color: theme.color.danger, fontSize: theme.font.small, lineHeight: 19 },
  savedText: { color: theme.color.ok, fontSize: theme.font.small, fontWeight: '600' },

  saveBtn: {
    backgroundColor: theme.color.accent,
    borderRadius: theme.radius.md,
    paddingVertical: 13,
    alignItems: 'center',
  },
  saveBtnOff: { opacity: 0.4 },
  saveBtnText: { color: theme.color.bg, fontSize: theme.font.body, fontWeight: '700' },
});
