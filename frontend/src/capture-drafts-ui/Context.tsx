import { createContext, useContext, type ReactNode } from 'react';
import type { CaptureDraftPort } from './port';

const Context = createContext<CaptureDraftPort | null>(null);
export function CaptureDraftProvider({ port, children }: { port: CaptureDraftPort; children: ReactNode }) {
  return <Context.Provider value={port}>{children}</Context.Provider>;
}
export const useCaptureDrafts = () => useContext(Context);
