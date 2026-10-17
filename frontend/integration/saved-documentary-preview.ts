/** Explicit private-fixture snapshot input. This module creates documentary
 * presentation facts only, never a native frame, lease, session or currentness. */
import { ExactDecimal } from '../src/numeric/decimal';
import type { DocumentaryOverlayReadPins } from '../src/lantern/scans/native-scene-source-types';
import type { AtlasScene } from '../src/lantern/unified-atlas/types';
import { projectDocumentaryFacts, type DocumentaryFacts, type PropertyRecords } from '../src/lantern/unified-atlas/runtime-overlays';
import { readSavedDocumentaryDetails } from './native-scene-source-client';
import { readDocumentarySupport, documentaryReferences } from './native-scene-documentary-support';
import type { UnifiedAtlasOverlayReviewedRoomLinks } from './unified-atlas-overlay-source';

type FilePin = { readonly path: string; readonly bytes: number; readonly sha256: string };
interface SavedManifest {
  readonly profile: 'houseatlas.saved-documentary-preview.v1';
  readonly observedAt: string;
  readonly publicationId: string; readonly semanticsSha256: string; readonly modelSha256: string;
  readonly entryBuildingId: string | null;
  readonly pins: DocumentaryOverlayReadPins;
  readonly primary: FilePin; readonly support: FilePin; readonly roomLinks: FilePin;
}
const SHA = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function need(value: unknown): asserts value { if (!value) throw new Error('Saved documentary input does not match its evidence pins.'); }
const digest = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))].map(b => b.toString(16).padStart(2, '0')).join('');
const text = (bytes: Uint8Array) => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);

/** Deliberately simple private fixture names: no URL rewriting or subpaths. */
export function savedDocumentaryInputPath(value: unknown): string {
  need(typeof value === 'string' && /^\/review-input\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value)
    && !value.includes('..'));
  const url = new URL(value, 'https://fixture.invalid');
  need(url.origin === 'https://fixture.invalid' && url.pathname === value && !url.search && !url.hash);
  return value;
}

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  need(value !== null && typeof value === 'object' && !Array.isArray(value));
  const row = value as Record<string, unknown>;
  need(Object.keys(row).length === keys.length && Object.keys(row).every(key => keys.includes(key)));
  return row;
}
function string(value: unknown, maximum = 512): string {
  need(typeof value === 'string' && value.length > 0 && value.length <= maximum); return value;
}
function strings(value: unknown, maximum: number): string[] {
  need(Array.isArray(value) && value.length <= maximum);
  const result = value.map(item => string(item)); need(new Set(result).size === result.length); return result;
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${canonical(row[key])}`).join(',')}}`;
}

/** The receipt literal is pinned by the primary original. Manifest anchors are
 * only a copy; they must retain its complete membership and unresolved labels. */
function bindCapturedReceipt(primary: Uint8Array, pins: DocumentaryOverlayReadPins): void {
  const root = JSON.parse(text(primary)) as Record<string, unknown>;
  const literal = string(root.receiptCanonicalJson, 131072);
  const receipt = object(JSON.parse(literal), ['profile', 'receiptId', 'sourceReceiptSha256', 'anchors']);
  need(receipt.profile === 'houseatlas.native-scene-room-review.v1' && canonical(receipt) === literal
    && receipt.receiptId === pins.acceptedRoomReceiptId
    && canonical(receipt.anchors) === canonical(pins.acceptedRoomAnchors));
}

