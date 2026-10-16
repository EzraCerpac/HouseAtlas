import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon } from '../components/Icon';
import { parseIfcGlbProfile, type IfcGlbProfile } from '../scans/ifc-glb-profile';
import { decodeMeshJson } from '../scans/mesh-profile';
import { checkManifest, ManifestError, readBrowserManifest, type BrowserManifest, type ManifestCheck } from './browser-manifest';
import { drawnBounds, makeProjection, pick, prepareMeshes, type Bounds, type DrawRules, type PreparedMesh } from './geometry';
import { GlbFormatError, hasGlbSignature, isClosedIfcProfile, readGlbContainer, STANDARD_GLB_LIMITS, type GlbStage } from './glb-preflight';
import { MeshLayer } from './MeshLayer';
import type { StandardGlb } from './standard-glb';
import { useReducedMotionPreference, useStageCamera } from './useStageCamera';
import type { LocalModelReviewOptions } from '../electrical-documentary/types';
import { ElectricalReviewSection, type ElectricalSelection } from '../electrical-documentary/ElectricalReviewSection';
import { LocalSourceView } from '../electrical-documentary/LocalSourceView';
import { useElectricalReview } from '../electrical-documentary/useElectricalReview';
import type { ElectricalTargetChoice, RendererFiles } from '../electrical-documentary/types';
import { ModelNavigator, navigationIndex, nodeLabel, SelectionFacts, useModelNavigation } from './ModelNavigator';
import { stageSpan } from '../observability/stage-timing';
import './canonical-ifc.css';

/** The closed GLB profile's own byte cap (also enforced by the parser). */
export const LOCAL_GLB_MAX_BYTES = 8 * 1024 * 1024;
export const LOCAL_MANIFEST_MAX_BYTES = 4 * 1024 * 1024;
/** One manifest, its house GLB and an optional reference GLB. */
export const LOCAL_FILES_MAX = 3;

export interface LocalGlbSummary {
  readonly sha256: string;
  readonly bytes: number;
  readonly source: IfcGlbProfile['source'];
  readonly counts: IfcGlbProfile['counts'];
  readonly meshes: readonly PreparedMesh[];
}

