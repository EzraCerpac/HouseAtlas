import type { NativeSceneSourceFrame, NativeSceneSourceSelection } from '../scans/native-scene-source-types';
import type { ElectricalLibraryDocument, ElectricalLibraryPage, ElectricalLibraryRoom, ElectricalLibrarySheet } from './types';

type Details = Pick<NativeSceneSourceFrame, 'electricity' | 'electricalFixtures' | 'drawingReferences'>;
function need(value: unknown): asserts value { if (!value) throw new Error('Electrical drawing references are unavailable'); }
const pair = (key: string, uuid: string) => JSON.stringify([key, uuid]);

/** Pure display projection of already qualified source data. It issues no
 * native identity or access and never joins a document by title or hash. */
export function projectElectricalLibrary(selection: NativeSceneSourceSelection, details: Details): {
  readonly documents: readonly ElectricalLibraryDocument[];
  readonly unlinkedSheets: readonly ElectricalLibrarySheet[];
} {
  const fixtures = details.electricalFixtures.status === 'available' ? details.electricalFixtures.data : null;
  const index = details.electricity.status === 'available' ? details.electricity.data : null;
  const targets = new Map<string, Set<string>>();
  for (const mapping of selection.acceptedRoomMappings ?? []) for (const target of mapping.targets) {
    if (target.atlasPlaceId === null) continue;
    const key = pair(target.packagePlaceKey, target.packagePlaceUuid);
    const ids = targets.get(key) ?? new Set<string>(); ids.add(target.atlasPlaceId); targets.set(key, ids);
  }
  const sheets = fixtures?.sheets ?? [];
  need(new Set(sheets.map(sheet => sheet.id)).size === sheets.length);
  const references = details.drawingReferences ?? [];
  need(new Set(references.map(reference => reference.sheetId)).size === references.length);
  const bySheet = new Map(references.map(reference => [reference.sheetId, reference]));
  const groups = new Map<string, ElectricalLibraryDocument & { pages: ElectricalLibraryPage[] }>();
  const unlinkedSheets: ElectricalLibrarySheet[] = [];
  for (const sheet of sheets) {
    const matches = index?.sheets.filter(item => item.id === sheet.id) ?? [];
    need(matches.length <= 1);
    const documentary = matches[0] ?? null;
    if (documentary) need(documentary.source.pdfPage === sheet.pdfPage && documentary.source.sha256 === sheet.originalPhotoSha256);
    const ledgerPlaces = fixtures?.regions.filter(region => region.sheetId === sheet.id).flatMap(region => region.places) ?? [];
    // The reviewed fixture ledger owns these sheet/region references. Retain
    // the separate earlier interpretation and its confidence verbatim below.
    const places = ledgerPlaces.length > 0 ? ledgerPlaces : documentary?.roomAssociations.map(room => ({
      packagePlaceKey: room.packagePlaceKey, packagePlaceUuid: room.packagePlaceUuid, label: room.label, basis: room.status })) ?? [];
    const rooms = new Map<string, ElectricalLibraryRoom>();
    for (const place of places) {
      const key = pair(place.packagePlaceKey, place.packagePlaceUuid), native = targets.get(key);
      // A documentary association remains visible if its native target is
      // unresolved or ambiguous. A label never repairs that join.
      rooms.set(JSON.stringify([key, place.label, place.basis]), Object.freeze({ ...place,
        nativePlaceId: native?.size === 1 ? [...native][0]! : null }));
    }
    const entry: ElectricalLibrarySheet = Object.freeze({ sheet, documentary, rooms: Object.freeze([...rooms.values()]) });
    const reference = bySheet.get(sheet.id);
    if (!reference) { unlinkedSheets.push(entry); continue; }
    need(reference.workspaceId === selection.workspaceId && reference.homeId === selection.homeId
      && reference.buildingId === selection.buildingId && reference.viewKey === selection.viewKey
      && reference.sheetId === sheet.id && reference.pdfPage === sheet.pdfPage
      && reference.originalPhotoSha256 === sheet.originalPhotoSha256 && reference.renderedPhotoSha256 === sheet.renderedPhotoSha256);
    const key = JSON.stringify([reference.workspaceId, reference.homeId, reference.evidenceId, reference.assetId]);
    let document = groups.get(key);
    if (!document) {
      document = { key, evidenceId: reference.evidenceId, evidenceRevision: reference.evidenceRevision,
        assetId: reference.assetId, assetRevision: reference.assetRevision, sha256: reference.assetSha256,
        byteSize: reference.byteSize, pages: [] };
      groups.set(key, document);
    }
    need(document.evidenceRevision === reference.evidenceRevision && document.assetRevision.compare(reference.assetRevision) === 0
      && document.sha256 === reference.assetSha256 && document.byteSize.compare(reference.byteSize) === 0);
    document.pages.push(Object.freeze({ ...entry, reference }));
  }
  need(references.every(reference => sheets.some(sheet => sheet.id === reference.sheetId)));
  return Object.freeze({ documents: Object.freeze([...groups.values()].map(document => Object.freeze({ ...document,
    pages: Object.freeze(document.pages.sort((a, b) => a.reference.pdfPage - b.reference.pdfPage || a.sheet.id.localeCompare(b.sheet.id))) }))),
    unlinkedSheets: Object.freeze(unlinkedSheets) });
}

/** Search only already-authorized display facts; retain every original object. */
export function filterElectricalLibrary(documents: readonly ElectricalLibraryDocument[],
  unlinkedSheets: readonly ElectricalLibrarySheet[], query: string) {
  const needle = query.trim().toLowerCase();
  const matches = (entry: ElectricalLibrarySheet) => {
    const source = entry.documentary;
    const facts = [entry.sheet.title, String(entry.sheet.pdfPage), entry.sheet.sourceDate ?? 'Not recorded',
      ...entry.rooms.flatMap(room => [room.label, room.basis === 'owner-reported' ? 'Owner reported' : 'Inferred',
        room.nativePlaceId === null ? 'Native room unresolved' : '']),
      ...(entry.rooms.length === 0 ? ['No room association recorded'] : []),
      ...(source ? [source.directReading.text, source.directReading.uncertainty.explanation,
        source.drawingAssociation.text, source.drawingAssociation.uncertainty.explanation, source.openUncertainty,
        source.source.factAt ?? 'Not recorded', source.source.retrievedAt ?? 'Not recorded', source.source.interpretationDate,
        ...source.roomAssociations.flatMap(room => [room.label, room.relationship, room.historicalLabel, room.statement])] : [])];
    return needle === '' || facts.filter(value => typeof value === 'string').join(' ').toLowerCase().includes(needle);
  };
  const visibleDocuments = documents.map(document => ({ document, pages: document.pages.filter(matches) }))
    .filter(entry => entry.pages.length > 0);
  const visibleUnlinked = unlinkedSheets.filter(matches);
  return { documents: visibleDocuments, unlinkedSheets: visibleUnlinked,
    totalSheets: documents.reduce((count, document) => count + document.pages.length, 0) + unlinkedSheets.length,
    matchedSheets: visibleDocuments.reduce((count, entry) => count + entry.pages.length, 0) + visibleUnlinked.length };
}