/** The manifest carries numeric revision tokens as strings to retain precision. */
function factualPins(raw: unknown): DocumentaryOverlayReadPins {
  need(raw !== null && typeof raw === 'object' && !Array.isArray(raw));
  const value = raw as Record<string, unknown>;
  const keys = ['workspaceId', 'homeId', 'buildingId', 'viewKey', 'sceneEvidenceId', 'sceneAssetId', 'sceneOriginalSha256',
    'sceneEvidenceRevision', 'sceneAssetRevision', 'acceptedRoomReceiptId', 'acceptedRoomReceiptSha256', 'acceptedRoomAnchors',
    'acceptedRoomMappings', 'sourceFloorBindings', 'drawingSupport'];
  need(Object.keys(value).every(key => keys.includes(key)));
  for (const key of ['workspaceId', 'homeId', 'buildingId', 'sceneEvidenceId', 'sceneAssetId']) need(typeof value[key] === 'string' && UUID.test(value[key] as string));
  need(typeof value.viewKey === 'string' && value.viewKey.length > 0 && value.viewKey.length <= 512);
  need(typeof value.sceneOriginalSha256 === 'string' && SHA.test(value.sceneOriginalSha256));
  need(Number.isSafeInteger(value.sceneEvidenceRevision) && (value.sceneEvidenceRevision as number) >= 1);
  need(typeof value.sceneAssetRevision === 'string' && /^\d+$/.test(value.sceneAssetRevision));
  need(Array.isArray(value.sourceFloorBindings) && value.sourceFloorBindings.length <= 3);
  const bindings = value.sourceFloorBindings.map(item => {
    need(item !== null && typeof item === 'object' && !Array.isArray(item));
    need(typeof item.nativeGeometryRevision === 'string' && /^\d+$/.test(item.nativeGeometryRevision));
    return { ...item, nativeGeometryRevision: ExactDecimal.parse(item.nativeGeometryRevision) };
  });
  const support = value.drawingSupport as Record<string, unknown> | undefined;
  if (support) need(typeof support.assetRevision === 'string' && /^\d+$/.test(support.assetRevision)
    && typeof support.evidenceId === 'string' && UUID.test(support.evidenceId)
    && typeof support.assetId === 'string' && UUID.test(support.assetId)
    && Number.isSafeInteger(support.evidenceRevision) && (support.evidenceRevision as number) >= 1
    && typeof support.originalSha256 === 'string' && SHA.test(support.originalSha256)
    && typeof support.reviewMarker === 'string' && support.reviewMarker.length <= 512);
  need(value.acceptedRoomReceiptId === null || typeof value.acceptedRoomReceiptId === 'string' && value.acceptedRoomReceiptId.length <= 256);
  need(value.acceptedRoomReceiptSha256 === null || typeof value.acceptedRoomReceiptSha256 === 'string' && SHA.test(value.acceptedRoomReceiptSha256));
  need(Array.isArray(value.acceptedRoomAnchors) && value.acceptedRoomAnchors.length <= 128);
  const anchorIds = new Set<string>();
  const anchors = value.acceptedRoomAnchors.map(item => {
    const a = object(item, ['id', 'sourceFloorKey', 'sourceOriginalSha256', 'targets', 'unresolvedLabels']);
    const id = string(a.id); need(!anchorIds.has(id)); anchorIds.add(id);
    need(typeof a.sourceOriginalSha256 === 'string' && SHA.test(a.sourceOriginalSha256));
    need(Array.isArray(a.targets) && a.targets.length <= 16);
    const targets = a.targets.map(item => {
      const target = object(item, ['packagePlaceKey', 'packagePlaceUuid']);
      need(typeof target.packagePlaceUuid === 'string' && UUID.test(target.packagePlaceUuid));
      return { packagePlaceKey: string(target.packagePlaceKey), packagePlaceUuid: target.packagePlaceUuid };
    });
    need(new Set(targets.map(target => `${target.packagePlaceKey}\0${target.packagePlaceUuid}`)).size === targets.length);
    return { id, sourceFloorKey: string(a.sourceFloorKey), sourceOriginalSha256: a.sourceOriginalSha256,
      targets, unresolvedLabels: strings(a.unresolvedLabels, 32) };
  });
  need(value.acceptedRoomMappings === undefined || Array.isArray(value.acceptedRoomMappings) && value.acceptedRoomMappings.length <= 256);
  const mappingIds = new Set<string>();
  const mappings = (value.acceptedRoomMappings as unknown[] | undefined)?.map(item => {
    const m = object(item, ['sourceRoomId', 'sourceFloorKey', 'sourceOriginalSha256', 'sourceAnchorIds', 'targets', 'unresolvedLabels', 'evidenceIds']);
    const sourceRoomId = string(m.sourceRoomId); need(!mappingIds.has(sourceRoomId)); mappingIds.add(sourceRoomId);
    const sourceFloorKey = string(m.sourceFloorKey), sourceOriginalSha256 = string(m.sourceOriginalSha256, 64);
    need(SHA.test(sourceOriginalSha256));
    const sourceAnchorIds = strings(m.sourceAnchorIds, 128); need(sourceAnchorIds.length > 0);
    const members = sourceAnchorIds.map(id => anchors.find(anchor => anchor.id === id));
    need(members.every(anchor => anchor && anchor.sourceFloorKey === sourceFloorKey && anchor.sourceOriginalSha256 === sourceOriginalSha256));
    need(Array.isArray(m.targets) && m.targets.length <= 16);
    const targets = m.targets.map(item => {
      const target = object(item, ['packagePlaceKey', 'packagePlaceUuid', 'atlasPlaceId']);
      const packagePlaceKey = string(target.packagePlaceKey), packagePlaceUuid = string(target.packagePlaceUuid, 36);
      need(UUID.test(packagePlaceUuid) && (target.atlasPlaceId === null || typeof target.atlasPlaceId === 'string' && UUID.test(target.atlasPlaceId))
        && members.some(anchor => anchor!.targets.some(pair => pair.packagePlaceKey === packagePlaceKey && pair.packagePlaceUuid === packagePlaceUuid)));
      return { packagePlaceKey, packagePlaceUuid, atlasPlaceId: target.atlasPlaceId };
    });
    need(new Set(targets.map(target => `${target.packagePlaceKey}\0${target.packagePlaceUuid}`)).size === targets.length);
    const evidenceIds = strings(m.evidenceIds, 32);
    need(evidenceIds.length === 2 && evidenceIds.every(id => UUID.test(id)) && evidenceIds.includes(value.sceneEvidenceId as string));
    return { sourceRoomId, sourceFloorKey, sourceOriginalSha256, sourceAnchorIds, targets,
      unresolvedLabels: strings(m.unresolvedLabels, 32), evidenceIds };
  });
  return { workspaceId: value.workspaceId as string, homeId: value.homeId as string, buildingId: value.buildingId as string,
    viewKey: value.viewKey, sceneEvidenceId: value.sceneEvidenceId as string, sceneAssetId: value.sceneAssetId as string,
    sceneOriginalSha256: value.sceneOriginalSha256, sceneEvidenceRevision: value.sceneEvidenceRevision as number,
    sceneAssetRevision: ExactDecimal.parse(value.sceneAssetRevision), sourceFloorBindings: bindings,
    acceptedRoomReceiptId: value.acceptedRoomReceiptId, acceptedRoomReceiptSha256: value.acceptedRoomReceiptSha256,
    acceptedRoomAnchors: anchors,
    ...(mappings === undefined ? {} : { acceptedRoomMappings: mappings }),
    ...(support ? { drawingSupport: { evidenceId: support.evidenceId as string, evidenceRevision: support.evidenceRevision as number,
      assetId: support.assetId as string, assetRevision: ExactDecimal.parse(support.assetRevision as string),
      originalSha256: support.originalSha256 as string, reviewMarker: support.reviewMarker as string } } : {}) };
}

