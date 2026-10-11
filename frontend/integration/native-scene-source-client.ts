import { ExactDecimal, isExactDecimal } from '../src/numeric/decimal';
import { parseLosslessJson, type LosslessJson } from '../src/numeric/lossless-json';
import { admittedRoomRegions } from '../src/lantern/scans/presentation/room-region-model';
import { adaptDocumentaryElectricity } from '../src/lantern/overlays/electricity/documentary-adapter';
import type { NativeEvidenceDocumentClient, NativeEvidenceDocumentFrame } from '../src/lantern/scans/native-evidence-document-types';
import type { NativeGeometryReadClient, NativeGeometryFrame } from '../src/lantern/scans/native-read-types';
import type { NativeSceneSourceClient, NativeSceneSourceFrame, NativeSceneSourceSelection, NativeSceneSubset,
  NativeSceneFloorBinding, NativeSceneDrawingPdfReference } from '../src/lantern/scans/native-scene-source-types';
import type { SchematicRoom, DisplayRoomRegion } from '../src/lantern/scans/presentation/types';
import type { NetworkOverlayData, NetworkOverlayDevice, NetworkOverlayEndpoint,
  NetworkOverlayLink, NetworkPlaceAssociation, NetworkOverlaySource } from '../src/lantern/overlays/network/types';
import type { ElectricityOverlayData } from '../src/lantern/overlays/electricity/types';
import type { ElectricalFixture, ElectricalFixtureData, ElectricalFixtureRegion,
  ElectricalFixtureSheet, ElectricalDocumentaryGroup, FixtureBox, FixturePoint } from '../src/lantern/overlays/electricity/fixture-types';

type Row = { [key: string]: LosslessJson };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const ZERO = ExactDecimal.parse('0'), ONE = ExactDecimal.parse('1');
const MAX_TEXT = 8 * 1024 * 1024;
const unavailable = (reason: 'not-retained' | 'not-qualified' | 'source-unavailable') =>
  Object.freeze({ status: 'unavailable' as const, reason });
export class NativeSceneSourceError extends Error {
  constructor() { super('Current native scene source is unavailable'); this.name = 'NativeSceneSourceError'; }
}
function need(value: unknown): asserts value { if (!value) throw new NativeSceneSourceError(); }
function row(value: LosslessJson | undefined, keys: readonly string[]): Row {
  need(value !== null && typeof value === 'object' && !Array.isArray(value) && !isExactDecimal(value));
  need(Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key)));
  return value;
}
function list(value: LosslessJson | undefined, maximum: number): LosslessJson[] {
  need(Array.isArray(value) && value.length <= maximum); return value;
}
function str(value: LosslessJson | undefined, maximum = 256): string {
  need(typeof value === 'string' && value.length > 0 && value.length <= maximum && value.trim() === value);
  return value;
}
function plain(value: LosslessJson | undefined, maximum = 2048): string {
  need(typeof value === 'string' && value.length <= maximum); return value;
}
function optional(value: LosslessJson | undefined, maximum = 256): string | null {
  return value === null ? null : str(value, maximum);
}
function digest(value: LosslessJson | undefined): string { const s = str(value, 64); need(SHA.test(s)); return s; }
function strings(value: LosslessJson | undefined, maximum: number, size = 256): readonly string[] {
  const result = list(value, maximum).map(part => str(part, size));
  need(new Set(result).size === result.length); return Object.freeze(result);
}
function choice<T extends string>(value: LosslessJson | undefined, options: readonly T[]): T {
  need(typeof value === 'string' && options.includes(value as T)); return value as T;
}
function fraction(value: LosslessJson | undefined): number {
  need(isExactDecimal(value) && value.compare(ZERO) >= 0 && value.compare(ONE) <= 0);
  const result = Number(value.token); need(Number.isFinite(result) && result >= 0 && result <= 1); return result;
}
function page(value: LosslessJson | undefined): number {
  need(isExactDecimal(value)); const result = value.toSafeInteger(); need(result !== undefined && result >= 1 && result <= 10000); return result;
}
function count(value: LosslessJson | undefined): number | null {
  if (value === null) return null;
  need(isExactDecimal(value)); const result = value.toSafeInteger();
  need(result !== undefined && result >= 1 && result <= 10000); return result;
}
function bool(value: LosslessJson | undefined): boolean { need(typeof value === 'boolean'); return value; }
function sourcePoint(value: LosslessJson | undefined): FixturePoint {
  const values = list(value, 2); need(values.length === 2);
  return freeze([fraction(values[0]), fraction(values[1])] as const);
}
function sourceBox(value: LosslessJson | undefined): FixtureBox {
  const values = list(value, 4); need(values.length === 4);
  const result = [fraction(values[0]), fraction(values[1]), fraction(values[2]), fraction(values[3])] as const;
  need(result[0] <= result[2] && result[1] <= result[3]); return freeze(result);
}
function identical(a: ExactDecimal, b: ExactDecimal): boolean { return a.compare(b) === 0; }
function selectionStamp(value: NativeSceneSourceSelection): string {
  return JSON.stringify([value.sessionIdentity === null, value.workspaceId, value.homeId, value.expiresAt,
    value.buildingId, value.viewKey, value.sceneEvidenceId, value.sceneAssetId,
    value.sceneOriginalSha256, value.sceneEvidenceRevision, value.sceneAssetRevision.token,
    value.acceptedRoomReceiptId, value.acceptedRoomReceiptSha256,
    value.acceptedRoomAnchors.map(a => [a.id, a.sourceFloorKey, a.sourceOriginalSha256,
      a.targets.map(t => [t.packagePlaceKey, t.packagePlaceUuid]), [...a.unresolvedLabels]]),
    value.sourceFloorBindings.map(f => [f.sourceFloorKey, f.sourceOriginalSha256,
      f.nativeFloorKey, f.nativeOriginalAssetId, f.nativeOriginalSha256,
      f.nativeGeometryId, f.nativeGeometryRevision.token]),
    value.drawingReferences?.map(r => [r.correlationId, r.correlationSha256, r.workspaceId, r.homeId,
      r.buildingId, r.viewKey, r.sceneOriginalSha256, r.sceneEvidenceId, r.sceneEvidenceRevision,
      r.sceneAssetId, r.sceneAssetRevision?.token, r.sheetId, r.pdfPage,
      r.originalPhotoSha256, r.renderedPhotoSha256, r.evidenceId, r.evidenceRevision,
      r.assetId, r.assetRevision?.token, r.assetSha256, r.byteSize?.token])]);
}

