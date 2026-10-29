// In-process fake streams/children and a controlled clock. No browser/process,
// network, native state, credentials or timers waiting on a real cold start.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { BrowserPipe, STARTUP_TIMEOUT_MS, COMMAND_TIMEOUT_MS } from './browser-pipe.mjs';
import { trackOfflineBrowser } from '../../frontend/lantern-tests/offline-launch-cleanup.mjs';

function fixture() {
  const child = new EventEmitter(), input = new EventEmitter(), output = new EventEmitter();
  child.exitCode = null; child.signalCode = null; child.stdio = [null, null, null, input, output];
  const writes = [], scheduled = new Map(); let now = 0, next = 0;
  const timers = {
    setTimeout(run, ms) { const id = ++next; scheduled.set(id, { run, at: now + ms }); return id; },
    clearTimeout(id) { scheduled.delete(id); },
  };
  const tick = ms => {
    now += ms;
    for (const [id, task] of [...scheduled]) if (task.at <= now) { scheduled.delete(id); task.run(); }
  };
  input.write = (text, callback) => { writes.push(JSON.parse(text.slice(0, -1))); callback(); return true; };
  const events = [], pipe = new BrowserPipe(child, event => events.push(event), timers);
  const reply = (id, result) => output.emit('data', Buffer.from(JSON.stringify({ id, result }) + '\0'));
  return { child, input, output, writes, scheduled, tick, events, pipe, reply };
}

