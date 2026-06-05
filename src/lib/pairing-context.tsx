/**
 * App-wide pairing state. Loads the stored pairing once on mount, exposes it,
 * and lets screens pair / unpair. `ready` gates the router so we don't flash the
 * pairing screen before the keychain read resolves.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { setUnauthorizedHandler } from '@/lib/api';
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

  useEffect(() => {
    loadPairing()
      .then((p) => {
        dlog('pair', p ? `loaded pairing → ${p.host}:${p.port}` : 'no stored pairing');
        setPairing(p);
      })
      .finally(() => setReady(true));
  }, []);

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
      relocate: async () => {
        if (!pairing) return false;
        dlog('pair', `relocate: scanning for server (was ${pairing.host})`);
        const host = await discoverServerHost(pairing);
        if (!host) {
          dlog('pair', 'relocate: no server found');
          return false;
        }
        if (host !== pairing.host) {
          const next = { ...pairing, host };
          await savePairing(next);
          dlog('pair', `relocate: host updated ${pairing.host} → ${host}`);
          setPairing(next); // host change re-runs screens' pairing-keyed effects → reconnect
        } else {
          dlog('pair', `relocate: server confirmed at same host ${host}`);
        }
        return true;
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
    [pairing, ready],
  );

  return <PairingContext.Provider value={value}>{children}</PairingContext.Provider>;
}

export function usePairing(): PairingContextValue {
  const ctx = useContext(PairingContext);
  if (!ctx) throw new Error('usePairing must be used within a PairingProvider');
  return ctx;
}