/** Host pins are independent of retained scene text. Invalid or ambiguous joins
 * cannot grant a PDF action; other qualified scene subsets remain usable. */
function drawingReferences(selection: NativeSceneSourceSelection,
  fixtures: NativeSceneSubset<ElectricalFixtureData>): readonly NativeSceneDrawingPdfReference[] {
  const input = selection.drawingReferences;
  if (!input || input.length > 128 || fixtures.status !== 'available') return Object.freeze([]);
  const duplicates = new Set(input.filter((r, i) => input.some((other, j) => j !== i && other.sheetId === r.sheetId)).map(r => r.sheetId));
  const result: NativeSceneDrawingPdfReference[] = [];
  for (const r of input) {
    const sheet = fixtures.data.sheets.find(s => s.id === r.sheetId);
    if (!sheet || duplicates.has(r.sheetId) || !r.correlationId || r.correlationId.length > 256
      || !SHA.test(r.correlationSha256) || r.workspaceId !== selection.workspaceId
      || r.homeId !== selection.homeId || r.buildingId !== selection.buildingId || r.viewKey !== selection.viewKey
      || r.sceneOriginalSha256 !== selection.sceneOriginalSha256
      || r.sceneEvidenceId !== selection.sceneEvidenceId || r.sceneEvidenceRevision !== selection.sceneEvidenceRevision
      || r.sceneAssetId !== selection.sceneAssetId || !isExactDecimal(r.sceneAssetRevision)
      || !identical(r.sceneAssetRevision, selection.sceneAssetRevision) || r.pdfPage !== sheet.pdfPage
      || r.originalPhotoSha256 !== sheet.originalPhotoSha256 || r.renderedPhotoSha256 !== sheet.renderedPhotoSha256
      || !UUID.test(r.evidenceId) || !UUID.test(r.assetId) || !SHA.test(r.assetSha256)
      || !Number.isSafeInteger(r.evidenceRevision) || r.evidenceRevision < 1
      || !isExactDecimal(r.assetRevision) || !r.assetRevision.isInteger || r.assetRevision.compare(ONE) < 0
      || !isExactDecimal(r.byteSize) || r.byteSize.toSafeInteger() === undefined
      || r.byteSize.compare(ONE) < 0 || r.byteSize.compare(ExactDecimal.parse('10485760')) > 0) continue;
    result.push(freeze({ ...r }));
  }
  return Object.freeze(result);
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
}

/** The shared lossless parser preserves numbers but is deliberately last-wins for keys.
 * This bounded lexical pass rejects duplicate decoded keys before that parser runs. */
function rejectDuplicateKeys(text: string): void {
  let i = 0, members = 0;
  const space = () => { while (/\s/.test(text[i] ?? '') && i < text.length) i++; };
  const quoted = (): string => {
    need(text[i] === '"'); const start = i++;
    for (; i < text.length; i++) {
      if (text[i] === '\\') { i++; continue; }
      if (text[i] === '"') { i++; return JSON.parse(text.slice(start, i)) as string; }
    }
    throw new NativeSceneSourceError();
  };
  const scan = (depth: number): void => {
    need(depth <= 32); space();
    if (text[i] === '{') {
      i++; space(); const seen = new Set<string>();
      if (text[i] === '}') { i++; return; }
      for (;;) {
        const key = quoted(); need(++members <= 50000 && !seen.has(key)); seen.add(key);
        space(); need(text[i++] === ':'); scan(depth + 1); space();
        if (text[i] === '}') { i++; return; }
        need(text[i++] === ','); space();
      }
    }
    if (text[i] === '[') {
      i++; space(); if (text[i] === ']') { i++; return; }
      for (;;) { need(++members <= 50000); scan(depth + 1); space();
        if (text[i] === ']') { i++; return; } need(text[i++] === ','); }
    }
    if (text[i] === '"') { quoted(); return; }
    const start = i;
    while (i < text.length && !/[\s,\]}]/.test(text[i]!)) i++;
    need(i > start);
  };
  scan(0); space(); need(i === text.length);
}
function parse(text: string): LosslessJson { rejectDuplicateKeys(text); return parseLosslessJson(text); }
function boundedTree(value: LosslessJson): void {
  let count = 0;
  const visit = (node: LosslessJson, depth: number): void => {
    need(++count <= 50000 && depth <= 24);
    if (typeof node === 'string') { need(node.length <= 4096); return; }
    if (node === null || typeof node !== 'object' || isExactDecimal(node)) return;
    if (Array.isArray(node)) { need(node.length <= 2048); node.forEach(child => visit(child, depth + 1)); return; }
    const keys = Object.keys(node); need(keys.length <= 128);
    for (const key of keys) { need(key.length <= 128); visit(node[key]!, depth + 1); }
  };
  visit(value, 0);
}
async function sha256(bytes: Uint8Array): Promise<string> {
  const result = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return [...new Uint8Array(result)].map(value => value.toString(16).padStart(2, '0')).join('');
}
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const stop = () => { signal.removeEventListener('abort', stop); reject(signal.reason ?? new NativeSceneSourceError()); };
    signal.addEventListener('abort', stop, { once: true });
    work.then(value => { signal.removeEventListener('abort', stop); resolve(value); },
      error => { signal.removeEventListener('abort', stop); reject(error); });
    if (signal.aborted) stop();
  });
}
type Anchor = Readonly<{ id: string; floor: string; sourceSha: string;
  targets: readonly Readonly<{ key: string; uuid: string }>[]; unresolved: readonly string[] }>;
