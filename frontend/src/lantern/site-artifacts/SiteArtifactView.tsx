import { useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { Icon } from '../components/Icon';
import { useEased } from '../atlas/useCamera';
import { drawnBounds, makeProjection, pick, type Bounds, type DrawRules, type PreparedMesh } from '../canonical-ifc/geometry';
import { MeshLayer } from '../canonical-ifc/MeshLayer';
import { useReducedMotionPreference, useStageCamera } from '../canonical-ifc/useStageCamera';
import { stageMark } from '../observability/stage-timing';
import { REFERENCE_ENVELOPE_KIND, type PlanShape } from './publication';
import type { SiteGroup, SitePublication, SiteSourcePort } from './types';
import { useSitePublication, type SiteAssetOutcome } from './useSitePublication';
import '../canonical-ifc/canonical-ifc.css';
import './site-artifacts.css';

const RULES: DrawRules = { visibleFloors: 'all', clipY: null };
const NO_CONTEXT: readonly string[] = [], NO_TINTS: ReadonlyMap<string, string> = new Map();
const count = (value: number) => value.toLocaleString('en');
const exact = (value: number) => value.toLocaleString('en', { maximumFractionDigits: 20, useGrouping: false });

/** Whole-site artifact consumer. Generated assets are drawn exactly as stored
 * in the declared renderer frame; nothing is synthesized, fitted or posed. The
 * native Home atlas is unchanged and stays a separate view. */
export function SiteArtifactView({ port }: { readonly port: SiteSourcePort }) {
  const stage = useRef<HTMLDivElement>(null);
  const state = useSitePublication(port, stage);
  if (state.status === 'loading') return <div className="cifc cifc-unavailable" role="status" aria-busy="true"><h2>Site</h2><p>Reading the site publication…</p></div>;
  if (state.status === 'invalidated') return <div className="cifc cifc-unavailable" role="status"><h2>Site cleared</h2>
    <p>{state.reason} Nothing from it is shown, and no other version is substituted.</p></div>;
  if (state.status === 'failed') return <div className="cifc cifc-unavailable" role="status"><h2>Site unavailable</h2><p>{state.message}</p></div>;
  // Keyed by the pin: a fast read can commit a new publication without an
  // intervening loading render, and its visibility defaults, selection and
  // entry must start from that publication, never the previous one.
  return <SiteScene key={JSON.stringify([state.publication.pin.publicationId, state.publication.pin.version])}
    stage={stage} publication={state.publication} assets={state.assets} />;
}

interface SceneIndex {
  readonly meshes: readonly PreparedMesh[];
  readonly referenceKeys: ReadonlySet<string>;
  /** Resolved groups bound to the reference envelope asset. */
  readonly referenceGroups: readonly string[];
  /** groupId -> exact drawn mesh keys, or a reason the binding did not resolve. */
  readonly groupKeys: ReadonlyMap<string, readonly string[]>;
  readonly unresolved: ReadonlyMap<string, string>;
  readonly groupsOf: ReadonlyMap<string, readonly string[]>;
  readonly ungrouped: readonly string[];
  readonly plans: readonly { readonly assetId: string; readonly shapes: readonly PlanShape[]; readonly skipped: number }[];
}

/** Joins groups to drawn primitives by exact node and mesh index only. */
function sceneIndex(publication: SitePublication, assets: readonly SiteAssetOutcome[]): SceneIndex {
  const meshes: PreparedMesh[] = [], referenceKeys = new Set<string>(), groupKeys = new Map<string, string[]>(), unresolved = new Map<string, string>();
  const groupsOf = new Map<string, string[]>();
  const drawn = new Map(assets.flatMap(outcome => outcome.status === 'drawn' ? [[outcome.asset.assetId, outcome] as const] : []));
  for (const outcome of drawn.values()) {
    meshes.push(...outcome.glb.meshes);
    if (outcome.asset.kind === REFERENCE_ENVELOPE_KIND) for (const mesh of outcome.glb.meshes) referenceKeys.add(mesh.meshKey);
  }
  for (const group of publication.groups) {
    const outcome = drawn.get(group.assetId);
    if (!outcome) { unresolved.set(group.groupId, 'Its asset is not drawn'); continue; }
    const nodes = new Map(outcome.glb.nodes.map(node => [node.nodeIndex, node]));
    const meshSet = new Set(group.meshIndices);
    const missing = group.nodeIndices.find(index => !nodes.has(index));
    const mismatch = group.nodeIndices.find(index => { const mesh = nodes.get(index)?.meshIndex; return mesh !== null && mesh !== undefined && !meshSet.has(mesh); });
    if (missing !== undefined) { unresolved.set(group.groupId, `Node ${missing} is not in the asset scene`); continue; }
    if (mismatch !== undefined) { unresolved.set(group.groupId, `Node ${mismatch} draws a mesh the group does not list`); continue; }
    const nodeSet = new Set(group.nodeIndices);
    const keys = outcome.glb.drawn.filter(item => item.nodeIndex !== null && nodeSet.has(item.nodeIndex) && item.meshIndex !== null && meshSet.has(item.meshIndex))
      .map(item => item.meshKey);
    groupKeys.set(group.groupId, keys);
    for (const key of keys) groupsOf.set(key, [...groupsOf.get(key) ?? [], group.groupId]);
  }
  const referenceGroups = publication.groups.filter(group => groupKeys.has(group.groupId) && drawn.get(group.assetId)?.asset.kind === REFERENCE_ENVELOPE_KIND)
    .map(group => group.groupId);
  const ungrouped = meshes.filter(mesh => !groupsOf.has(mesh.meshKey) && !referenceKeys.has(mesh.meshKey)).map(mesh => mesh.meshKey);
  const plans = assets.flatMap(outcome => outcome.status === 'plan' ? [{ assetId: outcome.asset.assetId, ...outcome.plan }] : []);
  return { meshes, referenceKeys, referenceGroups, groupKeys, unresolved, groupsOf, ungrouped, plans };
}

type Selection = { readonly kind: 'group'; readonly groupId: string } | { readonly kind: 'part'; readonly meshKey: string } | null;

function SiteScene({ stage, publication, assets }: { readonly stage: RefObject<HTMLDivElement | null>; readonly publication: SitePublication; readonly assets: readonly SiteAssetOutcome[] }) {
  const index = useMemo(() => sceneIndex(publication, assets), [publication, assets]);
  const groupsById = useMemo(() => new Map(publication.groups.map(group => [group.groupId, group])), [publication]);
  // Hidden by default when the group or its feature says so; presentation only.
  const [hiddenGroups, setHiddenGroups] = useState<ReadonlySet<string>>(() => new Set([
    ...publication.groups.filter(group => !group.defaultVisible).map(group => group.groupId),
    ...publication.features.filter(feature => !feature.defaultVisible3D).flatMap(feature => feature.groupIds)]));
  const [hidePlan, setHidePlan] = useState<ReadonlySet<string>>(() => new Set(publication.features.filter(feature => !feature.defaultVisible2D).map(feature => feature.sourceFeatureId)));
  const [showUngrouped, setShowUngrouped] = useState(true);
  // Reference parts in no declared group; grouped reference parts follow their groups.
  const [showReferenceUngrouped, setShowReferenceUngrouped] = useState(true);
  const [selection, setSelection] = useState<Selection>(null);
  const [entry, setEntry] = useState<string | null>(null);
  // One effective visibility: declared group and feature defaults apply to the
  // reference envelope too, and the layer control reads and sets the same state.
  const hiddenKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const mesh of index.meshes) {
      const groups = index.groupsOf.get(mesh.meshKey);
      if (groups ? groups.every(id => hiddenGroups.has(id)) : !(index.referenceKeys.has(mesh.meshKey) ? showReferenceUngrouped : showUngrouped)) keys.add(mesh.meshKey);
    }
    return keys;
  }, [index, hiddenGroups, showUngrouped, showReferenceUngrouped]);
  const showReference = [...index.referenceKeys].some(key => !hiddenKeys.has(key));
  const setShowReference = (show: boolean) => { toggleGroups(index.referenceGroups, show); setShowReferenceUngrouped(show); };
  const selectedKeys = useMemo(() => new Set(selection?.kind === 'group' ? index.groupKeys.get(selection.groupId) ?? []
    : selection?.kind === 'part' ? [selection.meshKey] : []), [index, selection]);
  const toggleGroups = (ids: readonly string[], show: boolean) => setHiddenGroups(value => {
    const next = new Set(value); for (const id of ids) { if (show) next.delete(id); else next.add(id); } return next;
  });
  const enter = (groupId: string | null) => { stageMark('site', groupId === null ? 'overview' : 'building-entry'); setEntry(groupId); };
  const entryGroup = entry === null ? null : groupsById.get(entry) ?? null;
  const drawable = useMemo(() => publication.groups.filter(group => (index.groupKeys.get(group.groupId)?.length ?? 0) > 0), [publication, index]);
  return <div className="cifc site-artifact"><div className="cifc-layout">
    <SiteStage stage={stage} index={index} hiddenKeys={hiddenKeys} selectedKeys={selectedKeys}
      focusKeys={entry === null ? null : index.groupKeys.get(entry) ?? null} focusLabel={entryGroup ? groupName(publication, entryGroup) : null}
      onReturn={() => enter(null)} showReference={showReference} onReference={setShowReference}
      onPick={meshKey => setSelection(meshKey === null ? null : { kind: 'part', meshKey })}
      describe={meshKey => index.referenceKeys.has(meshKey) ? 'Official reference envelope. Not a second building.'
        : index.groupsOf.has(meshKey) ? `${index.groupsOf.get(meshKey)!.map(id => groupName(publication, groupsById.get(id)!)).join(', ')}` : 'Part in no declared group'} />
    <aside className="cifc-panel" aria-label="Site publication">
      <header className="cifc-panel-head"><h2>Site</h2>
        <p className="cifc-pub">Version {publication.pin.version}. {publication.kind === 'authorized-private-preview' ? 'Authorized private preview. ' : ''}
          Not a native publication.</p></header>
      {selection && <section className="cifc-focus has-room" aria-labelledby="site-selected">
        <div className="cifc-focus-head"><h3 id="site-selected">{selection.kind === 'group' ? groupName(publication, groupsById.get(selection.groupId)!)
          : index.referenceKeys.has(selection.meshKey) ? 'Reference envelope' : 'Picked part'}</h3>
          <button type="button" className="chip-btn" onClick={() => setSelection(null)}>Clear</button></div>
        {selection.kind === 'group' ? <GroupFacts group={groupsById.get(selection.groupId)!} drawn={index.groupKeys.get(selection.groupId)?.length ?? 0} />
          : <dl className="cifc-facts">
            <div><dt>Groups</dt><dd>{index.referenceKeys.has(selection.meshKey) ? 'Reference layer only'
              : (index.groupsOf.get(selection.meshKey) ?? []).map(id => groupName(publication, groupsById.get(id)!)).join(', ') || 'None declared'}</dd></div>
          </dl>}
      </section>}
      {drawable.length > 0 && <section className="cifc-nav" aria-labelledby="site-go">
        <h3 id="site-go" className="cifc-subhead">Go to</h3>
        <div className="cifc-toggles" role="group" aria-label="Camera">
          <button type="button" className="chip-btn" aria-pressed={entry === null} onClick={() => enter(null)}>Whole site</button>
          {drawable.map(group => <button key={group.groupId} type="button" className="chip-btn" aria-pressed={entry === group.groupId}
            onClick={() => { enter(group.groupId); setSelection({ kind: 'group', groupId: group.groupId }); }}>{groupName(publication, group)}</button>)}
        </div>
      </section>}
      <section className="cifc-nav" aria-labelledby="site-show">
        <h3 id="site-show" className="cifc-subhead">Show</h3>
        <div className="cifc-toggles" role="group" aria-label="Source groups">
          {publication.groups.map(group => {
            const reason = index.unresolved.get(group.groupId);
            return <button key={group.groupId} type="button" className="chip-btn" disabled={reason !== undefined} title={reason}
              aria-pressed={reason === undefined && !hiddenGroups.has(group.groupId)} onClick={() => toggleGroups([group.groupId], hiddenGroups.has(group.groupId))}>
              {groupName(publication, group)}{reason ? ' (not drawn)' : ''}</button>;
          })}
          {index.ungrouped.length > 0 && <button type="button" className="chip-btn" aria-pressed={showUngrouped} onClick={() => setShowUngrouped(value => !value)}>
            Parts in no declared group</button>}
        </div>
      </section>
      <FeatureList publication={publication} hiddenGroups={hiddenGroups} hidePlan={hidePlan} onGroups={toggleGroups}
        onPlan={(id, show) => setHidePlan(value => { const next = new Set(value); if (show) next.delete(id); else next.add(id); return next; })} />
      <FrameFacts publication={publication} />
      <AssetFacts assets={assets} unresolved={index.unresolved} publication={publication} />
    </aside>
  </div>
  {index.plans.length > 0 && <SitePlanView plans={index.plans} hidden={hidePlan} publication={publication} />}
  </div>;
}

