import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readMeasurement } from './read-json.mjs';
import { validateIdentity } from './report.mjs';
import { compareRuns } from './adapter.mjs';

export function runCli(args, contract) {
  const names = ['--base', '--head', '--identity', '--markdown', '--comparison'];
  if (args.length !== 10) throw new Error('Expected --base FILE --head FILE --identity FILE --markdown FILE --comparison FILE');
  const options = new Map();
  for (let index = 0; index < args.length; index += 2) {
    if (!names.includes(args[index]) || options.has(args[index]) || !args[index + 1]) throw new Error('Invalid report arguments');
    options.set(args[index], args[index + 1]);
  }
  if (options.size !== names.length) throw new Error('Invalid report arguments');
  const identity = readMeasurement(options.get('--identity'), value => { validateIdentity(value); return true; });
  const baseRun = readMeasurement(options.get('--base'), contract.validateRun);
  const headRun = readMeasurement(options.get('--head'), contract.validateRun);
  const result = compareRuns({ identity, baseRun, headRun, contract });
  writeFileSync(options.get('--markdown'), result.markdown + '\n', { flag: 'wx' });
  writeFileSync(options.get('--comparison'), JSON.stringify({ format: 'houseatlas.perf.comparison/1', identity,
    profiles: result.profiles, comparisons: result.comparisons, failed: result.failed }, null, 2) + '\n', { flag: 'wx' });
  return result.failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    // Fixed trusted owner module; no artifact or CLI argument selects executable code.
    const contract = await import('../contract/index.mjs');
    process.exitCode = runCli(process.argv.slice(2), contract);
  } catch {
    console.error('Performance report unavailable: contract, identity, measurements or output invalid.');
    process.exitCode = 1;
  }
}
