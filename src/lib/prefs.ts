/**
 * Lightweight device-local preferences (not credentials). Currently just the
 * preferred chat model, chosen in Settings and honored by the chat screen when
 * it creates a new session. Persisted with expo-secure-store to avoid pulling in
 * a second storage dependency — the value isn't secret, just small and local.
 */
import * as SecureStore from 'expo-secure-store';

const MODEL_KEY = 'odysseus.model';

/** Identifies a model choice across restarts (endpoint + model name). */
export interface ModelPref {
  endpoint_id: string;
  model: string;
}

export async function loadModelPref(): Promise<ModelPref | null> {
  try {
    const raw = await SecureStore.getItemAsync(MODEL_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (obj && typeof obj.endpoint_id === 'string' && typeof obj.model === 'string') {
      return { endpoint_id: obj.endpoint_id, model: obj.model };
    }
    return null;
  } catch {
    return null;
  }
}

export async function saveModelPref(pref: ModelPref): Promise<void> {
  await SecureStore.setItemAsync(MODEL_KEY, JSON.stringify(pref));
}

export async function clearModelPref(): Promise<void> {
  await SecureStore.deleteItemAsync(MODEL_KEY).catch(() => {});
}