const hex = (digest: ArrayBuffer) => [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');

async function closedProfile(bytes: Uint8Array, sha256: string, signal: AbortSignal): Promise<LocalGlbSummary> {
  const profile = await parseIfcGlbProfile(bytes, signal, decodeMeshJson); signal.throwIfAborted();
  const meshes = prepareMeshes(profile.meshes.map((mesh, index) => ({ meshKey: `local#${index}`, floorId: null, occurrenceId: null,
    positions: Float32Array.from(mesh.positionsLocalTokens, Number), indices: Uint32Array.from(mesh.triangleIndicesTokens, Number) })), () => null);
  return { sha256, bytes: bytes.byteLength, source: profile.source, counts: profile.counts, meshes };
}

/** Reads a local GLB in the browser only: no upload, storage, custody or
 * publication. Every mesh is unbound; rooms and floors are never inferred. */
export async function readLocalGlb(file: Blob, signal: AbortSignal): Promise<LocalGlbSummary> {
  if (file.size > LOCAL_GLB_MAX_BYTES) throw new RangeError('size');
  const bytes = new Uint8Array(await file.arrayBuffer()); signal.throwIfAborted();
  const sha256 = hex(await crypto.subtle.digest('SHA-256', bytes)); signal.throwIfAborted();
  return closedProfile(bytes, sha256, signal);
}

export type LocalFileRole = 'house' | 'reference' | 'manifest' | 'glb' | 'other';
/** What the browser itself measured for each chosen file. */
export interface LocalFileFacts { readonly name: string | null; readonly bytes: number; readonly sha256: string | null; readonly role: LocalFileRole }
export type LocalFailureKind = 'selection' | 'size' | 'digest' | 'type' | 'closed-profile' | GlbStage | ManifestError['stage'];
export class LocalReadError extends Error {
  constructor(readonly kind: LocalFailureKind, message: string, readonly files: readonly LocalFileFacts[]) { super(message); }
}
export interface LoadedLayer { readonly file: LocalFileFacts; readonly glb: StandardGlb; readonly bounds: Bounds | null }
export type LocalRead =
  | { readonly kind: 'closed-profile'; readonly files: readonly LocalFileFacts[]; readonly summary: LocalGlbSummary }
  | { readonly kind: 'standard'; readonly files: readonly LocalFileFacts[]; readonly house: LoadedLayer; readonly reference: LoadedLayer | null;
      readonly manifest: { readonly data: BrowserManifest; readonly check: ManifestCheck } | null;
      /** The original chosen objects in their checked roles; never rebuilt from facts. */
      readonly originals: LocalOriginals };
export interface LocalOriginals { readonly house: Blob; readonly manifest: Blob | null; readonly reference: Blob | null }

const GLB_LEAD: Readonly<Record<GlbStage, string>> = { container: 'Not a glTF 2.0 binary file.', preflight: 'Not accepted for preview.', load: 'Not loaded.' };
const MANIFEST_LEAD: Readonly<Record<ManifestError['stage'], string>> = { manifest: 'Manifest not accepted.',
  pin: 'The files do not match the manifest.', binding: 'The house GLB does not match its manifest.' };
const nameOf = (blob: Blob) => { const name = (blob as Partial<File>).name; return typeof name === 'string' && name.length > 0 ? name : null; };

/** Reads one chosen set in this browser only. One GLB alone is shown as a
 * closed-profile or standard GLB by its own content; a browser manifest pins
 * its house GLB and optional reference GLB by exact bytes and SHA-256. Any
 * mismatch refuses the whole set, so versions are never combined. */
export async function readLocalFiles(blobs: readonly Blob[], signal: AbortSignal): Promise<LocalRead> {
  const files: LocalFileFacts[] = blobs.map(blob => ({ name: nameOf(blob), bytes: blob.size, sha256: null, role: 'other' }));
  function fail(kind: LocalFailureKind, message: string): never { throw new LocalReadError(kind, message, files.slice()); }
  const subject = (at: number) => blobs.length > 1 ? `${files[at]!.name ?? `File ${at + 1}`}: ` : '';
  if (blobs.length === 0 || blobs.length > LOCAL_FILES_MAX) fail('selection', 'Choose one GLB, or one manifest with its house GLB and an optional reference GLB.');
  for (const [at, blob] of blobs.entries())
    if (blob.size > STANDARD_GLB_LIMITS.bytes) fail('size', `${subject(at)}Files over 32 MiB are not supported.`);
  if (typeof crypto === 'undefined' || !crypto.subtle) fail('digest', 'This page cannot compute file fingerprints. Open it from localhost or over HTTPS.');

  const contents: Uint8Array[] = [];
  for (const [at, blob] of blobs.entries()) {
    let bytes: Uint8Array<ArrayBuffer>;
    try { bytes = new Uint8Array(await blob.arrayBuffer()); } catch { signal.throwIfAborted(); return fail('type', `${subject(at)}The browser could not read this file.`); }
    signal.throwIfAborted();
    const sha256 = hex(await crypto.subtle.digest('SHA-256', bytes)); signal.throwIfAborted();
    files[at] = { ...files[at]!, bytes: bytes.byteLength, sha256, role: hasGlbSignature(bytes) ? 'glb' : 'other' };
    contents.push(bytes);
  }
  const glbs = files.flatMap((file, at) => file.role === 'glb' ? [at] : []);
  const others = files.flatMap((file, at) => file.role === 'glb' ? [] : [at]);
  if (others.length > 1) fail('selection', 'Choose one manifest at a time. Versions are never combined.');

  const standard = async (at: number, layer: 'house' | 'reference'): Promise<LoadedLayer> => {
    const { loadStandardGlb } = await import('./standard-glb');
    try {
      const glb = await loadStandardGlb(contents[at]!, layer, signal);
      return { file: files[at]!, glb, bounds: drawnBounds(glb.meshes, [], null) };
    } catch (error) {
      signal.throwIfAborted();
      return fail(error instanceof GlbFormatError ? error.stage : 'load',
        `${subject(at)}${GLB_LEAD[error instanceof GlbFormatError ? error.stage : 'load']} ${error instanceof GlbFormatError ? error.message : 'The standard glTF loader rejected the file'}.`);
    }
  };

  if (others.length === 0) {
    if (glbs.length !== 1) fail('selection', 'Several GLB files need their manifest. Add it, or choose one GLB.');
    const at = glbs[0]!;
    let closed = false;
    try { closed = isClosedIfcProfile(readGlbContainer(contents[at]!)); }
    catch (error) { fail('container', `${GLB_LEAD.container} ${error instanceof GlbFormatError ? error.message : 'Unreadable container'}.`); }
    if (!closed) return { kind: 'standard', files, house: await standard(at, 'house'), reference: null, manifest: null,
      originals: { house: blobs[at]!, manifest: null, reference: null } };
    if (contents[at]!.byteLength > LOCAL_GLB_MAX_BYTES) fail('size', 'HouseAtlas IFC-derived GLB files over 8 MiB are not supported.');
    try { return { kind: 'closed-profile', files, summary: await closedProfile(contents[at]!, files[at]!.sha256!, signal) }; }
    catch (error) {
      signal.throwIfAborted();
      const reason = error instanceof TypeError && error.message.startsWith('IFC GLB: ') ? error.message.slice(9) : 'JSON chunk';
      return fail('closed-profile', `This file declares the HouseAtlas IFC-derived profile but does not satisfy it (check: ${reason}).`);
    }
  }

  const at = others[0]!;
  if (contents[at]!.byteLength > LOCAL_MANIFEST_MAX_BYTES) fail('size', `${subject(at)}Manifest files over 4 MiB are not supported.`);
  let json: unknown;
  try { json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(contents[at])); }
  catch { fail('type', `${subject(at)}Neither a GLB nor a JSON browser manifest.`); }
  let manifest: BrowserManifest;
  try { manifest = readBrowserManifest(json); }
  catch (error) { return fail('manifest', `${subject(at)}${MANIFEST_LEAD.manifest} ${error instanceof ManifestError ? error.message : 'Unreadable manifest'}.`); }
  files[at] = { ...files[at]!, role: 'manifest' };
  for (const glb of glbs) {
    const file = files[glb]!;
    const role = file.sha256 === manifest.house.sha256 && file.bytes === manifest.house.bytes ? 'house'
      : file.sha256 === manifest.reference.sha256 && file.bytes === manifest.reference.bytes ? 'reference' : null;
    if (!role) fail('pin', `${subject(glb)}${MANIFEST_LEAD.pin} This GLB matches neither file pinned by manifest version ${manifest.version}.`);
    if (files.some(other => other.role === role)) fail('selection', `The ${role} GLB was chosen twice.`);
    files[glb] = { ...file, role };
  }
  const houseAt = files.findIndex(file => file.role === 'house'), referenceAt = files.findIndex(file => file.role === 'reference');
  if (houseAt < 0) fail('pin', `${MANIFEST_LEAD.pin} Add the house GLB pinned by manifest version ${manifest.version}.`);
  const house = await standard(houseAt, 'house');
  const reference = referenceAt < 0 ? null : await standard(referenceAt, 'reference');
  try {
    const check = checkManifest(manifest, { sha256: house.file.sha256!, bytes: house.file.bytes, glb: house.glb, bounds: house.bounds },
      reference && { sha256: reference.file.sha256!, bytes: reference.file.bytes });
    return { kind: 'standard', files, house, reference, manifest: { data: manifest, check },
      originals: { house: blobs[houseAt]!, manifest: blobs[at]!, reference: referenceAt < 0 ? null : blobs[referenceAt]! } };
  } catch (error) {
    if (!(error instanceof ManifestError)) throw error;
    return fail(error.stage, `${MANIFEST_LEAD[error.stage]} ${error.message}.`);
  }
}

