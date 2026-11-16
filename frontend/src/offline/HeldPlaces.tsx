import { useEffect, useMemo, useState } from 'react';
import type { ReadyView } from '../app/types';
import type { OfflineCopyHandle, OfflineReadPort, OfflineViewSnapshotV1 } from './live-copy-types';
import { projectView } from '../lantern/adapters/read';
import { StoreProvider, type LanternActions } from '../lantern/state/store';
import { TopologyProvider } from '../lantern/topology/TopologyProvider';
import { offlineMessage } from '../lantern/topology/BuildingSection';
import { PlacesContent } from '../lantern/views/RoomsView';
import { InlineTime } from '../lantern/components/ui';
import { createHeldTopologyClient, decodeHeldTopology, type HeldTopologyV1 } from './held-topology';
import '../lantern/styles/topology.css';

/** The held view as a read-only ready view: no edit authority, native links or file URLs. */
export function heldReadyView(data: OfflineViewSnapshotV1['data']): ReadyView {
  const scope = { workspaceId: data.scope.workspaceId, homeId: data.scope.homeId };
  return { status: 'ready', scope, homeLabel: data.homeLabel, now: data.sourceNow, canEdit: false,
    homes: [{ ...scope, label: data.homeLabel }], caches: data.caches.map(cache => ({ ...cache })),
    entries: data.entries.map(entry => ({ ...entry, aliases: [...entry.aliases], maintenance: [...entry.maintenance],
      networkStates: [...entry.networkStates], networkRelations: [...entry.networkRelations], nativeLinks: [],
      attachments: entry.attachments.map(attachment => attachment.kind === 'stored-file'
        ? { attachmentId: attachment.attachmentId, title: attachment.title, kind: 'stored-file' as const, contentType: attachment.contentType ?? null,
          byteSize: attachment.byteSize ?? null, downloadHref: null, previewHref: null }
        : { attachmentId: attachment.attachmentId, title: attachment.title, kind: 'external-link' as const, url: null, archived: attachment.archived ?? false }) })) };
}
// No reload, home switch, session or edit port: the held lens only reads this device's copy.
const actions: LanternActions = { reload: async () => false, switchHome: () => {}, nativeContent: null };

/** Rooms & places from the held copy, through the live lens and its wording. Building records come only from
 * this copy's own row for its account and home; a copy without one keeps the not-held sentence. */
export default function HeldPlaces({ read, handle, snapshot, signal }: {
  read: Pick<OfflineReadPort, 'readTopology'>; handle: OfflineCopyHandle; snapshot: OfflineViewSnapshotV1; signal: AbortSignal;
}) {
  const [held, setHeld] = useState<HeldTopologyV1 | 'missing' | 'failed' | null>(null);
  useEffect(() => {
    let active = true; setHeld(null);
    void read.readTopology(handle, signal).then(result => {
      if (!active || signal.aborted) return;
      if (result.status !== 'ok') { setHeld(result.status === 'missing' ? 'missing' : 'failed'); return; }
      try { setHeld(decodeHeldTopology(result.value, snapshot.data.scope)); } catch { setHeld('failed'); }
    }, () => { if (active && !signal.aborted) setHeld('failed'); });
    return () => { active = false; };
  }, [read, handle, snapshot, signal]);
  const projection = useMemo(() => projectView(heldReadyView(snapshot.data), { status: 'not-supplied' }, { status: 'unavailable' }), [snapshot]);
  const client = useMemo(() => typeof held === 'object' && held ? createHeldTopologyClient(held) : null, [held]);
  if (held === null) return <p role="status">Reading held building records…</p>;
  if (held === 'missing') return <p role="status">{offlineMessage}</p>;
  if (held === 'failed' || !client) return <p role="status">Held building records failed verification. Connect and open live to read them.</p>;
  return <>
    <p>Building records retrieved <InlineTime value={held.capturedAt} />.</p>
    <StoreProvider projection={projection} actions={actions}>
      <TopologyProvider client={client}><PlacesContent /></TopologyProvider>
    </StoreProvider>
  </>;
}
