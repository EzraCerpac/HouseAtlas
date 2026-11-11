import { useSyncExternalStore } from 'react';
import type { NativeHandoff } from './native-handoff';

/** Isolated explicit-owner mount seam. No app-root/router registration. */
export function NativeHandoffView({ handoff }: { handoff: NativeHandoff }) {
  const state = useSyncExternalStore(handoff.subscribe, handoff.getSnapshot, handoff.getSnapshot);
  return <section aria-label="Manual native source review">
    <h2>Continue in the native source</h2>
    <p role="status">{state.message}</p>
    <p>This is a manual handoff, not approval or a saved change. Category and tag text are not native IDs. Intervals do not establish due dates.</p>
    {state.rows.map(row => <article key={row.key}>
      <h3>{row.label}{row.edited ? ' (edited)' : ''}</h3>
      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{row.value}</pre>
      <a href={row.href} rel="noopener noreferrer" referrerPolicy="no-referrer"
        onClick={event => { if (!handoff.canNavigate(row.key, row.href)) event.preventDefault(); }}
        onAuxClick={event => { if (!handoff.canNavigate(row.key, row.href)) event.preventDefault(); }}
        onContextMenu={event => { if (!handoff.canNavigate(row.key, row.href)) event.preventDefault(); }}>
        Open native source for manual review
      </a>
    </article>)}
  </section>;
}