function receipt(selection: NativeSceneSourceSelection): ReadonlyMap<string, Anchor> {
  const anchors = new Map<string, Anchor>();
  if (selection.acceptedRoomReceiptId === null || selection.acceptedRoomReceiptSha256 === null) {
    need(selection.acceptedRoomReceiptId === null && selection.acceptedRoomReceiptSha256 === null
      && selection.acceptedRoomAnchors.length === 0);
    return anchors;
  }
  need(selection.acceptedRoomReceiptId.length > 0 && selection.acceptedRoomReceiptId.length <= 256
    && SHA.test(selection.acceptedRoomReceiptSha256));
  need(selection.acceptedRoomAnchors.length <= 128);
  for (const a of selection.acceptedRoomAnchors) {
    const id = str(a.id), floor = str(a.sourceFloorKey), sourceSha = digest(a.sourceOriginalSha256);
    need(!anchors.has(id));
    need(a.targets.length <= 16);
    const targets = a.targets.map(t => {
      const key = str(t.packagePlaceKey), uuid = str(t.packagePlaceUuid);
      need(UUID.test(uuid)); return freeze({ key, uuid });
    });
    need(new Set(targets.map(t => `${t.key}\0${t.uuid}`)).size === targets.length);
    need(a.unresolvedLabels.length <= 32);
    const unresolved = a.unresolvedLabels.map(value => str(value, 512));
    anchors.set(id, freeze({ id, floor, sourceSha, targets, unresolved: Object.freeze(unresolved) }));
  }
  return anchors;
}
function bindings(selection: NativeSceneSourceSelection, geometry: NativeGeometryFrame): ReadonlyMap<string, NativeSceneFloorBinding> {
  need(geometry.viewKey === selection.viewKey && geometry.descriptor.viewKey === selection.viewKey
    && geometry.descriptor.buildingId === selection.buildingId
    && geometry.descriptor.scope.workspaceId === selection.workspaceId
    && geometry.descriptor.scope.homeId === selection.homeId);
  const result = new Map<string, NativeSceneFloorBinding>(), used = new Set<string>();
  need(selection.sourceFloorBindings.length <= 3);
  for (const binding of selection.sourceFloorBindings) {
    need(!result.has(binding.sourceFloorKey) && !used.has(binding.nativeFloorKey)
      && SHA.test(binding.sourceOriginalSha256) && SHA.test(binding.nativeOriginalSha256)
      && UUID.test(binding.nativeOriginalAssetId) && UUID.test(binding.nativeGeometryId));
    const offered = geometry.descriptor.floors.find(o => o.floor.key === binding.nativeFloorKey)?.floor;
    need(offered && offered.originalAssetId === binding.nativeOriginalAssetId
      && offered.originalSha256 === binding.nativeOriginalSha256
      && offered.geometryId === binding.nativeGeometryId
      && identical(offered.geometryRevision, binding.nativeGeometryRevision));
    result.set(binding.sourceFloorKey, binding); used.add(binding.nativeFloorKey);
  }
  return result;
}
function floorFor(key: string, sha: string, bound: ReadonlyMap<string, NativeSceneFloorBinding>): string {
  const binding = bound.get(key); need(binding && binding.sourceOriginalSha256 === sha); return binding.nativeFloorKey;
}
function rooms(source: Row, anchors: ReadonlyMap<string, Anchor>, bound: ReadonlyMap<string, NativeSceneFloorBinding>):
  NativeSceneSubset<Readonly<{ rooms: readonly SchematicRoom[]; regions: readonly DisplayRoomRegion[] }>> {
  if (source.status !== 'available') {
    need(source.status === 'unavailable' && source.entries === null && source.regions === null);
    return unavailable(choice(source.reason, ['not-retained', 'not-qualified', 'source-unavailable']));
  }
  need(source.reason === null && source.receiptId !== null && source.receiptSha256 !== null
    && anchors.size > 0);
  const entries: SchematicRoom[] = [], ids = new Set<string>();
  for (const item of list(source.entries, 32)) {
    const r = row(item, ['id','label','sourceFloorKey','sourceOriginalSha256','sourceAnchorIds',
      'packagePlaceKey','packagePlaceUuid','xFraction','yFraction']);
    const id = str(r.id), floor = str(r.sourceFloorKey), sha = digest(r.sourceOriginalSha256);
    const key = str(r.packagePlaceKey), uuid = str(r.packagePlaceUuid), sourceAnchorIds = strings(r.sourceAnchorIds, 32);
    need(!ids.has(id) && UUID.test(uuid) && sourceAnchorIds.length > 0);
    const nativeFloor = floorFor(floor, sha, bound);
    for (const anchorId of sourceAnchorIds) {
      const anchor = anchors.get(anchorId);
      need(anchor && anchor.floor === floor && anchor.sourceSha === sha && anchor.targets.length === 1
        && anchor.targets[0]!.key === key && anchor.targets[0]!.uuid === uuid);
    }
    entries.push(freeze({ id, floorKey: nativeFloor, label: str(r.label, 512), packagePlaceKey: key,
      packagePlaceUuid: uuid, sourceAnchorIds, receiptId: str(source.receiptId),
      receiptSha256: digest(source.receiptSha256), xFraction: fraction(r.xFraction),
      yFraction: fraction(r.yFraction), basis: 'schematic-room' as const }));
    ids.add(id);
  }
  const regions: DisplayRoomRegion[] = []; let vertices = 0;
  for (const item of list(source.regions, 32)) {
    const r = row(item, ['roomId','sourceFloorKey','sourceOriginalSha256','sourceAnchorIds',
      'packagePlaceKey','packagePlaceUuid','polygons','geometryQualification','sourceGeometryHandles','displayKind']);
    const roomId = str(r.roomId), floor = floorFor(str(r.sourceFloorKey), digest(r.sourceOriginalSha256), bound);
    const room = entries.find(entry => entry.id === roomId);
    const sourceAnchorIds = strings(r.sourceAnchorIds, 32);
    need(room && room.floorKey === floor && room.packagePlaceKey === r.packagePlaceKey
      && room.packagePlaceUuid === r.packagePlaceUuid && sourceAnchorIds.length > 0
      && sourceAnchorIds.every(id => room.sourceAnchorIds.includes(id))
      && !regions.some(region => region.roomId === roomId));
    const polygons = list(r.polygons, 16).map(input => {
      const points = list(input, 512).map(point => {
        const pair = list(point, 2); need(pair.length === 2); vertices++;
        need(vertices <= 8192); return freeze([fraction(pair[0]), fraction(pair[1])] as const);
      });
      need(points.length >= 3); return Object.freeze(points);
    });
    need(polygons.length > 0);
    const displayKind = choice(r.displayKind, ['sleep','wet','circulation','service','living']);
    regions.push(freeze({ roomId, floorKey: floor, packagePlaceKey: room.packagePlaceKey,
      packagePlaceUuid: room.packagePlaceUuid, receiptId: room.receiptId, receiptSha256: room.receiptSha256,
      sourceAnchorIds, polygons, geometryQualification: str(r.geometryQualification, 2048),
      sourceGeometryHandles: strings(r.sourceGeometryHandles, 256), displayKind }));
  }
  need(admittedRoomRegions(regions, entries).length === regions.length);
  return freeze({ status: 'available' as const, data: freeze({ rooms: Object.freeze(entries), regions: Object.freeze(regions) }) });
}

