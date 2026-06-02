/**
 * App-wide pairing state. Loads the stored pairing once on mount, exposes it,
 * and lets screens pair / unpair. `ready` gates the router so we don't flash the
 * pairing screen before the keychain read resolves.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { clearPairing, loadPairing, savePairing, type Pairing } from '@/lib/pairing';

interface PairingContextValue {
  pairing: Pairing | null;
  ready: boolean;
  pair: (p: Pairing) => Promise<void>;
  unpair: () => Promise<void>;
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

  const value = useMemo<PairingContextValue>(
    () => ({
      pairing,
      ready,
      pair: async (p) => {
        await savePairing(p);
        setPairing(p);
      },
      unpair: async () => {
        await clearPairing();
        setPairing(null);
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