const groupName = (publication: SitePublication, group: SiteGroup) => {
  const feature = group.sourceFeatureId === null ? undefined : publication.features.find(item => item.sourceFeatureId === group.sourceFeatureId);
  const base = feature?.displayName ?? group.groupId;
  return group.sourceStoreyLabel ? `${base}, ${group.sourceStoreyLabel}` : base;
};

function GroupFacts({ group, drawn }: { readonly group: SiteGroup; readonly drawn: number }) {
  return <dl className="cifc-facts">
    <div><dt>Group</dt><dd><code>{group.groupId}</code></dd></div>
    {group.sourceGlobalId && <div><dt>GlobalId</dt><dd><code>{group.sourceGlobalId}</code></dd></div>}
    {group.sourceStoreyLabel && <div><dt>Storey</dt><dd>{group.sourceStoreyLabel}, as supplied</dd></div>}
    <div><dt>Binding</dt><dd>{count(group.nodeIndices.length)} nodes, {count(group.meshIndices.length)} meshes<span>{count(drawn)} drawn parts</span></dd></div>
    <div><dt>Coverage</dt><dd>{group.coverage}</dd></div>
  </dl>;
}

function FeatureList({ publication, hiddenGroups, hidePlan, onGroups, onPlan }: {
  readonly publication: SitePublication; readonly hiddenGroups: ReadonlySet<string>; readonly hidePlan: ReadonlySet<string>;
  readonly onGroups: (ids: readonly string[], show: boolean) => void; readonly onPlan: (id: string, show: boolean) => void;
}) {
  if (publication.features.length === 0) return null;
  return <section aria-labelledby="site-features">
    <h3 id="site-features" className="cifc-subhead">Source features <span className="cifc-count">{count(publication.features.length)}</span></h3>
    <ul className="site-features">{publication.features.map(feature => {
      const shown3D = feature.groupIds.length > 0 && feature.groupIds.some(id => !hiddenGroups.has(id));
      return <li key={feature.sourceFeatureId}>
        <div className="site-feature-head"><strong>{feature.displayName}</strong>
          <span className="cifc-room-id">{feature.sourceFeatureId}</span></div>
        <p>{feature.coverage.mode}{feature.coverage.reason ? `. ${feature.coverage.reason}` : ''}. {feature.sourceGeometryDimensions}D source,
          elevation {feature.sourceGeometryElevation === null ? 'unknown' : `${exact(feature.sourceGeometryElevation)} ${publication.siteFrame.unit}`}.</p>
        <div className="cifc-toggles" role="group" aria-label={`${feature.displayName} visibility`}>
          <button type="button" className="chip-btn" aria-pressed={!hidePlan.has(feature.sourceFeatureId)} onClick={() => onPlan(feature.sourceFeatureId, hidePlan.has(feature.sourceFeatureId))}>Plan</button>
          {feature.groupIds.length > 0 ? <button type="button" className="chip-btn" aria-pressed={shown3D} onClick={() => onGroups(feature.groupIds, !shown3D)}>3D</button>
            : <span className="site-feature-note">No 3D group</span>}
        </div>
      </li>;
    })}</ul>
  </section>;
}

