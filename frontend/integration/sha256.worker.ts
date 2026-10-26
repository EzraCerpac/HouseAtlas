import type { Sha256WorkerReply } from './sha256-thread';

/** The worker side of sha256OffThread: one digest per worker, and the bytes go back with it. */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<Uint8Array<ArrayBuffer>>) => void) | null;
  postMessage(message: Sha256WorkerReply, transfer: Transferable[]): void;
};

scope.onmessage = ({ data: bytes }) => {
  crypto.subtle.digest('SHA-256', bytes).then(
    digest => scope.postMessage({ bytes, digest }, [bytes.buffer, digest]),
    () => scope.postMessage(null, []));
};
