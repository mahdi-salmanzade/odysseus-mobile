/**
 * Text-to-speech read-aloud for assistant replies, on `expo-speech` (native
 * AVSpeechSynthesizer / Android TextToSpeech — offline, nothing leaves the
 * device, matching the local-first ethos). A tiny React hook tracks which
 * message is currently speaking so the UI can toggle a single play/stop control.
 */
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useState } from 'react';

import { currentLanguage } from '@/lib/i18n';

/** i18n code → TTS BCP-47 language tag. */
const TTS_TAGS: Record<string, string> = {
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  pt: 'pt-BR',
  ar: 'ar-SA',
  fa: 'fa-IR',
};

/**
 * Reduce markdown to speakable plain text: drop code fences, images, list/heading
 * markers, emphasis and link syntax, and collapse whitespace. Not a full parser —
 * just enough that the synthesizer reads prose, not punctuation.
 */
export function markdownToSpeech(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ') // fenced code
    .replace(/`([^`]+)`/g, '$1') // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → link text
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // heading markers
    .replace(/^\s*[-*+]\s+/gm, '') // bullet markers
    .replace(/^\s*\d+\.\s+/gm, '') // ordered-list markers
    .replace(/^\s*>\s?/gm, '') // blockquote markers
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1') // emphasis
    .replace(/\|/g, ' ') // table pipes
    .replace(/\s+/g, ' ')
    .trim();
}

export interface Speaker {
  /** Message id currently being spoken, or null. */
  speakingId: string | null;
  /** Speak `text` for `id`; if that id is already speaking, stops it (toggle). */
  toggle: (id: string, text: string) => void;
  /** Stop any current speech. */
  stop: () => void;
}

export function useSpeaker(): Speaker {
  const [speakingId, setSpeakingId] = useState<string | null>(null);

  const stop = useCallback(() => {
    Speech.stop().catch(() => {});
    setSpeakingId(null);
  }, []);

  // Never leave the synthesizer running after the screen unmounts.
  useEffect(() => () => void Speech.stop().catch(() => {}), []);

  const toggle = useCallback(
    (id: string, text: string) => {
      if (speakingId === id) {
        stop();
        return;
      }
      const body = markdownToSpeech(text);
      if (!body) return;
      Speech.stop().catch(() => {});
      setSpeakingId(id);
      Speech.speak(body, {
        language: TTS_TAGS[currentLanguage()] ?? 'en-US',
        onDone: () => setSpeakingId((cur) => (cur === id ? null : cur)),
        onStopped: () => setSpeakingId((cur) => (cur === id ? null : cur)),
        onError: () => setSpeakingId((cur) => (cur === id ? null : cur)),
      });
    },
    [speakingId, stop],
  );

  return { speakingId, toggle, stop };
}
