/** Generated only on explicit Save (or named CPU positive). No household data. */
import { buildSyntheticAtlas, composeAtlasEnvelope, SYNTHETIC_ATLAS } from '../unified-atlas/synthetic-atlas';
import { canonicalPack, PACK_LIMITS, readPackManifest, SECTION_NAMES } from '../../src/offline/manifest';
import { parseLosslessJson } from '../../src/numeric/lossless-json';
import { savedDigest, savedHouseKey, type SavedHouse } from '../../src/offline/store';
export const GENERATED_SCOPE = { workspaceId: '00000000-0000-4000-8000-000000000800', homeId: '00000000-0000-4000-8000-000000000801' };
export async function generateSavedPack(mode: 'complete' | 'partial', shellBuildId: string, historical = false, tuples = false, emptyNetwork = false) {
  const scope = GENERATED_SCOPE, generated = await buildSyntheticAtlas(scope);
  const composed = await composeAtlasEnvelope(generated.companionBytes, generated.glb, SYNTHETIC_ATLAS.revision);
  const encode = (value: unknown) => new TextEncoder().encode(canonicalPack(parseLosslessJson(JSON.stringify(value)))).buffer;
  const resources = new Map<string, ArrayBuffer>(), descriptors: { sha256: string; bytes: number; contentType: string; section: string; role: string; record: { recordType: string; recordId: string; revision: number } | null }[] = [];
  const add = async (bytes: ArrayBuffer, contentType: string, section: string, role = 'section', record: { recordType: string; recordId: string; revision: number } | null = null) => {
    const sha256 = await savedDigest(bytes);
    // Canonical first descriptor wins when sections reference identical bytes.
    if (!resources.has(sha256)) { resources.set(sha256, bytes); descriptors.push({ sha256, bytes: bytes.byteLength, contentType, section, role, record }); }
    return { resourceSha256: sha256, bytes: bytes.byteLength, contentType };
  };
  const sources = [{ ...scope, sourceInstanceId: '00000000-0000-4000-8000-000000000803', collectionId: 'generated-collection', owner: 'network', partitionMode: 'exclusive-home', allowedExternalIds: [] },
    { ...scope, sourceInstanceId: '00000000-0000-4000-8000-000000000805', collectionId: 'generated-inventory', owner: 'homebox', partitionMode: 'exclusive-home', allowedExternalIds: [] }];
  const caches = [{ schemaVersion: 1, ...scope, sourceInstanceId: '00000000-0000-4000-8000-000000000803', collectionId: 'generated-collection', generationId: '00000000-0000-4000-8000-000000000806', consistency: 'non-transactional-offset-pages', error: null, status: mode === 'complete' ? 'fresh' : 'stale', lastSuccessfulFetchAt: '2026-10-15T10:11:12Z', lastAttemptAt: '2026-10-16T10:11:12Z' }];
  const native = (recordType: string, recordId: string, payload: unknown, revision = 9007199254740991) => ({ schemaVersion: 1, ...scope, recordType, recordId,
    revision, lifecycle: 'active', createdAt: '2020-01-02T00:00:00Z', updatedAt: '2024-03-04T00:00:00Z', lastAuditId: '00000000-0000-4000-8000-000000000804', payload });
  const provenance = { source: null, sourceRevision: 'source-17', sourceConfidence: 'uncertain', evidenceBasis: 'document', factAt: '1998-04-05T00:00:00Z',
    retrievedAt: '2024-03-04T00:00:00Z', vantage: null, uncertainty: { status: 'unknown', explanation: 'Historical circuit association unverified' } };
  const home = await add(encode({ profile: 'houseatlas.home-read-pack.home.v1', scope, label: 'Generated saved property', selection: { ...scope, buildingId: null, floorId: null, roomId: null } }), 'application/json', 'home');
  const historicalSource = historical ? await generateHistoricalSource(scope, generated.companion, native) : null;
  if (historicalSource) {
    await add(historicalSource.primary.buffer.slice(0), 'text/plain', 'atlas', 'original', { recordType: 'asset', recordId: '00000000-0000-4000-8000-000000000005', revision: 9 });
    await add(historicalSource.support.buffer.slice(0), 'text/plain', 'atlas', 'original', { recordType: 'asset', recordId: '00000000-0000-4000-8000-000000000007', revision: 10 });
    await add(historicalSource.primary.buffer.slice(0), 'text/plain', 'documents', 'original'); // Same SHA retains first asset descriptor.
  }
  const atlasRows = [native('circuit', '00000000-0000-4000-8000-000000000901', { label: 'Historical circuit A', panel: null, evidenceIds: ['00000000-0000-4000-8000-000000000902'] }),
    native('evidence', '00000000-0000-4000-8000-000000000902', { statement: 'Recorded circuit note', provenance, supersedesEvidenceIds: [], references: [] }),
    native('relation', '00000000-0000-4000-8000-000000000903', { kind: 'circuit-supplies', from: { kind: 'atlas-record', ref: { recordType: 'circuit', recordId: '00000000-0000-4000-8000-000000000901' } },
      to: { kind: 'unresolved', description: 'Unidentified historical outlet' }, medium: 'electricity', uncertainty: { status: 'unknown', explanation: 'No wiring survey' }, evidenceIds: ['00000000-0000-4000-8000-000000000904'] }),
    native('evidence', '00000000-0000-4000-8000-000000000904', { statement: 'Relation-only electrical evidence', provenance, supersedesEvidenceIds: [], references: [] }), ...(historicalSource?.records ?? [])];
  const atlas = await add(encode({ contractVersion: '1.0.0', synthetic: true, records: atlasRows, revisions: atlasRows.map(row => ({ recordType: row.recordType, recordId: row.recordId, revision: row.revision, lastAuditId: row.lastAuditId })), nativeGeometry: [], sources, caches }), 'application/json', 'atlas');
  const inventory = await add(encode({ entities: [{ schemaVersion: 1, ...scope,
    source: { sourceInstanceId: '00000000-0000-4000-8000-000000000805', collectionId: 'generated-inventory', sourceKind: 'homebox-entity', externalId: '00000000-0000-4000-8000-000000000905' },
    sourceUpdatedAt: '2011-02-03T00:00:00Z', retrievedAt: '2024-03-04T00:00:00Z', entity: {
      id: '00000000-0000-4000-8000-000000000905', name: 'Unclassified archived cabinet', description: 'Original inventory description', archived: true,
      entityType: null, parent: null, quantity: null, manufacturer: null, modelNumber: null, serialNumber: null, notes: null },
    attachments: [], maintenance: [], nativeLinks: [] }], sources, caches }), 'application/json', 'inventory');
  const relation = { schemaVersion: 1, ...scope, sourceInstanceId: '00000000-0000-4000-8000-000000000803', collectionId: 'generated-collection', externalId: 'generated-link',
    kind: 'network-connection', from: { kind: 'interface', id: 'generated-port', description: 'Recorded port' }, to: { kind: 'unresolved', id: null, description: 'Unknown remote end' },
    medium: 'ethernet', sourceRevision: mode === 'complete' ? 9007199254740991 : null, sourceSnapshotAt: '2024-01-02T00:00:00Z', retrievedAt: '2024-03-04T00:00:00Z', vantage: null,
    sourceConfidence: 'tentative', evidenceBasis: 'source-report', temporalStatus: 'historical', factAt: '2020-01-02T00:00:00Z', notes: 'Logical connection only' };
  const relations = tuples ? [{ ...relation, collectionId: 'a/b', externalId: 'c', from: { ...relation.from, id: 'd' } },
    { ...relation, collectionId: 'a', externalId: 'b/c', from: { ...relation.from, id: 'b/d' } }] : [relation];
  const network = await add(encode({ relations: emptyNetwork ? [] : relations, sources, caches }), 'application/json', 'network');
  const documentId = '00000000-0000-4000-8000-000000000906', documentAssetId = '00000000-0000-4000-8000-000000000907';
  const documentOriginal = await add(encode({ generatedDocument: 'Original documentary metadata' }), 'application/json', 'documents', 'original', { recordType: 'geodata-document', recordId: documentId, revision: 1 });
  const document = { schemaVersion: 2, recordType: 'geodata-document', recordId: documentId, ...scope, revision: 1, lifecycle: 'active',
    createdAt: '2024-03-04T00:00:00Z', updatedAt: '2024-03-04T00:00:00Z', lastAuditId: '00000000-0000-4000-8000-000000000908',
    payload: { profile: 'houseatlas.geodata-document.v2', title: 'Circuit filename does not classify this document',
      original: { assetId: documentAssetId, revision: 1, sha256: documentOriginal.resourceSha256, bytes: documentOriginal.bytes },
      provenance: { agency: 'Generated source', url: null, license: { status: 'permitted', reference: 'CC0-1.0' }, retrievedAt: '2024-03-04T00:00:00Z',
        custodyReceiptSha256: await savedDigest(encode({ profile: 'houseatlas.geodata-custody-receipt.v1', scope,
          asset: { assetId: documentAssetId, revision: 1, sha256: documentOriginal.resourceSha256, bytes: documentOriginal.bytes },
          retrievedAt: '2024-03-04T00:00:00Z', sourceUrl: null, admissionProfile: 'houseatlas.native-original.json.v1', measuredContentType: 'application/json' })),
        published: { value: '1998-04-05', precision: 'day' }, observed: null, frame: { crs: null, axes: [], linearUnit: null, extent: null } }, preview: null } };
  const documents = await add(encode({ profile: 'houseatlas.home-read-pack.documents.v1', documents: [document],
    originals: [{ documentId, documentRevision: 1, assetId: documentAssetId, resourceSha256: documentOriginal.resourceSha256, availability: 'available' }], previews: [], exclusions: [] }), 'application/json', 'documents');
  const original = await add(generated.glb.buffer.slice(0), 'model/gltf-binary', 'model', 'model');
  const companion = await add(generated.companionBytes.buffer.slice(0), 'application/json', 'model', 'original');
  const room = generated.companion.rooms.find(room => room.nativePlaceId !== null)!;
  const roomLinks = await add(encode({ profile: 'houseatlas.unified-atlas-room-links.v1', ...scope, publicationId: composed.publicationId,
    semanticsSha256: composed.envelope.publication.semanticsSha256, links: [{ roomId: room.roomId, nativePlaceId: room.nativePlaceId,
      packagePlaceKey: 'generated:room', packagePlaceUuid: '00000000-0000-4000-8000-000000000021' }] }), 'application/json', 'model', 'original');
  const overview = JSON.parse(new TextDecoder().decode(composed.overviewManifestBytes));
  const model = await add(encode({ profile: 'houseatlas.home-read-pack.model.v2', overview: { ...overview, profile: 'houseatlas.model-overview-read.v1',
    manifestSha256: composed.manifestSha256, original: { ...original, sha256: original.resourceSha256 } }, unifiedAtlas: { profile: 'houseatlas.home-read-pack.unified-atlas.v1', scope,
      publicationId: composed.publicationId, selectionRevision: SYNTHETIC_ATLAS.revision, semanticsSha256: companion.resourceSha256, companion,
      originalResourceSha256: original.resourceSha256, roomLinks } }), 'application/json', 'model');
  const pins = { home, atlas, inventory, network, documents, model };
  const sections = Object.fromEntries(SECTION_NAMES.map(name => [name, { state: mode === 'partial' && name === 'network' ? 'partial' : 'complete',
    resourceSha256: pins[name].resourceSha256, requiredBytesComplete: true }]));
  const manifest = { profile: 'houseatlas.home-read-pack.v1', scope, capturedAt: '2026-10-17T12:34:56.000Z', completeness: mode,
    limits: PACK_LIMITS, totals: { bytes: descriptors.reduce((sum, row) => sum + row.bytes, 0), resources: descriptors.length }, sections,
    resources: descriptors, exclusions: mode === 'complete' ? [] : [{ section: 'network', code: 'source-withheld', label: 'Additional source relations not retained' }] };
  const snapshotId = await savedDigest(encode(manifest));
  const admitted = await readPackManifest(encode({ ...manifest, snapshotId }), scope, true);
  const house: Omit<SavedHouse, 'localRevision'> = { version: 1, key: savedHouseKey(scope), scope, snapshotId, label: 'Generated saved property',
    capturedAt: admitted.capturedAt, shellBuildId, resources: admitted.resources, manifest: admitted.localBytes };
  return { house, resources, scene: composed.envelope, originalRoomNames: generated.companion.rooms.map(room => room.label) };
}