function network(source: Row, viewKey: string, receiptId: string | null, receiptSha: string | null,
  anchors: ReadonlyMap<string, Anchor>, bound: ReadonlyMap<string, NativeSceneFloorBinding>): NativeSceneSubset<NetworkOverlayData> {
  if (source.status !== 'available') {
    need(source.status === 'unavailable' && source.source === null && source.devices === null && source.endpoints === null && source.links === null);
    return unavailable(choice(source.reason, ['not-retained','not-qualified','source-unavailable']));
  }
  need(source.reason === null);
  const meta = row(source.source, ['label','revision','recordedAt','retrievedAt','status','acceptedAt','coverage','notes']);
  const sourceInfo: NetworkOverlaySource = freeze({ label: str(meta.label, 512), revision: optional(meta.revision),
    recordedAt: optional(meta.recordedAt), retrievedAt: optional(meta.retrievedAt),
    status: choice(meta.status, ['recorded','stale']), acceptedAt: null,
    coverage: choice(meta.coverage, ['complete','partial','unknown']), notes: plain(meta.notes),
    ...(receiptId !== null && receiptSha !== null ? { roomMappingReceipt: { id: receiptId, sha256: receiptSha } } : {}) });
  need(meta.acceptedAt === null);
  const deviceIds = new Set<string>(), endpointIds = new Set<string>(), linkIds = new Set<string>();
  const devices: NetworkOverlayDevice[] = list(source.devices, 512).map(item => {
    const d = row(item, ['id','label','kind','mobility','confidence','notes','place']);
    const id = str(d.id); need(!deviceIds.has(id)); deviceIds.add(id);
    let place: NetworkPlaceAssociation | null = null;
    if (d.place !== null) {
      const p = row(d.place, ['sourceRoomId','sourcePlaceId','sourcePlaceUUID','planAssociations',
        'roomLabel','detail','confidence','basis','sourceFloorKey','mappingStatus','coordinate']);
      need(p.coordinate === null);
      const refs = list(p.planAssociations, 32).map(item => {
        need(receiptSha !== null);
        const a = row(item, ['sourceAnchorId','sourceFloorKey','sourceFloorLabel','sourceReference','sourceHandle','sourceSHA256']);
        const id = str(a.sourceAnchorId), anchor = anchors.get(id);
        need(anchor && anchor.floor === a.sourceFloorKey && anchor.sourceSha === a.sourceSHA256);
        return freeze({ sourceAnchorId: id, sourceFloorKey: anchor.floor, sourceFloorLabel: str(a.sourceFloorLabel),
          sourceReference: str(a.sourceReference, 512), sourceHandle: str(a.sourceHandle),
          sourceSHA256: anchor.sourceSha, mappingReceiptSHA256: receiptSha });
      });
      const sourceFloorKey = optional(p.sourceFloorKey);
      const sourcePlaceId = optional(p.sourcePlaceId), sourcePlaceUUID = optional(p.sourcePlaceUUID);
      const mappingStatus = choice(p.mappingStatus, ['unmatched','proposed','accepted']);
      if (mappingStatus === 'accepted') {
        need(receiptSha !== null && sourcePlaceId && sourcePlaceUUID && refs.length > 0 && UUID.test(sourcePlaceUUID)
          && refs.every(ref => {
            const targets = anchors.get(ref.sourceAnchorId)?.targets;
            return targets?.length === 1 && targets[0]!.key === sourcePlaceId
              && targets[0]!.uuid === sourcePlaceUUID;
          }));
      }
      need(sourceFloorKey === null || refs.length > 0 && refs.every(ref => ref.sourceFloorKey === sourceFloorKey));
      const floorKey = sourceFloorKey === null ? null : floorFor(sourceFloorKey, refs[0]!.sourceSHA256, bound);
      place = freeze({ placeId: null, sourceRoomId: optional(p.sourceRoomId), sourcePlaceId,
        sourcePlaceUUID, planAssociations: freeze(refs), roomLabel: str(p.roomLabel, 512),
        detail: plain(p.detail, 1024), confidence: choice(p.confidence, ['accepted','recorded','tentative','unknown','conflicting']),
        basis: str(p.basis, 1024), floorKey, mappingStatus, coordinate: null });
    }
    return freeze({ id, label: str(d.label, 512), kind: str(d.kind),
      mobility: choice(d.mobility, ['fixed','mobile','nonspatial','unknown']),
      confidence: choice(d.confidence, ['accepted','recorded','tentative','unknown','conflicting']),
      notes: plain(d.notes), place });
  });
  const endpoints: NetworkOverlayEndpoint[] = list(source.endpoints, 1024).map(item => {
    const e = row(item, ['id','label','kind','ownerDeviceId','notes']); const id = str(e.id);
    need(!endpointIds.has(id) && !deviceIds.has(id)); endpointIds.add(id);
    const ownerDeviceId = optional(e.ownerDeviceId); need(ownerDeviceId === null || deviceIds.has(ownerDeviceId));
    return freeze({ id, label: str(e.label, 512), kind: choice(e.kind, ['segment','interface','named-endpoint','unresolved']),
      ownerDeviceId, notes: plain(e.notes) });
  });
  const links: NetworkOverlayLink[] = list(source.links, 2048).map(item => {
    const l = row(item, ['id','fromEndpointId','toEndpointId','kind','medium','confidence',
      'sourceConfidence','temporalStatus','recordedAtPrecision','basis','recordedAt','notes','path']);
    const id = str(l.id), fromEndpointId = str(l.fromEndpointId), toEndpointId = str(l.toEndpointId);
    need(!linkIds.has(id) && (deviceIds.has(fromEndpointId) || endpointIds.has(fromEndpointId))
      && (deviceIds.has(toEndpointId) || endpointIds.has(toEndpointId)) && l.path === null);
    linkIds.add(id);
    return freeze({ id, fromEndpointId, toEndpointId, kind: choice(l.kind, ['connection','segment-membership','unresolved-path','hypothesis']),
      medium: str(l.medium), confidence: choice(l.confidence, ['accepted','recorded','tentative','unknown','conflicting']),
      sourceConfidence: optional(l.sourceConfidence), temporalStatus: str(l.temporalStatus),
      recordedAtPrecision: optional(l.recordedAtPrecision), basis: str(l.basis, 1024),
      recordedAt: optional(l.recordedAt), notes: plain(l.notes), path: null });
  });
  return freeze({ status: 'available' as const,
    data: freeze({ viewKey, source: sourceInfo, devices, endpoints, links }) });
}