function FrameFacts({ publication }: { readonly publication: SitePublication }) {
  const { siteFrame: frame, canonicalHouse: house, native } = publication;
  return <details className="cifc-source">
    <summary>Frame and status</summary>
    <dl className="cifc-facts is-source">
      <div><dt>Horizontal CRS</dt><dd>{frame.horizontalCRS}, as declared</dd></div>
      <div><dt>Vertical datum</dt><dd>{frame.verticalDatum}, as declared</dd></div>
      <div><dt>Unit</dt><dd>{frame.unit}</dd></div>
      <div><dt>Source origin</dt><dd><code>{frame.originSource.map(exact).join(', ')}</code><span>Declared; plans subtract it, assets already use it</span></dd></div>
      <div><dt>Modeling axes</dt><dd>{frame.modelingAxes.join(', ')}</dd></div>
      <div><dt>Renderer axes</dt><dd>{frame.rendererAxes.join(', ')}</dd></div>
      <div><dt>Artifacts</dt><dd>{publication.artifactAvailability}</dd></div>
      <div><dt>Native publication</dt><dd>{native.sitePublicationId ? <code>{native.sitePublicationId}</code> : 'None'}<span>{native.availability}</span></dd></div>
      <div><dt>Canonical house</dt><dd>{house.status}{house.groupIds.length > 0 ? `; ${count(house.groupIds.length)} groups` : ''}
        <span>{house.qualifiedMatrixDeclared ? 'A placement matrix is declared and not applied here' : 'No qualified placement'}
          {house.provisionalPoseDeclared ? '; a provisional visual pose is declared, not a survey' : ''}</span></dd></div>
    </dl>
  </details>;
}

