import { useEffect, useId, useRef, useState } from 'react';
import { MeshCanvas } from './MeshCanvas';
import { readScanMesh } from './mesh-profile';
import type { MeshProfile, ScanFloor, ScanMeshReadPort } from './mesh-profile';
import type { MeshCanvasFailure } from './MeshCanvas';

interface Props {
  /** Fresh opaque identity for the authorized session/scope/building revision.
   * Owner must replace it when any of those change; it contains no credentials. */
  readonly viewKey: string; readonly buildingLabel: string;
  readonly floors: readonly ScanFloor[]; readonly port: ScanMeshReadPort;
  /** Owner controls visibility/availability. Inactive means no read or canvas. */
  readonly active: boolean;
}
type ReadState = { readonly port: ScanMeshReadPort; readonly viewKey: string; readonly floor: ScanFloor; readonly attempt: number } & (
  { readonly status: 'loading' } | { readonly status: 'ready'; readonly profile: MeshProfile }
  | { readonly status: 'unavailable' } | { readonly status: 'render-unavailable'; readonly reason: MeshCanvasFailure }
);

/** Unmounted by default in the app. The native/Media owner supplies the sole
 * read port and floor descriptors after the paired closed contracts exist. */
export function ScanPreview({ viewKey, buildingLabel, floors, port, active }: Props) {
  const id = useId();
  const [opened, setOpened] = useState<{ viewKey: string; port: ScanMeshReadPort } | null>(null);
  const [chosen, setChosen] = useState<{ viewKey: string; key: string } | null>(null);
  const [invalidated, setInvalidated] = useState<{ viewKey: string; port: ScanMeshReadPort } | null>(null);
  const [attempt, setAttempt] = useState(0), [read, setRead] = useState<ReadState | null>(null);
  const [selection, setSelection] = useState<{ profile: MeshProfile; sourceObjectId: string | null } | null>(null);
  const floor = floors.find(entry => chosen?.viewKey === viewKey && entry.key === chosen.key) ?? floors[0];
  const open = active && opened?.viewKey === viewKey && opened.port === port;
  const denied = invalidated?.viewKey === viewKey && invalidated.port === port;
  const available = active && !denied && port.isCurrent(viewKey);
  const context = useRef({ port, viewKey, floor, open, active, attempt, denied });
  context.current = { port, viewKey, floor, open, active, attempt, denied };
  useEffect(() => port.subscribeInvalidation(viewKey, () => {
    if (context.current.port !== port || context.current.viewKey !== viewKey) return;
    context.current = { ...context.current, denied: true };
    setInvalidated({ port, viewKey }); setRead(null); setSelection(null);
  }), [port, viewKey]);
  useEffect(() => {
    setRead(null); setSelection(null);
    if (!open || !active || denied || !floor || !port.isCurrent(viewKey)) return;
    const controller = new AbortController();
    const current = (): boolean => !controller.signal.aborted && context.current.port === port
      && context.current.viewKey === viewKey && context.current.floor === floor && context.current.attempt === attempt
      && context.current.open && context.current.active && !context.current.denied && port.isCurrent(viewKey);
    setRead({ port, viewKey, floor, attempt, status: 'loading' });
    void readScanMesh(port, viewKey, floor, controller.signal).then(profile => {
      if (current()) setRead({ port, viewKey, floor, attempt, status: 'ready', profile });
    }).catch(() => {
      if (current()) setRead({ port, viewKey, floor, attempt, status: 'unavailable' });
    });
    return () => controller.abort();
  }, [port, viewKey, floor, attempt, open, active, denied]);
  const currentRead = open && available && read?.port === port && read.viewKey === viewKey
    && read.floor === floor && read.attempt === attempt ? read : null;
  const profile = currentRead?.status === 'ready' ? currentRead.profile : null;
  const selected = selection?.profile === profile ? selection.sourceObjectId : null;
  const mesh = profile?.meshes.find(entry => entry.sourceObjectId === selected);
  const reload = (): void => { setRead(null); setSelection(null); setAttempt(value => value + 1); };
  const renderUnavailable = (reason: MeshCanvasFailure): void => {
    if (!profile || context.current.port !== port || context.current.viewKey !== viewKey
      || context.current.floor !== floor || !context.current.open || !context.current.active || context.current.denied || !floor) return;
    setRead({ port, viewKey, floor, attempt, status: 'render-unavailable', reason }); setSelection(null);
  };
  if (!active) return null;
  return <section className="scan-preview" aria-labelledby={`${id}-heading`}>
    <h3 id={`${id}-heading`}>Provisional scans</h3>
    <p>{buildingLabel}</p>
    <p>Incomplete scan — physical scale and floor alignment unverified.</p>
    {!available ? <p role="status">Scan access or availability changed. Refresh the building view.</p>
      : floors.length === 0 ? <p>No scan preview available.</p>
      : <>
        <button type="button" aria-expanded={open} aria-controls={`${id}-panel`} onClick={() => {
          setRead(null); setSelection(null); setOpened(open ? null : { port, viewKey });
        }}>{open ? 'Close scan' : 'Show scan'}</button>
        {open && <div id={`${id}-panel`}>
          <label htmlFor={`${id}-floor`}>Exported floor</label>{' '}
          <select id={`${id}-floor`} value={floor?.key ?? ''} onChange={event => {
            setRead(null); setSelection(null); setChosen({ viewKey, key: event.target.value });
          }}>{floors.map(entry => <option key={entry.key} value={entry.key}>{entry.exportLabel}</option>)}</select>
          {!currentRead || currentRead.status === 'loading' ? <p role="status">Loading scan…</p>
            : currentRead.status === 'unavailable' ? <div><p role="status">Scan unavailable or unsupported.</p><button type="button" onClick={reload}>Retry scan</button></div>
            : currentRead.status === 'render-unavailable' ? <div><p role="status">{currentRead.reason === 'context-lost'
              ? 'Graphics context lost. Reload the scan to continue.' : currentRead.reason === 'webgl-unavailable'
                ? 'WebGL unavailable. Source mesh details require a compatible browser.' : 'Source meshes cannot be rendered.'}</p><button type="button" onClick={reload}>Reload scan</button></div>
            : profile && <>
              <p>{profile.meshes.length} source meshes · {profile.meshes.reduce((sum, entry) => sum + entry.triangleIndicesTokens.length / 3, 0)} triangles</p>
              <p>Declared source units: {profile.authoredCoordinates.metersPerUnitToken} metres per authored unit · Up axis: {profile.authoredCoordinates.upAxis}</p>
              <MeshCanvas profile={profile} viewKey={viewKey} selectedSourceId={selected} onUnavailable={renderUnavailable} onPick={sourceObjectId => {
                if (context.current.port === port && context.current.viewKey === viewKey && context.current.floor === floor
                  && context.current.open && context.current.active && !context.current.denied && port.isCurrent(viewKey))
                  setSelection({ profile, sourceObjectId });
              }} />
              <label htmlFor={`${id}-mesh`}>Source mesh</label>{' '}
              <select id={`${id}-mesh`} value={selected ?? ''} onChange={event => setSelection({ profile, sourceObjectId: event.target.value || null })}>
                <option value="">All source meshes</option>
                {profile.meshes.map(entry => <option key={entry.sourceObjectId} value={entry.sourceObjectId}>{entry.sourceName} · {entry.sourceObjectId}</option>)}
              </select>
              <div aria-live="polite" style={{ overflowWrap: 'anywhere' }}>{mesh && <dl>
                <dt>Source name</dt><dd>{mesh.sourceName}</dd><dt>Source object ID</dt><dd>{mesh.sourceObjectId}</dd>
                <dt>Triangles</dt><dd>{mesh.triangleIndicesTokens.length / 3}</dd>
              </dl>}</div>
              <p>Source mesh identifiers do not establish rooms. No measured dimensions or floor registration.</p>
            </>}
        </div>}
      </>}
  </section>;
}
