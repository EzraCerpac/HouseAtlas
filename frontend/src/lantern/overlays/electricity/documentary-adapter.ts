import type { ElectricityOverlayData, ElectricityPackagePlaceSelection, ElectricityRoomAssociation, ElectricitySheet, ElectricityStatement } from './types';

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected documentary object');
  return value as ObjectValue;
};
const array = (value: unknown): readonly unknown[] => {
  if (!Array.isArray(value)) throw new Error('Expected documentary list');
  return value;
};
const text = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Expected nonempty documentary text');
  return value;
};
const nullableText = (value: unknown): string | null => value === null ? null : text(value);
const strings = (value: unknown): readonly string[] => array(value).map(text);
const sha = (value: unknown): string => {
  const result = text(value);
  if (!/^[a-f0-9]{64}$/.test(result)) throw new Error('Invalid documentary digest');
  return result;
};
const statement = (value: unknown, basis: 'document' | 'inference'): ElectricityStatement => {
  const source = object(value), uncertainty = object(source.uncertainty);
  if (source.evidenceBasis !== basis) throw new Error('Documentary statement basis changed');
  return { text: text(source.statement), evidenceBasis: basis,
    uncertainty: { status: text(uncertainty.status), explanation: text(uncertainty.explanation) } };
};
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

interface Room {
  readonly key: string; readonly uuid: string; readonly label: string;
  readonly aliases: ElectricityRoomAssociation['aliases']; readonly sourceRefs: readonly string[];
}
function roomsFrom(value: unknown): ReadonlyMap<string, Room> {
  const root = object(value);
  if (root.schema !== 'private-houseatlas-room-registry/v1') throw new Error('Unsupported room registry');
  const result = new Map<string, Room>(), uuids = new Set<string>();
  for (const input of array(root.entities)) {
    const row = object(input), key = text(row.id), uuid = text(row.stable_uuid);
    if (result.has(key) || uuids.has(uuid)) throw new Error('Duplicate package place identity');
    const aliases = array(row.aliases).map(object)
      .filter(alias => alias.status === 'owner_confirmed_same_identity')
      .map(alias => ({ label: text(alias.label), sourceRefs: strings(alias.source_refs) }));
    result.set(key, { key, uuid, label: text(row.display_name), aliases, sourceRefs: strings(row.source_refs) });
    uuids.add(uuid);
  }
  return result;
}

/** Only an owner-reconciled genuine native receipt map may supply native IDs.
 * No lookup by alias, candidate label, source object, ordinal or package UUID. */
function nativeIdsFrom(value: unknown, rooms: ReadonlyMap<string, Room>): ReadonlyMap<string, string> {
  const root = object(value);
  if (root.schema !== 'private-native-identity-map/v1') throw new Error('Unsupported native identity map');
  const result = new Map<string, string>(), used = new Set<string>();
  for (const input of array(root.mapping)) {
    const row = object(input), key = text(row.package_id), id = text(row.native_identity_id);
    const room = rooms.get(key);
    if (!room || text(row.stable_package_uuid) !== room.uuid || result.has(key) || used.has(id))
      throw new Error('Unreconciled or duplicate native identity');
    text(row.receipt);
    text(row.native_request_id);
    text(row.native_operation_id);
    if (id === room.uuid) throw new Error('Package UUID cannot establish native identity');
    result.set(key, id); used.add(id);
  }
  return result;
}

