import type { HostElectricalDocumentaryPort, SourceOpenContext } from '../../src/lantern/electrical-documentary/types';

export const HOST_ELECTRICAL_DOCUMENTARY_CONTRACT: 'houseatlas.host-electrical-documentary-port.v1';
export interface ProviderAuthority {
  isCurrent(): boolean;
  subscribeInvalidation(changed: () => void): () => void;
  openSource(descriptor: { readonly sourceKey: string; readonly role: string; readonly label: string; readonly sheetId: string | null; readonly pdfPage: number | null },
    signal: AbortSignal, context: Omit<SourceOpenContext, 'selectionContext'>): Promise<'opened' | 'unavailable'>;
}
export function createHostElectricalDocumentaryProvider(snapshot: unknown, authority: ProviderAuthority): HostElectricalDocumentaryPort;
