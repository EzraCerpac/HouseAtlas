import { dependencyUrl, loadSource, threeUrl } from '../harness/load-source.mjs';

/** Uses the existing pinned transformer and dependency lock; no source edits. */
export async function modules(root, observed) {
  const base = 'frontend/src/lantern/canonical-ifc/';
  const compile = (path, replacements) => loadSource(root, path, observed, replacements);
  const geometryUrl = await compile(base + 'geometry.ts');
  const preflightUrl = await compile(base + 'glb-preflight.ts');
  const standardUrl = await compile(base + 'standard-glb.ts', { './geometry': geometryUrl, './glb-preflight': preflightUrl,
    three: threeUrl, 'three/examples/jsm/loaders/GLTFLoader.js': dependencyUrl('three/examples/jsm/loaders/GLTFLoader.js') });
  const manifestUrl = await compile(base + 'browser-manifest.ts');
  const navigatorUrl = await compile(base + 'ModelNavigator.tsx', { react: dependencyUrl('react'),
    'react/jsx-runtime': dependencyUrl('react/jsx-runtime') });
  const sampleUrl = await compile('frontend/lantern-tests/canonical-ifc-visual/standard-glb-sample.ts');
  const [geometry, preflight, standard, manifest, navigator, sample, react, server] = await Promise.all([
    import(geometryUrl), import(preflightUrl), import(standardUrl), import(manifestUrl), import(navigatorUrl), import(sampleUrl),
    import(dependencyUrl('react')), import(dependencyUrl('react-dom/server')),
  ]);
  return { geometry, preflight, standard, manifest, navigator, sample, react, server };
}