type Phase = { readonly files: readonly Blob[]; readonly status: 'reading' } | { readonly files: readonly Blob[]; readonly status: 'ready'; readonly read: LocalRead }
  | { readonly files: readonly Blob[]; readonly status: 'failed'; readonly message: string; readonly facts: readonly LocalFileFacts[] };
const RULES: DrawRules = { visibleFloors: 'all', clipY: null };
const NO_CONTEXT: readonly string[] = [], NO_TINTS: ReadonlyMap<string, string> = new Map();
const ROLE_LABEL: Readonly<Record<LocalFileRole, string>> = { house: 'House GLB, matches its pin', reference: 'Reference GLB, matches its pin',
  manifest: 'Browser manifest', glb: 'GLB', other: 'Not a GLB' };
const count = (value: number) => value.toLocaleString('en');
const yesNo = (value: boolean) => value ? 'Yes' : 'No';

/** Previews chosen files; a new choice replaces the previous preview whole.
 * Optional review inputs connect source-owner electrical documents to the
 * exact files of a manifest-checked standard set. */
export function LocalGlbPreview({ files, review }: { readonly files: readonly Blob[]; readonly review?: LocalModelReviewOptions | undefined }) {
  const [phase, setPhase] = useState<Phase | null>(null);
  useEffect(() => {
    if (files.length === 0) return;
    const controller = new AbortController();
    // Anonymous: counts and fixed outcomes only, never names or fingerprints.
    const timing = stageSpan('model', 'files-read', { files: files.length });
    setPhase({ files, status: 'reading' });
    readLocalFiles(files, controller.signal).then(read => {
      if (controller.signal.aborted) return;
      timing({ outcome: 'shown', triangles: read.kind === 'standard' ? read.house.glb.counts.triangles + (read.reference?.glb.counts.triangles ?? 0) : read.summary.counts.triangles });
      setPhase({ files, status: 'ready', read });
    }, error => {
      if (controller.signal.aborted) return;
      timing({ outcome: 'failed' });
      setPhase(error instanceof LocalReadError
        ? { files, status: 'failed', message: error.message, facts: error.files }
        : { files, status: 'failed', message: 'These files could not be read in this browser.', facts: [] });
    });
    return () => { timing({ outcome: 'withdrawn' }); controller.abort(); };
  }, [files]);
  const current = phase?.files === files ? phase : null;
  if (files.length === 0) return null;
  if (!current || current.status === 'reading') return <div className="cifc cifc-unavailable" role="status" aria-busy="true">
    <h2>Local preview</h2><p>Reading {files.length === 1 ? 'file' : `${files.length} files`}…</p></div>;
  if (current.status === 'failed') return <div className="cifc cifc-unavailable" role="status">
    <h2>Local preview unavailable</h2><p>{current.message}</p>
    {current.facts.length > 0 && <FileFacts files={current.facts} />}</div>;
  return current.read.kind === 'closed-profile' ? <ClosedProfileView summary={current.read.summary} />
    : <StandardView read={current.read} review={review} />;
}

