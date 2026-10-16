export const METHOD = Object.freeze({ id: 'synthetic-cpu-bundle', revision: 1 });
export const PROFILE = Object.freeze({
  id: 'synthetic-cpu-bundle-v1',
  build: { mode: 'production', cache: 'fresh-process-temporary-output', startupAssets: 'entry-and-html-modulepreload-js', gzip: 'node-zlib-default' },
  cache: 'warm-process-generated-inputs',
  scenario: { scan: 'public-readme-seven-mesh', glbInstances: 1000, viewport: [960, 640], yaw: -32, pitch: 36, clipY: null,
    pick: 'middle-node-top', navigationStoreys: 1 },
  warmups: 3, repetitions: 9,
});