function association(input: unknown, record: ObjectValue, rooms: ReadonlyMap<string, Room>, native: ReadonlyMap<string, string>): ElectricityRoomAssociation {
  const row = object(input), key = text(row.package_room_id), room = rooms.get(key);
  if (!room || text(row.stable_package_uuid) !== room.uuid || row.current_circuit_binding !== null)
    throw new Error('Unreconciled room or unsupported current circuit assertion');
  const nativeId = native.get(key) ?? null;
  if (row.native_atlas_identity_id !== null && row.native_atlas_identity_id !== nativeId)
    throw new Error('Unreconciled native room assertion');
  let status: ElectricityRoomAssociation['status'] = 'inferred';
  let historicalLabel: string | null = null, relationship = 'name-or-context-candidate';
  let ownerStatementId: string | null = null, ownerStatement: string | null = null, receivedViaThreadId: string | null = null;
  if (row.status === 'inferred-name-or-context-match' && row.evidenceBasis === 'inference') {
    // Preserve the proposal; title/candidate keys never resolve its target.
  } else if (row.evidenceBasis === 'owner-report') {
    const naming = record.owner_confirmed_room_mapping === null ? null : object(record.owner_confirmed_room_mapping);
    const layout = record.owner_confirmed_layout_mapping === null ? null : object(record.owner_confirmed_layout_mapping);
    if (naming?.package_room_id === key && naming.evidenceBasis === 'owner-report') {
      if (row.status !== 'owner-confirmed') throw new Error('Unsupported owner naming relationship');
      status = 'owner-reported'; relationship = 'same-identity-name';
      ownerStatement = text(naming.statement); ownerStatementId = text(naming.source_message_id);
      receivedViaThreadId = text(naming.received_via_thread);
    } else if (layout?.evidenceBasis === 'owner-report') {
      if (row.status !== 'owner-confirmed-historical-to-current-space-mapping') throw new Error('Unsupported owner layout relationship');
      const matches = array(layout.mappings).map(object)
        .filter(mapping => strings(mapping.current_package_room_ids).includes(key));
      if (matches.length !== 1) throw new Error('Missing or ambiguous owner layout relationship');
      const mapping = matches[0]!;
      status = 'owner-reported'; historicalLabel = text(mapping.historical_label);
      relationship = text(mapping.relationship); ownerStatement = text(mapping.statement);
      ownerStatementId = text(layout.source_message_id);
      receivedViaThreadId = text(layout.received_via_thread);
    } else throw new Error('Owner room association requires its original statement');
  } else throw new Error('Unsupported room association status');
  return { packagePlaceKey: key, packagePlaceUuid: room.uuid, nativePlaceId: nativeId,
    label: room.label, aliases: room.aliases, status, historicalLabel, relationship,
    statement: ownerStatement, roomSourceRefs: room.sourceRefs, associationSource: {
      evidenceBasis: status === 'owner-reported' ? 'owner-report' : 'inference', documentId: text(record.document_id),
      ownerStatementId, receivedViaThreadId } };
}

export interface DocumentaryElectricityContext {
  readonly viewKey: string;
  readonly buildingPackageKey: string;
  /** Actual source retrieval instant if supplied by its owner, otherwise null. */
  readonly retrievedAt: string | null;
}

/** Pure, immutable documentary projection. Does no I/O or admission/import.
 * Crop coordinates and historical F labels are never physical or circuit data. */
export function adaptDocumentaryElectricity(input: unknown, registry: unknown, nativeIdentityMap: unknown, context: DocumentaryElectricityContext): ElectricityOverlayData {
  const root = object(input);
  if (root.schema !== 'private-documentary-records/v1') throw new Error('Unsupported electricity interpretation');
  if (root.native_import_receipt !== null) throw new Error('Native import status requires a qualified native owner');
  const rooms = roomsFrom(registry), native = nativeIdsFrom(nativeIdentityMap, rooms), ids = new Set<string>();
  if (!rooms.has(context.buildingPackageKey)) throw new Error('Unknown package building');
  const sheets = array(root.records).map(inputRecord => {
    const record = object(inputRecord), id = text(record.document_id), diagram = object(record.provisional_diagram);
    if (ids.has(id)) throw new Error('Duplicate documentary identity');
    ids.add(id);
    if (diagram.coordinate_space !== 'normalized-upright-photo' || diagram.geometry_status !== 'unmeasured'
      || diagram.metric_units !== null || diagram.scale !== null || diagram.transform !== null)
      throw new Error('Unsupported documentary geometry or date interpretation');
    const xyxy = array(diagram.region_xyxy);
    if (xyxy.length !== 4 || xyxy.some(n => typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1)
      || !(Number(xyxy[0]) < Number(xyxy[2]) && Number(xyxy[1]) < Number(xyxy[3])))
      throw new Error('Invalid source-image crop');
    const page = record.pdf_page;
    if (typeof page !== 'number' || !Number.isSafeInteger(page) || page < 1) throw new Error('Invalid source PDF page');
    const associations = array(record.package_room_associations).map(row => association(row, record, rooms, native));
    if (new Set(associations.map(row => row.packagePlaceKey)).size !== associations.length) throw new Error('Duplicate sheet association');
    for (const assertedId of strings(record.native_atlas_identity_ids))
      if (!associations.some(row => row.nativePlaceId === assertedId)) throw new Error('Unreconciled native sheet target');
    const result: ElectricitySheet = {
      id, bundleId: text(record.bundle_id), titleAsRead: text(record.title_as_read),
      source: { photo: text(record.source_photo), sha256: sha(record.source_sha256), renderedPhoto: text(record.rendered_photo),
        pdfPage: page, factAt: nullableText(record.factAt), sourceDate: nullableText(diagram.source_date), retrievedAt: nullableText(context.retrievedAt),
        interpretationDate: text(record.interpretation_date) },
      documentaryLabels: strings(record.documentary_group_labels), directReading: statement(record.direct_reading, 'document'),
      drawingAssociation: statement(record.drawing_association, 'inference'), openUncertainty: text(record.open_uncertainty),
      roomAssociations: associations,
      spatial: { mappingStatus: 'unmatched', coordinate: null, sourceImageRegion: {
        coordinateSpace: 'normalized-upright-photo', xyxy: [Number(xyxy[0]), Number(xyxy[1]), Number(xyxy[2]), Number(xyxy[3])] } },
    };
    return result;
  });
  return freeze({ schema: 'houseatlas.documentary-electricity.v1', viewKey: text(context.viewKey),
    buildingPlaceId: native.get(context.buildingPackageKey) ?? null,
    preparationSnapshot: { status: text(root.status), nativeImportReceipt: null }, sheets });
}