function AssetFacts({ assets, unresolved, publication }: { readonly assets: readonly SiteAssetOutcome[]; readonly unresolved: ReadonlyMap<string, string>; readonly publication: SitePublication }) {
  const STATUS = { drawn: 'Drawn as stored', plan: 'Source plan, 2D only', 'not-drawn': 'Not drawn', unavailable: 'Unavailable' } as const;
  return <details className="cifc-source">
    <summary>Assets <span className="cifc-count">{count(assets.length)}</span></summary>
    <dl className="cifc-facts is-source">{assets.map(outcome => <div key={outcome.asset.assetId}>
      <dt>{outcome.asset.kind}</dt>
      <dd>{STATUS[outcome.status]}{'reason' in outcome ? `. ${outcome.reason}.` : ''}
        <code>{outcome.asset.sha256}</code><span>{count(outcome.asset.bytes)} bytes, {outcome.asset.contentType}</span>
        {outcome.status === 'drawn' && outcome.glb.copyright && <span>{outcome.glb.copyright}</span>}
        {outcome.status === 'plan' && outcome.plan.skipped > 0 && <span>{count(outcome.plan.skipped)} features without a supported geometry</span>}</dd>
    </div>)}
    {[...unresolved].map(([groupId, reason]) => <div key={groupId}><dt>Group {groupsLabel(publication, groupId)}</dt><dd>Not drawn. {reason}.</dd></div>)}
    </dl>
  </details>;
}
const groupsLabel = (publication: SitePublication, groupId: string) => {
  const group = publication.groups.find(item => item.groupId === groupId);
  return group ? groupName(publication, group) : groupId;
};

