import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { sha256 } from './fixtures.mjs';

export function sourceRoot(path) {
  const root = realpathSync(path);
  if (!lstatSync(root).isDirectory()) throw new Error('Invalid source root');
  const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8', timeout: 5000 }).trim();
  if (realpathSync(top) !== root) throw new Error('Source root must be the checkout root');
  return root;
}
export function gitIdentity(root) {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024 });
  const commit = git(['rev-parse', '--verify', 'HEAD']).trim(), tree = git(['rev-parse', '--verify', 'HEAD^{tree}']).trim();
  if (![commit, tree].every(value => /^[0-9a-f]{40}$/.test(value))) throw new Error('Unsupported Git identity');
  return { commit, tree, dirty: git(['status', '--porcelain=v1', '-z', '--untracked-files=normal']).length > 0 };
}
export function harnessDigest(root) {
  const rows = [];
  function visit(path) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error('Harness source must be regular');
    if (stat.isDirectory()) for (const entry of readdirSync(path).sort()) { if (entry !== 'node_modules') visit(join(path, entry)); }
    else { if (!stat.isFile()) throw new Error('Harness source must be regular'); rows.push([relative(root, path), sha256(readFileSync(path))]); }
  }
  visit(resolve(root, 'tools/perf/harness')); visit(resolve(root, 'tools/perf/contract'));
  return sha256(JSON.stringify(rows));
}
export function readSource(root, path, observed) {
  if (!path.startsWith('frontend/') || path.split('/').some(part => part === '..' || part === '.')) throw new Error('Unsupported source path');
  const file = resolve(root, path), stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024 || !realpathSync(file).startsWith(root + '/')) throw new Error('Unsupported source file');
  const bytes = readFileSync(file); observed.set(path, sha256(bytes)); return bytes;
}
