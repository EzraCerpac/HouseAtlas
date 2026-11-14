import { GlbFormatError, type GlbAdmission } from './glb-preflight';
import { meshBuffers } from './geometry';
import { loadStandardGlb } from './standard-glb';
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
    // Every buffer the loaded GLB owns moves to the page without a copy.
    glb => scope.postMessage({ kind: 'loaded', glb }, meshBuffers(glb.meshes)),
    (error: unknown) => scope.postMessage({ kind: 'failed', stage: error instanceof GlbFormatError ? error.stage : null,
      message: error instanceof Error ? error.message : 'The model could not be loaded' }, []));
};