/** The geometry owner verifies the canonical receipt. These shape checks do
 * not authenticate a receipt hash or establish native identity or placement. */
export function hasAcceptedPackageSelection(data: ElectricityOverlayData, selection: ElectricityPackagePlaceSelection): boolean {
  return selection.viewKey === data.viewKey && selection.status === 'accepted'
    && typeof selection.receiptId === 'string' && Boolean(selection.receiptId.trim())
    && typeof selection.receiptSha256 === 'string' && /^[a-f0-9]{64}$/.test(selection.receiptSha256)
    && Array.isArray(selection.sourceAnchorIds) && selection.sourceAnchorIds.length > 0
    && selection.sourceAnchorIds.every(id => typeof id === 'string' && Boolean(id.trim()))
    && Array.isArray(selection.targets) && selection.targets.length > 0 && selection.targets.every(target => target
      && typeof target.packagePlaceKey === 'string' && Boolean(target.packagePlaceKey.trim())
      && typeof target.packagePlaceUuid === 'string' && Boolean(target.packagePlaceUuid.trim()))
    && Array.isArray(selection.unresolvedLabels) && selection.unresolvedLabels.every(value => typeof value === 'string' && Boolean(value.trim()));
}

/** No floor/export/name matching occurs here. Reviewed exact package key/UUID
 * pairs select source context; native selection applies without that context.
 * The host reconciles any native identity separately. A multi-place anchor is a union
 * of documentary associations, never a joined room or current circuit. */
export function electricitySheets(data: ElectricityOverlayData, selectedPlaceId: string | null, label: string | null,
  selectedPackagePlaces: ElectricityPackagePlaceSelection | null = null): readonly ElectricitySheet[] {
  if (selectedPackagePlaces && !hasAcceptedPackageSelection(data, selectedPackagePlaces)) return [];
  return data.sheets.filter(sheet => (selectedPackagePlaces
    ? sheet.roomAssociations.some(room => selectedPackagePlaces.targets.some(target =>
      room.packagePlaceKey === target.packagePlaceKey && room.packagePlaceUuid === target.packagePlaceUuid))
    : !selectedPlaceId || selectedPlaceId === data.buildingPlaceId || sheet.roomAssociations.some(room => room.nativePlaceId === selectedPlaceId))
    && (label === null || sheet.documentaryLabels.includes(label)));
}

export function electricityLabels(data: ElectricityOverlayData): readonly { readonly label: string; readonly sheetCount: number }[] {
  const labels = new Map<string, number>();
  for (const sheet of data.sheets) for (const label of new Set(sheet.documentaryLabels)) labels.set(label, (labels.get(label) ?? 0) + 1);
  return [...labels].map(([label, sheetCount]) => ({ label, sheetCount }));
}