/** Genuine generated source originals and their captured factual association.
 * The producer shape matches the existing named overlay-source healthy example. */
async function generateHistoricalSource(scope: typeof GENERATED_SCOPE, scene: Awaited<ReturnType<typeof buildSyntheticAtlas>>['companion'],
  record: (type: string, id: string, payload: unknown, revision?: number) => { recordType: string; recordId: string; revision: number; lastAuditId: string }) {
  const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const hash = async (value: string | Uint8Array) => savedDigest(typeof value === 'string' ? new TextEncoder().encode(value).buffer : new Uint8Array(value).buffer);
  const canonical = (value: unknown) => canonicalPack(parseLosslessJson(JSON.stringify(value)));
  const floor='generated:floor',floorHash='a'.repeat(64),packageKey='generated:room',packageUuid=U(21),photoHash='b'.repeat(64);
  const historical=new TextEncoder().encode('Generated historical documentary original.');
  const anchors=[{id:'generated:anchor',sourceFloorKey:floor,sourceOriginalSha256:floorHash,targets:[{packagePlaceKey:packageKey,packagePlaceUuid:packageUuid}],unresolvedLabels:[]},
    {id:'generated:other-anchor',sourceFloorKey:floor,sourceOriginalSha256:floorHash,targets:[{packagePlaceKey:'generated:other-room',packagePlaceUuid:U(23)}],unresolvedLabels:[]}];
  const receipt=canonical({profile:'houseatlas.native-scene-room-review.v1',receiptId:'generated:receipt',sourceReceiptSha256:await hash(historical),anchors});
  const receiptSha=await hash(receipt);
  const fixtures={schema:'houseatlas.documentary-electrical-fixtures.v1',viewKey:'documentary-source',interpretationDate:'2026-10-10',
    symbolLegend:{xMeansSocket:true,socketsPerX:1,receiptId:'generated:symbol-review'},roomMappingReceipt:{id:'generated:receipt',sha256:receiptSha},registrationReceipts:[],
    sheets:[{id:'sheet',title:'Generated sheet',pdfPage:2,originalPhoto:'originals/generated.svg',originalPhotoSha256:photoHash,renderedPhotoSha256:photoHash,sourceDate:null,regionIds:['region']}],
    groups:[{id:'group',label:'L1',fixtureIds:['socket'],evidenceBasis:'historic-drawing-label',currentCircuitId:null,verifiedWiring:false}],
    regions:[{id:'region',sheetId:'sheet',label:'Generated room',sourceOutline:[],outlineClosed:false,sourceBounds:[.1,.1,.9,.9],outlineBasis:'untraced',places:[{packagePlaceKey:packageKey,packagePlaceUuid:packageUuid,label:'Generated room',basis:'owner-reported'}],orientation:'unregistered',physicalTransform:null}],
    fixtures:[{id:'socket',sheetId:'sheet',regionId:'region',clusterId:null,kind:'socket',label:'Generated socket',glyph:'X',source:{symbolKey:'generated:symbol',originalPhotoSha256:photoHash,renderedPhotoSha256:photoHash,normalizedBox:[.3,.3,.4,.4],normalizedPoint:[.35,.35],literalLabels:['L1'],placementDescription:'Generated symbol'},group:{id:'group',label:'L1',basis:'label-adjacent',note:'Historical label'},glyphCount:1,fixtureCount:1,uncertainty:null,currentState:'historic-unverified',physicalCoordinate:null,wireRoute:null}]};
  const statement=(basis: string)=>({statement:'Generated documentary statement',evidenceBasis:basis,uncertainty:{status:'unmeasured',explanation:'Documentary only'}});
  const sheet={document_id:'generated:sheet',bundle_id:'generated:bundle',title_as_read:'Generated sheet',source_photo:'originals/generated.svg',source_sha256:photoHash,rendered_photo:'rendered/generated.svg',pdf_page:2,factAt:'2026-10-09',interpretation_date:'2026-10-10',documentary_group_labels:['L1'],direct_reading:statement('document'),drawing_association:statement('inference'),open_uncertainty:'Historical only',native_atlas_identity_ids:[],owner_confirmed_room_mapping:null,owner_confirmed_layout_mapping:null,
    provisional_diagram:{coordinate_space:'normalized-upright-photo',geometry_status:'unmeasured',metric_units:null,scale:null,transform:null,region_xyxy:[.1,.1,.9,.9],source_date:null},
    package_room_associations:[{package_room_id:packageKey,stable_package_uuid:packageUuid,current_circuit_binding:null,native_atlas_identity_id:null,status:'inferred-name-or-context-match',evidenceBasis:'inference'}]};
  const primary=new TextEncoder().encode(JSON.stringify({schema:'houseatlas.native-scene-source.v2',receiptCanonicalJson:receipt,
    rooms:{status:'available',reason:null,receiptId:'generated:receipt',receiptSha256:receiptSha,entries:[],regions:[]},
    network:{status:'available',reason:null,source:{label:'Generated recorded network',revision:'source-1',recordedAt:'2026-10-10',retrievedAt:null,status:'recorded',acceptedAt:null,coverage:'partial',notes:''},
      devices:[{id:'device:generated',label:'Generated device',kind:'switch',mobility:'fixed',confidence:'recorded',notes:'',place:{sourceRoomId:'source:room',sourcePlaceId:packageKey,sourcePlaceUUID:packageUuid,planAssociations:[{sourceAnchorId:'generated:anchor',sourceFloorKey:floor,sourceFloorLabel:'Generated floor',sourceReference:'Generated documentary reference',sourceHandle:'generated:handle',sourceSHA256:floorHash}],roomLabel:'Generated room',detail:'',confidence:'recorded',basis:'Reviewed source association',sourceFloorKey:floor,mappingStatus:'accepted',coordinate:null}},{id:'device:mobile',label:'Generated phone',kind:'phone',mobility:'mobile',confidence:'recorded',notes:'Moves between rooms',place:null}],endpoints:[{id:'endpoint:segment',label:'Generated shared segment',kind:'segment',ownerDeviceId:null,notes:'No physical location'}],links:[{id:'link:generated',fromEndpointId:'device:generated',toEndpointId:'device:mobile',kind:'connection',medium:'wireless',confidence:'recorded',sourceConfidence:'uncertain source note',temporalStatus:'recorded-past',recordedAtPrecision:'day',basis:'Generated documentary connection',recordedAt:'2026-10-09',notes:'No physical route',path:null}]},
    electricity:{status:'available',reason:null,documentarySource:{schema:'private-documentary-records/v1',status:'documentary',native_import_receipt:null,records:[sheet]},roomRegistry:{schema:'private-houseatlas-room-registry/v1',entities:[{id:'generated:building',stable_uuid:U(22),display_name:'Generated building',aliases:[],source_refs:['generated']},{id:packageKey,stable_uuid:packageUuid,display_name:'Generated room',aliases:[],source_refs:['generated']}]},buildingPackageKey:'generated:building',retrievedAt:null},
    electricalFixtures:{status:'available',reason:null,documentaryFixtures:fixtures}}));

  const primarySha = await hash(primary), supportSha = await hash(historical);
  const buildingId = scene.buildings.find(building => building.nativePlaceId !== null)!.nativePlaceId!;
  const room = scene.rooms.find(room => room.nativePlaceId !== null)!;
  const documents = [
    { role: 'primary-scene', evidenceId: U(4), evidenceRevision: 7, originalAssetId: U(5), originalAssetRevision: 9, originalSha256: primarySha, contentType: 'text/plain' },
    { role: 'documentary-sheet', evidenceId: U(6), evidenceRevision: 8, originalAssetId: U(7), originalAssetRevision: 10, originalSha256: supportSha, contentType: 'text/plain' },
  ];
  const payload = { profile: 'houseatlas.native-scene-association.v1', buildingId, associationVersion: 1, previousAssociationId: null,
    reviewStatus: 'accepted', reviewStatement: 'Generated captured association', sourceDocuments: documents,
    acceptedReceipt: { receiptId: 'generated:receipt', canonicalJson: receipt, canonicalSha256: receiptSha, anchors },
    sourceFloors: [{ sourceFloorKey: floor, sourceOriginalSha256: floorHash, nativeFloorKey: 'native:floor', nativeGeometryId: U(10), nativeGeometryRevision: 1,
      nativeOriginalAssetId: U(11), nativeOriginalSha256: floorHash }],
    roomMappings: [{ sourceRoomId: 'source:room', sourceFloorKey: floor, sourceOriginalSha256: floorHash, sourceAnchorIds: ['generated:anchor'],
      targets: [{ packagePlaceKey: packageKey, packagePlaceUuid: packageUuid, atlasPlaceId: room.nativePlaceId }], unresolvedLabels: [], evidenceIds: [U(4), U(6)] }] };
  const provenance = { source: null, sourceRevision: null, sourceConfidence: null, evidenceBasis: 'document', factAt: null,
    retrievedAt: '2026-10-10T12:00:00Z', vantage: null, uncertainty: { status: 'unknown', explanation: 'Captured documentary original' } };
  const asset = (sha256: string, bytes: number) => ({ owner: 'atlas', purpose: 'evidence-original', sha256, byteSize: bytes, contentType: 'text/plain', availability: 'available', sourceLicense: { status: 'permitted', reference: 'CC0-1.0' }, previewPolicy: 'download-only', evidenceIds: [] });
  return { primary, support: historical, records: [
    record('identity', buildingId, { kind: 'location', evidenceIds: [U(4)] }, 1),
    record('asset', U(5), asset(primarySha, primary.byteLength), 9), record('asset', U(7), asset(supportSha, historical.byteLength), 10),
    record('evidence', U(4), { statement: 'Generated primary source', provenance, supersedesEvidenceIds: [], references: [{ kind: 'atlas-asset', assetId: U(5) }] }, 7),
    record('evidence', U(6), { statement: 'Generated support original', provenance, supersedesEvidenceIds: [], references: [{ kind: 'atlas-asset', assetId: U(7) }] }, 8),
    record('scene-association', U(12), payload, 1),
  ], scope };
}