interface StageProps {
  readonly stage: RefObject<HTMLDivElement | null>;
  readonly index: SceneIndex;
  readonly hiddenKeys: ReadonlySet<string>;
  readonly selectedKeys: ReadonlySet<string>;
  readonly focusKeys: readonly string[] | null;
  readonly focusLabel: string | null;
  readonly onReturn: () => void;
  readonly showReference: boolean;
  readonly onReference: (show: boolean) => void;
  readonly onPick: (meshKey: string | null) => void;
  readonly describe: (meshKey: string) => string;
}

const boundsVector = (bounds: Bounds) => ({ x0: bounds.min[0], y0: bounds.min[1], z0: bounds.min[2], x1: bounds.max[0], y1: bounds.max[1], z1: bounds.max[2] });

/** Overview and building entry ease the framed bounds; any new choice
 * retargets the motion, so entry and return are always interruptible. */
function SiteStage({ stage, index, hiddenKeys, selectedKeys, focusKeys, focusLabel, onReturn, showReference, onReference, onPick, describe }: StageProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<'3d' | 'top'>('3d');
  const [failure, setFailure] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const reduced = useReducedMotionPreference();
  const visible = useMemo(() => index.meshes.filter(mesh => !hiddenKeys.has(mesh.meshKey)), [index, hiddenKeys]);
  const overview = useMemo(() => drawnBounds(visible, [], null), [visible]);
  const focus = useMemo(() => { if (!focusKeys) return null; const keys = new Set(focusKeys); return drawnBounds(index.meshes.filter(mesh => keys.has(mesh.meshKey)), [], null); }, [index, focusKeys]);
  const target = focus ?? overview;
  const eased = useEased(target ? boundsVector(target) : { x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1 }, { reduced, tau: 180 });
  const bounds: Bounds | null = target ? { min: [eased.x0, eased.y0, eased.z0], max: [eased.x1, eased.y1, eased.z1] } : null;
  const camera = useStageCamera({ element: viewport, top: view === 'top', reduced, ...(focusKeys ? { onEscape: onReturn } : {}),
    onTap: (px, py) => {
      if (!projection) return;
      const hit = pick(visible, projection, RULES, px, py), meshKey = hit.kind === 'none' ? null : hit.meshKey;
      stageMark('site', 'pick', { hit: meshKey !== null, input: 'pointer' });
      setHint(meshKey === null ? null : describe(meshKey)); onPick(meshKey);
    } });
  const projection = bounds ? makeProjection(camera.eased, bounds, camera.size, camera.planBlend) : null;
  return <div ref={stage} className="cifc-stage">
    <div className="cifc-stage-head">
      <div className="cifc-view-ctrl">
        <div className="seg" role="group" aria-label="Site view">
          <button type="button" aria-pressed={view === '3d'} onClick={() => setView('3d')}>3D</button>
          <button type="button" aria-pressed={view === 'top'} onClick={() => setView('top')}>Top view</button>
        </div>
        <div className="ctrl-group" role="group" aria-label="Camera">
          {view === '3d' && <>
            <button type="button" className="ctrl-btn" aria-label="Turn site left" onClick={() => camera.turn(-45)}><Icon name="rotl" size={17} /></button>
            <button type="button" className="ctrl-btn" aria-label="Turn site right" onClick={() => camera.turn(45)}><Icon name="rotr" size={17} /></button>
          </>}
          <button type="button" className="ctrl-btn" aria-label="Zoom in" disabled={camera.zoom >= camera.zoomLimits.max} onClick={() => camera.zoomBy(1.3)}><Icon name="plus" size={17} /></button>
          <button type="button" className="ctrl-btn" aria-label="Zoom out" disabled={camera.zoom <= camera.zoomLimits.min} onClick={() => camera.zoomBy(1 / 1.3)}><Icon name="minus" size={17} /></button>
          <button type="button" className="ctrl-btn" aria-label="Fit" title="Fit" onClick={camera.fit}><Icon name="fit" size={17} /></button>
        </div>
      </div>
      {focusLabel && <button type="button" className="chip-btn site-return" onClick={onReturn}>Back to whole site</button>}
    </div>
    <div ref={viewport} className={`cifc-viewport${camera.dragging ? ' is-dragging' : ''}`} tabIndex={0} role="group"
      aria-label={`${view === 'top' ? 'Top view' : '3D'} of ${focusLabel ?? 'the whole site'}. Drag or arrow keys ${view === 'top' ? 'pan' : 'turn'}, plus and minus zoom, 0 fits${focusLabel ? ', Escape returns to the whole site' : ''}.`} {...camera.bind}>
      {projection && !failure && <div className="cifc-canvas-wrap">
        <MeshLayer meshes={index.meshes} projection={projection} rules={RULES} currentFloorId={null} selectedOccurrenceId={null}
          contextOccurrenceIds={NO_CONTEXT} tints={NO_TINTS} hidden={false} referenceKeys={index.referenceKeys}
          hiddenKeys={hiddenKeys} selectedKeys={selectedKeys} onUnavailable={setFailure} />
      </div>}
      {!overview && <p className="cifc-stage-note" role="status">{index.meshes.length > 0 ? 'Everything is hidden. Turn a group back on.' : 'No generated 3D asset is drawn for this publication.'}</p>}
      {failure && <p className="cifc-stage-note" role="status">{failure}</p>}
      <p className="cifc-hint" role="status" aria-live="polite">{hint}</p>
    </div>
    <div className="cifc-stage-foot">
      <div className="cifc-status"><span className="cifc-chip is-local">Generated site export</span></div>
      {index.referenceKeys.size > 0 && <div className="layer-bar" role="group" aria-label="Layers">
        <button type="button" className="layer-chip" aria-pressed={showReference} style={{ '--layer': '#6F8796' } as CSSProperties}
          onClick={() => { onReference(!showReference); setHint(null); }}><span className="layer-swatch" aria-hidden="true" />Reference envelope</button>
      </div>}
    </div>
  </div>;
}

