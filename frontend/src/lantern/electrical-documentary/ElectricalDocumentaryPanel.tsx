import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ElectricalFixture } from '../overlays/electricity/fixture-types';
import type { LocalSourceFence, LocalSourceReaderStore } from './local-source-reader';
import type { SeenLedger } from './seen-ledger';
import { stageSpan } from '../observability/stage-timing';
import { goToSource, rememberOpener } from './source-focus';
import { pageProvenance, SOURCE_ROLE_LABEL } from './LocalSourceView';
import type { ElectricalBridge, ElectricalDocumentaryReadyFrame, ElectricalDocumentaryRecord, ElectricalDocumentaryTarget,
  ElectricalModelBinding, ElectricalRecordRole, ElectricalSourceRole, ElectricalUnavailableReason, SelectionOwner, SourceOpenContext } from './types';

const REASON: Readonly<Record<ElectricalUnavailableReason, string>> = {
  'no-provider': 'No electrical documents are connected for this model.',
  'model-not-qualified': 'This model version is not qualified for electrical documents.',
  'room-link-not-qualified': 'No reviewed electrical link exists for this selection.',
  'evidence-not-qualified': 'The electrical evidence for this selection is not qualified.',
  'source-unavailable': 'The electrical documents could not be read.',
  'selection-changed': 'The selection changed before the documents were read. Select it again.',
  'access-revoked': 'Access to these electrical documents ended.',
};
const ROLE: Readonly<Record<ElectricalRecordRole, string>> = {
  'socket-mark': 'Socket marks', 'light-label': 'Light labels', 'light-annotation': 'Light annotations', 'unresolved-symbol': 'Unresolved symbols',
};
const ROLE_ORDER: readonly ElectricalRecordRole[] = ['socket-mark', 'light-label', 'light-annotation', 'unresolved-symbol'];
const SOURCE_ORDER: readonly ElectricalSourceRole[] = ['original-sheet', 'drawing-crop', 'interpretation-record'];
const count = (value: number) => value.toLocaleString('en');

const sameBinding = (a: ElectricalModelBinding, b: ElectricalModelBinding) => a.kind === 'canonical-publication'
  ? b.kind === 'canonical-publication' && a.sourceRevisionId === b.sourceRevisionId && a.publicationId === b.publicationId
    && a.semanticMapRevisionId === b.semanticMapRevisionId && a.semanticMapSha256 === b.semanticMapSha256
  : b.kind === 'private-preview' && a.modelVersion === b.modelVersion && a.modelGlbSha256 === b.modelGlbSha256
    && a.canonicalSourceSha256 === b.canonicalSourceSha256 && a.crosswalkSha256 === b.crosswalkSha256;
export const sameTarget = (a: ElectricalDocumentaryTarget, b: ElectricalDocumentaryTarget) => a.kind === 'model-room'
  ? b.kind === 'model-room' && a.roomId === b.roomId && a.spaceOccurrenceId === b.spaceOccurrenceId
  : b.kind === 'documentary-scope' && a.scopeId === b.scopeId;

type ViewState = { readonly status: 'reading' } | { readonly status: 'unavailable'; readonly message: string }
  | { readonly status: 'ready'; readonly frame: ElectricalDocumentaryReadyFrame };
type SourceState = { readonly sourceKey: string; readonly status: 'opening' | 'opened' | 'unavailable' };

/** Pure totals for one view. Ledger IDs dedupe; installed totals stay
 * unknown. The review-wide union is the bridge's SeenLedger, never a sum. */
export function documentaryTotals(frame: ElectricalDocumentaryReadyFrame) {
  const fixtures = new Map(frame.fixtureData.fixtures.map(fixture => [fixture.id, fixture]));
  const ids = [...new Set(frame.view.fixtureIds)];
  let glyphs = 0, unknownGlyphs = 0;
  for (const id of ids) { const glyphCount = fixtures.get(id)?.glyphCount ?? null; if (glyphCount === null) unknownGlyphs++; else glyphs += glyphCount; }
  return { records: ids.length, glyphs, unknownGlyphs, installed: null };
}

