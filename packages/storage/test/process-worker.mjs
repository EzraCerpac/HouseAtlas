import { readFileSync } from 'node:fs';
import { AtlasStore, options, scope, principal, createCircuit, circuitTarget } from './helpers.mjs';
const [mode, path, phase, payloadFile] = process.argv.slice(2);
const crash = () => process.kill(process.pid, 'SIGKILL');
const store = new AtlasStore({ ...options(path), fault: p => { if (mode === 'interrupt' && p === phase) crash(); } });
if (mode === 'migration') throw new Error('Migration fault was not reached');
if (mode === 'race') {
  process.stdout.write('ready\n');
  process.stdin.once('data', () => {
    const payload = JSON.parse(readFileSync(payloadFile));
    try { const r = store.execute(principal, scope, payload.target, payload.command); process.stdout.write(JSON.stringify({ result: r.record.recordId }) + '\n'); }
    catch (error) { process.stdout.write(JSON.stringify({ code: error.code }) + '\n'); }
    store.close(); process.exit(0);
  });
} else {
  if (payloadFile) store.executeBatch(principal, scope, JSON.parse(readFileSync(payloadFile)));
  else store.execute(principal, scope, circuitTarget, createCircuit());
  if (mode === 'lost-response') crash();
  store.close();
}
