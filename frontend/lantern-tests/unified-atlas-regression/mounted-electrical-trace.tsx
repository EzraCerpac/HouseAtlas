/** GENERATED inputs only. Explicit prop changes below are not a production
 * review-withdrawal subscription, canonical reader or currentReviews supplier. */
import { useReducer, useState } from 'react';
import { createRoot } from 'react-dom/client';
import generated from '../../../contracts/electrical-data/generated.fixture.json';
import electricalSchema from '../../../contracts/electrical-data/v1.schema.json';
import nativeSchema from '../../../packages/contracts/schemas/atlas.v2.schema.json';
import { createElectricalDataProjector } from '../../../packages/contracts/src/electrical-data.mjs';
import { Inspector } from '../../src/lantern/unified-atlas/AtlasInspector';
import { atlasReducer, bindAtlasModel, initialAtlasState, type AtlasAction, type AtlasModel } from '../../src/lantern/unified-atlas/scene';
import { electricalGroups } from '../../src/lantern/unified-atlas/electrical-group';
import { projectDocumentaryFacts } from '../../src/lantern/unified-atlas/runtime-overlays';
import type { ElectricalTraceSource } from '../../src/lantern/unified-atlas/electrical-trace';
import { loadStandardGlb } from '../../src/lantern/canonical-ifc/standard-glb';
import { readUnifiedAtlas } from '../../integration/unified-atlas-reader';
import { atlasScenePath, buildSyntheticAtlas, composeAtlasEnvelope, createAtlasTransport, SYNTHETIC_ATLAS } from '../unified-atlas/synthetic-atlas';
import '../../src/lantern/unified-atlas/unified-atlas.css';

const project = createElectricalDataProjector(electricalSchema, nativeSchema);
const pins = { ...generated.data.scope, sceneEvidenceId: 'generated-mounted-scene', sceneEvidenceRevision: 1,
  sceneOriginalSha256: 'c'.repeat(64), sceneAssetId: 'generated-mounted-asset', sceneAssetRevision: 1,
  acceptedRoomReceiptId: null, acceptedRoomReceiptSha256: null, acceptedRoomAnchors: [] };
const records = projectDocumentaryFacts({ rooms: [] }, { mode: 'current-native', pins, roomBindings: [],
  network: { status: 'unavailable', reason: 'not-retained' }, electricity: { status: 'unavailable', reason: 'not-retained' },
  electricalFixtures: { status: 'available', data: generated.context.documentary.data }, observationFacts: [] }, new Set());
const groups = electricalGroups(records);
const source = (withheld: boolean): ElectricalTraceSource => ({
  ledger: { ...generated.data.scope, sceneEvidenceId: pins.sceneEvidenceId, sceneOriginalSha256: pins.sceneOriginalSha256,
    viewKey: generated.data.viewKey, sha256: generated.data.fixtureLedgerSha256 },
  // The checked-in synthetic context is the only review context used here.
  // Removing its reviews exercises the real projector's refusal, not a fabricated verdict.
  projection: project(generated.data, withheld ? { ...generated.context, currentReviews: [] } : generated.context),
  roomBindings: [{ roomId: 'syn-room-living', nativePlaceId: generated.expected.reviewedRoomId, qualification: 'current-native-room-join' }],
});
const currentSource = source(false), withheldSource = source(true);

async function generatedModel() {
  const input = await buildSyntheticAtlas(generated.data.scope);
  // Bind this invented publication's Living room to the fixture's invented
  // native room before actual publication admission; do not patch the model.
  const living = input.companion.rooms.find(room => room.roomId === 'syn-room-living');
  if (!living) throw new Error('Generated Living room missing');
  living.nativePlaceId = generated.expected.reviewedRoomId;
  for (const binding of input.companion.overlayBindings) if (binding.roomId === living.roomId)
    binding.nativePlaceId = generated.expected.reviewedRoomId;
  const companionBytes = new TextEncoder().encode(JSON.stringify(input.companion));
  const composed = await composeAtlasEnvelope(companionBytes, input.glb, SYNTHETIC_ATLAS.revision);
  const selection = { owner: {}, scope: generated.data.scope, expiresAt: '2099-01-01T00:00:00Z',
    publicationId: composed.publicationId, manifestSha256: composed.manifestSha256 };
  const read = await readUnifiedAtlas({ selection, origin: SYNTHETIC_ATLAS.origin, signal: new AbortController().signal,
    isCurrent: () => true, transport: createAtlasTransport({ origin: SYNTHETIC_ATLAS.origin,
      scenePath: atlasScenePath(selection.scope), envelopeBytes: composed.envelopeBytes, href: composed.href,
      glb: input.glb, sha256: composed.sha256, manifestSha256: composed.manifestSha256, revision: SYNTHETIC_ATLAS.revision }) });
  const loaded = await loadStandardGlb(read.model, 'generated-electrical-inspector', new AbortController().signal);
  return bindAtlasModel(read.scene, loaded);
}

function MountedInspector({ model }: { readonly model: AtlasModel }) {
  const [state, dispatch] = useReducer((state: ReturnType<typeof initialAtlasState>, action: AtlasAction) => atlasReducer(model, state, action),
    model, model => ({ ...atlasReducer(model, initialAtlasState(model), { type: 'select', occurrenceId: 'syn-occ-hall' }),
      layers: { ...initialAtlasState(model).layers, electrical: true } }));
  const [groupId, setGroupId] = useState('generated-group-1');
  const [data, setData] = useState<ElectricalTraceSource | undefined>(currentSource);
  const group = groups.find(row => row.groupId === groupId);
  if (!group) throw new Error('Generated drawing group missing');
  return <>
    <nav aria-label="Generated trace controls">
      <button onClick={() => { setGroupId('generated-group-1'); setData(currentSource); }}>Show owner report</button>
      <button onClick={() => { setGroupId('generated-group-3'); setData(currentSource); }}>Show generated test</button>
      <button onClick={() => setData(withheldSource)}>Replace with withheld projection</button>
      <button onClick={() => setData(undefined)}>Remove electrical data</button>
    </nav>
    <output aria-label="Selected occurrence">{state.occurrenceId}</output>
    <div className="lantern-host"><div className="ua-shell" style={{ height: 850, minHeight: 850 }}>
      <Inspector model={model} state={state} dispatch={dispatch} context={[]} renderFailure={null}
        runtime={null} runtimeReason="generated-mounted-fixture" runtimeConfigured={true}
        open={true} setOpen={() => {}} electricalGroup={group} canElectricalGroup={() => false}
        onElectricalGroup={() => {}} clearElectricalGroup={() => setGroupId('generated-group-1')}
        electricalData={data} openDocuments={undefined} openNetwork={undefined} />
    </div></div>
  </>;
}

function Harness({ model }: { readonly model: AtlasModel }) {
  const [generation, remount] = useReducer((value: number) => value + 1, 0);
  return <><p>Generated review and tested-state fixture only; no household wiring or authority.</p>
    <button onClick={remount}>Remount Inspector</button>
    <output aria-label="Inspector generation">{generation}</output>
    <MountedInspector key={generation} model={model} />
  </>;
}

const root = createRoot(document.getElementById('root')!);
void generatedModel().then(model => root.render(<Harness model={model} />),
  error => root.render(<p role="alert">{String(error)}</p>));
