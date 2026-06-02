/**
 * Pairing = everything the phone needs to reach one Odysseus server:
 * host + port + an `ody_` API token. Persisted in the device keychain via
 * expo-secure-store (the token is a real credential, so never AsyncStorage).
 *
 * The pairing payload is exactly what the server's /api/companion/pair page
 * (and scripts/pair_mobile.py) emits, so a scanned QR parses straight through.
 */
import * as SecureStore from 'expo-secure-store';

const KEY = 'odysseus.pairing';

export interface Pairing {
  v: number;
  host: string;
  port: number;
  token: string;
}

export async function savePairing(p: Pairing): Promise<void> {
  // Bind the credential to this device and require the device be unlocked.
  // The pairing token is a LAN credential; there's no reason for it to sync to
  // iCloud Keychain or restore onto another device via an encrypted backup.
  await SecureStore.setItemAsync(KEY, JSON.stringify(p), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function loadPairing(): Promise<Pairing | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as Pairing;
    return isValidPairing(obj) ? obj : null;
  } catch {
    return null;
  }
}

export async function clearPairing(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}

/**
 * Is `host` a plausible LAN address? A scanned QR / typed string is untrusted
 * input that gets interpolated straight into the request URL — and we then send
 * the `ody_` bearer token to it. So we enforce the product's LAN-only contract:
 * accept private/loopback/link-local IPv4 (and CGNAT, for Tailscale), bare
 * single-label hostnames, and `*.local` mDNS names. This rejects URL-injection
 * shapes (schemes, `@`, `/`, `:`, whitespace) and public FQDNs, so a malicious
 * code can't redirect the token to an arbitrary internet host.
 */
export function isLanHost(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (m) {
    const o = [m[1], m[2], m[3], m[4]].map((n) => parseInt(n, 10));
    if (o.some((n) => n > 255)) return false;
    const [a, b] = o;
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // loopback
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 169 && b === 254) return true; // link-local
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (Tailscale)
    return false;
  }
  // Hostname shape only — no scheme, path, credentials, port, or whitespace.
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*(\.[a-zA-Z0-9-]+)*$/.test(host)) return false;
  // A dotted name must be an mDNS .local name; a bare label (e.g. "odysseus")
  // is a LAN hostname and is fine.
  return host.includes('.') ? host.toLowerCase().endsWith('.local') : true;
}

function isValidPairing(o: unknown): o is Pairing {
  if (!o || typeof o !== 'object') return false;
  const p = o as Record<string, unknown>;
  return (
    p.v === 1 &&
    typeof p.host === 'string' &&
    isLanHost(p.host) &&
    typeof p.port === 'number' &&
    Number.isInteger(p.port) &&
    p.port >= 1 &&
    p.port <= 65535 &&
    typeof p.token === 'string' &&
    p.token.startsWith('ody_') &&
    p.token.length >= 12
  );
}

/**
 * Parse a scanned QR / pasted code into a Pairing.
 * Accepts the JSON payload `{"v":1,"host":"...","port":7000,"token":"ody_..."}`.
 * Returns null if it isn't a valid Odysseus pairing code.
 */
export function parsePairingPayload(raw: string): Pairing | null {
  try {
    const obj = JSON.parse(raw.trim());
    // A QR's port may arrive as a string; coerce it. We do NOT coerce `v` — the
    // version field is the gate that rejects malformed/future payload shapes, so
    // let isValidPairing enforce v===1 strictly.
    if (typeof obj?.port === 'string') obj.port = parseInt(obj.port, 10);
    return isValidPairing(obj) ? (obj as Pairing) : null;
  } catch {
    return null;
  }
}

/** Build a pairing from manually-typed fields. Returns null if invalid. */
export function manualPairing(host: string, port: string, token: string): Pairing | null {
  const p: Pairing = {
    v: 1,
    host: host.trim(),
    port: parseInt(port.trim(), 10),
    token: token.trim(),
  };
  return isValidPairing(p) ? p : null;
}