function FileFacts({ files }: { readonly files: readonly LocalFileFacts[] }) {
  return <dl className="cifc-facts is-source">{files.map((file, at) =>
    <div key={at}><dt>{file.name ?? `File ${at + 1}`}</dt><dd>{ROLE_LABEL[file.role]}<span>{count(file.bytes)} bytes</span>
      {file.sha256 ? <code>{file.sha256}</code> : <span>SHA-256 not computed</span>}</dd></div>)}</dl>;
}

interface StageProps {
  readonly meshes: readonly PreparedMesh[];
  /** Separate reference layer, toggled independently and never framed as building. */
  readonly referenceKeys: ReadonlySet<string> | null;
  readonly describe: (meshKey: string) => string;
  readonly subject: string;
  /** Presentation only: hidden parts are neither drawn nor picked. */
  readonly hiddenKeys?: ReadonlySet<string> | undefined;
  readonly selectedKeys?: ReadonlySet<string> | undefined;
  /** The actual drawn mesh key under the pointer, or null for empty space. */
  readonly onPick?: ((meshKey: string | null) => void) | undefined;
}

function PreviewStage({ meshes, referenceKeys, describe, subject, hiddenKeys, selectedKeys, onPick }: StageProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<'3d' | 'top'>('3d');
  const [showReference, setShowReference] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const reduced = useReducedMotionPreference();
  const visible = useMemo(() => referenceKeys && !showReference ? meshes.filter(mesh => !referenceKeys.has(mesh.meshKey)) : meshes,
    [meshes, referenceKeys, showReference]);
  // Framing follows the loaded meshes actually drawn, never metadata nodes or storey assumptions.
  const bounds = useMemo(() => drawnBounds(visible, [], null), [visible]);
  const camera = useStageCamera({ element: viewport, top: view === 'top', reduced,
    onTap: (px, py) => {
      if (!projection) return;
      const hit = pick(hiddenKeys ? visible.filter(mesh => !hiddenKeys.has(mesh.meshKey)) : visible, projection, RULES, px, py);
      const meshKey = hit.kind === 'none' ? null : hit.meshKey;
      setHint(meshKey === null ? null : describe(meshKey)); onPick?.(meshKey);
    } });
  const projection = useMemo(() => bounds ? makeProjection(camera.eased, bounds, camera.size, camera.planBlend) : null, [bounds, camera.eased, camera.size, camera.planBlend]);
  return <div className="cifc-stage">
    <div className="cifc-stage-head">
      <div className="cifc-view-ctrl">
        <div className="seg" role="group" aria-label="Model view">
          <button type="button" aria-pressed={view === '3d'} onClick={() => setView('3d')}>3D</button>
          <button type="button" aria-pressed={view === 'top'} onClick={() => setView('top')}>Top view</button>
        </div>
        <div className="ctrl-group" role="group" aria-label="Camera">
          {view === '3d' && <>
            <button type="button" className="ctrl-btn" aria-label="Turn model left" onClick={() => camera.turn(-45)}><Icon name="rotl" size={17} /></button>
            <button type="button" className="ctrl-btn" aria-label="Turn model right" onClick={() => camera.turn(45)}><Icon name="rotr" size={17} /></button>
          </>}
          <button type="button" className="ctrl-btn" aria-label="Zoom in" disabled={camera.zoom >= camera.zoomLimits.max} onClick={() => camera.zoomBy(1.3)}><Icon name="plus" size={17} /></button>
          <button type="button" className="ctrl-btn" aria-label="Zoom out" disabled={camera.zoom <= camera.zoomLimits.min} onClick={() => camera.zoomBy(1 / 1.3)}><Icon name="minus" size={17} /></button>
          <button type="button" className="ctrl-btn" aria-label="Fit whole model" title="Fit whole model" onClick={camera.fit}><Icon name="fit" size={17} /></button>
        </div>
      </div>
    </div>
    <div ref={viewport} className={`cifc-viewport${camera.dragging ? ' is-dragging' : ''}`} tabIndex={0} role="group"
      aria-label={`${view === 'top' ? 'Top view' : '3D'} of ${subject}. Drag or arrow keys ${view === 'top' ? 'pan' : 'turn'}, plus and minus zoom, 0 fits.`} {...camera.bind}>
      {projection && !failure && <div className="cifc-canvas-wrap">
        <MeshLayer meshes={visible} projection={projection} rules={RULES} currentFloorId={null} selectedOccurrenceId={null}
          contextOccurrenceIds={NO_CONTEXT} tints={NO_TINTS} hidden={false} referenceKeys={referenceKeys ?? undefined}
          hiddenKeys={hiddenKeys} selectedKeys={selectedKeys} onUnavailable={setFailure} />
      </div>}
      {!bounds && <p className="cifc-stage-note" role="status">{meshes.length > 0 ? 'No geometry is shown. Turn the reference layer back on.' : 'This file has no drawable geometry.'}</p>}
      {failure && <p className="cifc-stage-note" role="status">{failure}</p>}
      <p className="cifc-hint" role="status" aria-live="polite">{hint}</p>
    </div>
    <div className="cifc-stage-foot">
      <div className="cifc-status"><span className="cifc-chip is-local">Local preview</span></div>
      {referenceKeys && <div className="layer-bar" role="group" aria-label="Layers">
        <button type="button" className="layer-chip" aria-pressed={showReference} style={{ '--layer': '#6F8796' } as CSSProperties}
          onClick={() => { setShowReference(value => !value); setHint(null); }}><span className="layer-swatch" aria-hidden="true" />Reference surfaces</button>
      </div>}
    </div>
  </div>;
}

