import { constants, close, fstatSync, openSync, read } from 'node:fs';
import { Readable } from 'node:stream';

export const POLL_MS = 100;
const CHUNK = 64 * 1024;

// The helper opens the FIFO read-write, so it is always a reader (shairport-sync can open its write end at
// any moment, never getting ENXIO) and its own write reference means no EOF when shairport-sync's writer
// closes. A non-blocking read returns EAGAIN while the pipe is empty, so poll with fs.read on one reused buffer.
class FifoReader extends Readable {
  private fd: number;
  private buffer = Buffer.allocUnsafe(CHUNK);
  private busy = false;
  private timer: NodeJS.Timeout | null = null;
  private closing: ((error: Error | null) => void) | null = null;
  private failure: Error | null = null;
  constructor(fd: number) { super({ highWaterMark: CHUNK }); this.fd = fd; }
  override _read() { this.pull(); }
  private pull() {
    if (this.busy || this.timer || this.fd < 0 || this.closing) return;
    this.busy = true;
    read(this.fd, this.buffer, 0, CHUNK, null, (error, bytes) => {
      this.busy = false;
      if (this.closing) return this.finish();
      if (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EAGAIN') return this.destroy(error);
        this.timer = setTimeout(() => { this.timer = null; this.pull(); }, POLL_MS);
        return;
      }
      if (bytes === 0) { this.push(null); return; }
      if (this.push(Buffer.from(this.buffer.subarray(0, bytes)))) this.pull(); // a copy: the buffer is reused
    });
  }
  override _destroy(error: Error | null, callback: (error: Error | null) => void) {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.failure = error; this.closing = callback;
    if (!this.busy) this.finish(); // otherwise the pending read closes the descriptor
  }
  private finish() {
    const fd = this.fd, callback = this.closing!;
    this.fd = -1;
    if (fd >= 0) close(fd, () => callback(this.failure)); else callback(this.failure);
  }
}

export function openPipe(path: string) {
  return async (): Promise<Readable> => {
    // Read-write never waits for shairport-sync and never reports its writer closing (see above).
    const fd = openSync(path, constants.O_RDWR | constants.O_NONBLOCK | constants.O_NOFOLLOW);
    try { if (!fstatSync(fd).isFIFO()) throw new Error('not a FIFO'); } catch (error) { close(fd, () => {}); throw error; }
    return new FifoReader(fd);
  };
}
