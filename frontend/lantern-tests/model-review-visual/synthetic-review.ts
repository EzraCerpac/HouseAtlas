/** SYNTHETIC local model review inputs. Generated anonymous blocks, records and
 * sources only: no real building, room, sheet, circuit, receipt or retained
 * asset. The documentary port is the unchanged neutral provider; this file is
 * the fixture's stand-in for a source-owner bridge, with an explicit node
 * table instead of any name, GlobalId or filename inference. */
import { buildGlb, sampleManifest, SAMPLE_HOUSE, SAMPLE_REFERENCE, type SampleGlb } from '../canonical-ifc-visual/standard-glb-sample';
import { syntheticPdf } from '../source-host-visual/synthetic-documents';
import { createHostElectricalDocumentaryProvider, type ProviderAuthority } from './host-electrical-documentary-provider.mjs';
import type { CreateElectricalBridge, ElectricalDocumentaryTarget, ElectricalModelBinding, ElectricalTargetChoice, SourceOpenAction,
  SourceOpenContext } from '../../src/lantern/electrical-documentary/types';

const POSED = { posesAlreadyApplied: true, applyTransformAgain: false } as const;
/** The generated house plus a second geometry-free occurrence of the same logical room. */
const REVIEW_HOUSE: SampleGlb = {
  ...SAMPLE_HOUSE,
  nodes: [{ ...SAMPLE_HOUSE.nodes[0]!, children: [1, 2, 3, 4, 5, 6] }, ...SAMPLE_HOUSE.nodes.slice(1),
    { name: 'Room occurrence two', extras: { ...POSED, occurrenceId: 'syn-occurrence-0002', level: null, footprint: null } }],
};

export async function reviewFiles(): Promise<readonly File[]> {
  const house = buildGlb(REVIEW_HOUSE), reference = buildGlb(SAMPLE_REFERENCE);
  const manifest = await sampleManifest(house, reference);
  const data = { ...manifest, houseGLB: { ...manifest.houseGLB, roomOccurrenceNodes: 2 },
    roomOccurrences: [{ globalId: 'syn-occurrence-0001', nodeIndex: 4, footprintAvailable: false },
      { globalId: 'syn-occurrence-0002', nodeIndex: 6, footprintAvailable: false }] };
  return [new File([JSON.stringify(data, null, 2)], 'sample-manifest.json', { type: 'application/json' }),
    new File([house], 'sample-house.glb', { type: 'model/gltf-binary' }), new File([reference], 'sample-reference.glb', { type: 'model/gltf-binary' })];
}

const hex = async (blob: Blob) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))]
  .map(byte => byte.toString(16).padStart(2, '0')).join('');

/** A generated drawing crop, encoded by the browser as a real JPEG. */
async function syntheticJpeg(): Promise<Blob> {
  const canvas = new OffscreenCanvas(480, 300), context = canvas.getContext('2d')!;
  context.fillStyle = '#f3f1ea'; context.fillRect(0, 0, 480, 300);
  context.strokeStyle = '#2b3650'; context.lineWidth = 3; context.strokeRect(40, 40, 400, 220);
  context.lineWidth = 2;
  for (const [x, y] of [[120, 110], [300, 190]] as const) { context.beginPath(); context.arc(x, y, 14, 0, Math.PI * 2); context.stroke();
    context.beginPath(); context.moveTo(x - 10, y - 10); context.lineTo(x + 10, y + 10); context.moveTo(x + 10, y - 10); context.lineTo(x - 10, y + 10); context.stroke(); }
  context.fillStyle = '#2b3650'; context.font = '16px sans-serif'; context.fillText('Synthetic drawing crop', 52, 30);
  return canvas.convertToBlob({ type: 'image/jpeg', quality: .9 });
}

const logical: ElectricalDocumentaryTarget = Object.freeze({ kind: 'model-room', roomId: 'syn-room', spaceOccurrenceId: null });
const first: ElectricalDocumentaryTarget = Object.freeze({ kind: 'model-room', roomId: 'syn-room', spaceOccurrenceId: 'syn-occurrence-0001' });
const second: ElectricalDocumentaryTarget = Object.freeze({ kind: 'model-room', roomId: 'syn-room', spaceOccurrenceId: 'syn-occurrence-0002' });
const unmodeled: ElectricalDocumentaryTarget = Object.freeze({ kind: 'documentary-scope', scopeId: 'syn-unmodeled-scope' });
const TARGETS = [logical, first, second, unmodeled];
const targetKey = (target: ElectricalDocumentaryTarget) => JSON.stringify(target.kind === 'model-room'
  ? [target.kind, target.roomId, target.spaceOccurrenceId] : [target.kind, target.scopeId]);