function capturedBindings(scene: AtlasScene, pins: DocumentaryOverlayReadPins, map: UnifiedAtlasOverlayReviewedRoomLinks): DocumentaryFacts['roomBindings'] {
  need(map.profile === 'houseatlas.unified-atlas-room-links.v1' && map.workspaceId === scene.scope.workspaceId
    && map.homeId === scene.scope.homeId && map.publicationId === scene.publication.publicationId
    && map.semanticsSha256 === scene.publication.semanticsSha256 && Array.isArray(map.links) && map.links.length <= 2048);
  const seen = new Set<string>();
  return map.links.flatMap(link => {
    need(typeof link.roomId === 'string' && !seen.has(link.roomId) && UUID.test(link.nativePlaceId)
      && typeof link.packagePlaceKey === 'string' && UUID.test(link.packagePlaceUuid)); seen.add(link.roomId);
    const room = scene.rooms.find(room => room.roomId === link.roomId);
    need(room && room.nativePlaceId === link.nativePlaceId);
    const matching = (pins.acceptedRoomMappings ?? []).filter(mapping => mapping.targets.some(target =>
      target.atlasPlaceId === link.nativePlaceId && target.packagePlaceKey === link.packagePlaceKey && target.packagePlaceUuid === link.packagePlaceUuid));
    if (!matching.length) return [];
    const anchors = [...new Set(matching.flatMap(mapping => mapping.sourceAnchorIds).filter(id => pins.acceptedRoomAnchors.some(anchor =>
      anchor.id === id && anchor.targets.some(target => target.packagePlaceKey === link.packagePlaceKey && target.packagePlaceUuid === link.packagePlaceUuid))))];
    if (!anchors.length) return [];
    return [{ roomId: room.roomId, nativePlaceId: link.nativePlaceId, spaceOccurrenceId: null,
      sourceRoomIds: [...new Set(matching.map(mapping => mapping.sourceRoomId))],
      targets: [{ packagePlaceKey: link.packagePlaceKey, packagePlaceUuid: link.packagePlaceUuid, sourceAnchorIds: anchors }],
      qualification: 'captured-room-identity-join' as const, anchor: { kind: 'room-summary' as const } }];
  });
}

