import { dirname } from 'node:path';
import { checkDirectories, parseFlags, Refusal } from './config.ts';
import { Helper } from './helper.ts';
import { openPipe } from './pipe.ts';
import { coverFiles, snapshotWriter } from './writer.ts';

async function main() {
  if (process.version !== 'v26.10.0') throw new Error('Node 26.10.0 required');
  const config = parseFlags(process.argv.slice(2));
  checkDirectories(config);
  process.umask(0o077);
  const covers = coverFiles(dirname(config.snapshotPath));
  const helper = new Helper({
    open: openPipe(config.pipePath),
    write: snapshotWriter(config.snapshotPath),
    writeCover: covers.write,
    pruneCovers: covers.prune,
    clock: { now: () => Date.now(), setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); } },
    log: message => console.error(message),
  });
  await helper.start();
  await new Promise<void>(resolve => {
    const stop = () => { process.off('SIGTERM', stop); process.off('SIGINT', stop); resolve(); };
    process.on('SIGTERM', stop); process.on('SIGINT', stop);
  });
  await helper.stop();
}
// Fixed messages only: never print paths, pipe contents or exception text.
main().catch(error => { console.error(error instanceof Refusal ? error.message : 'Now-playing helper could not write its snapshot; check the snapshot directory'); process.exitCode = 1; });