/** Optional documentary consumer for one explicit target. Frames are applied
 * only while current; invalidation hides evidence, closes the source reader,
 * cancels source opens and releases the frame, in that order. `seen` belongs
 * to the bridge, so it survives this panel being replaced on navigation. */
export function ElectricalDocumentaryPanel({ bridge, seen, target, targetLabel, selectionOwner, selectionContext, store }: {
  readonly bridge: ElectricalBridge;
  readonly seen: SeenLedger;
  readonly target: ElectricalDocumentaryTarget;
  readonly targetLabel: string;
  readonly selectionOwner: SelectionOwner;
  readonly selectionContext: object;
  readonly store: LocalSourceReaderStore;
}) {
  const body = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const opens = useRef(new Set<AbortController>());
  const withdrawRef = useRef<() => void>(() => undefined);
  const [state, setState] = useState<ViewState & { readonly key: number; readonly seen: number }>({ status: 'reading', key: 0, seen: 0 });
  const [source, setSource] = useState<SourceState | null>(null);
  const display = useSyncExternalStore(store.subscribe, store.snapshot);

  useEffect(() => {
    const mine = ++generation.current, controller = new AbortController(), { port } = bridge;
    let frame: ElectricalDocumentaryReadyFrame | null = null, stop: (() => void) | null = null;
    const withdraw = (message: string | null) => {
      const ending = frame; frame = null;
      if (ending) {
        body.current?.setAttribute('hidden', '');
        // Reader first: release() removes listeners without broadcasting.
        store.setFence(null);
        for (const open of opens.current) open.abort();
        opens.current.clear();
        stop?.(); stop = null;
        port.release(ending);
      }
      if (message !== null && generation.current === mine) { setSource(null); setState(previous => ({ status: 'unavailable', message, key: mine, seen: previous.seen })); }
    };
    withdrawRef.current = () => withdraw(REASON['selection-changed']);
    setSource(null);
    setState(previous => ({ status: 'reading', key: mine, seen: previous.seen }));
    port.read({ binding: bridge.binding, target }, controller.signal).then(result => {
      if (controller.signal.aborted || generation.current !== mine) { if (result.status === 'available') port.release(result); return; }
      if (result.status !== 'available') { setState(previous => ({ status: 'unavailable', message: REASON[result.reason], key: mine, seen: previous.seen })); return; }
      if (!sameBinding(result.binding, bridge.binding) || !sameTarget(result.target, target) || !port.isCurrent(result)) {
        port.release(result); setState(previous => ({ status: 'unavailable', message: REASON['selection-changed'], key: mine, seen: previous.seen })); return;
      }
      frame = result;
      let ended = false;
      stop = port.subscribeInvalidation(result, () => { ended = true; withdraw(REASON['access-revoked']); });
      if (ended || !port.isCurrent(result)) { withdraw(REASON['access-revoked']); return; }
      const fence: LocalSourceFence = {
        isCurrent: (context: SourceOpenContext) => frame === result && context.frame === result && port.isCurrent(result)
          && context.selectionContext === selectionContext && selectionOwner.isCurrent(selectionContext),
        watch(context, changed) {
          const frameStop = port.subscribeInvalidation(context.frame, changed);
          const selectionStop = selectionOwner.subscribe(context.selectionContext, changed);
          return () => { frameStop(); selectionStop(); };
        },
      };
      store.setFence(fence);
      body.current?.removeAttribute('hidden');
      setState({ status: 'ready', frame: result, key: mine, seen: seen.record(result) });
    }, () => { if (!controller.signal.aborted && generation.current === mine) setState(previous => ({ status: 'unavailable', message: REASON['source-unavailable'], key: mine, seen: previous.seen })); });
    return () => { controller.abort(); withdraw(null); withdrawRef.current = () => undefined; };
  }, [bridge, seen, target, store, selectionOwner, selectionContext]);

  // Invalidation withdraws synchronously; render only shows the applied frame.
  const ready = state.status === 'ready' && state.key === generation.current ? state.frame : null;
  const open = (sourceKey: string, opener: HTMLElement) => {
    if (!ready) return;
    rememberOpener(store, opener);
    // Currency is rechecked immediately before the explicit source action.
    if (!bridge.port.isCurrent(ready)) { withdrawRef.current(); return; }
    for (const pending of opens.current) pending.abort();
    opens.current.clear();
    const controller = new AbortController(); opens.current.add(controller);
    // Anonymous timing from this action to the representation's own
    // acknowledgement; a switch replaces a representation already shown.
    const shown = store.snapshot();
    const timed = stageSpan('source', 'open', shown?.status === 'shown' ? { switch: true, from: shown.representation } : { switch: false });
    const end = (result: 'opened' | 'unavailable') => {
      const now = store.snapshot();
      timed({ outcome: controller.signal.aborted ? 'withdrawn' : result === 'opened' ? 'shown' : 'unavailable',
        representation: now && now.action.sourceKey === sourceKey ? now.representation : 'none' });
    };
    setSource({ sourceKey, status: 'opening' });
    bridge.port.openSource(ready, sourceKey, controller.signal).then(result => {
      end(result);
      if (!controller.signal.aborted) setSource({ sourceKey, status: result });
    }, () => { end('unavailable'); if (!controller.signal.aborted) setSource({ sourceKey, status: 'unavailable' }); })
      .finally(() => { opens.current.delete(controller); });
  };

  return <section className="edoc" aria-label="Electrical documents">
    <header className="edoc-head">
      <h3>Electrical documents</h3>
      <p>{targetLabel}</p>
    </header>
    {state.status === 'reading' && <p role="status">Reading electrical documents…</p>}
    {state.status === 'unavailable' && <p className="edoc-status" role="status">{state.message}</p>}
    <div ref={body} className="edoc-body">
      {ready && <DocumentaryView frame={ready} seen={state.seen} source={source} onOpen={open}
        // The reader below shows this frame's source: offer the way to it.
        shownKey={display && display.status === 'shown' && display.context.frame === ready ? display.action.sourceKey : null}
        onGoTo={() => { if (display) goToSource(store, display.id); }} />}
    </div>
  </section>;
}

