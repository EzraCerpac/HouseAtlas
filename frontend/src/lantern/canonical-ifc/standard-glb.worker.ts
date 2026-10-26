import { GlbFormatError, type GlbAdmission } from './glb-preflight';
import { loadStandardGlb, type StandardGlb } from './standard-glb';
import type { GlbWorkerReply, GlbWorkerRequest } from './standard-glb-thread';

/** The worker side of loadStandardGlbInWorker: one load per worker. The page
 * ends the worker to cancel, so the load itself is never aborted here. */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<GlbWorkerRequest>) => void) | null;
  postMessage(message: GlbWorkerReply, transfer: Transferable[]): void;
};
let admitted: (() => void) | null = null;

scope.onmessage = ({ data }) => {
  if (data.kind === 'admitted') { admitted?.(); admitted = null; return; }
  const { bytes, keyPrefix, admits, options } = data;
  // The page sees the admitted work before anything is copied or extracted.
  const admit = admits ? (admission: GlbAdmission) => new Promise<void>(resolve => {
    admitted = resolve; scope.postMessage({ kind: 'admission', admission }, []);
  }) : undefined;
  loadStandardGlb(bytes, keyPrefix, new AbortController().signal, admit, options).then(
    glb => scope.postMessage({ kind: 'loaded', glb }, transfers(glb)),
    (error: unknown) => scope.postMessage({ kind: 'failed', stage: error instanceof GlbFormatError ? error.stage : null,
      message: error instanceof Error ? error.message : 'The model could not be loaded' }, []));
};

/** Every buffer the loaded GLB owns, once each (meshes can share a texture), so they move to the page without a copy. */
function transfers(glb: StandardGlb): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  const own = (array: { readonly buffer: ArrayBufferLike } | undefined) => { if (array?.buffer instanceof ArrayBuffer) buffers.add(array.buffer); };
  for (const { vertices, materialVertices, sourceMaterial } of glb.meshes) {
    own(vertices); own(materialVertices);
    if (sourceMaterial) for (const texture of [sourceMaterial.baseColorTexture, sourceMaterial.normalTexture, sourceMaterial.metallicRoughnessTexture]) own(texture?.image.rgba);
  }
  return [...buffers];
}
