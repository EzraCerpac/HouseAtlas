// One blank Chromium startup observation; no application, cookies or authentication.
// Only Browser.getVersion and Browser.close are sent through the owned CDP pipe.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

assert.equal(process.version, 'v26.10.0');
const chrome = process.env.HOUSEATLAS_CHROMIUM ?? '/usr/bin/google-chrome';
const limit = 65536;
const report = {
  scope: 'Blank Chromium startup only; no app, cookie, auth, provider or product control.',
  node: process.version,
  executable: chrome,
};
const wait = async (promise, milliseconds, label) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), milliseconds); }),
    ]);
  } finally { clearTimeout(timer); }
};

const version = { status: null, signal: null, error: null };
const versionProcess = spawn(chrome, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
let versionClosed = false, versionOut = Buffer.alloc(0), versionError = Buffer.alloc(0);
const versionClose = new Promise(resolve => versionProcess.once('close', (code, signal) => {
  versionClosed = true; version.status = code; version.signal = signal; resolve();
}));
versionProcess.on('error', error => { version.error = error.message; });
versionProcess.stdout.on('error', error => { version.error = error.message; });
versionProcess.stderr.on('error', error => { version.error = error.message; });
versionProcess.stdout.on('data', chunk => {
  version.stdoutTruncated ||= chunk.length > limit - versionOut.length;
  versionOut = Buffer.concat([versionOut, chunk.subarray(0, limit - versionOut.length)]);
});
versionProcess.stderr.on('data', chunk => {
  version.stderrTruncated ||= chunk.length > limit - versionError.length;
  versionError = Buffer.concat([versionError, chunk.subarray(0, limit - versionError.length)]);
});
try { await wait(versionClose, 5000, 'Chrome --version timeout'); }
catch (error) {
  version.error = error.message;
  versionProcess.kill('SIGKILL');
  try { await wait(versionClose, 2000, 'Chrome --version process did not exit'); }
  catch (cleanupError) {
    version.cleanupError = cleanupError.message;
    versionProcess.stdout.destroy(); versionProcess.stderr.destroy(); versionProcess.unref();
  }
}
report.chromeVersion = {
  ...version, stdout: versionOut.toString('utf8'), stderr: versionError.toString('utf8'),
  pid: versionProcess.pid ?? null, closed: versionClosed,
};

function command(browser, id, method, milliseconds) {
  return new Promise((resolve, reject) => {
    let bytes = Buffer.alloc(0), done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      browser.stdio[4].off('data', onData);
      browser.stdio[4].off('end', onEnd);
      browser.stdio[4].off('error', onError);
      browser.stdio[3].off('error', onError);
      browser.off('error', onError);
      browser.off('exit', onExit);
      error ? reject(error) : resolve(value);
    };
    const onError = error => finish(error);
    const onExit = () => finish(new Error('Browser exited before ' + method));
    const onEnd = () => finish(new Error('CDP output ended before ' + method));
    const onData = chunk => {
      bytes = Buffer.concat([bytes, chunk]);
      if (bytes.length > limit) return finish(new Error('CDP response exceeds diagnostic byte bound'));
      let end;
      while ((end = bytes.indexOf(0)) !== -1) {
        const frame = bytes.subarray(0, end).toString('utf8');
        bytes = bytes.subarray(end + 1);
        if (!frame) continue;
        let reply;
        try { reply = JSON.parse(frame); }
        catch { return finish(new Error('CDP returned invalid JSON')); }
        if (reply.id !== id) continue;
        return reply.error ? finish(new Error(reply.error.message)) : finish(null, reply.result);
      }
    };
    const timer = setTimeout(() => finish(new Error('CDP timeout: ' + method)), milliseconds);
    browser.stdio[4].on('data', onData);
    browser.stdio[4].once('end', onEnd);
    browser.stdio[4].once('error', onError);
    browser.stdio[3].once('error', onError);
    browser.once('error', onError);
    browser.once('exit', onExit);
    browser.stdio[3].write(JSON.stringify({ id, method, params: {} }) + '\0', error => {
      if (error) finish(error);
    });
  });
}