export async function browserPipeSyntheticCases() {
  const passed = [];
  {
    const f = fixture(); f.child.emit('spawn'); const ready = f.pipe.startup();
    assert.equal(f.writes.length, 1); assert.equal(f.writes[0].method, 'Browser.getVersion');
    assert.equal([...f.scheduled.values()][0].at, STARTUP_TIMEOUT_MS);
    f.tick(15001); assert.equal(f.pipe.pending.size, 1, 'Only startup may outlive 15 s');
    // Fragment a multibyte version across chunks, interleave an event and an
    // unrelated response, and include empty NUL frames. Only exact id settles.
    const frame = Buffer.from('\0' + JSON.stringify({ method: 'Synthetic.event' }) + '\0'
      + JSON.stringify({ id: 999, result: {} }) + '\0'
      + JSON.stringify({ id: 1, result: { product: 'Synthetic/é' } }) + '\0');
    const split = frame.indexOf(Buffer.from('é')) + 1;
    f.output.emit('data', frame.subarray(0, split)); assert.equal(f.pipe.ready, false);
    f.output.emit('data', frame.subarray(split));
    assert.equal((await ready).product, 'Synthetic/é'); assert.equal(f.events.length, 1);
    assert.equal(f.pipe.snapshot().frames, 3); assert.equal(f.scheduled.size, 0);
    const command = f.pipe.send('Runtime.enable'); const rejected = assert.rejects(command, /CDP timeout: Runtime.enable/);
    assert.equal([...f.scheduled.values()][0].at, 15001 + COMMAND_TIMEOUT_MS);
    f.tick(COMMAND_TIMEOUT_MS); await rejected;
    assert.equal(f.writes.length, 2); assert.equal(f.pipe.pending.size, 0);
    await assert.rejects(f.pipe.startup(), /already attempted/); f.pipe.dispose();
    passed.push('fragmented-correlated-startup-and-ordinary-budget');
  }
  {
    const f = fixture(); const ready = f.pipe.startup(); const rejected = assert.rejects(ready, /CDP timeout: Browser.getVersion/);
    f.tick(STARTUP_TIMEOUT_MS); await rejected;
    assert.equal(f.writes.length, 1); assert.equal(f.scheduled.size, 0);
    await assert.rejects(f.pipe.startup(), /already attempted/);
    await assert.rejects(f.pipe.send('Target.createTarget'), /handshake not complete/);
    f.pipe.dispose(); passed.push('silent-startup-expires-without-retry');
  }
  for (const kind of ['spawn-error', 'exit', 'close', 'input-error', 'input-close', 'output-error', 'output-end', 'output-close', 'malformed-frame']) {
    const f = fixture(); const ready = f.pipe.startup(); const rejected = assert.rejects(ready);
    if (kind === 'spawn-error') f.child.emit('error', Object.assign(new Error('synthetic'), { code: 'ENOENT' }));
    if (kind === 'exit') { f.child.exitCode = 7; f.child.emit('exit', 7, null); }
    if (kind === 'close') f.child.emit('close', null, 'SIGTERM');
    if (kind === 'input-error') f.input.emit('error', new Error('synthetic'));
    if (kind === 'input-close') f.input.emit('close');
    if (kind === 'output-error') f.output.emit('error', new Error('synthetic'));
    if (kind === 'output-end') f.output.emit('end');
    if (kind === 'output-close') f.output.emit('close');
    if (kind === 'malformed-frame') f.output.emit('data', Buffer.from('{not-json}\0'));
    await rejected; assert.equal(f.scheduled.size, 0); assert.equal(f.pipe.pending.size, 0);
    assert(f.pipe.snapshot().stopped); assert.equal(f.writes.length, 1);
    f.reply(1, { product: 'late' }); assert.equal(f.pipe.ready, false);
    f.pipe.dispose(); passed.push(kind);
  }
  for (const kind of ['write-callback', 'write-throw']) {
    const f = fixture();
    f.input.write = (_text, callback) => {
      const error = Object.assign(new Error('synthetic'), { code: 'EPIPE' });
      if (kind === 'write-throw') throw error;
      callback(error); return false;
    };
    await assert.rejects(f.pipe.startup(), /CDP write failed/);
    assert.equal(f.scheduled.size, 0); assert.equal(f.pipe.snapshot().writeError, 'EPIPE');
    f.pipe.dispose(); passed.push(kind);
  }
  {
    const f = fixture(); const ready = f.pipe.startup(); f.reply(1, { product: 'Synthetic/1' }); await ready;
    const first = assert.rejects(f.pipe.send('Page.enable'), /CDP output ended/);
    const second = assert.rejects(f.pipe.send('Runtime.enable'), /CDP output ended/);
    f.output.emit('end'); await Promise.all([first, second]);
    assert.equal(f.scheduled.size, 0); assert.equal(f.pipe.pending.size, 0);
    await assert.rejects(f.pipe.send('Page.navigate'), /CDP output ended/);
    assert.equal(f.writes.length, 3); f.pipe.dispose(); passed.push('terminal-error-rejects-all-and-future-commands');
  }
  {
    const f = fixture(); const ready = f.pipe.startup(); f.reply(1, {});
    await assert.rejects(ready, /Invalid Chromium version/); assert.equal(f.pipe.ready, false);
    f.pipe.dispose(); passed.push('invalid-handshake-refused');
  }
  {
    const f = fixture(); const ready = f.pipe.startup(); const rejected = assert.rejects(ready, /Chromium exited/);
    f.reply(1, { product: 'Synthetic/1' }); f.child.exitCode = 1; f.child.emit('exit', 1, null);
    await rejected; assert.equal(f.pipe.ready, false); assert.equal(f.scheduled.size, 0);
    f.pipe.dispose(); passed.push('exit-before-handshake-continuation');
  }
  {
    const f = fixture(), signals = []; f.child.kill = signal => { signals.push(signal); return true; };
    const stop = trackOfflineBrowser(f.child); let finished = false;
    const stopping = stop(async () => {}).then(() => { finished = true; });
    await Promise.resolve(); await Promise.resolve();
    assert.equal(finished, false, 'A protocol acknowledgement is not child close');
    f.child.exitCode = 0; f.child.emit('exit', 0, null);
    await Promise.resolve(); assert.equal(finished, false, 'Exit alone does not close owned pipes');
    f.child.emit('close', 0, null); await stopping;
    assert.deepEqual(signals, []); f.pipe.dispose(); passed.push('cleanup-waits-for-close-after-exit');
  }
  console.log(JSON.stringify({ browserPipeSynthetic: passed }));
}
