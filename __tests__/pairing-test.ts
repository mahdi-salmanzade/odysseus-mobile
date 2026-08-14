/**
 * Layer 1 — pure logic. No device, no network, milliseconds to run.
 *
 * pairing.ts is the trust boundary: a scanned QR / typed string is untrusted
 * input that we interpolate into the request URL and then send the `ody_` bearer
 * token to. These tests pin both the happy path AND the security contract
 * (LAN-only host validation rejects URL-injection / token-exfil shapes).
 */
import * as SecureStore from 'expo-secure-store';

import {
  isLanHost,
  isPairableHost,
  isTlsHost,
  parsePairingPayload,
  manualPairing,
  savePairing,
  loadPairing,
  clearPairing,
  splitScheme,
  type Pairing,
} from '@/lib/pairing';

// In-memory stand-in for the device keychain so save/load/clear are testable in
// Node. We assert it's called with the device-only accessibility option too.
// (jest.mock is hoisted above the imports by babel-jest, so the import below
// still receives this mock.)
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked-this-device-only',
    setItemAsync: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    deleteItemAsync: jest.fn(async (k: string) => void store.delete(k)),
    __store: store,
  };
});

const VALID: Pairing ={ v: 1, host: '192.168.1.50', port: 7000, token: 'ody_abcdefgh' };

describe('isLanHost', () => {
  test.each([
    '10.0.0.1', // 10/8
    '192.168.1.50', // 192.168/16
    '172.16.0.1', // 172.16/12 low
    '172.31.255.255', // 172.16/12 high
    '127.0.0.1', // loopback
    '169.254.1.1', // link-local
    '100.64.0.1', // CGNAT / Tailscale
    'odysseus', // bare single-label hostname
    'my-server.local', // mDNS
    'NAS.LOCAL', // mDNS, case-insensitive
  ])('accepts LAN host %s', (h) => {
    expect(isLanHost(h)).toBe(true);
  });

  test.each([
    '8.8.8.8', // public
    '172.15.0.1', // just below 172.16/12
    '172.32.0.1', // just above 172.16/12
    '11.0.0.1', // public (not 10/8)
    '256.1.1.1', // octet > 255
    'example.com', // public FQDN
    'evil.com', // public FQDN
    'http://192.168.1.1', // scheme — URL injection
    '192.168.1.1/path', // path — URL injection
    '192.168.1.1:8080', // embedded port
    'user@192.168.1.1', // credentials — token-exfil shape
    '192.168.1.1 ', // trailing whitespace
    '', // empty
    'a b', // whitespace
  ])('rejects non-LAN / injection host %s', (h) => {
    expect(isLanHost(h)).toBe(false);
  });
});

describe('isTlsHost / isPairableHost', () => {
  test.each([
    'box.tail1234.ts.net', // Tailscale MagicDNS FQDN behind `tailscale serve`
    'odysseus.example.com', // a reverse-proxy vhost
    'my-mac', // bare MagicDNS label
    'nas.local', // mDNS
    '203.0.113.7', // public IP literal with a cert in front
  ])('an https pairing accepts %s', (h) => {
    expect(isTlsHost(h)).toBe(true);
    expect(isPairableHost(h, true)).toBe(true);
  });

  test.each([
    'https://box.ts.net', // scheme — URL injection
    'evil.com/path', // path
    'user@evil.com', // credentials
    'evil.com:443', // embedded port
    'box .ts.net', // whitespace
    '', // empty
    '256.1.1.1', // not a valid IP literal
  ])('rejects injection shape %s even over https', (h) => {
    expect(isTlsHost(h)).toBe(false);
    expect(isPairableHost(h, true)).toBe(false);
  });

  test('cleartext stays LAN-only — the https allowance does not leak into http', () => {
    expect(isPairableHost('box.tail1234.ts.net', false)).toBe(false);
    expect(isPairableHost('box.tail1234.ts.net', undefined)).toBe(false);
    expect(isLanHost('box.tail1234.ts.net')).toBe(false);
  });
});

describe('splitScheme', () => {
  test.each([
    ['https://box.ts.net', { host: 'box.ts.net', tls: true }],
    ['http://192.168.1.50', { host: '192.168.1.50', tls: false }],
    ['HTTPS://Box.ts.net/', { host: 'Box.ts.net', tls: true }],
    ['  https://box.ts.net//  ', { host: 'box.ts.net', tls: true }],
    ['192.168.1.50', { host: '192.168.1.50', tls: undefined }],
  ])('splits %s', (raw, expected) => {
    expect(splitScheme(raw)).toEqual(expected);
  });
});

