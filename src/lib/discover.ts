/**
 * LAN rediscovery — find the paired Odysseus server again after its IP changes.
 *
 * The pairing stores host + port + token. The token and port survive a network
 * change (hotspot → home Wi-Fi), but the server's LAN IP does not, so the stored
 * `host` goes stale and every call fails to connect. This scans the phone's
 * current /24 subnet for a host that identifies as Odysseus on the existing
 * `/api/companion/ping`, so we can swap in the new IP without re-pairing.
 *
 * Privacy/security: we do a TWO-PHASE scan to avoid spraying the bearer token
 * across the subnet. Phase 1 probes each host UNAUTHENTICATED — an Odysseus
 * returns 401 on the auth-gated ping, so only hosts that look like an
 * auth-protected companion server become candidates. Phase 2 sends the token
 * ONLY to those candidates to confirm identity (`name === "odysseus"`). The
 * found host is still re-validated through `isLanHost` before we trust it.
 */
import * as Network from 'expo-network';

import { dlog } from '@/lib/log';
import { isLanHost, type Pairing } from '@/lib/pairing';

const PROBE_TIMEOUT_MS = 1500;
const BATCH = 24; // concurrent probes per wave — bounded so we don't open 254 sockets at once

/** The phone's current /24 base (e.g. "192.168.1"), or null if unavailable. */
async function deviceSubnet(): Promise<{ base: string; selfOctet: number } | null> {
  try {
    const ip = await Network.getIpAddressAsync();
    dlog('scan', `device IP from expo-network: ${ip}`);
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip || '');
    if (!m) return null;
    return { base: `${m[1]}.${m[2]}.${m[3]}`, selfOctet: parseInt(m[4], 10) };
  } catch (e) {
    // Most likely the native module isn't in this build (rebuild needed).
    dlog('scan', 'getIpAddressAsync failed:', String(e));
    return null;
  }
}

/** Fetch with a hard timeout; resolves to null on any error/timeout. */
async function probe(url: string, init: RequestInit, timeoutMs: number): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Does this host identify as our Odysseus when we send the token? */
async function isOurServer(host: string, port: number, token: string): Promise<boolean> {
  const res = await probe(
    `http://${host}:${port}/api/companion/ping`,
    { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
    PROBE_TIMEOUT_MS,
  );
  if (!res || !res.ok) return false;
  try {
    const j = (await res.json()) as { name?: string; ok?: boolean };
    return j?.name === 'odysseus';
  } catch {
    return false;
  }
}

/**
 * Scan the phone's current subnet for the paired Odysseus on `pairing.port`.
 * Returns the host (IP) if found, else null. Tries the stored host first (the
 * IP may not have changed), then sweeps the /24.
 */
export async function discoverServerHost(pairing: Pairing): Promise<string | null> {
  const { host: storedHost, port, token } = pairing;
  dlog('scan', `start — stored host ${storedHost}:${port}`);

  // Cheap first: maybe the stored IP still works (failure was transient).
  if (await isOurServer(storedHost, port, token)) {
    dlog('scan', `stored host still works: ${storedHost}`);
    return storedHost;
  }

  const net = await deviceSubnet();
  if (!net) {
    dlog('scan', 'could not read device IP/subnet (expo-network missing or no Wi-Fi?) — aborting');
    return null;
  }
  // 169.254.x.x is a self-assigned (link-local) address: the phone joined a
  // network but never got a real DHCP lease, so it isn't on any routable LAN.
  // Scanning that range is pointless — bail with a clear signal.
  if (net.base.startsWith('169.254')) {
    dlog('scan', `phone has a self-assigned address (${net.base}.${net.selfOctet}) — not on a real Wi-Fi network. Reconnect Wi-Fi / re-join so it gets a 192.168.x / 10.x lease.`);
    return null;
  }
  dlog('scan', `device subnet ${net.base}.0/24 (self .${net.selfOctet}); sweeping :${port}`);

  // Phase 1 — unauthenticated probe across the /24 to find auth-gated companion
  // servers (Odysseus answers 401 here). Skip our own address.
  const octets: number[] = [];
  for (let o = 1; o <= 254; o++) if (o !== net.selfOctet) octets.push(o);

  const candidates: string[] = [];
  for (let i = 0; i < octets.length && candidates.length === 0; i += BATCH) {
    const wave = octets.slice(i, i + BATCH);
    const found = await Promise.all(
      wave.map(async (o) => {
        const host = `${net.base}.${o}`;
        const res = await probe(`http://${host}:${port}/api/companion/ping`, { method: 'GET' }, PROBE_TIMEOUT_MS);
        // 401 (auth required) or 200 → a companion server lives here.
        return res && (res.status === 401 || res.status === 200) ? host : null;
      }),
    );
    for (const h of found) if (h) candidates.push(h);
  }
  dlog('scan', `phase 1 done — ${candidates.length} candidate(s): ${candidates.join(', ') || '(none)'}`);

  // Phase 2 — token-confirm the candidates; first real Odysseus wins.
  for (const host of candidates) {
    if (!isLanHost(host)) continue;
    if (await isOurServer(host, port, token)) {
      dlog('scan', `MATCH ${host} — updating host`);
      return host;
    }
  }
  dlog('scan', 'no Odysseus found on this subnet');
  return null;
}
