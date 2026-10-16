import { useMemo, useState } from 'react';
import type { BrowserManifest } from './browser-manifest';
import type { StandardGlb } from './standard-glb';

type Product = BrowserManifest['products'][number];

/** A deliberate selection. Node selections carry the actual loader node index. */
export type NavSelection =
  | { readonly kind: 'node'; readonly nodeIndex: number; readonly via: 'pick' | 'list' }
  | { readonly kind: 'choice'; readonly at: number }
  | { readonly kind: 'reference' };

export interface StoreyGroup { readonly key: string; readonly label: string; readonly declared: boolean; readonly products: readonly Product[] }

/** Joins drawn meshes to manifest rows by the loader's node association only. */
export function navigationIndex(glb: StandardGlb, data: BrowserManifest | undefined) {
  const drawnNode = new Map(glb.drawn.map(item => [item.meshKey, item.nodeIndex]));
  const meshesByNode = new Map<number, string[]>();
  for (const item of glb.drawn) if (item.nodeIndex !== null) meshesByNode.set(item.nodeIndex, [...meshesByNode.get(item.nodeIndex) ?? [], item.meshKey]);
  const products = new Map((data?.products ?? []).map(product => [product.nodeIndex, product]));
  const occurrences = new Map((data?.roomOccurrences ?? []).map(occurrence => [occurrence.nodeIndex, occurrence]));
  const names = new Map(glb.nodes.map(node => [node.nodeIndex, node.name]));
  // Storeys exactly as declared; an undeclared key stays visible as its raw value.
  const declared = new Map((data?.storeys ?? []).map(storey => [storey.key, storey.label]));
  const groups = new Map<string, Product[]>();
  for (const product of data?.products ?? []) groups.set(product.storey, [...groups.get(product.storey) ?? [], product]);
  const storeys: StoreyGroup[] = [
    ...(data?.storeys ?? []).map(storey => ({ key: storey.key, label: storey.label, declared: true, products: groups.get(storey.key) ?? [] })),
    ...[...groups].filter(([key]) => !declared.has(key)).map(([key, products]) => ({ key, label: key, declared: false, products })),
  ];
  const classes = new Map<string, number>();
  for (const product of data?.products ?? []) classes.set(product.ifcClass, (classes.get(product.ifcClass) ?? 0) + 1);
  const unlisted = glb.drawn.filter(item => item.nodeIndex === null || !products.has(item.nodeIndex)).map(item => item.meshKey);
  return { drawnNode, meshesByNode, products, occurrences, storeys, unlisted, names, declared,
    classes: [...classes].sort(([a], [b]) => a.localeCompare(b)).map(([ifcClass, count]) => ({ ifcClass, count })) };
}
export type NavigationIndex = ReturnType<typeof navigationIndex>;

export interface Visibility { readonly storeys: ReadonlySet<string>; readonly classes: ReadonlySet<string>; readonly unlisted: boolean }
const ALL_VISIBLE: Visibility = { storeys: new Set(), classes: new Set(), unlisted: false };
const toggled = (set: ReadonlySet<string>, key: string) => { const next = new Set(set); if (!next.delete(key)) next.add(key); return next; };

export function useModelNavigation(index: NavigationIndex) {
  const [hidden, setHidden] = useState<Visibility>(ALL_VISIBLE);
  const [selection, setSelection] = useState<NavSelection | null>(null);
  const hiddenKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const [meshKey, nodeIndex] of index.drawnNode) {
      const product = nodeIndex === null ? undefined : index.products.get(nodeIndex);
      if (product ? hidden.storeys.has(product.storey) || hidden.classes.has(product.ifcClass) : hidden.unlisted) keys.add(meshKey);
    }
    return keys;
  }, [index, hidden]);
  const selectedKeys = useMemo(() => new Set(selection?.kind === 'node' ? index.meshesByNode.get(selection.nodeIndex) ?? [] : []), [index, selection]);
  return { hidden, hiddenKeys, selectedKeys, selection, setSelection,
    toggleStorey: (key: string) => setHidden(value => ({ ...value, storeys: toggled(value.storeys, key) })),
    toggleClass: (key: string) => setHidden(value => ({ ...value, classes: toggled(value.classes, key) })),
    toggleUnlisted: () => setHidden(value => ({ ...value, unlisted: !value.unlisted })) };
}
export type ModelNavigation = ReturnType<typeof useModelNavigation>;

const count = (value: number) => value.toLocaleString('en');

/** Label for a node selection from declared manifest rows and the node's own name. */
export function nodeLabel(index: NavigationIndex, nodeIndex: number) {
  const product = index.products.get(nodeIndex), occurrence = index.occurrences.get(nodeIndex), name = index.names.get(nodeIndex);
  if (product) return `${product.ifcClass} ${product.globalId}`;
  if (occurrence) return name ? `${name}, room occurrence` : `Room occurrence ${occurrence.globalId}`;
  return name ? `${name} (node ${nodeIndex})` : `Node ${nodeIndex}`;
}

/** Source-declared storey and class visibility plus room-occurrence and part
 * browsing. Visibility is presentation only; it assigns nothing to a floor. */
