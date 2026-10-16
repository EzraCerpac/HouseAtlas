import { useCallback, useEffect, useState } from 'react';
import { ElectricalDocumentaryPanel } from './ElectricalDocumentaryPanel';
import { setFocusFallback } from './source-focus';
import type { ElectricalBridge, ElectricalDocumentaryTarget, ElectricalTargetChoice } from './types';
import type { ElectricalReview } from './useElectricalReview';
import './electrical-documentary.css';

/** One deliberate selection. `resolve` asks the bridge only: a loader node
 * index through resolvePickedNode, or an injected explicit target through
 * resolveTarget. Labels never create targets. */
export interface ElectricalSelection {
  readonly label: string;
  resolve(bridge: ElectricalBridge): ElectricalDocumentaryTarget | null;
}

const STATUS = {
  absent: 'Not connected for this model.',
  incomplete: 'Choose the manifest with its house and reference GLB to connect electrical documents.',
  retired: 'Closed because the session changed. Choose the files again to reconnect.',
  connecting: 'Connecting…',
  failed: 'Could not be connected for these files.',
} as const;

export function ElectricalReviewSection({ review, choices, selection, chosen, onChoose }: {
  readonly review: ElectricalReview;
  readonly choices: readonly ElectricalTargetChoice[];
  readonly selection: ElectricalSelection | null;
  /** Index of the injected choice that is currently selected. */
  readonly chosen: number | null;
  readonly onChoose: (at: number | null) => void;
}) {
  const { bridge: state, handle, store } = review;
  const bridge = state.status === 'ready' ? state.bridge : null;
  const [resolved, setResolved] = useState<{ readonly selection: ElectricalSelection; readonly bridge: ElectricalBridge; readonly target: ElectricalDocumentaryTarget | null } | null>(null);
  useEffect(() => {
    // Replacing the selection closes any shown source before its frame is released.
    store.clear();
    setResolved(bridge && selection ? { selection, bridge, target: selection.resolve(bridge) } : null);
  }, [bridge, selection, store]);
  const current = resolved && resolved.selection === selection && resolved.bridge === bridge ? resolved : null;
  // Closing a source whose opener is gone returns here.
  const heading = useCallback((element: HTMLHeadingElement | null) => setFocusFallback(store, element), [store]);
  return <section className="edoc-review" aria-labelledby="edoc-review-title">
    <h3 id="edoc-review-title" ref={heading} tabIndex={-1} className="cifc-subhead">Electrical documents</h3>
    {state.status !== 'ready' ? <p className="cifc-caveat" role="status">{STATUS[state.status]}</p> : <>
      {choices.length > 0 && <div className="cifc-toggles" role="group" aria-label="Reviewed places">
        {choices.map((choice, at) => <button key={at} type="button" className="chip-btn" aria-pressed={chosen === at}
          onClick={() => onChoose(chosen === at ? null : at)}>{choice.label}</button>)}
      </div>}
      {!selection ? <p className="cifc-caveat">Select a room occurrence, a part{choices.length > 0 ? ' or a reviewed place' : ''} to read its documents.</p>
        : !current ? <p role="status">Checking the reviewed link…</p>
        : !current.target ? <p className="cifc-caveat" role="status">No reviewed electrical link for {selection.label}.</p>
        : handle && <ElectricalDocumentaryPanel bridge={current.bridge} seen={state.seen} target={current.target} targetLabel={selection.label}
          selectionOwner={handle.owner} selectionContext={handle.context} store={store} />}
    </>}
  </section>;
}
