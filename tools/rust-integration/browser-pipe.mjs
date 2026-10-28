// One owned Chromium pipe. Startup has one finite budget, never a relaunch/retry.
// No CDP payload, browser stderr, URL, cookie or application data in diagnostics.
export const STARTUP_TIMEOUT_MS = 60000;
export const COMMAND_TIMEOUT_MS = 15000;

export class BrowserPipe {
  constructor(child, onEvent = () => {}, timers = { setTimeout, clearTimeout }) {
    this.child = child; this.onEvent = onEvent; this.timers = timers;
    this.next = 0; this.pending = new Map(); this.buffer = Buffer.alloc(0);
    this.stopped = null; this.started = false; this.ready = false;
    this.receivedBytes = 0; this.frames = 0; this.writeCompleted = false;
    this.writeError = null; this.spawned = false;
    child.on('spawn', () => { this.spawned = true; });
    child.on('error', error => this.fail('Chromium process error', error));
    child.on('exit', (code, signal) => this.fail(`Chromium exited: code=${code} signal=${signal}`));
    child.on('close', () => this.fail('Chromium child closed'));
    this.input = child.stdio[3]; this.output = child.stdio[4];
    this.input.on('error', error => this.fail('CDP input error', error));
    this.input.on('close', () => this.fail('CDP input closed'));
    this.output.on('error', error => this.fail('CDP output error', error));
    this.output.on('end', () => this.fail('CDP output ended'));
    this.output.on('close', () => this.fail('CDP output closed'));
    this.output.on('data', bytes => this.receive(bytes));
    if (child.exitCode !== null || child.signalCode !== null)
      this.fail('Chromium already exited before pipe attachment');
  }
  fail(message, cause) {
    this.stopped ??= new Error(message, cause ? { cause } : undefined);
    for (const entry of this.pending.values()) {
      this.timers.clearTimeout(entry.timer); entry.reject(this.stopped);
    }
    this.pending.clear(); this.buffer = Buffer.alloc(0);
  }
  receive(bytes) {
    this.receivedBytes += bytes.length;
    if (this.stopped) return;
    this.buffer = Buffer.concat([this.buffer, bytes]);
    let end;
    while ((end = this.buffer.indexOf(0)) !== -1) {
      const raw = this.buffer.subarray(0, end).toString('utf8');
      this.buffer = this.buffer.subarray(end + 1);
      if (!raw) continue;
      let message;
      try {
        message = JSON.parse(raw);
        if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error();
      } catch { this.fail('Invalid CDP JSON frame'); return; }
      this.frames++;
      if (Object.hasOwn(message, 'id')) {
        const entry = this.pending.get(message.id);
        if (!entry) continue;
        this.pending.delete(message.id); this.timers.clearTimeout(entry.timer);
        message.error ? entry.reject(new Error('CDP command rejected: ' + entry.method)) : entry.resolve(message.result);
      } else {
        try { this.onEvent(message); }
        catch (error) { this.fail('CDP event handler failed', error); return; }
      }
    }
  }
  request(method, params, sessionId, timeoutMs) {
    if (this.stopped) return Promise.reject(this.stopped);
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = this.timers.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('CDP timeout: ' + method));
      }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      const written = error => {
        if (method === 'Browser.getVersion') {
          this.writeCompleted = true; this.writeError = error?.code ?? null;
        }
        if (error) this.fail('CDP write failed', error);
      };
      try { this.input.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0', written); }
      catch (error) { written(error); }
    });
  }
  async startup() {
    if (this.started) throw new Error('Chromium handshake already attempted');
    this.started = true;
    const version = await this.request('Browser.getVersion', {}, undefined, STARTUP_TIMEOUT_MS);
    if (this.stopped) throw this.stopped;
    if (typeof version?.product !== 'string' || !version.product)
      throw new Error('Invalid Chromium version handshake');
    this.ready = true;
    return version;
  }
  send(method, params = {}, sessionId) {
    if (!this.ready) return Promise.reject(new Error('Chromium handshake not complete'));
    return this.request(method, params, sessionId, COMMAND_TIMEOUT_MS);
  }
  snapshot() {
    return { spawned: this.spawned, ready: this.ready, writeCompleted: this.writeCompleted,
      writeError: this.writeError, receivedBytes: this.receivedBytes, frames: this.frames,
      bufferedBytes: this.buffer.length, pending: this.pending.size,
      stopped: this.stopped?.message ?? null, exitCode: this.child.exitCode, signalCode: this.child.signalCode };
  }
  dispose() { this.fail('CDP owner disposed'); }
}
