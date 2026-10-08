// Observe only the original Chrome process before any page or cookie work.
// No relaunch, timeout extension, browser flag or application assertion change.
import { readFileSync, readlinkSync } from 'node:fs';
import { freemem, loadavg } from 'node:os';

export function observeBrowserStartup(browser, disposableRoot) {
  const started = performance.now();
  let spawned = false, writeCompleted = false, writeError = null, receivedBytes = 0;
  browser.once('spawn', () => { spawned = true; });
  const received = bytes => { receivedBytes += bytes.length; };
  browser.stdio[4].on('data', received);
  const read = path => {
    try { return readFileSync(path, 'utf8').slice(0, 4096).trim(); }
    catch { return null; }
  };
  const link = path => {
    try { return readlinkSync(path).replaceAll(disposableRoot, '<disposable-profile>'); }
    catch { return null; }
  };
  return {
    // Call only for the initial Browser.getVersion write. No message contents.
    written(error) { writeCompleted = true; writeError = error?.code ?? null; },
    snapshot() {
      const processes = [];
      if (process.platform === 'linux' && Number.isInteger(browser.pid)) {
        const pending = [browser.pid], seen = new Set();
        while (pending.length && processes.length < 16) {
          const pid = pending.shift();
          if (seen.has(pid)) continue;
          seen.add(pid);
          const base = '/proc/' + pid;
          const status = read(base + '/status');
          // No command line, environment, URLs or credentials are inspected.
          processes.push({ pid, executable: link(base + '/exe'),
            state: status?.split('\n').find(row => row.startsWith('State:')) ?? null,
            waitChannel: read(base + '/wchan'),
            inputDescriptor: link(base + '/fd/3'), outputDescriptor: link(base + '/fd/4') });
          const children = read(base + '/task/' + pid + '/children');
          if (children) pending.push(...children.split(/\s+/).map(Number).filter(Number.isInteger).slice(0, 16));
        }
      }
      return { spawned, writeCompleted, writeError, receivedBytes,
        milliseconds: Math.round(performance.now() - started),
        freeMemoryBytes: freemem(), loadAverage: loadavg(), processes };
    },
    finish() { browser.stdio[4].off('data', received); },
  };
}