function DocumentaryView({ frame, seen, source, onOpen, shownKey, onGoTo }: {
  readonly frame: ElectricalDocumentaryReadyFrame; readonly seen: number; readonly source: SourceState | null;
  readonly onOpen: (sourceKey: string, opener: HTMLElement) => void; readonly shownKey: string | null; readonly onGoTo: () => void;
}) {
  const fixtures = new Map(frame.fixtureData.fixtures.map(fixture => [fixture.id, fixture]));
  const sheets = new Map(frame.fixtureData.sheets.map(sheet => [sheet.id, sheet]));
  const totals = documentaryTotals(frame);
  const { view } = frame;
  return <>
    <p className="edoc-caveat">{view.label}. Historic drawing evidence only: no current circuit, cable route, height or position is claimed.</p>
    <dl className="cifc-facts edoc-totals">
      <div><dt>Records</dt><dd>{count(totals.records)} in this view</dd></div>
      <div><dt>Drawn glyphs</dt><dd>{count(totals.glyphs)}{totals.unknownGlyphs > 0 ? `, plus ${count(totals.unknownGlyphs)} ${totals.unknownGlyphs === 1 ? 'record' : 'records'} with an unknown count` : ''}</dd></div>
      <div><dt>Installed fixtures</dt><dd>Unknown</dd></div>
      <div><dt>Seen in this review</dt><dd>{count(seen)} distinct {seen === 1 ? 'record' : 'records'}</dd></div>
    </dl>
    {ROLE_ORDER.map(role => {
      const rows = view.records.filter(record => record.role === role);
      return rows.length > 0 && <section key={role} className="cifc-records edoc-role">
        <h4>{ROLE[role]} <span className="cifc-count">{count(rows.length)}</span></h4>
        <ul>{rows.map(record => {
          const fixture = fixtures.get(record.fixtureId) ?? null;
          return <RecordRow key={record.fixtureId} record={record} fixture={fixture} sheet={fixture ? sheets.get(fixture.sheetId) ?? null : null} />;
        })}</ul>
      </section>;
    })}
    <section className="cifc-records edoc-sources" aria-label="Sources">
      <h4>Sources</h4>
      {view.sources.length === 0 ? <p>No source is listed for this view.</p> : <ul>{SOURCE_ORDER.flatMap(role => view.sources.filter(item => item.role === role)).map(item => {
        const pending = source?.sourceKey === item.sourceKey ? source.status : null;
        return <li key={item.sourceKey} className="edoc-source">
          <div className="edoc-source-actions">
            <button type="button" className="chip-btn" aria-busy={pending === 'opening'} onClick={event => onOpen(item.sourceKey, event.currentTarget)}>
              Open {SOURCE_ROLE_LABEL[item.role].toLowerCase()}</button>
            {shownKey === item.sourceKey && <button type="button" className="chip-btn" onClick={onGoTo}>Go to source</button>}
          </div>
          <span>{item.label}. {pageProvenance(item.role, item.pdfPage)}{item.sheetId && sheets.get(item.sheetId) ? `, ${sheets.get(item.sheetId)!.title}` : ''}.</span>
          {pending === 'opening' && <span role="status">Opening…</span>}
          {pending === 'unavailable' && <span role="status">This source could not be shown here.</span>}
        </li>;
      })}</ul>}
    </section>
  </>;
}

