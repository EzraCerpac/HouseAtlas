import { useSyncExternalStore } from 'react';
import type { HouseAcquisitionPort } from './acquisition-types';
import { markSavedEntry } from './saved-entry';

/** A passive leaf: only explicit buttons invoke preparation or retention.
 * Laid out as the steps it takes: what saving means for this profile, the
 * prepared copy with its coverage and exclusions, then the actions, the
 * status line and the receipt of what was saved. */
export function SaveHouseCopy({ port }: { readonly port: HouseAcquisitionPort }) {
  const state = useSyncExternalStore(port.subscribe, port.getState, port.getState);
  const busy = state.status === 'preparing' || state.status === 'saving';
  const preparation = state.status === 'ready' ? state.preparation : undefined;
  const receipt = state.receipt;
  return <details className="save-copy">
    <summary tabIndex={0}>Saved house copy</summary>
    <div className="save-copy-terms">
      <p className="save-copy-privacy">Save a historical, read-only house copy with captured Atlas, inventory and document lists and details, including allowed source originals. Data is unencrypted in this browser profile and remains after sign-out.</p>
      <p>Retained document originals can be explicitly verified and downloaded. Inline PDF navigation, editing, sync and fresh native downloads are unavailable in the saved viewer. Storage estimates are advisory; browser persistence is not guaranteed.</p>
    </div>
    {preparation && <section className="save-copy-review" aria-label="Prepared house copy">
      <p className="save-copy-label">{preparation.label} · {preparation.resources} resources · {preparation.totalBytes.toLocaleString()} bytes</p>
      <p className="save-copy-fact">Coverage: {preparation.completeness}</p>
      <p className="save-copy-fact">New capture: {preparation.capturedAt}</p>
      {preparation.prior && <p className="save-copy-replace">Currently saved: captured {preparation.prior.capturedAt} · revision {preparation.prior.localRevision}. Saving will replace it.</p>}
      {preparation.exclusions.length > 0 && <div className="save-copy-exclusions"><p>Not included in this copy:</p><ul>{preparation.exclusions.map((entry, index) => <li key={index}>{entry.section}: {entry.label} ({entry.code})</li>)}</ul></div>}
    </section>}
    <div className="save-copy-actions">
      {!busy && !preparation && <button type="button" className="save-copy-primary" onClick={() => { void port.prepare(); }}>Prepare house copy</button>}
      {preparation && <button type="button" className="save-copy-primary" onClick={() => { void port.save(preparation.prior?.localRevision); }}>{preparation.prior ? 'Replace saved copy' : 'Save house copy'}</button>}
      {(busy || preparation) && <button type="button" className="save-copy-secondary" onClick={port.cancel}>{state.status === 'saving' ? 'Stop saving' : 'Cancel'}</button>}
    </div>
    <p className="save-copy-status" role="status">{state.status === 'preparing' ? 'Preparing house copy…' : state.status === 'saving'
      ? `Saving house: ${state.progress?.done.toLocaleString() ?? '0'} of ${state.progress?.total.toLocaleString() ?? state.preparation?.totalBytes.toLocaleString() ?? '0'} bytes`
      : state.message ?? (state.status === 'saved' ? 'House copy saved in this browser profile.' : '')}</p>
    {receipt && <section className="save-copy-receipt" aria-label="Saved copy receipt">
      <p className="save-copy-label">{receipt.house.label} · saved capture {receipt.house.capturedAt}</p>
      <p className="save-copy-fact">Coverage: {receipt.completeness}</p>
      <dl><dt>Snapshot</dt><dd>{receipt.house.snapshotId}</dd><dt>Local revision</dt><dd>{receipt.house.localRevision}</dd><dt>Saved app build</dt><dd>{receipt.house.shellBuildId}</dd></dl>
      {receipt.exclusions.length > 0 && <div className="save-copy-exclusions"><p>Not included in this copy:</p><ul>{receipt.exclusions.map((entry, index) => <li key={index}>{entry.section}: {entry.label} ({entry.code})</li>)}</ul></div>}
      <p className="save-copy-note">This receipt describes a saved capture, not the current native home. App verification does not establish offline device availability.</p>
    </section>}
    <a className="save-copy-open" href="/saved/index.html" onClick={markSavedEntry}>Open saved house copy</a>
  </details>;
}
