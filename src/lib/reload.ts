/**
 * Reload the whole JS app. Used after changes that must re-run module-level
 * StyleSheets or native layout direction — theme swap and RTL toggle — which a
 * React re-render alone can't pick up. Prefers the OTA-safe `expo-updates`
 * reload in a real build and falls back to `DevSettings.reload()` in dev.
 */
import { DevSettings } from 'react-native';
import * as Updates from 'expo-updates';

export async function reloadApp(): Promise<void> {
  try {
    await Updates.reloadAsync();
  } catch {
    try {
      DevSettings.reload();
    } catch {
      // nothing else to try; the caller's change is already persisted and will
      // take effect on the next manual launch
    }
  }
}