/** Explicit selector entries; labels are display only. */
export const REVIEW_TARGETS: readonly ElectricalTargetChoice[] = [
  { label: 'Synthetic room, both occurrences', target: logical },
  { label: 'Unmodeled synthetic scope', target: unmodeled },
];
/** Reviewed loader node table for the generated house: the two occurrence nodes only. */
const NODE_TARGETS: ReadonlyMap<number, ElectricalDocumentaryTarget> = new Map([[4, first], [6, second]]);

function snapshot(binding: ElectricalModelBinding, pins: ReadonlyMap<string, { sha256: string }>) {
  const sheetSha = pins.get('syn-original')!.sha256;
  const fixture = (id: string, kind: string, label: string, literal: readonly string[], group: string | null) => ({
    id, sheetId: 'syn-sheet', regionId: 'syn-region', clusterId: null, kind, label, glyph: kind === 'socket' ? 'x' : '?',
    source: { symbolKey: id, originalPhotoSha256: sheetSha, renderedPhotoSha256: sheetSha, normalizedBox: [0.2, 0.3, 0.3, 0.4],
      normalizedPoint: [0.25, 0.35], literalLabels: literal, placementDescription: 'Generated position' },
    group: { id: group ? 'syn-group' : null, label: group, basis: group ? 'historic-label' : 'unknown', note: group ? 'Historic drawing label' : 'Unknown' },
    glyphCount: 2, fixtureCount: null, uncertainty: 'Generated example', currentState: 'historic-unverified', physicalCoordinate: null, wireRoute: null });
  const records = [
    { fixtureId: 'syn-record-room', role: 'socket-mark', associationScope: { kind: 'logical-room' }, sharedScopeIds: [] },
    { fixtureId: 'syn-record-one', role: 'light-label', associationScope: { kind: 'occurrences', spaceOccurrenceIds: ['syn-occurrence-0001'] }, sharedScopeIds: [] },
    { fixtureId: 'syn-record-two', role: 'light-annotation', associationScope: { kind: 'occurrences', spaceOccurrenceIds: ['syn-occurrence-0002'] }, sharedScopeIds: [] },
    { fixtureId: 'syn-record-shared', role: 'unresolved-symbol', associationScope: { kind: 'documentary-only' }, sharedScopeIds: ['syn-unmodeled-scope'] },
  ];
  const sources = [
    { sourceKey: 'syn-original', role: 'original-sheet', label: 'Synthetic sheet', sheetId: 'syn-sheet', pdfPage: 2 },
    { sourceKey: 'syn-crop', role: 'drawing-crop', label: 'Synthetic crop', sheetId: 'syn-sheet', pdfPage: 2 },
    { sourceKey: 'syn-record', role: 'interpretation-record', label: 'Synthetic interpretation', sheetId: 'syn-sheet', pdfPage: null },
  ];
  return {
    binding, reviewSha256: 'a'.repeat(64), fixtureLedgerSha256: 'b'.repeat(64), documentaryIndex: null, custody: 'private-local-review',
    fixtureData: {
      schema: 'houseatlas.documentary-electrical-fixtures.v1', viewKey: 'syn-ledger', interpretationDate: '2026-01-01',
      symbolLegend: { xMeansSocket: null, socketsPerX: null, receiptId: null }, roomMappingReceipt: null, registrationReceipts: [], groups: [],
      sheets: [{ id: 'syn-sheet', title: 'Synthetic sheet', pdfPage: 2, originalPhoto: 'syn-photo', originalPhotoSha256: sheetSha,
        renderedPhotoSha256: sheetSha, sourceDate: null, regionIds: ['syn-region'] }],
      regions: [{ id: 'syn-region', sheetId: 'syn-sheet', label: 'Synthetic region', sourceOutline: [], outlineClosed: false,
        sourceBounds: [0, 0, 1, 1], outlineBasis: 'untraced', places: [], orientation: 'unregistered', physicalTransform: null }],
      fixtures: [fixture('syn-record-room', 'socket', 'Socket mark', ['x x'], null),
        fixture('syn-record-one', 'light', 'Light label', ['L1'], 'Group 3'),
        fixture('syn-record-two', 'light', 'Light annotation', [], null),
        fixture('syn-record-shared', 'unresolved', 'Unresolved symbol', ['?'], null)],
    },
    views: TARGETS.map((target, index) => {
      const rows = target.kind === 'documentary-scope' ? [records[3]!] : records;
      return { target, view: { id: `syn-view-${index}`, label: target.kind === 'documentary-scope' ? 'Unmodeled synthetic scope' : 'Synthetic room',
        fixtureIds: rows.map(row => row.fixtureId), records: rows, sources: target.kind === 'documentary-scope' ? [sources[2]!] : sources,
        installedFixtureCount: null } };
    }),
  };
}

