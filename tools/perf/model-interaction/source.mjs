import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { dependencyUrl, loadSource, threeUrl } from '../harness/load-source.mjs';

/** Uses the existing pinned transformer and dependency lock; no source edits. */
export async function modules(root, observed) {
  const base = 'frontend/src/lantern/canonical-ifc/';
  const compile = (path, replacements) => loadSource(root, path, observed, replacements);
  const geometryUrl = await compile(base + 'geometry.ts');
  const preflightUrl = await compile(base + 'glb-preflight.ts');
  // Map and hash the optional dynamic import without enabling materials in
  // the measured geometry-only load. Older source revisions lack this file.
  const embeddedPath = base + 'embedded-png-material.ts';
  const embeddedUrl = existsSync(resolve(root, embeddedPath))
    ? await compile(embeddedPath, { './glb-preflight': preflightUrl }) : null;
  // Meshopt expansion, likewise mapped where the source has it; generated inputs are plain.
  const meshoptPath = base + 'glb-meshopt.ts';
  const meshoptUrl = existsSync(resolve(root, meshoptPath)) ? await compile(meshoptPath, { './glb-preflight': preflightUrl,
    'three/examples/jsm/libs/meshopt_decoder.module.js': dependencyUrl('three/examples/jsm/libs/meshopt_decoder.module.js') }) : null;
  const standardUrl = await compile(base + 'standard-glb.ts', { './geometry': geometryUrl, './glb-preflight': preflightUrl,
    ...(embeddedUrl ? { './embedded-png-material': embeddedUrl } : {}), ...(meshoptUrl ? { './glb-meshopt': meshoptUrl } : {}),
    three: threeUrl, 'three/examples/jsm/loaders/GLTFLoader.js': dependencyUrl('three/examples/jsm/loaders/GLTFLoader.js') });
  const sampleUrl = await compile('frontend/lantern-tests/canonical-ifc-visual/standard-glb-sample.ts');
  const [geometry, preflight, standard, sample] = await Promise.all([
    import(geometryUrl), import(preflightUrl), import(standardUrl), import(sampleUrl),
  ]);
  return { geometry, preflight, standard, sample };
}
