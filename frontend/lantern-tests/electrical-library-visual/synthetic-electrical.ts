/** Fictional inputs only. Real source parsers run against generated native-shaped
 * GET responses and dedicated fake original-document owners; nothing is uploaded. */
import { ExactDecimal } from '../../src/numeric/decimal';
import type { ReadyView } from '../../src/app/types';
import type { TopologyClient, TopologyKind, TopologyRecord } from '../../src/api/topology-client';
import type { NativeEvidenceDocumentClient, NativeEvidenceDocumentFrame } from '../../src/lantern/scans/native-evidence-document-types';
import type { NativeElectricalLibraryOptions } from '../../integration/native-electrical-library-reader';
import { createNativeElectricalLibraryReader } from '../../integration/native-electrical-library-reader';
import type { ElectricalLibraryPort } from '../../src/lantern/electrical-library/types';
import type { SceneAssociationContext } from '../../integration/native-scene-association-client';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const encode = (text: string) => new TextEncoder().encode(text);
const hash = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))].map(n => n.toString(16).padStart(2, '0')).join('');
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
}
function need(value: unknown): asserts value { if (!value) throw new Error('Unexpected fictional evidence request'); }
/** Eighteen visibly distinct generated vector pages; no external font or image. */
export function syntheticElectricalPdf(): Uint8Array<ArrayBuffer> {
  const objects: string[] = ['<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: 18 }, (_, i) => `${3 + i * 2} 0 R`).join(' ')}] /Count 18 >>`];
  for (let i = 0; i < 18; i++) {
    const content = `${(0.4 + i / 40).toFixed(2)} 0.65 0.8 rg 20 20 555 380 re f\nBT /F1 22 Tf 0 0 0 rg 35 350 Td (SYNTHETIC ELECTRICAL PAGE ${i + 1}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 420] /Resources << /Font << /F1 39 0 R >> >> /Contents ${4 + i * 2} 0 R >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let document = '%PDF-1.4\n'; const offsets: number[] = [];
  objects.forEach((object, i) => { offsets.push(document.length); document += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = document.length;
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return encode(document);
}

export async function createSyntheticElectricalLibrary(mode: 'pdf' | 'legacy' = 'pdf') {
  const scope = Object.freeze({ workspaceId: U(1), homeId: U(2) }), buildingId = U(3), pdfEvidenceId = U(7), pdfAssetId = U(8);
  const session = Object.freeze({ schemaVersion: 1 as const, actorId: U(90), csrfToken: 'fictional-unused', expiresAt: '2099-01-01T00:00:00Z' });
  const view: ReadyView = { status: 'ready', scope, homeLabel: 'Fictional electrical home', now: '2026-01-02T12:00:00Z',
    canEdit: false, homes: [{ ...scope, label: 'Fictional electrical home' }], entries: [] } as ReadyView;
  const context: SceneAssociationContext = { sessionIdentity: session, session, view, admission: null };
  const pdf = syntheticElectricalPdf(), pdfSha = await hash(pdf);
  const sheets = [2, 9, 18].map((page, i) => ({ id: `fictional-sheet-${i + 1}`, title: ['Fictional kitchen', 'Fictional study', 'Fictional unassigned sheet'][i]!,
    pdfPage: page, originalPhoto: `originals/fictional-${i + 1}.jpg`, originalPhotoSha256: String(i + 1).repeat(64),
    renderedPhotoSha256: String(i + 4).repeat(64), sourceDate: null, regionIds: i < 2 ? [`region-${i + 1}`] : [] }));
  const targets = [1, 2].map(i => ({ packagePlaceKey: `fictional-room-${i}`, packagePlaceUuid: U(20 + i), atlasPlaceId: U(40 + i) }));
  const floor = 'fictional-floor', floorHash = 'a'.repeat(64);
  const anchors = targets.map((target, i) => ({ id: `fictional-anchor-${i + 1}`, sourceFloorKey: floor, sourceOriginalSha256: floorHash,
    targets: [{ packagePlaceKey: target.packagePlaceKey, packagePlaceUuid: target.packagePlaceUuid }], unresolvedLabels: [] }));
  const mappingJson = '{"receiptId":"fictional-historical-room-map"}', mappingSha = await hash(encode(mappingJson));
  const ledger = { schema: 'houseatlas.documentary-electrical-fixtures.v1', viewKey: 'fictional-source', interpretationDate: '2026-01-02',
    symbolLegend: { xMeansSocket: null, socketsPerX: null, receiptId: null }, roomMappingReceipt: { id: 'fictional-historical-room-map', sha256: mappingSha },
    registrationReceipts: [], sheets, groups: [], fixtures: [], regions: targets.map((target, i) => ({ id: `region-${i + 1}`, sheetId: sheets[i]!.id,
      label: sheets[i]!.title, sourceOutline: [], outlineClosed: false, sourceBounds: [.1, .1, .9, .9], outlineBasis: 'untraced',
      places: [{ packagePlaceKey: target.packagePlaceKey, packagePlaceUuid: target.packagePlaceUuid, label: sheets[i]!.title, basis: i === 0 ? 'owner-reported' : 'inferred' }],
      orientation: 'unregistered', physicalTransform: null })) };
  const ledgerJson = JSON.stringify(ledger), ledgerSha = await hash(encode(ledgerJson));
  const crosswalkJson = canonical({ profile: 'houseatlas.documentary-sheet-pdf-correlation.v1', correlationId: 'fictional-correlation', fixtureLedgerSha256: ledgerSha,
    pdf: { ...scope, buildingId, evidenceId: pdfEvidenceId, evidenceRevision: 4, assetId: pdfAssetId, assetRevision: 7, sha256: pdfSha, byteSize: pdf.length },
    references: sheets.map(sheet => ({ sheetId: sheet.id, pdfPage: sheet.pdfPage, originalPhotoSha256: sheet.originalPhotoSha256,
      renderedPhotoSha256: sheet.renderedPhotoSha256, pdfEmbeddedImageSha256: 'b'.repeat(64) })) });
  const crosswalkSha = await hash(encode(crosswalkJson)), sourceReviewJson = '{"observation":"fictional vector pages only"}';
  const reviewJson = canonical({ profile: 'houseatlas.documentary-sheet-pdf-review.v1', reviewId: 'fictional-independent-review',
    crosswalkSha256: crosswalkSha, roomMappingSha256: mappingSha, sourceReviewJson, sourceReviewSha256: await hash(encode(sourceReviewJson)) });
  const reviewSha = await hash(encode(reviewJson));
  const historical = encode(mode === 'legacy' ? mappingJson : JSON.stringify({ schema: 'houseatlas.documentary-scene-support.v1',
    roomMapping: { json: mappingJson, sha256: mappingSha }, fixtureLedger: { json: ledgerJson, sha256: ledgerSha },
    crosswalk: { json: crosswalkJson, sha256: crosswalkSha }, review: { json: reviewJson, sha256: reviewSha } }));
  const historicalSha = await hash(historical);
  const receiptJson = canonical({ profile: 'houseatlas.native-scene-room-review.v1', receiptId: 'fictional-current-native-review', sourceReceiptSha256: historicalSha, anchors });
  const receiptSha = await hash(encode(receiptJson));
  if (mode === 'legacy') ledger.roomMappingReceipt = { id: 'fictional-current-native-review', sha256: receiptSha };
  const statement = (basis: string) => ({ statement: 'Fictional historical reading', evidenceBasis: basis, uncertainty: { status: 'unknown', explanation: 'Current wiring is unverified' } });
  const documentary = sheets.map((sheet, i) => ({ document_id: sheet.id, bundle_id: 'fictional-bundle', title_as_read: sheet.title,
    source_photo: sheet.originalPhoto, source_sha256: sheet.originalPhotoSha256, rendered_photo: `rendered/fictional-${i + 1}.png`, pdf_page: sheet.pdfPage,
    factAt: null, interpretation_date: '2026-01-02', documentary_group_labels: [], direct_reading: statement('document'), drawing_association: statement('inference'),
    open_uncertainty: 'Fictional source; no verified wiring', native_atlas_identity_ids: [], owner_confirmed_room_mapping: null, owner_confirmed_layout_mapping: null,
    provisional_diagram: { coordinate_space: 'normalized-upright-photo', geometry_status: 'unmeasured', metric_units: null, scale: null, transform: null, region_xyxy: [.1, .1, .9, .9], source_date: null },
    package_room_associations: i < 2 ? [{ package_room_id: targets[i]!.packagePlaceKey, stable_package_uuid: targets[i]!.packagePlaceUuid,
      current_circuit_binding: null, native_atlas_identity_id: null, status: 'inferred-name-or-context-match', evidenceBasis: 'inference' }] : [] }));
  const primary = encode(JSON.stringify({ schema: 'houseatlas.native-scene-source.v2', receiptCanonicalJson: receiptJson,
    rooms: { status: 'available', reason: null, receiptId: 'fictional-current-native-review', receiptSha256: receiptSha, entries: [], regions: [] },
    network: { status: 'unavailable', reason: 'not-retained', source: null, devices: null, endpoints: null, links: null },
    electricity: { status: 'available', reason: null, documentarySource: { schema: 'private-documentary-records/v1', status: 'documentary', native_import_receipt: null, records: documentary },
      roomRegistry: { schema: 'private-houseatlas-room-registry/v1', entities: [{ id: 'fictional-building', stable_uuid: U(30), display_name: 'Fictional building', aliases: [], source_refs: ['fictional'] },
        ...targets.map((target, i) => ({ id: target.packagePlaceKey, stable_uuid: target.packagePlaceUuid, display_name: sheets[i]!.title, aliases: [], source_refs: ['fictional'] }))] }, buildingPackageKey: 'fictional-building', retrievedAt: null },
    electricalFixtures: { status: 'available', reason: null, documentaryFixtures: ledger } }));
  const primarySha = await hash(primary);
  const documents = [{ role: 'primary-scene', evidenceId: U(4), evidenceRevision: 1, originalAssetId: U(5), originalAssetRevision: 1, originalSha256: primarySha, contentType: 'text/plain' },
    { role: 'documentary-sheet', evidenceId: U(9), evidenceRevision: 1, originalAssetId: U(10), originalAssetRevision: 1, originalSha256: historicalSha, contentType: 'text/plain' }];
  const marker = `\n[HouseAtlas drawing review v1 support:${historicalSha} crosswalk:${crosswalkSha} review:${reviewSha}]`;
  const payload = { profile: 'houseatlas.native-scene-association.v1', buildingId, associationVersion: 1, previousAssociationId: null,
    reviewStatus: 'accepted', reviewStatement: `Fictional reviewed source${mode === 'pdf' ? marker : ''}`, sourceDocuments: documents,
    acceptedReceipt: { receiptId: 'fictional-current-native-review', canonicalJson: receiptJson, canonicalSha256: receiptSha, anchors },
    sourceFloors: [{ sourceFloorKey: floor, sourceOriginalSha256: floorHash, nativeFloorKey: 'fictional-native-floor', nativeGeometryId: U(50), nativeGeometryRevision: 1, nativeOriginalAssetId: U(51), nativeOriginalSha256: floorHash }],
    roomMappings: targets.map((target, i) => ({ sourceRoomId: `fictional-source-room-${i + 1}`, sourceFloorKey: floor, sourceOriginalSha256: floorHash,
      sourceAnchorIds: [anchors[i]!.id], targets: [target], unresolvedLabels: [], evidenceIds: [U(4), U(9)] })) };
  const record = { schemaVersion: 1, recordType: 'scene-association', recordId: U(11), ...scope, revision: 1, lifecycle: 'active',
    createdAt: '2026-01-02T12:00:00Z', updatedAt: '2026-01-02T12:00:00Z', lastAuditId: U(12), payload };
  const head = { schema: 'houseatlas.native-scene-head.v1', scope, buildingId, status: 'available', reason: null,
    head: { recordId: U(11), revision: 1, payloadSha256: await hash(encode(canonical(payload))) } };
  const counts = { gets: 0, heads: 0, owners: 0, releases: 0, disposes: 0, opens: [] as string[] };
  const bytes = new Map([[U(4), primary], [U(9), historical], [pdfEvidenceId, pdf]]);
  const pins = new Map([[U(4), { assetId: U(5), sha256: primarySha, revision: 1, evidenceRevision: 1 }],
    [U(9), { assetId: U(10), sha256: historicalSha, revision: 1, evidenceRevision: 1 }],
    [pdfEvidenceId, { assetId: pdfAssetId, sha256: pdfSha, revision: 7, evidenceRevision: 4 }]]);
  const createDocuments = (): NativeEvidenceDocumentClient => {
    counts.owners++; let held: NativeEvidenceDocumentFrame | null = null, disposed = false;
    return {
      async open(evidenceId, signal) {
        signal.throwIfAborted(); need(!disposed && pins.has(evidenceId) && held === null);
        const pin = pins.get(evidenceId)!, original = bytes.get(evidenceId)!; counts.opens.push(evidenceId);
        held = Object.freeze({ lease: {}, evidenceId, evidenceRevision: pin.evidenceRevision, mode: 'original-download', asset: {
          assetId: pin.assetId, revision: ExactDecimal.parse(String(pin.revision)), sha256: pin.sha256, byteSize: ExactDecimal.parse(String(original.length)),
          contentType: evidenceId === pdfEvidenceId ? 'application/pdf' : 'text/plain', purpose: 'evidence-original', previewPolicy: 'download-only',
          sourceLicense: { status: 'unknown', reference: null }, evidenceIds: [] } }); return held;
      },
      isCurrent: frame => !disposed && held === frame,
      getBlob(frame) { return !disposed && held === frame ? new Blob([bytes.get(frame.evidenceId)!], { type: frame.asset.contentType }) : null; },
      subscribeInvalidation(frame) { need(held === frame); return () => {}; },
      release(frame) { if (held === frame) { held = null; counts.releases++; } },
      dispose() { if (disposed) return; disposed = true; held = null; counts.disposes++; },
    };
  };
  const transport: typeof fetch = async (input, init) => {
    need(init?.method === 'GET' && init.credentials === 'same-origin' && init.cache === 'no-store' && init.redirect === 'error');
    init.signal?.throwIfAborted(); counts.gets++;
    const path = String(input), prefix = `/api/atlas/scene/v1/workspaces/${scope.workspaceId}/homes/${scope.homeId}/buildings/${buildingId}`;
    let output: unknown;
    if (path === `${prefix}/current`) output = { status: 'available', association: record };
    else if (path === `${prefix}/head`) { counts.heads++; output = head; }
    else {
      need(path === `/api/atlas/stock/v3/workspaces/${scope.workspaceId}/homes/${scope.homeId}/records/identity/${buildingId}`);
      output = { schemaVersion: 3, commandId: 'atlas.identity.get', requestId: U(13), resolvedScope: scope, status: 'read', replayed: false,
        data: { sourceStatus: 'current', nextCursor: null, records: [{ target: { authority: 'atlas', recordType: 'identity', recordId: buildingId },
          revision: 1, lifecycle: 'active', payload: { kind: 'location', evidenceIds: [U(4), U(9), pdfEvidenceId] } }] } };
    }
    return new Response(JSON.stringify(output), { headers: { 'content-type': 'application/json' } });
  };
  const options: NativeElectricalLibraryOptions = { getContext: () => context, subscribeContext: () => () => {}, createDocuments, transport };
  const port: ElectricalLibraryPort = { async createReader() { return createNativeElectricalLibraryReader(options); } };
  const identity = { target: { authority: 'atlas', recordType: 'identity', recordId: buildingId }, revision: 1, lifecycle: 'active', payload: { kind: 'location', evidenceIds: [] } };
  const semantics = { target: { authority: 'atlas', recordType: 'location-semantics', recordId: U(61) }, revision: 1, lifecycle: 'active',
    payload: { atlasId: buildingId, semanticKind: 'building', label: 'Fictional building', reviewStatus: 'accepted' } };
  const topologyBinding = Object.freeze({ scope });
  const topology: TopologyClient = { getBinding: () => topologyBinding, subscribe: () => () => {},
    async listAll<K extends TopologyKind>(_binding: unknown, kind: K, signal: AbortSignal) {
      signal.throwIfAborted(); return { status: 'ready' as const, sourceStatus: 'current' as const, snapshotSha256: 'c'.repeat(64),
        records: (kind === 'identity' ? [identity] : kind === 'location-semantics' ? [semantics] : []) as unknown as readonly TopologyRecord<K>[] };
    },
    async buildingMembers(_binding, _buildingId, signal) { signal.throwIfAborted(); return { status: 'ready', sourceStatus: 'current', snapshotSha256: 'c'.repeat(64), records: [] }; },
  };
  return { scope, session, view, buildingId, pdfEvidenceId, pdfAssetId, pdf, pdfSha, sheets, options, port, topology, counts };
}
