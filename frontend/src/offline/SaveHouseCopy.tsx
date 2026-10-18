import { useSyncExternalStore } from 'react';
import type { HouseAcquisitionPort } from './acquisition-types';

/** A passive leaf: only explicit buttons invoke preparation or retention. */
export function SaveHouseCopy({ port }: { readonly port: HouseAcquisitionPort }) {
  const state = useSyncExternalStore(port.subscribe, port.getState, port.getState);
  const busy = state.status === 'preparing' || state.status === 'saving';
  const preparation = state.status === 'ready' ? state.preparation : undefined;
  const receipt = state.receipt;
  return <details>
    <summary tabIndex={0}>Saved house copy</summary>
    <p>Save the whole current house for the saved Atlas viewer, including allowed source originals. Data is unencrypted in this browser profile and remains after sign-out.</p>
    <p>The saved viewer supports Atlas only. General inventory, Documents and PDF navigation, and editing are unavailable offline. Storage estimates are advisory; browser persistence is not guaranteed.</p>
    {!busy && !preparation && <button type="button" onClick={() => { void port.prepare(); }}>Save this house for offline viewing</button>}
    {preparation && <div>
      <p>{preparation.label} · {preparation.completeness} export · {preparation.resources} resources · {preparation.totalBytes.toLocaleString()} bytes</p>
      <p>Captured {preparation.capturedAt}</p>
      {preparation.prior && <p>Replace the saved copy captured {preparation.prior.capturedAt}, revision {preparation.prior.localRevision}.</p>}
      {preparation.exclusions.length > 0 && <ul>{preparation.exclusions.map((entry, index) => <li key={index}>{entry.section}: {entry.label} ({entry.code})</li>)}</ul>}
      <button type="button" onClick={() => { void port.save(preparation.prior?.localRevision); }}>{preparation.prior ? 'Replace saved copy' : 'Save house copy'}</button>
    </div>}
    {(busy || preparation) && <button type="button" onClick={port.cancel}>Cancel saving</button>}
    <p role="status">{state.status === 'preparing' ? 'Preparing house copy…' : state.status === 'saving'
      ? `Saving house: ${state.progress?.done.toLocaleString() ?? '0'} of ${state.progress?.total.toLocaleString() ?? state.preparation?.totalBytes.toLocaleString() ?? '0'} bytes`
      : state.message ?? (state.status === 'saved' ? 'House copy saved in this browser profile.' : '')}</p>
    {receipt && <div>
      <p>{receipt.house.label} · saved capture {receipt.house.capturedAt} · {receipt.completeness}</p>
      <dl><dt>Snapshot</dt><dd>{receipt.house.snapshotId}</dd><dt>Local revision</dt><dd>{receipt.house.localRevision}</dd><dt>Saved app build</dt><dd>{receipt.house.shellBuildId}</dd></dl>
      {receipt.exclusions.length > 0 && <ul>{receipt.exclusions.map((entry, index) => <li key={index}>{entry.section}: {entry.label} ({entry.code})</li>)}</ul>}
      <p>This receipt describes a saved capture, not the current native home. App verification does not establish offline device availability.</p>
    </div>}
    <a href="/saved/index.html">Open saved Atlas</a>
  </details>;
}
