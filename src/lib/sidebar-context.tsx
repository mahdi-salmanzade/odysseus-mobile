/**
 * Drives the slide-in navigation sidebar. Any screen can open it (e.g. a hamburger
 * button in its header); the <Sidebar/> overlay rendered in the root layout reads
 * this state to animate in/out.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

interface SidebarContextValue {
  open: boolean;
  openSidebar: () => void;
  closeSidebar: () => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  const value = useMemo<SidebarContextValue>(
    () => ({
      open,
      openSidebar: () => setOpen(true),
      closeSidebar: () => setOpen(false),
    }),
    [open],
  );

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar(): SidebarContextValue {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error('useSidebar must be used within a SidebarProvider');
  return ctx;
}