function RecordRow({ record, fixture, sheet }: {
  readonly record: ElectricalDocumentaryRecord; readonly fixture: ElectricalFixture | null; readonly sheet: { readonly title: string; readonly sourceDate: string | null } | null;
}) {
  const scope = record.associationScope;
  const where = scope.kind === 'logical-room' ? 'Whole room, as reviewed'
    : scope.kind === 'occurrences' ? `${count(scope.spaceOccurrenceIds.length)} reviewed ${scope.spaceOccurrenceIds.length === 1 ? 'occurrence' : 'occurrences'} only`
    : 'Documentary context only, not placed in a room';
  if (!fixture) return <li><strong>{record.fixtureId}</strong><span>{where}</span></li>;
  const box = fixture.source.normalizedBox;
  return <li className="edoc-record">
    <strong>{fixture.label}{fixture.glyph ? ` (${fixture.glyph})` : ''}</strong>
    <span>{where}{record.sharedScopeIds.length > 0 ? `. Shared with ${count(record.sharedScopeIds.length)} documentary ${record.sharedScopeIds.length === 1 ? 'scope' : 'scopes'}` : ''}.</span>
    <span>Glyphs drawn: {fixture.glyphCount === null ? 'unknown' : count(fixture.glyphCount)}. Fixtures: {fixture.fixtureCount === null ? 'unknown' : count(fixture.fixtureCount)}.</span>
    {fixture.source.literalLabels.length > 0 && <span>Written on the drawing: {fixture.source.literalLabels.join(', ')}</span>}
    {fixture.group.label && <span>Historic group label {fixture.group.label}; not a current circuit.</span>}
    <span>{sheet ? `${sheet.title}, ${sheet.sourceDate ?? 'source date unknown'}` : 'Sheet not listed'}. {fixture.uncertainty ?? ''}</span>
    <span>On the source photo at {box.map(value => value.toFixed(2)).join(', ')} (fraction of width and height).</span>
  </li>;
}
