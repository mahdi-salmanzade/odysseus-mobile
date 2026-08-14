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
  /**
   * Talk to the server over `https://` instead of `http://`. Set when Odysseus
   * sits behind a TLS reverse proxy (`tailscale serve`, Caddy, nginx) — which is
   * the only way to reach it from outside the LAN: iOS App Transport Security
   * blocks cleartext to anything but the local network, so `http://100.x.y.z`
   * (Tailscale CGNAT) never leaves the device. Omitted (not `false`) for a plain
   * LAN pairing, so the stored payload keeps its original shape.
   */
  tls?: boolean;
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

/** Hostname shape only — no scheme, path, credentials, port, or whitespace. */
const HOSTNAME = /^[a-zA-Z0-9][a-zA-Z0-9-]*(\.[a-zA-Z0-9-]+)*$/;

/** Parse a dotted-quad into its octets, or null if it isn't one. */
function ipv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const o = [m[1], m[2], m[3], m[4]].map((n) => parseInt(n, 10));
  return o.some((n) => n > 255) ? null : o;
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
  const o = ipv4(host);
  if (o) {
    const [a, b] = o;
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // loopback
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 169 && b === 254) return true; // link-local
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (Tailscale)
    return false;
  }
  if (host.includes('.') || host.includes(':')) {
    // A dotted name must be an mDNS .local name; a bare label (e.g. "odysseus")
    // is a LAN hostname and is fine.
    return HOSTNAME.test(host) && host.toLowerCase().endsWith('.local');
  }
  return HOSTNAME.test(host);
}

/**
 * Host rule for an **https** pairing: any well-formed hostname or IP literal.
 *
 * The LAN-only rule above exists because cleartext + an arbitrary host would let
 * a hostile code ship the bearer token to any internet server in the clear. With
 * TLS the token is encrypted and the certificate binds the connection to the
 * name the user typed, so the remote-access setups people actually run —
 * `foo.tailnet.ts.net` via `tailscale serve`, a Caddy/nginx vhost — are allowed.
 * The shape check still rejects scheme/path/credential/port injection.
 */
export function isTlsHost(host: string): boolean {
  if (host.length > 253) return false;
  // An all-numeric host has to be a well-formed IPv4 literal — `256.1.1.1`
  // satisfies the hostname grammar but is nobody's server.
  if (/^[\d.]+$/.test(host)) return ipv4(host) !== null;
  return HOSTNAME.test(host);
}

/** The host rule that gates a pairing, given its transport. */
export function isPairableHost(host: string, tls?: boolean): boolean {
  return tls ? isTlsHost(host) : isLanHost(host);
}

/**
 * Split an optional scheme off a typed or pasted address:
 * `"https://box.tail1234.ts.net/"` → `{ host: 'box.tail1234.ts.net', tls: true }`.
 * Returns `tls: undefined` when no scheme was given, so callers can fall back to
 * an explicit toggle (or to the pairing's current transport) instead of guessing.
 */
export function splitScheme(raw: string): { host: string; tls?: boolean } {
  let host = raw.trim();
  let tls: boolean | undefined;
  const m = /^(https?):\/\//i.exec(host);
  if (m) {
    tls = m[1].toLowerCase() === 'https';
    host = host.slice(m[0].length);
  }
  return { host: host.replace(/\/+$/, '').trim(), tls };
}

function isValidPairing(o: unknown): o is Pairing {
  if (!o || typeof o !== 'object') return false;
  const p = o as Record<string, unknown>;
  if (p.tls !== undefined && typeof p.tls !== 'boolean') return false;
  return (
    p.v === 1 &&
    typeof p.host === 'string' &&
    isPairableHost(p.host, p.tls === true) &&
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
 * Accepts the JSON payload `{"v":1,"host":"...","port":7000,"token":"ody_..."}`,
 * optionally with `"tls":true` for a server reached over https.
 * Returns null if it isn't a valid Odysseus pairing code.
 */
export function parsePairingPayload(raw: string): Pairing | null {
  try {
    const obj = JSON.parse(raw.trim());
    // A QR's port may arrive as a string; coerce it. We do NOT coerce `v` — the
    // version field is the gate that rejects malformed/future payload shapes, so
    // let isValidPairing enforce v===1 strictly.
    if (typeof obj?.port === 'string') obj.port = parseInt(obj.port, 10);
    // Same tolerance for `tls`, which QR encoders may stringify. A falsy value
    // is dropped rather than stored, keeping a LAN payload's shape unchanged.
    if (typeof obj?.tls === 'string') obj.tls = /^(1|true|yes)$/i.test(obj.tls.trim());
    if (obj && obj.tls !== true) delete obj.tls;
    return isValidPairing(obj) ? (obj as Pairing) : null;
  } catch {
    return null;
  }
}

/**
 * Build a pairing from manually-typed fields. Returns null if invalid.
 * A scheme typed into the host field (`https://box`) wins over `tls`, so pasting
 * a full URL does the obvious thing whatever the toggle says.
 */
export function manualPairing(
  host: string,
  port: string,
  token: string,
  tls?: boolean,
): Pairing | null {
  const parsed = splitScheme(host);
  const secure = parsed.tls ?? tls ?? false;
  const p: Pairing = {
    v: 1,
    host: parsed.host,
    port: parseInt(port.trim(), 10),
    token: token.trim(),
    ...(secure ? { tls: true } : {}),
  };
  return isValidPairing(p) ? p : null;
}