/** Source plans in 2D only: east right, north up, origin subtracted. Never extruded. */
function SitePlanView({ plans, hidden, publication }: { readonly plans: SceneIndex['plans']; readonly hidden: ReadonlySet<string>; readonly publication: SitePublication }) {
  const shown = plans.flatMap(plan => plan.shapes.filter(shape => shape.featureId === null || !hidden.has(shape.featureId)));
  const extent = useMemo(() => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const plan of plans) for (const shape of plan.shapes) for (const path of shape.paths) for (const [x, y] of path) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    return Number.isFinite(x0) ? { x0, y0, w: Math.max(x1 - x0, 1e-6), h: Math.max(y1 - y0, 1e-6) } : null;
  }, [plans]);
  const declared = new Set(publication.features.map(feature => feature.sourceFeatureId));
  const undeclared = plans.reduce((sum, plan) => sum + plan.shapes.filter(shape => shape.featureId === null || !declared.has(shape.featureId)).length, 0);
  if (!extent) return null;
  const pad = Math.max(extent.w, extent.h) * .04;
  const d = (shape: PlanShape) => shape.paths.map(path => path.map(([x, y], at) => `${at === 0 ? 'M' : 'L'}${(x - extent.x0).toFixed(3)} ${(extent.h - (y - extent.y0)).toFixed(3)}`).join('')
    + (shape.kind === 'area' ? 'Z' : '')).join('');
  return <section className="site-plan" aria-labelledby="site-plan-title">
    <h3 id="site-plan-title" className="cifc-subhead">Source plan</h3>
    <p className="cifc-caveat">2D source geometry. Not extruded and not aligned to the 3D view.{undeclared > 0 ? ` ${count(undeclared)} shapes name no declared feature.` : ''}</p>
    <svg role="img" aria-label="Source plan, east to the right and north up" viewBox={`${-pad} ${-pad} ${extent.w + pad * 2} ${extent.h + pad * 2}`} preserveAspectRatio="xMidYMid meet">
      {shown.map((shape, at) => shape.kind === 'point'
        ? shape.paths.map((path, k) => <circle key={`${at}-${k}`} className="site-plan-point" cx={path[0]![0] - extent.x0} cy={extent.h - (path[0]![1] - extent.y0)} r={Math.max(extent.w, extent.h) * .006} />)
        : <path key={at} className={`site-plan-${shape.kind}`} d={d(shape)} fillRule="evenodd" vectorEffect="non-scaling-stroke" />)}
    </svg>
  </section>;
}