export function ModelNavigator({ index, navigation }: { readonly index: NavigationIndex; readonly navigation: ModelNavigation }) {
  const { hidden, selection, setSelection } = navigation;
  const selectedNode = selection?.kind === 'node' ? selection.nodeIndex : null;
  const occurrences = [...index.occurrences.values()];
  return <>
    {(index.storeys.length > 0 || index.unlisted.length > 0) && <section className="cifc-nav" aria-labelledby="cifc-nav-show">
      <h3 id="cifc-nav-show" className="cifc-subhead">Show</h3>
      <div className="cifc-toggles" role="group" aria-label="Storeys, as declared">
        {index.storeys.map(storey => <button key={storey.key} type="button" className="chip-btn" aria-pressed={!hidden.storeys.has(storey.key)}
          onClick={() => navigation.toggleStorey(storey.key)}>{storey.declared ? storey.label : `${storey.label} (not a declared storey)`}</button>)}
        {index.unlisted.length > 0 && <button type="button" className="chip-btn" aria-pressed={!hidden.unlisted} onClick={navigation.toggleUnlisted}>
          Parts not in the manifest</button>}
      </div>
      {index.classes.length > 1 && <div className="cifc-toggles" role="group" aria-label="IFC classes">
        {index.classes.map(({ ifcClass, count: total }) => <button key={ifcClass} type="button" className="chip-btn" aria-pressed={!hidden.classes.has(ifcClass)}
          onClick={() => navigation.toggleClass(ifcClass)}>{ifcClass} <span className="cifc-count">{count(total)}</span></button>)}
      </div>}
    </section>}
    {occurrences.length > 0 && <section className="cifc-room-group" aria-labelledby="cifc-nav-rooms">
      <h4 id="cifc-nav-rooms">Room occurrences <span className="cifc-count">{count(occurrences.length)}</span></h4>
      <ul>{occurrences.map(occurrence => <li key={occurrence.nodeIndex}>
        <button type="button" className="cifc-room-btn" aria-pressed={selectedNode === occurrence.nodeIndex}
          onClick={() => setSelection(selectedNode === occurrence.nodeIndex ? null : { kind: 'node', nodeIndex: occurrence.nodeIndex, via: 'list' })}>
          <span className="cifc-room-name">{index.names.get(occurrence.nodeIndex) ?? 'Unnamed room occurrence'}</span>
          <span className="cifc-room-tags"><span className="cifc-room-id">{occurrence.globalId}</span>
            {index.meshesByNode.has(occurrence.nodeIndex) ? '' : occurrence.footprintAvailable ? ' Footprint declared, not drawn' : ' No geometry'}</span>
        </button></li>)}</ul>
    </section>}
    {index.storeys.some(storey => storey.products.length > 0) && <section aria-labelledby="cifc-nav-parts">
      <h3 id="cifc-nav-parts" className="cifc-subhead">Parts by declared storey</h3>
      {index.storeys.filter(storey => storey.products.length > 0).map(storey => <details key={storey.key} className="cifc-source cifc-room-group">
        <summary>{storey.declared ? storey.label : `${storey.label} (not a declared storey)`} <span className="cifc-count">{count(storey.products.length)}</span></summary>
        <ul>{storey.products.map(product => <li key={product.nodeIndex}>
          <button type="button" className="cifc-room-btn" aria-pressed={selectedNode === product.nodeIndex}
            onClick={() => setSelection(selectedNode === product.nodeIndex ? null : { kind: 'node', nodeIndex: product.nodeIndex, via: 'list' })}>
            <span className="cifc-room-name">{index.names.get(product.nodeIndex) ?? product.ifcClass}</span>
            <span className="cifc-room-tags"><span className="cifc-room-id">{product.globalId}</span> {product.ifcClass}
              {index.meshesByNode.has(product.nodeIndex) ? '' : ', no geometry'}</span>
          </button></li>)}</ul>
      </details>)}
    </section>}
  </>;
}

/** Facts for the current node selection; the room is never inferred. */
export function SelectionFacts({ index, nodeIndex, hiddenKeys }: { readonly index: NavigationIndex; readonly nodeIndex: number; readonly hiddenKeys: ReadonlySet<string> }) {
  const product = index.products.get(nodeIndex), occurrence = index.occurrences.get(nodeIndex);
  const meshes = index.meshesByNode.get(nodeIndex) ?? [];
  const storey = product ? index.declared.get(product.storey) ?? `${product.storey} (not a declared storey)` : null;
  return <dl className="cifc-facts">
    {product && <div><dt>Class</dt><dd>{product.ifcClass}</dd></div>}
    {(product ?? occurrence) && <div><dt>GlobalId</dt><dd><code>{(product ?? occurrence)!.globalId}</code></dd></div>}
    {storey && <div><dt>Storey</dt><dd>{storey}, as declared</dd></div>}
    <div><dt>Geometry</dt><dd>{meshes.length === 0 ? 'None drawn' : meshes.every(key => hiddenKeys.has(key)) ? 'Hidden by Show' : `${count(meshes.length)} drawn ${meshes.length === 1 ? 'part' : 'parts'}`}</dd></div>
    <div><dt>Node</dt><dd>{nodeIndex}</dd></div>
  </dl>;
}
