import { parseArgs } from 'node:util';
import { loadConfig, readPrivate, Refusal, parseJson } from './config.ts';
import { validateInventory, MAX_INVENTORY_BYTES } from './inventory.ts';
import { Store } from './store.ts';
import { run, addresses } from './collect.ts';
import { Actions, periodic } from './actions.ts';
import { Scheduler } from './scheduler.ts';
import { server } from './http.ts';

async function main() {
  if (process.version !== 'v26.10.0') throw new Error('Node 26.10.0 required');
  const { values } = parseArgs({ options: { config: { type: 'string' }, once: { type: 'boolean', default: false } } });
  if (!values.config) throw new Error('--config is required');
  const config = loadConfig(values.config);
  process.umask(0o077);
  const store = new Store(config.storePath);
  const loadInventory = () => store.accept(validateInventory(parseJson(readPrivate(config.inventoryPath, MAX_INVENTORY_BYTES))));
  const actions = new Actions(store, config, run, addresses);
  let scheduler: Scheduler | undefined;
  let extrasScheduler: Scheduler | undefined;
  let http: ReturnType<typeof server> | undefined;
  let closing: Promise<void> | undefined;
  const shutdown = () => closing ??= (async () => {
    const closed = http ? new Promise<void>(resolve => { http!.close(() => resolve()); http!.closeAllConnections(); }) : Promise.resolve();
    await Promise.all([scheduler?.shutdown(), extrasScheduler?.shutdown(), actions.shutdown()]); await closed;
  })();
  const stop = () => { void shutdown(); };
  try {
    loadInventory();
    scheduler = new Scheduler(async signal => {
      // Reject a bad replacement as a whole, retain the previous accepted copy.
      try { loadInventory(); } catch { console.error('Inventory replacement refused; retaining accepted inventory'); }
      const at = Date.now();
      const result = await actions.collectRoutine(store.inventory()!, signal);
      store.record(at, result.guard, result.facts, config);
    });
    process.on('SIGTERM', stop); process.on('SIGINT', stop);
    extrasScheduler = new Scheduler(async signal => { if (!signal.aborted) await periodic(store, config, actions); });
    if (values.once) await Promise.all([scheduler.tick(), extrasScheduler.tick()]);
    else {
      http = server(store, config.listen, config, actions);
      await new Promise<void>((resolve, reject) => { http!.once('error', reject); http!.listen(config.listen.port, config.listen.address, resolve); });
      await Promise.all([scheduler.run(config.intervalMs), extrasScheduler.run(60_000)]);
    }
  } finally {
    try { await shutdown(); } finally { store.close(); }
    process.off('SIGTERM', stop); process.off('SIGINT', stop);
  }
}
// Fixed refusal messages only: never print config, inventory, command output,
// SQLite paths, local hostnames or arbitrary exception text.
main().catch(error => { console.error(error instanceof Refusal ? error.message : 'Network collector refused configuration, storage or startup; check private JSON, file modes and exclusive store access'); process.exitCode = 1; });