describe('parsePairingPayload', () => {
  test('parses a valid JSON payload', () => {
    expect(parsePairingPayload(JSON.stringify(VALID))).toEqual(VALID);
  });

  test('coerces a string port (QR encoders often stringify numbers)', () => {
    const raw = JSON.stringify({ ...VALID, port: '7000' });
    expect(parsePairingPayload(raw)).toEqual(VALID);
  });

  test('tolerates surrounding whitespace', () => {
    expect(parsePairingPayload(`  ${JSON.stringify(VALID)}\n`)).toEqual(VALID);
  });

  test('accepts a remote host when the payload asks for tls', () => {
    const raw = JSON.stringify({ ...VALID, host: 'box.tail1234.ts.net', port: 443, tls: true });
    expect(parsePairingPayload(raw)).toEqual({
      v: 1,
      host: 'box.tail1234.ts.net',
      port: 443,
      token: VALID.token,
      tls: true,
    });
  });

  test('coerces a stringified tls flag', () => {
    const raw = JSON.stringify({ ...VALID, host: 'box.ts.net', port: 443, tls: 'true' });
    expect(parsePairingPayload(raw)?.tls).toBe(true);
  });

  test('drops a falsy tls flag rather than storing it', () => {
    expect(parsePairingPayload(JSON.stringify({ ...VALID, tls: false }))).toEqual(VALID);
    expect(parsePairingPayload(JSON.stringify({ ...VALID, tls: 'no' }))).toEqual(VALID);
  });

  test('rejects a remote host without tls (cleartext to the internet)', () => {
    expect(parsePairingPayload(JSON.stringify({ ...VALID, host: 'evil.com' }))).toBeNull();
  });

  test.each([
    ['non-JSON', 'not json at all'],
    ['empty string', ''],
    ['wrong version', JSON.stringify({ ...VALID, v: 2 })],
    ['version as string (not coerced)', JSON.stringify({ ...VALID, v: '1' })],
    ['public host', JSON.stringify({ ...VALID, host: 'evil.com' })],
    ['bad token prefix', JSON.stringify({ ...VALID, token: 'sk-abcdefgh' })],
    ['short token', JSON.stringify({ ...VALID, token: 'ody_a' })],
    ['port out of range', JSON.stringify({ ...VALID, port: 70000 })],
    ['port zero', JSON.stringify({ ...VALID, port: 0 })],
    ['missing token', JSON.stringify({ v: 1, host: '10.0.0.1', port: 7000 })],
  ])('rejects %s', (_label, raw) => {
    expect(parsePairingPayload(raw)).toBeNull();
  });
});

describe('manualPairing', () => {
  test('builds a pairing from typed fields, trimming whitespace', () => {
    expect(manualPairing(' 192.168.1.50 ', ' 7000 ', ' ody_abcdefgh ')).toEqual(VALID);
  });

  test('returns null for a public host', () => {
    expect(manualPairing('example.com', '7000', 'ody_abcdefgh')).toBeNull();
  });

  test('returns null for a non-numeric port', () => {
    expect(manualPairing('10.0.0.1', 'abc', 'ody_abcdefgh')).toBeNull();
  });

  test('builds an https pairing when the toggle is on', () => {
    expect(manualPairing('box.tail1234.ts.net', '443', 'ody_abcdefgh', true)).toEqual({
      v: 1,
      host: 'box.tail1234.ts.net',
      port: 443,
      token: 'ody_abcdefgh',
      tls: true,
    });
  });

  test('a pasted https:// URL turns on tls and is stripped from the host', () => {
    expect(manualPairing('https://box.ts.net/', '443', 'ody_abcdefgh')).toEqual({
      v: 1,
      host: 'box.ts.net',
      port: 443,
      token: 'ody_abcdefgh',
      tls: true,
    });
  });

  test('a typed scheme overrides the toggle', () => {
    // http:// with the HTTPS switch on → cleartext rules apply, so a remote host
    // is refused rather than silently upgraded.
    expect(manualPairing('http://box.ts.net', '443', 'ody_abcdefgh', true)).toBeNull();
    expect(manualPairing('http://192.168.1.50', '7000', 'ody_abcdefgh', true)).toEqual(VALID);
  });

  test('does not store tls:false for a plain LAN pairing', () => {
    const p = manualPairing('192.168.1.50', '7000', 'ody_abcdefgh', false);
    expect(p).toEqual(VALID);
    expect('tls' in (p as object)).toBe(false);
  });
});

describe('secure-store round-trip', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await clearPairing();
  });

  test('save then load returns the same pairing', async () => {
    await savePairing(VALID);
    expect(await loadPairing()).toEqual(VALID);
  });

  test('binds the credential to this device only (no iCloud sync)', async () => {
    await savePairing(VALID);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'odysseus.pairing',
      JSON.stringify(VALID),
      { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
    );
  });

  test('load returns null when nothing is stored', async () => {
    expect(await loadPairing()).toBeNull();
  });

  test('load returns null (not throw) on corrupt stored JSON', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce('{ not json');
    expect(await loadPairing()).toBeNull();
  });

  test('load rejects a stored-but-now-invalid pairing (e.g. tampered host)', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(
      JSON.stringify({ ...VALID, host: 'evil.com' }),
    );
    expect(await loadPairing()).toBeNull();
  });

  test('clear deletes the stored credential', async () => {
    await savePairing(VALID);
    await clearPairing();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('odysseus.pairing');
    expect(await loadPairing()).toBeNull();
  });
});