/** Convert only the two control-number fields consumed by the pure electricity adapter. */
function electricity(source: Row, viewKey: string): NativeSceneSubset<ElectricityOverlayData> {
  if (source.status !== 'available') {
    need(source.status === 'unavailable' && source.documentarySource === null && source.roomRegistry === null && source.buildingPackageKey === null && source.retrievedAt === null);
    return unavailable(choice(source.reason, ['not-retained','not-qualified','source-unavailable']));
  }
  need(source.reason === null);
  const input = row(source.documentarySource, ['schema','status','native_import_receipt','records']);
  need(input.schema === 'private-documentary-records/v1' && input.native_import_receipt === null);
  const records = list(input.records, 128).map(item => {
    const record = item as Row; need(record !== null && typeof record === 'object' && !Array.isArray(record));
    const diagram = record.provisional_diagram as Row;
    need(diagram !== null && typeof diagram === 'object' && !Array.isArray(diagram));
    const coords = list(diagram.region_xyxy, 4); need(coords.length === 4);
    return { ...record, pdf_page: page(record.pdf_page),
      provisional_diagram: { ...diagram, region_xyxy: coords.map(fraction) } };
  });
  const registry = source.roomRegistry;
  const result = adaptDocumentaryElectricity({ ...input, records }, registry,
    { schema: 'private-native-identity-map/v1', mapping: [] },
    { viewKey, buildingPackageKey: str(source.buildingPackageKey), retrievedAt: optional(source.retrievedAt) });
  need(result.buildingPlaceId === null && result.preparationSnapshot.nativeImportReceipt === null
    && result.sheets.length <= 128 && result.sheets.every(sheet => sheet.roomAssociations.every(room => room.nativePlaceId === null)));
  return freeze({ status: 'available' as const, data: result });
}

/** A separate historical symbol inventory. Embedded receipt text and drawing
 * registration rows never grant room or fixture placement authority. */
