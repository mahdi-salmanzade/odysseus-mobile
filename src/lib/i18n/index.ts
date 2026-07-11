/**
 * i18n setup: i18next + react-i18next, with the initial language resolved
 * synchronously from device-prefs (an explicit user choice) or the device
 * locale (`expo-localization`). Text direction follows the active language's
 * script; switching a language that changes direction reloads the app, because
 * React Native only re-lays-out RTL/LTR after a native reload.
 */
import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { I18nManager } from 'react-native';
import { initReactI18next } from 'react-i18next';

import { readDevicePrefs, writeDevicePrefs } from '@/lib/device-prefs';
import { reloadApp } from '@/lib/reload';

import ar from './locales/ar.json';
import de from './locales/de.json';
import en from './locales/en.json';
import es from './locales/es.json';
import fa from './locales/fa.json';
import fr from './locales/fr.json';
import pt from './locales/pt.json';

export interface LanguageMeta {
  code: string;
  /** Endonym — the language's own name, shown in the picker. */
  name: string;
  rtl: boolean;
}

/**
 * Languages the app ships translations for. Add a locale JSON + an entry here to
 * grow the list; keys missing from a locale fall back to English automatically.
 */
export const languages: LanguageMeta[] = [
  { code: 'en', name: 'English', rtl: false },
  { code: 'es', name: 'Español', rtl: false },
  { code: 'fr', name: 'Français', rtl: false },
  { code: 'de', name: 'Deutsch', rtl: false },
  { code: 'pt', name: 'Português', rtl: false },
  { code: 'ar', name: 'العربية', rtl: true },
  { code: 'fa', name: 'فارسی', rtl: true },
];

const resources = {
  en: { translation: en },
  es: { translation: es },
  fr: { translation: fr },
  de: { translation: de },
  pt: { translation: pt },
  ar: { translation: ar },
  fa: { translation: fa },
} as const;

const RTL_CODES = new Set(languages.filter((l) => l.rtl).map((l) => l.code));

export function isRtlLanguage(code: string): boolean {
  return RTL_CODES.has(code);
}

/** The active language's initial resolution: explicit pref, else device, else en. */
function resolveInitialLanguage(): string {
  const stored = readDevicePrefs().language;
  if (stored && stored in resources) return stored;
  const device = getLocales()[0]?.languageCode ?? 'en';
  return device in resources ? device : 'en';
}

const initialLanguage = resolveInitialLanguage();

i18n.use(initReactI18next).init({
  resources,
  lng: initialLanguage,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

// Align native layout direction with the initial language on every launch. RTL
// must be allowed first; forceRTL only takes full effect after a reload, but
// setting it at boot means a stored RTL choice is correct from the first frame.
I18nManager.allowRTL(true);
if (I18nManager.isRTL !== isRtlLanguage(initialLanguage)) {
  I18nManager.forceRTL(isRtlLanguage(initialLanguage));
}

export function currentLanguage(): string {
  return i18n.language;
}

/**
 * Persist and switch the UI language. If the new language flips text direction,
 * the app reloads to re-lay-out; otherwise the change is applied live.
 */
export async function setLanguage(code: string): Promise<void> {
  if (!(code in resources)) return;
  writeDevicePrefs({ language: code });
  const flipsDirection = isRtlLanguage(code) !== I18nManager.isRTL;
  await i18n.changeLanguage(code);
  if (flipsDirection) {
    I18nManager.forceRTL(isRtlLanguage(code));
    await reloadApp();
  }
}

export default i18n;