export interface SyntheticBridgeLog { opens: number; reads: number }

/** Fixture bridge factory. `log` counts calls so the page can show that the
 * missing-provider mode makes none. */
export function syntheticBridge(log: SyntheticBridgeLog): CreateElectricalBridge {
  return async ({ modelFile, manifestFile, referenceFile, selectionOwner, reader, signal }) => {
    const context = selectionOwner.capture();
    if (context.modelFile !== modelFile || context.manifestFile !== manifestFile || context.referenceFile !== referenceFile)
      throw new Error('Not the renderer files');
    const pdf = new Blob([syntheticPdf()], { type: 'application/pdf' }), jpeg = await syntheticJpeg();
    const record = new Blob([JSON.stringify({ schema: 'synthetic-interpretation.v1', reading: 'Two generated marks', uncertainty: 'unknown' })], { type: 'application/json' });
    const blobs = new Map([['syn-original', pdf], ['syn-crop', jpeg], ['syn-record', record]]);
    const pins = new Map(await Promise.all([...blobs].map(async ([key, blob]) => [key, { sha256: await hex(blob), bytes: blob.size }] as const)));
    const binding: ElectricalModelBinding = Object.freeze({ kind: 'private-preview', modelVersion: 'synthetic-review-1',
      modelGlbSha256: await hex(modelFile), canonicalSourceSha256: null, crosswalkSha256: await hex(manifestFile) });
    signal.throwIfAborted();
    let closed = false;
    const closers = new Set<() => void>();
    const current = () => !closed && selectionOwner.isCurrent(context);
    const authority: ProviderAuthority = {
      isCurrent: current,
      subscribeInvalidation(changed) {
        const stop = selectionOwner.subscribe(context, changed); closers.add(changed);
        return () => { stop(); closers.delete(changed); };
      },
      async openSource(descriptor, openSignal, frameContext) {
        const blob = blobs.get(descriptor.sourceKey), pin = pins.get(descriptor.sourceKey);
        if (!blob || !pin) return 'unavailable';
        const full: SourceOpenContext = Object.freeze({ ...frameContext, selectionContext: context });
        if (openSignal.aborted || !current() || reader.isCurrent?.(full) === false) return 'unavailable';
        const action: SourceOpenAction = Object.freeze({ blob, sourceKey: descriptor.sourceKey, role: descriptor.role as SourceOpenAction['role'],
          contentType: blob.type, pdfPage: descriptor.pdfPage, sha256: pin.sha256, bytes: pin.bytes, label: descriptor.label, binding });
        log.opens++;
        const result = await reader.open(action, openSignal, full);
        return result === 'opened' && !openSignal.aborted && current() && reader.isCurrent?.(full) !== false ? 'opened' : 'unavailable';
      },
    };
    const provider = createHostElectricalDocumentaryProvider(snapshot(binding, pins), authority);
    const port = { ...provider, read: (...args: Parameters<typeof provider.read>) => { log.reads++; return provider.read(...args); } };
    return Object.freeze({
      port, binding,
      resolvePickedNode: (nodeIndex: number) => NODE_TARGETS.get(nodeIndex) ?? null,
      resolveTarget: (target: ElectricalDocumentaryTarget) => TARGETS.find(item => targetKey(item) === targetKey(target)) ?? null,
      close() {
        if (closed) return; closed = true;
        const notify = [...closers]; closers.clear();
        for (const changed of notify) changed();
      },
    });
  };
}
