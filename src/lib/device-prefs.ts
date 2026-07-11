/**
 * Tiny synchronous device-local settings (theme id, UI language) that must be
 * known *before* the first component styles itself. `expo-secure-store` is
 * async-only, and these values aren't secret — so they live in a small JSON
 * file read with expo-file-system's synchronous `textSync()` at module load.
 *
 * This is deliberately separate from `prefs.ts` (async, secure-store): those are
 * read after mount; these gate the very first render (theme palette + text
 * direction), so a synchronous read avoids a default-themed flash on cold start.
 */
import { File, Paths } from 'expo-file-system';

export interface DevicePrefs {
  /** Selected theme id (key into `themes`). */
  themeId?: string;
  /** Forced UI language tag (e.g. 'en', 'ar'); undefined = follow device. */
  language?: string;
}

const FILE_NAME = 'device-prefs.json';

function prefsFile(): File {
  return new File(Paths.document, FILE_NAME);
}

/** Synchronously read the stored prefs. Never throws; returns {} on any error. */
export function readDevicePrefs(): DevicePrefs {
  try {
    const f = prefsFile();
    if (!f.exists) return {};
    const obj = JSON.parse(f.textSync());
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

/** Merge and persist prefs synchronously. Never throws. */
export function writeDevicePrefs(patch: Partial<DevicePrefs>): void {
  try {
    const next = { ...readDevicePrefs(), ...patch };
    const f = prefsFile();
    if (!f.exists) f.create();
    f.write(JSON.stringify(next));
  } catch {
    // best-effort; a failed persist just means the choice resets next launch
  }
}
