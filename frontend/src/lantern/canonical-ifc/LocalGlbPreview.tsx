import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { parseIfcGlbProfile, type IfcGlbProfile } from '../scans/ifc-glb-profile';
import { decodeMeshJson } from '../scans/mesh-profile';
import { drawnBounds, makeProjection, pick, prepareMeshes, type DrawRules, type PreparedMesh } from './geometry';
import { MeshLayer } from './MeshLayer';
import { useReducedMotionPreference, useStageCamera } from './useStageCamera';
import './canonical-ifc.css';

/** The closed GLB profile's own byte cap (also enforced by the parser). */
export const LOCAL_GLB_MAX_BYTES = 8 * 1024 * 1024;

export interface LocalGlbSummary {
  readonly sha256: string;
  readonly bytes: number;
  readonly source: IfcGlbProfile['source'];
  readonly counts: IfcGlbProfile['counts'];
  readonly meshes: readonly PreparedMesh[];
}

/** Reads a local GLB in the browser only: no upload, storage, custody or
 * publication. Every mesh is unbound; rooms and floors are never inferred. */
export async function readLocalGlb(file: Blob, signal: AbortSignal): Promise<LocalGlbSummary> {
  if (file.size > LOCAL_GLB_MAX_BYTES) throw new RangeError('size');
  const bytes = new Uint8Array(await file.arrayBuffer()); signal.throwIfAborted();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)); signal.throwIfAborted();
  const profile = await parseIfcGlbProfile(bytes, signal, decodeMeshJson); signal.throwIfAborted();
  const meshes = prepareMeshes(profile.meshes.map((mesh, index) => ({ meshKey: `local#${index}`, floorId: null, occurrenceId: null,
    positions: Float32Array.from(mesh.positionsLocalTokens, Number), indices: Uint32Array.from(mesh.triangleIndicesTokens, Number) })), () => null);
  return { sha256: [...digest].map(byte => byte.toString(16).padStart(2, '0')).join(''), bytes: bytes.byteLength,
    source: profile.source, counts: profile.counts, meshes };
}

type Phase = { readonly file: Blob; readonly status: 'reading' } | { readonly file: Blob; readonly status: 'ready'; readonly summary: LocalGlbSummary }
  | { readonly file: Blob; readonly status: 'failed'; readonly message: string };
const RULES: DrawRules = { visibleFloors: 'all', clipY: null };
const NO_CONTEXT: readonly string[] = [], NO_TINTS: ReadonlyMap<string, string> = new Map();

export function LocalGlbPreview({ file }: { readonly file: Blob | null }) {
  const [phase, setPhase] = useState<Phase | null>(null);
  useEffect(() => {
    if (!file) return;
    const controller = new AbortController();
    setPhase({ file, status: 'reading' });
    readLocalGlb(file, controller.signal).then(summary => { if (!controller.signal.aborted) setPhase({ file, status: 'ready', summary }); },
      error => { if (!controller.signal.aborted) setPhase({ file, status: 'failed', message: error instanceof RangeError
        ? 'Files over 8 MiB are not supported.' : 'This file is not a supported HouseAtlas IFC-derived GLB.' }); });
    return () => controller.abort();
  }, [file]);
  const current = phase?.file === file ? phase : null;
  if (!file) return null;
  if (!current || current.status !== 'ready') return <div className="cifc cifc-unavailable" role="status" aria-busy={!current || current.status === 'reading'}>
    <h2>Local preview</h2><p>{current?.status === 'failed' ? current.message : 'Reading file…'}</p></div>;
  return <PreviewView summary={current.summary} />;
}

function PreviewView({ summary }: { readonly summary: LocalGlbSummary }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<'3d' | 'top'>('3d');
  const [failure, setFailure] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const reduced = useReducedMotionPreference();
  const bounds = useMemo(() => drawnBounds(summary.meshes, [], null), [summary]);
  const camera = useStageCamera({ element: viewport, top: view === 'top', reduced,
    onTap: (px, py) => { if (projection) setHint(pick(summary.meshes, projection, RULES, px, py).kind === 'none' ? null : 'Room associations unavailable'); } });
  const projection = useMemo(() => bounds ? makeProjection(camera.eased, bounds, camera.size, camera.planBlend) : null, [bounds, camera.eased, camera.size, camera.planBlend]);
  const { source, counts } = summary;
  return <div className="cifc cifc-preview"><div className="cifc-layout">
    <div className="cifc-stage">
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
        aria-label={`${view === 'top' ? 'Top view' : '3D'} of local GLB. Arrow keys ${view === 'top' ? 'pan' : 'turn'}, plus and minus zoom.`} {...camera.bind}>
        {projection && !failure && <div className="cifc-canvas-wrap">
          <MeshLayer meshes={summary.meshes} projection={projection} rules={RULES} currentFloorId={null} selectedOccurrenceId={null}
            contextOccurrenceIds={NO_CONTEXT} tints={NO_TINTS} hidden={false} onUnavailable={setFailure} />
        </div>}
        {!bounds && <p className="cifc-stage-note" role="status">This file has no drawable geometry.</p>}
        {failure && <p className="cifc-stage-note" role="status">{failure}</p>}
        <p className="cifc-hint" role="status" aria-live="polite">{hint}</p>
      </div>
      <div className="cifc-stage-foot"><div className="cifc-status"><span className="cifc-chip is-local">Local preview</span></div></div>
    </div>
    <aside className="cifc-panel" aria-label="Local file facts">
      <header className="cifc-panel-head"><h2>Local preview</h2><p className="cifc-pub">Read in this browser only. Not a publication.</p></header>
      <section className="cifc-focus" aria-label="Associations">
        <dl className="cifc-facts">
          <div><dt>Rooms</dt><dd>Unavailable</dd></div>
          <div><dt>Floors</dt><dd>Unavailable</dd></div>
          <div><dt>Meshes</dt><dd>{counts.meshes.toLocaleString('en')}, all unbound</dd></div>
          <div><dt>Triangles</dt><dd>{counts.triangles.toLocaleString('en')}</dd></div>
        </dl>
      </section>
      <dl className="cifc-facts is-source">
        <div><dt>File SHA-256</dt><dd><code>{summary.sha256}</code><span>{summary.bytes.toLocaleString('en')} bytes</span></dd></div>
        <div><dt>Source IFC</dt><dd><code>{source.originalSHA256}</code><span>{source.originalBytes.toString()} bytes, declared</span></dd></div>
        <div><dt>Converter</dt><dd>{source.converter.name} {source.converter.version}, declared<code>{source.converter.configSha256}</code></dd></div>
        <div><dt>Source units</dt><dd>{source.sourceUnits} (converter declaration)</dd></div>
        <div><dt>Source up axis</dt><dd>{source.sourceUpAxis} (converter declaration)</dd></div>
        <div><dt>GLB frame</dt><dd>{source.glbUnits === 'm' ? 'Metres' : source.glbUnits}, {source.glbUpAxis} up (declared)</dd></div>
        <div><dt>Axis map</dt><dd>{source.sourceToGlb.axisMap.join(', ')}; scale {source.sourceToGlb.scale} (declared)</dd></div>
        <div><dt>Physical alignment</dt><dd>Unknown</dd></div>
        <div><dt>Vertices</dt><dd>{counts.vertices.toLocaleString('en')}</dd></div>
      </dl>
    </aside>
  </div></div>;
}