function electricalFixtures(source: Row, viewKey: string, receiptId: string | null,
  receiptSha: string | null, anchors: ReadonlyMap<string, Anchor>): NativeSceneSubset<ElectricalFixtureData> {
  if (source.status !== 'available') {
    need(source.status === 'unavailable' && source.documentaryFixtures === null);
    return unavailable(choice(source.reason, ['not-retained','not-qualified','source-unavailable']));
  }
  need(source.reason === null && receiptId !== null && receiptSha !== null && anchors.size > 0);
  const input = row(source.documentaryFixtures, ['schema','viewKey','interpretationDate','symbolLegend',
    'roomMappingReceipt','registrationReceipts','sheets','groups','regions','fixtures']);
  need(input.schema === 'houseatlas.documentary-electrical-fixtures.v1');
  str(input.viewKey); // Documentary source key; only the host supplies the current view key.
  const legend = row(input.symbolLegend, ['xMeansSocket','socketsPerX','receiptId']);
  const xMeansSocket = legend.xMeansSocket === null ? null : bool(legend.xMeansSocket);
  const socketsPerX = count(legend.socketsPerX);
  const symbolReceipt = optional(legend.receiptId);
  const sourceReceipt = row(input.roomMappingReceipt, ['id','sha256']);
  need(sourceReceipt.id === receiptId && sourceReceipt.sha256 === receiptSha);
  // An actual reviewed registration is an independent host proof. This
  // source-only format admits no embedded proposed or accepted registration.
  need(list(input.registrationReceipts, 0).length === 0);
  const sheets: ElectricalFixtureSheet[] = [], sheetIds = new Set<string>();
  for (const item of list(input.sheets, 128)) {
    const s = row(item, ['id','title','pdfPage','originalPhoto','originalPhotoSha256',
      'renderedPhotoSha256','sourceDate','regionIds']);
    const id = str(s.id), originalPhoto = str(s.originalPhoto, 512);
    const photoParts = originalPhoto.split('/');
    need(!sheetIds.has(id) && photoParts.length <= 8 && photoParts.every(part =>
      /^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/.test(part) && part !== '.' && part !== '..'
      && !part.endsWith('.') && !part.endsWith(' ')));
    sheetIds.add(id);
    sheets.push(freeze({ id, title: str(s.title, 512), pdfPage: page(s.pdfPage), originalPhoto,
      originalPhotoSha256: digest(s.originalPhotoSha256), renderedPhotoSha256: digest(s.renderedPhotoSha256),
      sourceDate: optional(s.sourceDate), regionIds: strings(s.regionIds, 256) }));
  }
  const groups: ElectricalDocumentaryGroup[] = [], groupIds = new Set<string>();
  for (const item of list(input.groups, 512)) {
    const g = row(item, ['id','label','fixtureIds','evidenceBasis','currentCircuitId','verifiedWiring']);
    const id = str(g.id); need(!groupIds.has(id) && g.currentCircuitId === null && g.verifiedWiring === false);
    groupIds.add(id);
    groups.push(freeze({ id, label: str(g.label, 512), fixtureIds: strings(g.fixtureIds, 2048),
      evidenceBasis: choice(g.evidenceBasis, ['historic-drawing-label']), currentCircuitId: null,
      verifiedWiring: false as const }));
  }
  const regions: ElectricalFixtureRegion[] = [], regionIds = new Set<string>();
  const placeUuids = new Map<string, string>(), placeKeys = new Map<string, string>();
  for (const item of list(input.regions, 512)) {
    const r = row(item, ['id','sheetId','label','sourceOutline','outlineClosed','sourceBounds',
      'outlineBasis','places','orientation','physicalTransform']);
    const id = str(r.id), sheetId = str(r.sheetId);
    need(!regionIds.has(id) && sheetIds.has(sheetId) && r.physicalTransform === null);
    regionIds.add(id);
    const places = list(r.places, 64).map(item => {
      const p = row(item, ['packagePlaceKey','packagePlaceUuid','label','basis']);
      const packagePlaceKey = str(p.packagePlaceKey), packagePlaceUuid = str(p.packagePlaceUuid);
      need(UUID.test(packagePlaceUuid) && (!placeUuids.has(packagePlaceKey)
        || placeUuids.get(packagePlaceKey) === packagePlaceUuid)
        && (!placeKeys.has(packagePlaceUuid) || placeKeys.get(packagePlaceUuid) === packagePlaceKey));
      placeUuids.set(packagePlaceKey, packagePlaceUuid);
      placeKeys.set(packagePlaceUuid, packagePlaceKey);
      return freeze({ packagePlaceKey, packagePlaceUuid, label: str(p.label, 512),
        basis: choice(p.basis, ['owner-reported','inferred']) });
    });
    need(new Set(places.map(p => `${p.packagePlaceKey}\0${p.packagePlaceUuid}`)).size === places.length);
    const outline = list(r.sourceOutline, 1024).map(sourcePoint);
    const outlineClosed = bool(r.outlineClosed);
    const outlineBasis = choice(r.outlineBasis, ['untraced','approximate-photo-trace']);
    need(outlineBasis !== 'untraced' || outline.length === 0 && !outlineClosed);
    regions.push(freeze({ id, sheetId, label: str(r.label, 512), sourceOutline: freeze(outline),
      outlineClosed, sourceBounds: sourceBox(r.sourceBounds), outlineBasis, places: freeze(places),
      orientation: choice(r.orientation, ['unregistered']), physicalTransform: null }));
  }
  for (const sheet of sheets) {
    need(sheet.regionIds.every(id => regions.some(region => region.id === id && region.sheetId === sheet.id)));
    need(regions.filter(region => region.sheetId === sheet.id).every(region => sheet.regionIds.includes(region.id)));
  }
  const fixtures: ElectricalFixture[] = [], fixtureIds = new Set<string>(), symbols = new Set<string>();
  for (const item of list(input.fixtures, 2048)) {
    const f = row(item, ['id','sheetId','regionId','clusterId','kind','label','glyph','source',
      'group','glyphCount','fixtureCount','uncertainty','currentState','physicalCoordinate','wireRoute']);
    const id = str(f.id), sheetId = str(f.sheetId), regionId = str(f.regionId);
    need(!fixtureIds.has(id) && regions.some(region => region.id === regionId && region.sheetId === sheetId)
      && f.physicalCoordinate === null && f.wireRoute === null);
    fixtureIds.add(id);
    const s = row(f.source, ['symbolKey','originalPhotoSha256','renderedPhotoSha256',
      'normalizedBox','normalizedPoint','literalLabels','placementDescription']);
    const symbolKey = str(s.symbolKey, 512), sheet = sheets.find(sheet => sheet.id === sheetId)!;
    need(!symbols.has(symbolKey) && s.originalPhotoSha256 === sheet.originalPhotoSha256
      && s.renderedPhotoSha256 === sheet.renderedPhotoSha256);
    symbols.add(symbolKey);
    const normalizedBox = sourceBox(s.normalizedBox), normalizedPoint = sourcePoint(s.normalizedPoint);
    need(normalizedPoint[0] >= normalizedBox[0] && normalizedPoint[0] <= normalizedBox[2]
      && normalizedPoint[1] >= normalizedBox[1] && normalizedPoint[1] <= normalizedBox[3]);
    const g = row(f.group, ['id','label','basis','note']);
    const groupId = optional(g.id), groupLabel = optional(g.label, 512);
    need((groupId === null) === (groupLabel === null));
    if (groupId !== null) need(groups.some(group => group.id === groupId && group.label === groupLabel));
    fixtures.push(freeze({ id, sheetId, regionId, clusterId: optional(f.clusterId, 512),
      kind: choice(f.kind, ['socket','socket-candidate','light','appliance','unresolved']),
      label: str(f.label, 512), glyph: plain(f.glyph, 512),
      source: freeze({ symbolKey, originalPhotoSha256: sheet.originalPhotoSha256,
        renderedPhotoSha256: sheet.renderedPhotoSha256, normalizedBox, normalizedPoint,
        literalLabels: strings(s.literalLabels, 32, 512), placementDescription: plain(s.placementDescription) }),
      group: freeze({ id: groupId, label: groupLabel,
        basis: choice(g.basis, ['label-adjacent','drawn-arrow','uncertain','unknown']),
        note: plain(g.note) }),
      glyphCount: count(f.glyphCount), fixtureCount: count(f.fixtureCount),
      uncertainty: f.uncertainty === null ? null : plain(f.uncertainty),
      currentState: choice(f.currentState, ['historic-unverified']),
      physicalCoordinate: null, wireRoute: null }));
  }
  for (const group of groups) {
    need(group.fixtureIds.every(id => fixtures.some(fixture => fixture.id === id && fixture.group.id === group.id)));
    need(fixtures.filter(fixture => fixture.group.id === group.id).every(fixture => group.fixtureIds.includes(fixture.id)));
  }
  return freeze({ status: 'available' as const, data: freeze({
    schema: 'houseatlas.documentary-electrical-fixtures.v1' as const, viewKey,
    interpretationDate: str(input.interpretationDate),
    symbolLegend: freeze({ xMeansSocket, socketsPerX, receiptId: symbolReceipt }),
    roomMappingReceipt: freeze({ id: receiptId, sha256: receiptSha }),
    registrationReceipts: Object.freeze([]), sheets: freeze(sheets), groups: freeze(groups),
    regions: freeze(regions), fixtures: freeze(fixtures),
  }) });
}

export interface NativeSceneSourceOptions {
  /** Dedicated evidence-document client instance; it owns one original lease at a time. */
  readonly documents: NativeEvidenceDocumentClient;
  readonly geometry: NativeGeometryReadClient;
  /** Synchronous canonical host observation, never a document field. */
  getSelection(): NativeSceneSourceSelection | null;
  subscribeSelection(changed: () => void): () => void;
}