export interface SavedDocumentaryPreview {
  readonly observedAt: string;
  readonly entryBuildingId: string | null;
  records(scene: AtlasScene, selectable: ReadonlySet<string>): PropertyRecords;
}

/** Reads only manifest-declared same-origin bytes through the fixture's bounded
 * reader. Hashes identify captured facts, not present native authorization. */
export async function readSavedDocumentaryPreview(manifestBytes: Uint8Array,
  read: (path: string, maximum: number) => Promise<Uint8Array>, guard: () => void): Promise<SavedDocumentaryPreview> {
  guard(); need(manifestBytes.byteLength <= 1024 * 1024);
  const manifest = JSON.parse(text(manifestBytes)) as SavedManifest;
  need(manifest.profile === 'houseatlas.saved-documentary-preview.v1' && typeof manifest.observedAt === 'string'
    && Number.isFinite(Date.parse(manifest.observedAt)) && UUID.test(manifest.publicationId)
    && SHA.test(manifest.semanticsSha256) && SHA.test(manifest.modelSha256)
    && (manifest.entryBuildingId === null || typeof manifest.entryBuildingId === 'string'));
  const load = async (pin: FilePin, maximum: number) => {
    need(pin && Number.isSafeInteger(pin.bytes) && pin.bytes > 0 && pin.bytes <= maximum && SHA.test(pin.sha256));
    const bytes = await read(savedDocumentaryInputPath(pin.path), maximum); guard();
    need(bytes.byteLength === pin.bytes && await digest(bytes) === pin.sha256); guard(); return bytes;
  };
  const [primary, supportBytes, mapBytes] = await Promise.all([
    load(manifest.primary, 8 * 1024 * 1024), load(manifest.support, 8 * 1024 * 1024), load(manifest.roomLinks, 1024 * 1024)]);
  let pins = factualPins(manifest.pins);
  need(pins.sceneOriginalSha256 === manifest.primary.sha256);
  bindCapturedReceipt(primary, pins);
  const support = await readDocumentarySupport(supportBytes, guard); guard();
  if (pins.drawingSupport) {
    need(support && pins.drawingSupport.originalSha256 === manifest.support.sha256);
    pins = { ...pins, drawingReferences: documentaryReferences(support, pins) };
  }
  const details = await readSavedDocumentaryDetails(pins, primary, supportBytes, guard); guard();
  const map = JSON.parse(text(mapBytes)) as UnifiedAtlasOverlayReviewedRoomLinks;
  return { observedAt: manifest.observedAt, entryBuildingId: manifest.entryBuildingId,
    records(scene, selectable) {
      need(scene.scope.workspaceId === pins.workspaceId && scene.scope.homeId === pins.homeId
        && scene.publication.publicationId === manifest.publicationId && scene.publication.semanticsSha256 === manifest.semanticsSha256
        && scene.model.sha256 === manifest.modelSha256);
      const joins = capturedBindings(scene, pins, map);
      const projected = projectDocumentaryFacts(scene, { mode: 'saved-documentary-snapshot', pins, roomBindings: joins,
        network: details.network, electricity: details.electricity, electricalFixtures: details.electricalFixtures,
        drawingProvenance: details.capturedDrawingProvenance,
        observationFacts: [{ label: 'Presentation', value: 'Saved documentary snapshot; no current native authorization' },
          { label: 'Persisted source observed at', value: manifest.observedAt },
          { label: 'Captured room map SHA256', value: manifest.roomLinks.sha256 },
          { label: 'Captured publication', value: manifest.publicationId }] }, selectable);
      return { ...projected, buildings: scene.buildings.filter(building => building.levelIds.length > 0).map(building => ({
        buildingId: building.buildingId, label: building.label, network: projected.network, electrical: projected.electrical,
        reason: joins.some(join => scene.rooms.find(room => room.roomId === join.roomId)?.buildingId === building.buildingId)
          ? 'saved room identity links; no metric positions' : 'no captured room identity links' })) };
    } };
}
