/**
 * On-device speech-to-text for the composer.
 *
 * Wraps `expo-speech-recognition` so the chat screen only sees: is the mic
 * available, are we currently listening, and a `toggle(text, setText)` that
 * dictates into the existing input. We prefer **on-device** recognition
 * (iOS `SFSpeechRecognizer` with `requiresOnDeviceRecognition`, Android 13+
 * `SpeechRecognizer`) so a user's voice never leaves the phone — matching
 * Odysseus's local-first, privacy-first ethos. When the device can't do it
 * on-device we fall back to the platform recognizer rather than failing.
 */
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** Join two fragments with a single separating space (and no leading space). */
function join(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return `${a} ${b}`;
}

export type Dictation = {
  /** Recognition is supported on this device (mic button is hidden otherwise). */
  available: boolean;
  /** A listening session is in progress. */
  recognizing: boolean;
  /** Start/stop dictating. `text` seeds the session; `setText` receives updates. */
  toggle: (text: string, setText: (next: string) => void) => void;
  /** Stop listening and commit whatever was heard (mic-tap to finish). */
  stop: () => void;
  /** Stop listening AND discard any trailing transcript (used by send()). */
  cancel: () => void;
};

export function useDictation(): Dictation {
  // Synchronous capability probe — read once at mount, not in an effect.
  const [available] = useState(() => {
    try {
      return ExpoSpeechRecognitionModule.isRecognitionAvailable();
    } catch {
      return false;
    }
  });
  const [recognizing, setRecognizing] = useState(false);

  // The text already in the input when dictation started — committed final
  // segments are appended onto this, never replacing what the user typed.
  const baseRef = useRef('');
  // Final segments committed so far this session. In `continuous` mode the
  // recognizer emits a fresh transcript per utterance; once one is `isFinal`
  // we fold it in here so the next utterance doesn't overwrite it.
  const finalRef = useRef('');
  // Where to push transcript updates. Held in a ref so the (stable) event
  // handlers always target the input that owns the *current* session.
  const setTextRef = useRef<((next: string) => void) | null>(null);
  // Interim results arrive many times per second; writing each one straight to
  // the input state re-renders the chat screen on every tick and feels laggy.
  // Coalesce them on a short timer (final results flush immediately).
  const pendingRef = useRef<string | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards a single fallback retry: if on-device recognition errors out we
  // restart once with the cloud recognizer instead of leaving the user stuck.
  const triedOnDeviceRef = useRef(false);

  const flush = useCallback(() => {
    flushTimerRef.current = null;
    if (pendingRef.current !== null) {
      setTextRef.current?.(pendingRef.current);
      pendingRef.current = null;
    }
  }, []);

  // Queue a transcript update; `immediate` bypasses the timer for final results.
  const queue = useCallback(
    (next: string, immediate: boolean) => {
      pendingRef.current = next;
      if (immediate) {
        if (flushTimerRef.current) {
          clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }
        flush();
      } else if (!flushTimerRef.current) {
        flushTimerRef.current = setTimeout(flush, 120);
      }
    },
    [flush],
  );

  // Make sure a session — and any pending flush — never outlives the screen.
  useEffect(() => {
    return () => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {
        /* nothing in flight */
      }
    };
  }, []);

  useSpeechRecognitionEvent('start', () => setRecognizing(true));
  useSpeechRecognitionEvent('end', () => {
    setRecognizing(false);
    // Land whatever was buffered when the recognizer stops.
    flush();
  });

  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results[0]?.transcript ?? '';
    if (!transcript) return;
    if (event.isFinal) {
      finalRef.current = join(finalRef.current, transcript);
      queue(join(baseRef.current, finalRef.current), true);
    } else {
      // Show the in-progress utterance on top of what's already committed.
      queue(join(baseRef.current, join(finalRef.current, transcript)), false);
    }
  });

  useSpeechRecognitionEvent('error', (event) => {
    setRecognizing(false);
    // On-device unavailable for this locale/model — retry once via the cloud
    // recognizer so dictation still works (e.g. Android without the offline
    // model downloaded). 'aborted' is a normal user-initiated stop, skip it.
    if (triedOnDeviceRef.current && event.error !== 'aborted') {
      triedOnDeviceRef.current = false;
      try {
        ExpoSpeechRecognitionModule.start({
          lang: 'en-US',
          interimResults: true,
          continuous: true,
          requiresOnDeviceRecognition: false,
        });
      } catch {
        /* give up quietly — the mic just returns to idle */
      }
    }
  });

  const begin = useCallback((onDevice: boolean) => {
    triedOnDeviceRef.current = onDevice;
    ExpoSpeechRecognitionModule.start({
      lang: 'en-US',
      interimResults: true,
      // Keep listening across pauses so a multi-sentence message dictates in one go.
      continuous: true,
      requiresOnDeviceRecognition: onDevice,
    });
  }, []);

  const stop = useCallback(() => {
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      /* nothing in flight */
    }
  }, []);

  // Hard cancel: mute the sink first so the final `result`/`end` that the
  // native stop emits can't write into an input the caller is about to clear
  // (flush() and the result handler both no-op once setTextRef is null), then
  // abort the recognizer immediately. A later toggle() re-arms the sink.
  const cancel = useCallback(() => {
    setTextRef.current = null;
    pendingRef.current = null;
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    try {
      ExpoSpeechRecognitionModule.abort();
    } catch {
      /* nothing in flight */
    }
  }, []);

  const toggle = useCallback(
    (text: string, setText: (next: string) => void) => {
      if (recognizing) {
        stop();
        return;
      }
      (async () => {
        const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        if (!perm.granted) return;
        baseRef.current = text.trim();
        finalRef.current = '';
        pendingRef.current = null;
        setTextRef.current = setText;
        let onDevice = false;
        try {
          onDevice = ExpoSpeechRecognitionModule.supportsOnDeviceRecognition();
        } catch {
          onDevice = false;
        }
        begin(onDevice);
      })();
    },
    [recognizing, begin, stop],
  );

  return useMemo(
    () => ({ available, recognizing, toggle, stop, cancel }),
    [available, recognizing, toggle, stop, cancel],
  );
}