process.umask(0o077);
const scratch = mkdtempSync(join(tmpdir(), 'houseatlas-blank-chrome-'));
let browser, closed = false, closePromise, stderr = Buffer.alloc(0), stderrTruncated = false;
const redact = value => String(value).replaceAll(scratch, '<disposable-profile>');
try {
  assert.equal(version.status, 0, 'Chrome --version must succeed');
  assert.equal(version.error, null, 'Chrome --version must finish within its bound');
  const args = [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-pipe',
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-component-update', '--disable-sync', '--disable-features=MediaRouter,OptimizationHints',
    '--ignore-certificate-errors', '--user-data-dir=' + join(scratch, 'browser'), 'about:blank',
  ];
  report.arguments = args.map(redact);
  const started = performance.now();
  browser = spawn(chrome, args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  closePromise = new Promise(resolve => browser.once('close', (code, signal) => {
    closed = true; resolve({ code, signal });
  }));
  browser.on('error', error => { report.processError = error.message; });
  browser.stdio[3].on('error', error => { report.pipeWriteError = error.message; });
  browser.stdio[4].on('error', error => { report.pipeReadError = error.message; });
  browser.stderr.on('error', error => { report.stderrPipeError = error.message; });
  browser.stderr.on('data', chunk => {
    const available = limit - stderr.length;
    if (chunk.length > available) stderrTruncated = true;
    stderr = Buffer.concat([stderr, chunk.subarray(0, available)]);
  });
  report.browserGetVersion = await command(browser, 1, 'Browser.getVersion', 15000);
  assert.equal(typeof report.browserGetVersion?.product, 'string', 'Browser.getVersion actual product');
  report.browserGetVersionMilliseconds = Math.round(performance.now() - started);
  report.startup = 'Browser.getVersion received';
} catch (error) {
  report.failure = { stage: browser ? 'blank-browser-startup' : 'chrome-version', message: redact(error.message) };
  process.exitCode = 1;
} finally {
  report.startupStderr = redact(stderr.toString('utf8'));
  report.startupStderrTruncated = stderrTruncated;
  report.processBeforeCleanup = browser ? { pid: browser.pid ?? null, exitCode: browser.exitCode, signalCode: browser.signalCode } : null;
  try {
    if (browser?.pid && !closed) {
      await command(browser, 2, 'Browser.close', 2000).catch(error => {
        report.closeCommandObservation = redact(error.message);
      });
      try { await wait(closePromise, 3000, 'Browser.close did not exit'); }
      catch {
        report.cleanupSignal = 'SIGTERM'; browser.kill('SIGTERM');
        try { await wait(closePromise, 2000, 'SIGTERM did not exit'); }
        catch {
          report.cleanupSignal = 'SIGKILL'; browser.kill('SIGKILL');
          await wait(closePromise, 2000, 'Diagnostic process did not exit');
        }
      }
    }
  } catch (error) {
    report.cleanupError = redact(error.message); process.exitCode = 1;
    if (browser && !closed) {
      browser.stdio[3].destroy(); browser.stdio[4].destroy(); browser.stderr.destroy(); browser.unref();
    }
  } finally {
    report.processAfterCleanup = browser ? { pid: browser.pid ?? null, exitCode: browser.exitCode, signalCode: browser.signalCode, closed } : null;
    report.processStderr = redact(stderr.toString('utf8'));
    report.processStderrTruncated = stderrTruncated;
    if (!browser?.pid || closed) {
      try { rmSync(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
      catch (error) { report.scratchCleanupError = redact(error.message); process.exitCode = 1; }
    } else {
      report.scratchRetained = 'Diagnostic process exit was not confirmed'; process.exitCode = 1;
    }
    console.log(JSON.stringify(report, null, 2));
  }
}
