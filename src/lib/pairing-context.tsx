/**
 * App-wide pairing state. Loads the stored pairing once on mount, exposes it,
 * and lets screens pair / unpair. `ready` gates the router so we don't flash the
 * pairing screen before the keychain read resolves.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { setUnauthorizedHandler } from '@/lib/api';
import { discoverServerHost } from '@/lib/discover';
import { clearPairing, loadPairing, savePairing, type Pairing } from '@/lib/pairing';
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
}

const PairingContext = createContext<PairingContextValue | null>(null);

export function PairingProvider({ children }: { children: ReactNode }) {
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadPairing()
      .then(setPairing)
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
        const host = await discoverServerHost(pairing);
        if (!host) return false;
        if (host !== pairing.host) {
          const next = { ...pairing, host };
          await savePairing(next);
          setPairing(next); // host change re-runs screens' pairing-keyed effects → reconnect
        }
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
