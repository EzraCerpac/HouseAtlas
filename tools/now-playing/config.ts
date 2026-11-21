import { parseArgs } from 'node:util';
import { statSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { COVER_LIKE } from './writer.ts';

export class Refusal extends Error {}
function need(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Refusal(message);
}
const MAX_PATH = 4096;
export type Config = { pipePath: string; snapshotPath: string };

/** `--pipe <absolute path> --snapshot <absolute path>`; fixed messages, never the input. */
export function parseFlags(argv: string[]): Config {
  let values: { pipe?: string; snapshot?: string };
  try {
    const parsed = parseArgs({ args: argv, options: { pipe: { type: 'string' }, snapshot: { type: 'string' } }, allowPositionals: false, tokens: true });
    const names = parsed.tokens.filter(t => t.kind === 'option').map(t => (t as { name: string }).name);
    if (new Set(names).size !== names.length) throw new Error('repeated flag');
    values = parsed.values;
  } catch { throw new Refusal('Usage: --pipe <absolute path> --snapshot <absolute path>'); }
  const { pipe, snapshot } = values;
  need(pipe !== undefined && snapshot !== undefined, 'Usage: --pipe <absolute path> --snapshot <absolute path>');
  for (const p of [pipe, snapshot]) need(p.length <= MAX_PATH && !p.includes('\0') && isAbsolute(p) && resolve(p) === p, 'Paths must be absolute and normalized');
  need(pipe !== snapshot, 'Pipe and snapshot paths must differ');
  need(!COVER_LIKE.test(basename(snapshot)), 'Snapshot name is reserved for cover files');
  // The snapshot directory holds the helper's own files (cover pruning); the pipe lives elsewhere.
  need(dirname(pipe).toLowerCase() !== dirname(snapshot).toLowerCase(), 'Pipe must not be in the snapshot directory');
  return { pipePath: pipe, snapshotPath: snapshot };
}

/** The pipe's and the snapshot's directories must exist and be different directories (by identity, so symlinked
 *  parents cannot alias them): the snapshot directory is the helper's own, and its writes must never replace the pipe. */
export function checkDirectories(config: Config): void {
  let pipeDir, snapshotDir;
  try { pipeDir = statSync(dirname(config.pipePath)); snapshotDir = statSync(dirname(config.snapshotPath)); }
  catch { throw new Refusal('Pipe and snapshot directories must exist'); }
  need(!(pipeDir.dev === snapshotDir.dev && pipeDir.ino === snapshotDir.ino), 'Pipe must not be in the snapshot directory');
}