function Panel({ children, version }: { readonly children: ReactNode; readonly version?: string | undefined }) {
  return <aside className="cifc-panel" aria-label="Local file facts">
    <header className="cifc-panel-head"><h2>Local preview</h2>
      <p className="cifc-pub">{version ? `Manifest version ${version}. ` : ''}Read in this browser only. Not a publication.</p></header>
    {children}
  </aside>;
}

function ClosedProfileView({ summary }: { readonly summary: LocalGlbSummary }) {
  const { source, counts } = summary;
  return <div className="cifc cifc-preview"><div className="cifc-layout">
    <PreviewStage meshes={summary.meshes} referenceKeys={null} describe={() => 'Room associations unavailable'} subject="local GLB" />
    <Panel>
      <section className="cifc-focus" aria-label="Associations">
        <dl className="cifc-facts">
          <div><dt>Rooms</dt><dd>Unavailable</dd></div>
          <div><dt>Floors</dt><dd>Unavailable</dd></div>
          <div><dt>Meshes</dt><dd>{count(counts.meshes)}, all unbound</dd></div>
          <div><dt>Triangles</dt><dd>{count(counts.triangles)}</dd></div>
        </dl>
      </section>
      <dl className="cifc-facts is-source">
        <div><dt>File SHA-256</dt><dd><code>{summary.sha256}</code><span>{count(summary.bytes)} bytes</span></dd></div>
        <div><dt>Source IFC</dt><dd><code>{source.originalSHA256}</code><span>{source.originalBytes.toString()} bytes, declared</span></dd></div>
        <div><dt>Converter</dt><dd>{source.converter.name} {source.converter.version}, declared<code>{source.converter.configSha256}</code></dd></div>
        <div><dt>Source units</dt><dd>{source.sourceUnits} (converter declaration)</dd></div>
        <div><dt>Source up axis</dt><dd>{source.sourceUpAxis} (converter declaration)</dd></div>
        <div><dt>GLB frame</dt><dd>{source.glbUnits === 'm' ? 'Metres' : source.glbUnits}, {source.glbUpAxis} up (declared)</dd></div>
        <div><dt>Axis map</dt><dd>{source.sourceToGlb.axisMap.join(', ')}; scale {source.sourceToGlb.scale} (declared)</dd></div>
        <div><dt>Physical alignment</dt><dd>Unknown</dd></div>
        <div><dt>Vertices</dt><dd>{count(counts.vertices)}</dd></div>
      </dl>
    </Panel>
  </div></div>;
}

