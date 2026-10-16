import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PROFILE } from './settings.mjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const pad = length => (4 - length % 4) % 4;

/** Anonymous shared box, with deterministic translated node instances. No URLs or materials. */
export function gridGlb() {
  const n = PROFILE.scenario.glbInstances, side = Math.ceil(Math.sqrt(n));
  const positions = Float32Array.from([-.4,0,-.4,.4,0,-.4,.4,1,-.4,-.4,1,-.4,-.4,0,.4,.4,0,.4,.4,1,.4,-.4,1,.4]);
  const indices = Uint16Array.from([[0,3,2,1],[4,5,6,7],[0,1,5,4],[3,7,6,2],[0,4,7,3],[1,2,6,5]]
    .flatMap(([a,b,c,d]) => [a,b,c,a,c,d]));
  const bin = new Uint8Array(positions.byteLength + indices.byteLength);
  bin.set(new Uint8Array(positions.buffer)); bin.set(new Uint8Array(indices.buffer), positions.byteLength);
  const nodes = Array.from({ length: n }, (_, i) => ({ name: `Synthetic part ${i}`, mesh: 0,
    translation: [(i % side) * 1.2, 0, Math.floor(i / side) * 1.2] }));
  const json = { asset: { version: '2.0', generator: 'HouseAtlas synthetic performance fixture' }, scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }], nodes,
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: [-.4,0,-.4], max: [.4,1,.4] },
      { bufferView: 1, componentType: 5123, count: 36, type: 'SCALAR' }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength, target: 34962 },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: indices.byteLength, target: 34963 }], buffers: [{ byteLength: bin.byteLength }] };
  const encoded = new TextEncoder().encode(JSON.stringify(json)), length = encoded.length + pad(encoded.length);
  const bytes = new Uint8Array(28 + length + bin.length), view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true);
  view.setUint32(12, length, true); view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20, 20 + length); bytes.set(encoded, 20);
  view.setUint32(20 + length, bin.length, true); view.setUint32(24 + length, 0x004e4942, true); bytes.set(bin, 28 + length);
  return bytes;
}

export function fixtures() {
  return [
    { id: 'public-readme-mesh-v1', bytes: new Uint8Array(readFileSync(new URL('./mesh-profile.fixture.json', import.meta.url))) },
    { id: 'shared-box-grid-1000-v1', bytes: gridGlb() },
  ];
}
export const fixtureFacts = values => values.map(({ id, bytes }) => ({ id, bytes: bytes.byteLength, sha256: sha256(bytes) }));