/** One original-read interpretation; no background polling, native action or stored data. */
export function createNativeSceneSourceClient(options: NativeSceneSourceOptions): NativeSceneSourceClient {
  let current: NativeSceneSourceFrame | null = null, document: NativeEvidenceDocumentFrame | null = null;
  let currentSelection: NativeSceneSourceSelection | null = null;
  let currentStamp: string | null = null;
  type Attempt = { readonly generation: number; readonly controller: AbortController; frame: NativeEvidenceDocumentFrame | null };
  let pending: Attempt | null = null;
  let generation = 0, disposed = false, listeners = new Set<() => void>();
  let unsubscribeDocument: (() => void) | null = null, unsubscribeGeometry: (() => void) | null = null;
  let unsubscribeAbort: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const released = new WeakSet<object>();
  const releaseDocument = (frame: NativeEvidenceDocumentFrame) => {
    if (released.has(frame)) return; released.add(frame); options.documents.release(frame);
  };
  const clearOwned = () => {
    const oldPending = pending, oldDocument = document;
    const previousListeners = listeners; listeners = new Set();
    pending = null; document = null; current = null; currentSelection = null; currentStamp = null;
    if (timer) clearTimeout(timer); timer = null;
    const stopDocument = unsubscribeDocument, stopGeometry = unsubscribeGeometry, stopAbort = unsubscribeAbort;
    unsubscribeDocument = null; unsubscribeGeometry = null; unsubscribeAbort = null;
    oldPending?.controller.abort(new NativeSceneSourceError());
    stopAbort?.(); stopDocument?.(); stopGeometry?.();
    if (oldPending?.frame) releaseDocument(oldPending.frame);
    if (oldDocument) releaseDocument(oldDocument);
    for (const callback of previousListeners) { try { callback(); } catch { /* all listeners receive withdrawal */ } }
  };
  const withdraw = () => { generation++; clearOwned(); };
  const hostUnsubscribe = options.subscribeSelection(withdraw);
  const observed = () => { try { return options.getSelection(); } catch { return null; } };
  const same = (selection: NativeSceneSourceSelection, geometry: NativeGeometryFrame, reserved: number) => {
    const expiry = Date.parse(selection.expiresAt);
    if (disposed || generation !== reserved || observed() !== selection || generation !== reserved
      || !Number.isFinite(expiry) || expiry <= Date.now()) return false;
    const geometryCurrent = options.geometry.isCurrent(geometry);
    return geometryCurrent && generation === reserved && observed() === selection && generation === reserved;
  };
  const open: NativeSceneSourceClient['open'] = async (selection, geometry, signal) => {
    // Reserve before release/listener callbacks, any of which may reenter open.
    const reserved = ++generation; clearOwned();
    need(generation === reserved && !disposed && !signal.aborted);
    const controller = new AbortController(), attempt: Attempt = { generation: reserved, controller, frame: null };
    pending = attempt;
    const onAbort = () => { if (generation === reserved) withdraw(); };
    signal.addEventListener('abort', onAbort, { once: true });
    unsubscribeAbort = () => signal.removeEventListener('abort', onAbort);
    if (signal.aborted) onAbort();
    signal.throwIfAborted();
    // The document owner has its own finite fetch deadline; this also bounds
    // Blob copying, hashing and interpretation through final publication.
    const due = performance.now() + 75_000;
    timer = setTimeout(() => { if (generation === reserved) withdraw(); }, 75_000);
    const guard = () => {
      controller.signal.throwIfAborted(); signal.throwIfAborted();
      need(pending === attempt && generation === reserved && performance.now() < due
        && same(selection, geometry, reserved) && pending === attempt && generation === reserved
        && (!attempt.frame || options.documents.isCurrent(attempt.frame))
        && pending === attempt && generation === reserved);
    };
    let frame: NativeEvidenceDocumentFrame | null = null;
    let settledFrame: NativeEvidenceDocumentFrame | null = null;
    try {
    guard(); need(UUID.test(selection.workspaceId) && UUID.test(selection.homeId)
      && UUID.test(selection.buildingId) && UUID.test(selection.sceneEvidenceId)
      && UUID.test(selection.sceneAssetId) && SHA.test(selection.sceneOriginalSha256)
      && Number.isSafeInteger(selection.sceneEvidenceRevision) && selection.sceneEvidenceRevision > 0);
    need(selection.acceptedRoomAnchors.length <= 128 && selection.sourceFloorBindings.length <= 3);
    const stamp = selectionStamp(selection);
    const pinned = () => { guard(); need(selectionStamp(selection) === stamp); guard(); };
    pinned(); const bound = bindings(selection, geometry); pinned();
      // Geometry can withdraw while the document owner is reading, copying or
      // hashing. Attach this exact attempt before the first document request.
      const invalidated = () => { if (generation === reserved) withdraw(); };
      const offGeometry = options.geometry.subscribeInvalidation(geometry, invalidated);
      if (generation !== reserved || pending !== attempt) {
        offGeometry(); throw new NativeSceneSourceError();
      }
      unsubscribeGeometry = offGeometry;
      pinned();
      const work = options.documents.open(selection.sceneEvidenceId, controller.signal);
      // A document owner may resolve after our abort race. Release that exact
      // late frame; no superseded attempt can publish it.
      void work.then(late => {
        settledFrame = late;
        if ((pending !== attempt || controller.signal.aborted) && document !== late) releaseDocument(late);
      }, () => undefined);
      frame = await abortable(work, controller.signal);
      attempt.frame = frame;
      // Claim the returned lease before inspecting or copying its Blob. A
      // synchronous invalidation during subscription cannot be adopted.
      const offDocument = options.documents.subscribeInvalidation(frame, invalidated);
      if (generation !== reserved || pending !== attempt || attempt.frame !== frame) {
        offDocument(); throw new NativeSceneSourceError();
      }
      unsubscribeDocument = offDocument;
      pinned();
      need(options.documents.isCurrent(frame) && pending === attempt && generation === reserved
        && frame.evidenceId === selection.sceneEvidenceId && frame.mode === 'original-download'
        && frame.asset.assetId === selection.sceneAssetId && frame.asset.sha256 === selection.sceneOriginalSha256
        && frame.asset.contentType === 'text/plain' && identical(frame.asset.revision, selection.sceneAssetRevision));
      need(frame.evidenceRevision === selection.sceneEvidenceRevision);
      const blob = options.documents.getBlob(frame);
      pinned(); need(blob && blob.size <= MAX_TEXT && blob.type === 'text/plain');
      const bytes = new Uint8Array(await abortable(blob.arrayBuffer(), controller.signal));
      pinned(); need(bytes.byteLength <= MAX_TEXT
        && await abortable(sha256(bytes), controller.signal) === selection.sceneOriginalSha256);
      pinned();
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      need(!text.startsWith('\uFEFF'));
      const parsed = parse(text);
      need(parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) && !isExactDecimal(parsed));
      const version = parsed.schema;
      const root = version === 'houseatlas.native-scene-source.v1'
        ? row(parsed, ['schema','receiptCanonicalJson','rooms','network','electricity'])
        : row(parsed, ['schema','receiptCanonicalJson','rooms','network','electricity','electricalFixtures']);
      need(root.schema === 'houseatlas.native-scene-source.v1' || root.schema === 'houseatlas.native-scene-source.v2');
      const hasReceipt = selection.acceptedRoomReceiptId !== null && selection.acceptedRoomReceiptSha256 !== null;
      need((selection.acceptedRoomReceiptId === null) === (selection.acceptedRoomReceiptSha256 === null));
      if (hasReceipt) {
        const canonical = str(root.receiptCanonicalJson, 1024 * 1024);
        pinned(); need(await abortable(sha256(new TextEncoder().encode(canonical)), controller.signal)
          === selection.acceptedRoomReceiptSha256); pinned();
        parse(canonical); // Validate exact retained receipt syntax without inventing its schema.
      } else need(root.receiptCanonicalJson === null);
      boundedTree(root.rooms!); boundedTree(root.network!); boundedTree(root.electricity!);
      if (root.schema === 'houseatlas.native-scene-source.v2') boundedTree(root.electricalFixtures!);
      const anchors = receipt(selection);
      const roomSource = row(root.rooms, ['status','reason','receiptId','receiptSha256','entries','regions']);
      need(roomSource.receiptId === selection.acceptedRoomReceiptId
        && roomSource.receiptSha256 === selection.acceptedRoomReceiptSha256);
      const networkSource = row(root.network, ['status','reason','source','devices','endpoints','links']);
      const electricitySource = row(root.electricity, ['status','reason','documentarySource','roomRegistry','buildingPackageKey','retrievedAt']);
      const fixtureSource = root.schema === 'houseatlas.native-scene-source.v2'
        ? row(root.electricalFixtures, ['status','reason','documentaryFixtures']) : null;
      const roomSubset = rooms(roomSource, anchors, bound);
      const roomSelections = roomSubset.status === 'available' ? roomSubset.data.rooms.map(room => {
        const members = room.sourceAnchorIds.map(id => anchors.get(id)!);
        const targets = members.flatMap(anchor => anchor.targets.map(target => ({
          packagePlaceKey: target.key, packagePlaceUuid: target.uuid })));
        const unique = [...new Map(targets.map(target => [`${target.packagePlaceKey}\0${target.packagePlaceUuid}`, target])).values()];
        return freeze({ roomId: room.id, selection: {
          viewKey: selection.viewKey, status: 'accepted' as const,
          receiptId: selection.acceptedRoomReceiptId!, receiptSha256: selection.acceptedRoomReceiptSha256!,
          sourceAnchorIds: room.sourceAnchorIds, targets: unique,
          unresolvedLabels: [...new Set(members.flatMap(anchor => anchor.unresolved))],
        } });
      }) : [];
      const fixtureSubset = fixtureSource === null ? unavailable('not-retained')
        : electricalFixtures(fixtureSource, selection.viewKey, selection.acceptedRoomReceiptId,
          selection.acceptedRoomReceiptSha256, anchors);
      const result: NativeSceneSourceFrame = Object.freeze({ lease: Object.freeze({}), viewKey: selection.viewKey,
        sourceEvidenceId: frame.evidenceId, sourceAssetId: frame.asset.assetId,
        sourceOriginalSha256: frame.asset.sha256, receiptId: selection.acceptedRoomReceiptId,
        receiptSha256: selection.acceptedRoomReceiptSha256, rooms: roomSubset, roomSelections: freeze(roomSelections),
        network: network(networkSource, selection.viewKey, selection.acceptedRoomReceiptId,
          selection.acceptedRoomReceiptSha256, anchors, bound),
        electricity: electricity(electricitySource, selection.viewKey),
        electricalFixtures: fixtureSubset, drawingReferences: drawingReferences(selection, fixtureSubset),
        document: frame, geometry });
      pinned();
      document = frame; current = result; currentSelection = selection; currentStamp = stamp;
      need(same(selection, geometry, reserved) && selectionStamp(selection) === stamp
        && generation === reserved && current === result && document === frame
        && options.documents.isCurrent(frame) && generation === reserved && current === result);
      pending = null;
      if (timer) clearTimeout(timer); timer = null;
      timer = setTimeout(() => { if (generation === reserved) withdraw(); },
        Math.min(Date.parse(selection.expiresAt) - Date.now() + 1, 2_147_483_647));
      need(generation === reserved && current === result && document === frame
        && !controller.signal.aborted && performance.now() < due && same(selection, geometry, reserved));
      return result;
    } catch (error) {
      if (generation === reserved) withdraw();
      if (frame) releaseDocument(frame);
      if (settledFrame) releaseDocument(settledFrame);
      signal.throwIfAborted();
      if (error instanceof NativeSceneSourceError) throw error;
      throw new NativeSceneSourceError();
    }
  };
  const isCurrent = (frame: NativeSceneSourceFrame): boolean => {
      const reserved = generation, captured = current, owned = document, selection = currentSelection, stamp = currentStamp;
      if (captured !== frame || !owned || !selection || !stamp || disposed) return false;
      try {
        const expiry = Date.parse(selection.expiresAt);
        if (!options.documents.isCurrent(owned) || generation !== reserved || current !== captured
          || !options.geometry.isCurrent(frame.geometry) || generation !== reserved || current !== captured
          || observed() !== selection || generation !== reserved || current !== captured
          || !Number.isFinite(expiry) || expiry <= Date.now() || selectionStamp(selection) !== stamp) return false;
        return generation === reserved && current === frame && document === owned && currentSelection === selection;
      } catch { return false; }
    };
  return Object.freeze({ open, isCurrent,
    subscribeInvalidation: (frame: NativeSceneSourceFrame, changed: () => void) => {
      if (!isCurrent(frame)) { changed(); return () => undefined; }
      const registered = listeners;
      registered.add(changed); return () => { registered.delete(changed); };
    },
    release: (frame: NativeSceneSourceFrame) => { if (current === frame) withdraw(); },
    dispose: () => { if (disposed) return; disposed = true; withdraw(); hostUnsubscribe(); },
  });
}
