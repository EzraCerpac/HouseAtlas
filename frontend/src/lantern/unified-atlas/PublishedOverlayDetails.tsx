import { useMemo } from 'react';
import type { OverlayPlacement } from './scene';
import type { AtlasOverlayBinding } from './types';

/** Source tuples retain actual nulls and arbitrary source text without
 * delimiter collisions. Positions remain source-qualified model coordinates. */
function SourceDates({ bindings }: { readonly bindings: readonly AtlasOverlayBinding[] }) {
  const rows = new Map(bindings.map(row => [JSON.stringify([row.sourceRevision, row.sourceUpdatedAt, row.retrievedAt]), row]));
  return <ul className="ua-dates">{[...rows].map(([key, row]) => <li key={key}>
    Source {row.sourceRevision}
    {row.sourceUpdatedAt ? <>, updated <time dateTime={row.sourceUpdatedAt}>{row.sourceUpdatedAt}</time></> : ', update date unknown'}
    {row.retrievedAt ? <>, retrieved <time dateTime={row.retrievedAt}>{row.retrievedAt}</time></> : ', retrieval date unknown'}
  </li>)}</ul>;
}

export function PublishedOverlayDetails({ placement }: { readonly placement: OverlayPlacement }) {
  const { recordIds, bindings } = useMemo(() => ({ recordIds: placement.recordIds, bindings: placement.bindings }), [placement]);
  // A building-scoped source position has provenance but no drawable floor.
  // Read original bindings, preserving unspecified occurrence as unspecified.
  const positions = bindings.flatMap(binding => binding.anchor.kind === 'source-position'
    ? [{ occurrenceId: binding.spaceOccurrenceId, position: binding.anchor.position, basis: binding.anchor.basis }] : []);
  return <>
    <p>{placement.recordCount.toLocaleString()} {placement.recordCount === 1 ? 'record' : 'records'}
      {positions.length > 0 ? `, ${positions.length} with a source position` : ''}</p>
    <SourceDates bindings={bindings} />
    {positions.length > 0 && <details className="ua-refs"><summary>Source positions</summary>
      <p>Model-frame coordinates; physical registration unknown.</p>
      <dl>{positions.map((row, at) => <div key={at}>
        <dt>Source position {at + 1}</dt><dd>{row.position.join(', ')} m</dd>
        <dt>Occurrence</dt><dd>{row.occurrenceId ?? 'Unspecified'}</dd><dt>Basis</dt><dd>{row.basis}</dd>
      </div>)}</dl>
    </details>}
    {placement.recordCount > 0 && <details className="ua-refs"><summary>Record references</summary>
      <ul>{recordIds.map(record => <li key={record}>{record}</li>)}</ul>
    </details>}
  </>;
}
