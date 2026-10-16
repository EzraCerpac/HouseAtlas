import { createHash } from 'node:crypto';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const PROFILE = Object.freeze({ id: 'model-interaction-cpu-v1', sizes: [100, 1000, 5000],
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
  const reference = sample.buildGlb(sample.SAMPLE_REFERENCE);
  const document = await sample.sampleManifest(bytes, reference);
  const template = document.products[0];
  document.products = Array.from({ length: count }, (_, i) => ({ ...template, globalId: `generated-product-${i}`,
    nodeIndex: i, meshIndex: 0, ifcClass: i % 3 ? 'IfcBuildingElementProxy' : 'IfcSlab', storey: i % 2 ? 'b' : 'a' }));
  document.roomOccurrences = Array.from({ length: rooms }, (_, i) => ({ globalId: `generated-room-${i}`,
    nodeIndex: count + i, footprintAvailable: false }));
  const bounds = [[-.4, 0, -.4], [(Math.min(side, count) - 1) * 1.2 + .4, 1, Math.floor((count - 1) / side) * 1.2 + .4]];
  Object.assign(document.houseGLB, { meshCount: 1, productNodes: count, roomOccurrenceNodes: rooms,
    triangleCount: count * 12, boundsGLTFMetres: bounds, boundsLocalENNAPMetres: bounds });
  document.storeyVisibleMeshBounds = document.storeyVisibleMeshBounds.map((row, i) => ({ ...row,
    visibleMeshCount: i ? Math.floor(count / 2) : Math.ceil(count / 2), boundsGLTFMetres: bounds, boundsLocalENNAPMetres: bounds }));
  document.previewLineage = ['Generated model-interaction-cpu-v1 fixture'];
  document.remainingUncertainty = ['Synthetic boxes only; no physical placement established.'];
  const manifestBytes = new TextEncoder().encode(JSON.stringify(document));
  // Explicit plan-only rooms: these are deliberately separate from GLB semantic
  // nodes. A manifest's footprintAvailable flag does not supply a plan shape.
  const occurrenceIds = [], planShapes = new Map();
  for (let i = 0; i < count; i++) {
    const [x, , z] = position(i), id = `plan-room-${i}`;
    occurrenceIds.push(id);
    planShapes.set(id, [[[[x - .4, z - .4], [x + .4, z - .4], [x + .4, z + .4], [x - .4, z + .4]]]]);
  }
  return { bytes, reference, manifestBytes, count, rooms, side, bounds,
    plan: { floorFacts: new Map([['generated-floor', { occurrenceIds }]]), planShapes },
    facts: { id: `generated-boxes-${count}-v1`, products: count, rooms, triangles: count * 12,
      glb: { bytes: bytes.length, sha256: sha256(bytes) }, manifest: { bytes: manifestBytes.length, sha256: sha256(manifestBytes) },
      reference: { bytes: reference.length, sha256: sha256(reference) },
      planSha256: sha256(JSON.stringify([...planShapes])) } };
}
