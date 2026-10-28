import { createHash } from 'node:crypto';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const PROFILE = Object.freeze({ id: 'model-interaction-cpu-v2', sizes: [100, 1000, 5000],
  warmups: 3, repetitions: 9, allocationRepetitions: 3, samplingInterval: 32768,
  viewport: [960, 640], yaw: -32, pitch: 36 });

/** Only generated boxes and explicit synthetic semantic identities. */
export async function scenario(sample, count) {
  const side = Math.ceil(Math.sqrt(count)), rooms = Math.ceil(count / 10);
  const position = i => [(i % side) * 1.2, 0, Math.floor(i / side) * 1.2];
  const nodes = Array.from({ length: count }, (_, i) => ({ name: `Generated part ${i}`, mesh: 0,
    translation: position(i), extras: { globalId: `generated-product-${i}` } }));
  for (let i = 0; i < rooms; i++) nodes.push({ name: `Generated room ${i}`, extras: { globalId: `generated-room-${i}` } });
  const bytes = sample.buildGlb({ nodes, roots: nodes.map((_, i) => i), meshes: [sample.box([-.4, 0, -.4], [.4, 1, .4])] });
  const bounds = [[-.4, 0, -.4], [(Math.min(side, count) - 1) * 1.2 + .4, 1, Math.floor((count - 1) / side) * 1.2 + .4]];
  // Explicit plan-only rooms: these are deliberately separate from GLB semantic
  // nodes, which never supply a plan shape.
  const occurrenceIds = [], planShapes = new Map();
  for (let i = 0; i < count; i++) {
    const [x, , z] = position(i), id = `plan-room-${i}`;
    occurrenceIds.push(id);
    planShapes.set(id, [[[[x - .4, z - .4], [x + .4, z - .4], [x + .4, z + .4], [x - .4, z + .4]]]]);
  }
  return { bytes, count, rooms, side, bounds,
    plan: { floorFacts: new Map([['generated-floor', { occurrenceIds }]]), planShapes },
    facts: { id: `generated-boxes-${count}-v1`, products: count, rooms, triangles: count * 12,
      glb: { bytes: bytes.length, sha256: sha256(bytes) },
      planSha256: sha256(JSON.stringify([...planShapes])) } };
}
