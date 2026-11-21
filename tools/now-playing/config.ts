import { parseArgs } from 'node:util';
import { basename, isAbsolute, resolve } from 'node:path';
import { COVER_NAME } from './writer.ts';

export class Refusal extends Error {}
function need(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Refusal(message);
}
const MAX_PATH = 4096;
export type Config = { pipePath: string; snapshotPath: string };

/** `--pipe <absolute path> --snapshot <absolute path>`; fixed messages, never the input. */
export function parseFlags(argv: string[]): Config {
  let values: { pipe?: string; snapshot?: string };
  try { values = parseArgs({ args: argv, options: { pipe: { type: 'string' }, snapshot: { type: 'string' } }, allowPositionals: false }).values; }
  catch { throw new Refusal('Usage: --pipe <absolute path> --snapshot <absolute path>'); }
  const { pipe, snapshot } = values;
  need(pipe !== undefined && snapshot !== undefined, 'Usage: --pipe <absolute path> --snapshot <absolute path>');
  for (const p of [pipe, snapshot]) need(p.length <= MAX_PATH && !p.includes('\0') && isAbsolute(p) && resolve(p) === p, 'Paths must be absolute and normalized');
  need(pipe !== snapshot, 'Pipe and snapshot paths must differ');
  need(!COVER_NAME.test(basename(snapshot)), 'Snapshot name is reserved for cover files');
  return { pipePath: pipe, snapshotPath: snapshot };
}
