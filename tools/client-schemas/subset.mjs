// Copy complete definition nodes; never rewrite references or validation keywords.
import assert from 'node:assert/strict';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const escape = value => value.replaceAll('~', '~0').replaceAll('/', '~1');
const absolute = (ref, base) => new URL(ref, base).href;
const resource = uri => uri.split('#')[0];

/** Offline closure over pinned documents. Root assertions and each retained
 * top-level definition remain intact, including nested IDs, anchors and cycles.
 * Dynamic/recursive scope cannot in general be pruned statically: retain every
 * supplied document in that case. Unknown resources refuse generation. */
export function schemaSubset(documents, roots) {
  const locations = new Map(), resources = new Map(), anchors = new Map();
  const states = documents.map(document => ({ document, keep: new Set(), all: false }));
  const add = (map, key, location) => {
    assert(!map.has(key) || map.get(key) === location, `Ambiguous schema location: ${key}`);
    map.set(key, location);
  };
  function index(value, state, path, base, owner = null) {
    if (object(value) && typeof value.$id === 'string') base = absolute(value.$id, base);
    const location = { value, state, path, base, owner };
    locations.set(`${state.document.$id}#${path}`, location);
    if (path === '' || object(value) && typeof value.$id === 'string') add(resources, resource(base), location);
    if (!object(value) && !Array.isArray(value)) return;
    for (const key of ['$anchor', '$dynamicAnchor']) if (typeof value[key] === 'string')
      add(anchors, `${resource(base)}#${value[key]}`, location);
    for (const [key, child] of Object.entries(value)) {
      const nextOwner = path === '/$defs' || path === '/definitions' ? `${path}/${escape(key)}` : owner;
      index(child, state, `${path}/${escape(key)}`, base, nextOwner);
    }
  }
  for (const state of states) {
    assert.equal(typeof state.document.$id, 'string', 'Every input needs its pinned ID');
    index(state.document, state, '', state.document.$id);
  }
  function resolve(ref, base) {
    const uri = absolute(ref, base), id = resource(uri), fragment = uri.slice(id.length);
    const start = resources.get(id);
    assert(start, `Unpinned schema resource: ${id}`);
    if (!fragment || fragment === '#') return start;
    if (!fragment.startsWith('#/')) {
      const target = anchors.get(`${id}#${decodeURIComponent(fragment.slice(1))}`);
      assert(target, `Missing schema anchor: ${uri}`);
      return target;
    }
    const pointer = decodeURIComponent(fragment.slice(1));
    // Resolve pointers relative to the containing resource, including nested IDs.
    const target = locations.get(`${start.state.document.$id}#${start.path}${pointer}`);
    assert(target, `Missing schema pointer: ${uri}`);
    return target;
  }
  const visited = new Set();
  function visit(location) {
    const { state, owner } = location;
    if (owner !== null) {
      state.keep.add(owner);
      // A pointer into a definition retains the entire definition and its refs.
      location = locations.get(`${state.document.$id}#${owner}`);
    }
    if (visited.has(location)) return;
    visited.add(location);
    walk(location.value, location.base, location.path === '', true);
  }
  function walk(value, base, atRoot, located = false) {
    if (!object(value) && !Array.isArray(value)) return;
    if (!located && object(value) && typeof value.$id === 'string') base = absolute(value.$id, base);
    for (const [key, child] of Object.entries(value)) {
      if (atRoot && (key === '$defs' || key === 'definitions')) continue;
      if (['$dynamicRef', '$recursiveRef', '$dynamicAnchor', '$recursiveAnchor'].includes(key)) {
        for (const candidate of states) if (!candidate.all) {
          candidate.all = true;
          for (const container of ['$defs', 'definitions']) for (const name of Object.keys(candidate.document[container] ?? {}))
            visit(locations.get(`${candidate.document.$id}#/${container}/${escape(name)}`));
        }
      }
      if (['$ref', '$dynamicRef', '$recursiveRef'].includes(key)) {
        assert.equal(typeof child, 'string'); visit(resolve(child, base));
      } else walk(child, base, false);
    }
  }
  // Preserve all document-root semantics, even though clients request fragments.
  for (const state of states) visit(locations.get(`${state.document.$id}#`));
  for (const root of roots) visit(resolve(root, states[0].document.$id));
  return states.map(state => Object.fromEntries(Object.entries(state.document).map(([key, value]) =>
    key === '$defs' || key === 'definitions'
      ? [key, Object.fromEntries(Object.entries(value).filter(([name]) => state.keep.has(`/${key}/${escape(name)}`)))]
      : [key, value])));
}