const metres = (value: number) => `${value.toLocaleString('en', { maximumFractionDigits: 2 })} m`;
const size = (bounds: Bounds) => [0, 1, 2].map(axis => metres(bounds.max[axis]! - bounds.min[axis]!)).join(' × ');
const declared = (loaded: number, expected: number) => loaded === expected ? `${count(loaded)}, as declared` : `${count(loaded)} loaded, ${count(expected)} declared`;
const listed = (items: number, expected: number) => items === expected ? count(items) : `${count(items)} listed, ${count(expected)} declared`;
const GROUPING: Readonly<Record<keyof BrowserManifest['grouping'], string>> = { storeys: 'Storeys', floorSlabMeshes: 'Floor slab meshes',
  authoredRoofMeshes: 'Authored roof meshes', omittedLegacyAtticPhysicalMeshes: 'Omitted legacy attic meshes',
  unplacedStairSemanticNodes: 'Unplaced stair nodes', groundFloorMeshes: 'Ground floor meshes' };

const NO_CHOICES: readonly ElectricalTargetChoice[] = [];

function StandardView({ read, review: options }: { readonly read: Extract<LocalRead, { kind: 'standard' }>; readonly review: LocalModelReviewOptions | undefined }) {
  const { house, reference, manifest, originals } = read;
  const meshes = useMemo(() => reference ? [...house.glb.meshes, ...reference.glb.meshes] : house.glb.meshes, [house, reference]);
  const referenceKeys = useMemo(() => reference ? new Set(reference.glb.meshes.map(mesh => mesh.meshKey)) : null, [reference]);
  // readBrowserManifest refused duplicate or conflicting identities, so no row is overwritten here.
  const index = useMemo(() => navigationIndex(house.glb, manifest?.data), [house, manifest]);
  const navigation = useModelNavigation(index);
  const { selection, setSelection } = navigation;
  const describe = useMemo(() => (meshKey: string) => {
    if (referenceKeys?.has(meshKey)) return 'Reference surface. Not a building element.';
    const at = index.drawnNode.get(meshKey) ?? null;
    return `${at === null ? 'Unnamed part' : nodeLabel(index, at)}. Not linked to a room or floor by name or position.`;
  }, [index, referenceKeys]);
  // The exact chosen objects for this renderer: a manifest-checked house and reference set.
  const rendererFiles = useMemo<RendererFiles | null>(() => originals.house instanceof File && originals.manifest instanceof File
    && originals.reference instanceof File && manifest && reference
    ? Object.freeze({ modelFile: originals.house, manifestFile: originals.manifest, referenceFile: originals.reference }) : null, [originals, manifest, reference]);
  const review = useElectricalReview(rendererFiles, options?.createElectricalBridge, options?.session);
  const choices = options?.electricalTargets ?? NO_CHOICES;
  const electricalSelection = useMemo<ElectricalSelection | null>(() => {
    if (selection?.kind === 'node') { const at = selection.nodeIndex; return { label: nodeLabel(index, at), resolve: bridge => bridge.resolvePickedNode(at) }; }
    const choice = selection?.kind === 'choice' ? choices[selection.at] : undefined;
    return choice ? { label: choice.label, resolve: bridge => bridge.resolveTarget(choice.target) } : null;
  }, [selection, index, choices]);
  const onPick = (meshKey: string | null) => {
    const at = meshKey === null ? null : index.drawnNode.get(meshKey) ?? null;
    setSelection(meshKey !== null && referenceKeys?.has(meshKey) ? { kind: 'reference' } : at === null ? null : { kind: 'node', nodeIndex: at, via: 'pick' });
  };
  const { glb } = house, data = manifest?.data, check = manifest?.check, q = data?.qualifications;
  // Producer unknowns stay visible as unknowns; nothing here resolves them.
  const unknowns = data ? [
    !data.qualifications.atticShapeKnown && 'Attic shape is unknown.',
    !data.qualifications.physicalRegistrationEstablished && 'Physical registration is not established.',
    !data.qualifications.placementAccepted && 'Placement is not accepted.',
    ...data.remainingUncertainty,
  ].filter((item): item is string => typeof item === 'string') : [];
  const selectedNode = selection?.kind === 'node' ? selection.nodeIndex : null;
  return <div className="cifc cifc-preview"><div className="cifc-layout">
    <PreviewStage meshes={meshes} referenceKeys={referenceKeys} describe={describe} subject={reference ? 'local GLB files' : 'local GLB'}
      hiddenKeys={navigation.hiddenKeys} selectedKeys={navigation.selectedKeys} onPick={onPick} />
    <Panel version={data?.version}>
      {selectedNode !== null && <section className="cifc-focus has-room" aria-labelledby="cifc-selected">
        <div className="cifc-focus-head"><h3 id="cifc-selected">{nodeLabel(index, selectedNode)}</h3>
          <button type="button" className="chip-btn" onClick={() => setSelection(null)}>Clear</button></div>
        <SelectionFacts index={index} nodeIndex={selectedNode} hiddenKeys={navigation.hiddenKeys} />
      </section>}
      {selection?.kind === 'reference' && <p className="cifc-notice" role="status">Reference surface. Not a building element.</p>}
      <ElectricalReviewSection review={review} choices={choices} selection={electricalSelection}
        chosen={selection?.kind === 'choice' ? selection.at : null} onChoose={at => setSelection(at === null ? null : { kind: 'choice', at })} />
      <ModelNavigator index={index} navigation={navigation} />
      <section className="cifc-focus" aria-label="Model">
        <dl className="cifc-facts">
          <div><dt>Rooms</dt><dd>{data ? `${count(data.roomOccurrences.length)} occurrences listed; not linked by name or position` : 'Not linked'}</dd></div>
          <div><dt>Floors</dt><dd>Not inferred</dd></div>
          <div><dt>Drawn parts</dt><dd>{count(glb.drawn.length)}, {count(glb.counts.triangles)} triangles</dd></div>
          <div><dt>Scene nodes</dt><dd>{count(glb.nodes.length)}, {count(glb.counts.metadataOnlyNodes)} without geometry</dd></div>
          <div><dt>Transforms</dt><dd>{glb.counts.declaredTransforms === 0 ? 'None declared; positions shown as stored'
            : `${count(glb.counts.declaredTransforms)} glTF node transforms, applied once`}</dd></div>
          <div><dt>House size</dt><dd>{house.bounds ? size(house.bounds) : 'No geometry'}</dd></div>
          <div><dt>Physical alignment</dt><dd>{q?.physicalRegistrationEstablished ? 'Established, declared by producer' : q ? 'Not established' : 'Unknown'}</dd></div>
        </dl>
      </section>

      {data && check && <>
        <section className="cifc-focus is-uncertain" aria-labelledby="cifc-unknowns">
          <h3 id="cifc-unknowns">Unknowns</h3>
          {unknowns.length > 0 ? <ul className="cifc-unknowns">{unknowns.map((item, at) => <li key={at}>{item}</li>)}</ul>
            : <p>The producer lists no remaining uncertainty.</p>}
        </section>
        <section aria-labelledby="cifc-declared">
          <h3 id="cifc-declared" className="cifc-subhead">Checked against the manifest</h3>
          <dl className="cifc-facts">
            <div><dt>Files</dt><dd>House GLB matches its pin{reference ? '; reference GLB matches its pin' : '; reference GLB not chosen'}</dd></div>
            <div><dt>Meshes</dt><dd>{declared(check.meshes.loaded, check.meshes.declared)}</dd></div>
            <div><dt>Triangles</dt><dd>{declared(check.triangles.loaded, check.triangles.declared)}</dd></div>
            <div><dt>Visible bounds</dt><dd>{check.boundsDifference === null ? 'No geometry to compare'
              : check.boundsDifference <= check.boundsTolerance ? 'Match the declared bounds' : `Differ from the declared bounds by up to ${metres(check.boundsDifference)}`}</dd></div>
            <div><dt>Products</dt><dd>{listed(data.products.length, data.house.productNodes)}, {count(check.geometryFreeProducts)} without geometry</dd></div>
            <div><dt>Room occurrences</dt><dd>{listed(data.roomOccurrences.length, data.house.roomOccurrenceNodes)}, {count(check.occurrencesWithFootprint)} with a footprint</dd></div>
            <div><dt>Identities</dt><dd>Unique in the manifest{check.identitiesInExtras > 0 ? `; ${count(check.identitiesInExtras)} also declared by their GLB node` : '; not declared by GLB nodes'}</dd></div>
          </dl>
        </section>
        {data.storeys.length > 0 && <section aria-labelledby="cifc-storeys">
          <h3 id="cifc-storeys" className="cifc-subhead">Storeys</h3>
          <dl className="cifc-facts">{data.storeys.map(storey => <div key={storey.key}><dt>{storey.label}</dt>
            <dd>{storey.measuredFloorElevationKnown ? 'Measured floor elevation known' : 'Floor elevation not measured'}; {storey.physicalRegistrationEstablished ? 'registered' : 'not registered'}
              {storey.visibleMeshes !== null && <span>{count(storey.visibleMeshes)} visible meshes, declared</span>}</dd></div>)}</dl>
        </section>}
        <section aria-labelledby="cifc-reference">
          <h3 id="cifc-reference" className="cifc-subhead">Reference layer</h3>
          <p className="cifc-caveat">{reference ? 'Shown in grey-blue behind the building.' : 'Not chosen. Add the pinned reference GLB to show it.'} Its groups are reference
            observations. They do not certify roof shape or registration.</p>
          <dl className="cifc-facts">
            <div><dt>Role</dt><dd>{data.reference.role}</dd></div>
            {data.reference.groups.map(group => <div key={group.name}><dt>{group.name}</dt><dd>{count(group.meshes)} meshes, declared</dd></div>)}
            <div><dt>Closed solid</dt><dd>{yesNo(data.reference.referenceSolidClosed)}, declared</dd></div>
            {reference && <div><dt>Attribution</dt><dd>{reference.glb.copyright ?? 'None stated in the file'}</dd></div>}
          </dl>
        </section>
        <details className="cifc-source">
          <summary>Producer qualifications</summary>
          <p className="cifc-caveat">As recorded in manifest version {data.version}. Later acceptance is not reflected here.</p>
          <dl className="cifc-facts">
            <div><dt>Derivation</dt><dd>{q!.derivation}</dd></div>
            <div><dt>Attic shape known</dt><dd>{yesNo(q!.atticShapeKnown)}</dd></div>
            <div><dt>Placement accepted</dt><dd>{yesNo(q!.placementAccepted)}</dd></div>
            <div><dt>Registration established</dt><dd>{yesNo(q!.physicalRegistrationEstablished)}</dd></div>
            <div><dt>Roof authored</dt><dd>{yesNo(q!.roofAuthored)}</dd></div>
            <div><dt>Ground floor authored</dt><dd>{yesNo(q!.groundFloorAuthored)}</dd></div>
            <div><dt>Opening cuts applied</dt><dd>{yesNo(q!.openingCutsAlreadyApplied)}</dd></div>
            <div><dt>Scan received</dt><dd>{yesNo(q!.kiriReceived)}</dd></div>
            <div><dt>Native head refreshed</dt><dd>{yesNo(q!.currentNativeHeadRefreshed)}</dd></div>
            <div><dt>Status</dt><dd>{data.status}</dd></div>
            <div><dt>Envelope closed</dt><dd>{yesNo(data.house.wholeHouseRoofedEnvelopeClosed)}, declared</dd></div>
            <div><dt>Product solids closed</dt><dd>{yesNo(data.house.perProductSolidsClosed)}, declared</dd></div>
          </dl>
          <dl className="cifc-facts">{(Object.keys(GROUPING) as (keyof typeof GROUPING)[]).map(key =>
            <div key={key}><dt>{GROUPING[key]}</dt><dd>{count(data.grouping[key])}, declared</dd></div>)}</dl>
        </details>
      </>}

      <details className="cifc-source">
        <summary>Source details</summary>
        <FileFacts files={read.files} />
        <dl className="cifc-facts is-source">
          <div><dt>Frame</dt><dd>glTF metres, Y up. Poses are already applied; no producer matrix is applied again.</dd></div>
          {data && <div><dt>Source IFC</dt><dd>{data.sourceIFC.file}<code>{data.sourceIFC.sha256}</code><span>{count(data.sourceIFC.bytes)} bytes, declared</span></dd></div>}
          {data && <div><dt>Format</dt><dd>Version {data.formatVersion}<span>{data.axes}</span></dd></div>}
          <div><dt>Generator</dt><dd>{glb.generator ?? 'Not stated'}</dd></div>
          {glb.copyright && <div><dt>Attribution</dt><dd>{glb.copyright}</dd></div>}
          <div><dt>Textures</dt><dd>Not decoded; surfaces use preview tones</dd></div>
          {data && data.previewLineage.length > 0 && <div><dt>Lineage</dt><dd>{data.previewLineage.map((step, at) => <span key={at}>{step}</span>)}</dd></div>}
        </dl>
      </details>
    </Panel>
  </div>
  <LocalSourceView store={review.store} />
  </div>;
}
