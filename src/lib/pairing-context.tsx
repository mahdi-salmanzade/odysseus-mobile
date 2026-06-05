/**
 * App-wide pairing state. Loads the stored pairing once on mount, exposes it,
 * and lets screens pair / unpair. `ready` gates the router so we don't flash the
 * pairing screen before the keychain read resolves.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import * as Network from 'expo-network';

import { setRelocateHandler, setUnauthorizedHandler } from '@/lib/api';
import { discoverServerHost } from '@/lib/discover';
import { dlog } from '@/lib/log';
import { clearPairing, isLanHost, loadPairing, savePairing, type Pairing } from '@/lib/pairing';
import { disablePushForPairing, enablePushForPairing } from '@/lib/push';

interface PairingContextValue {
  pairing: Pairing | null;
  ready: boolean;
  pair: (p: Pairing) => Promise<void>;
  unpair: () => Promise<void>;
  /**
   * Re-find the paired server on the current network (its IP may have changed
   * after a Wi-Fi switch) and update the stored host. Returns true if a server
   * was located (host updated if it moved), false if none was found.
   */
  relocate: () => Promise<boolean>;
  /**
   * Manually point the existing pairing at a new address (keeps the token).
   * For when the IP changed and you know the new one — no re-scan, no re-entering
   * the token. Returns false if the host/port are invalid.
   */
  setAddress: (host: string, port: number) => Promise<boolean>;
}

const PairingContext = createContext<PairingContextValue | null>(null);

export function PairingProvider({ children }: { children: ReactNode }) {
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [ready, setReady] = useState(false);

  // Always-current pairing for the relocate machinery below. The API-layer
  // handler and the network/foreground listeners are registered once and would
  // otherwise close over a stale pairing; reading through a ref keeps them
  // scanning with the live token/port.
  const pairingRef = useRef<Pairing | null>(pairing);
  useEffect(() => {
    pairingRef.current = pairing;
  }, [pairing]);

  // Coalesced LAN rediscovery. A network switch makes many in-flight calls fail
  // at once; without coalescing each would kick off its own 254-host sweep. We
  // share a single in-flight scan so a burst collapses to one sweep, and it's
  // cheap when nothing moved (discoverServerHost probes the stored host first).
  // Returns the relocated Pairing (host updated + persisted if it moved), or
  // null if the server wasn't found on the current network.
  const relocateInFlight = useRef<Promise<Pairing | null> | null>(null);
  const runRelocate = useCallback(async (): Promise<Pairing | null> => {
    if (relocateInFlight.current) return relocateInFlight.current;
    const cur = pairingRef.current;
    if (!cur) return null;
    const job = (async (): Promise<Pairing | null> => {
      const host = await discoverServerHost(cur);
      if (!host) {
        dlog('pair', 'relocate: no server found on this network');
        return null;
      }
      if (host === cur.host) {
        dlog('pair', `relocate: server confirmed at same host ${host}`);
        return cur;
      }
      const next = { ...cur, host };
      await savePairing(next);
      dlog('pair', `relocate: host updated ${cur.host} → ${host}`);
      setPairing(next); // host change re-runs screens' pairing-keyed effects → reconnect
      return next;
    })().finally(() => {
      // Clear the coalescing slot once the sweep settles, so the next network
      // change starts a fresh scan. (`.finally` instead of try/finally keeps the
      // provider compilable by React Compiler.)
      relocateInFlight.current = null;
    });
    relocateInFlight.current = job;
    return job;
  }, []);

  useEffect(() => {
    loadPairing()
      .then((p) => {
        dlog('pair', p ? `loaded pairing → ${p.host}:${p.port}` : 'no stored pairing');
        setPairing(p);
      })
      .finally(() => setReady(true));
  }, []);

  // Let the API layer self-heal: on a connection failure it asks us to relocate
  // and retries against the new host, so a Wi-Fi switch recovers on every screen,
  // not just chat.
  useEffect(() => {
    setRelocateHandler(() => runRelocate());
    return () => setRelocateHandler(null);
  }, [runRelocate]);

  // Proactive relocation: the moment the OS reports a (re)connected network, the
  // server's IP may have changed — fix the stored host before the user taps
  // anything. Coalesced with reactive relocates, and a no-op cost when the host
  // is unchanged. Also re-check on app foreground, since the network commonly
  // changes while the app is backgrounded (e.g. walking out of Wi-Fi range).
  useEffect(() => {
    const netSub = Network.addNetworkStateListener((state) => {
      if (state.isConnected && pairingRef.current) {
        dlog('pair', `network changed (type=${state.type}) — proactive relocate`);
        void runRelocate();
      }
    });
    const appSub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && pairingRef.current) {
        dlog('pair', 'app foregrounded — proactive relocate');
        void runRelocate();
      }
    });
    return () => {
      netSub.remove();
      appSub.remove();
    };
  }, [runRelocate]);

  // When any API call sees a 401 (revoked/invalid token), clear the stored
  // pairing. The router's Stack.Protected guard keys off `pairing`, so this
  // alone routes the user back to the pair screen from wherever they are —
  // no per-screen 401 handling needed.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearPairing().finally(() => setPairing(null));
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const value = useMemo<PairingContextValue>(
    () => ({
      pairing,
      ready,
      pair: async (p) => {
        await savePairing(p);
        setPairing(p);
        // Offer push as soon as we're paired. Fire-and-forget: a denied prompt
        // or push-less device must not delay landing on the chat screen.
        void enablePushForPairing(p);
      },
      unpair: async () => {
        // Best-effort: tell the server to forget this device before the token
        // goes away, so it doesn't keep a stale push target.
        if (pairing) await disablePushForPairing(pairing);
        await clearPairing();
        setPairing(null);
      },
      // Manual rescan from the UI (the chat screen's "Couldn't connect" retry).
      // Shares the single coalesced sweep with the automatic relocates above.
      relocate: async () => {
        if (!pairing) return false;
        dlog('pair', `relocate: scanning for server (was ${pairing.host})`);
        return (await runRelocate()) !== null;
      },
      setAddress: async (host, port) => {
        if (!pairing) return false;
        const h = host.trim();
        if (!isLanHost(h) || !Number.isInteger(port) || port < 1 || port > 65535) {
          dlog('pair', `setAddress: rejected ${h}:${port}`);
          return false;
        }
        const next = { ...pairing, host: h, port };
        await savePairing(next);
        dlog('pair', `setAddress: ${pairing.host}:${pairing.port} → ${h}:${port}`);
        setPairing(next); // re-runs screens' pairing-keyed effects → reconnect
        return true;
      },
    }),
    [pairing, ready, runRelocate],
  );

  return <PairingContext.Provider value={value}>{children}</PairingContext.Provider>;
}

export function usePairing(): PairingContextValue {
  const ctx = useContext(PairingContext);
  if (!ctx) throw new Error('usePairing must be used within a PairingProvider');
  return ctx;
}
