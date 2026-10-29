// Rewrites the publication source manifest's file rows and aggregate digest from
// the working tree, using the walk and file rules of verify-source.mjs. Reads the
// tree and the named manifests; writes only the manifest, and nothing in --check.
// Never runs controls, Git or network calls.
//
//   node tools/publication/refresh-manifest.mjs [--check] [--root DIR]
//     [--owner PATH=OWNER ...] [--owners-from MANIFEST ...]
//
// Existing rows keep their owner (an --owner naming another is refused); files
// no longer present drop out. A path with no row needs --owner, or a row in an
// --owners-from manifest (for example the other side of a merge); every owner
// must be listed in this manifest's owners.
// Exit 0: written or already current. 1: --check found drift. 2: refused.
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const manifestPath = 'docs/publication/source-manifest.json';
const ignored = new Set(['.git', 'node_modules', 'dist']);
const safePath = path => /^[a-zA-Z0-9._/-]+$/.test(path) && !path.split('/').some(p => p === '..' || p === '.' || !p);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

class Refusal extends Error {}
const refuse = message => { throw new Refusal(message); };

function walk(root, directory, out) {
  for (const name of readdirSync(directory).sort()) {
    if (ignored.has(name)) continue;
    const path = join(directory, name), stat = lstatSync(path);
    if (stat.isSymbolicLink()) refuse(`${relative(root, path)} is a symlink; source entries must not be symlinks`);
    if (stat.isDirectory()) walk(root, path, out);
    else if (stat.isFile()) out.push(relative(root, path));
    else refuse(`${relative(root, path)} is not a regular file`);
  }
  return out;
}

function readManifest(file, what) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (error) { refuse(`cannot read ${what} ${file}: ${error.message}`); }
  if (/^(<{7}|={7}|>{7}|\|{7})( |$)/m.test(text)) {
    refuse(`${what} ${file} contains merge conflict markers; take one side first, for example ` +
      `git checkout --ours ${manifestPath}, and pass the other side with --owners-from`);
  }
  try { return { text, manifest: JSON.parse(text) }; } catch (error) { refuse(`${what} ${file} is not JSON: ${error.message}`); }
}

function listed(paths, limit = 20) {
  const shown = paths.slice(0, limit).map(path => `  ${path}`);
  if (paths.length > limit) {
    const tops = new Map();
    for (const path of paths) { const top = path.split('/')[0]; tops.set(top, (tops.get(top) ?? 0) + 1); }
    shown.unshift(`  by top-level entry: ${[...tops].map(([top, count]) => `${top} (${count})`).join(', ')}`);
    shown.push(`  ... and ${paths.length - limit} more`);
  }
  return shown.join('\n');
}

function refresh(argv) {
  const { values } = parseArgs({
    args: argv, strict: true, allowPositionals: false,
    options: {
      check: { type: 'boolean', default: false },
      root: { type: 'string' },
      owner: { type: 'string', multiple: true, default: [] },
      'owners-from': { type: 'string', multiple: true, default: [] },
    },
  });
  if (process.version !== 'v26.10.0') refuse(`Node v26.10.0 is required, found ${process.version}`);
  const root = values.root === undefined ? fileURLToPath(new URL('../../', import.meta.url)) : resolve(values.root);
  const file = join(root, manifestPath);
  const { text: before, manifest } = readManifest(file, 'manifest');
  if (manifest.format !== 'houseatlas-publication-source/1') refuse(`${manifestPath}: unexpected format ${JSON.stringify(manifest.format)}`);
  if (JSON.stringify(manifest.self) !== JSON.stringify({ path: manifestPath, mode: '100644', digest: 'anchored-by-reviewed-tree' })) {
    refuse(`${manifestPath}: unexpected self entry`);
  }
  if (!Array.isArray(manifest.owners) || !Array.isArray(manifest.files)) refuse(`${manifestPath}: owners and files must be lists`);
  const stat = lstatSync(file);
  if (!stat.isFile() || (stat.mode & 0o111)) refuse(`${manifestPath} must be a regular non-executable file`);

  const owners = new Map();
  for (const row of manifest.files) {
    if (owners.has(row.path)) refuse(`${manifestPath}: duplicate row ${row.path}`);
    if (!manifest.owners.includes(row.owner)) refuse(`${manifestPath}: ${row.path} has unknown owner ${JSON.stringify(row.owner)}`);
    owners.set(row.path, row.owner);
  }
  const fallback = new Map();
  for (const other of values['owners-from']) {
    for (const row of readManifest(resolve(other), '--owners-from manifest').manifest.files ?? []) {
      if (!fallback.has(row.path)) fallback.set(row.path, row.owner);
    }
  }

  const actual = walk(root, root, []).filter(path => path !== manifestPath).sort();
  const present = new Set(actual);
  const explicit = new Map();
  for (const entry of values.owner) {
    const split = entry.indexOf('=');
    const path = entry.slice(0, split), owner = entry.slice(split + 1);
    if (split < 1 || !owner) refuse(`--owner ${entry}: expected PATH=OWNER`);
    if (explicit.has(path)) refuse(`--owner names ${path} twice`);
    if (!present.has(path)) refuse(`--owner ${entry}: ${path} is not a regular file in ${root}`);
    if (owners.has(path) && owners.get(path) !== owner) refuse(`--owner ${entry}: ${path} already has a row owned by ${owners.get(path)}; edit that row to change ownership`);
    explicit.set(path, owner);
  }

  const rows = [], unowned = [];
  for (const path of actual) {
    const owner = owners.get(path) ?? explicit.get(path) ?? fallback.get(path);
    if (owner === undefined) { unowned.push(path); continue; }
    if (!manifest.owners.includes(owner)) refuse(`${path}: owner ${JSON.stringify(owner)} is not in ${manifestPath} owners (${manifest.owners.join(', ')})`);
    rows.push({ path, owner });
  }
  if (unowned.length) {
    refuse(`${unowned.length} path(s) have no manifest row and no owner:\n${listed(unowned)}\n` +
      `Pass --owner PATH=OWNER for each new file (owners: ${manifest.owners.join(', ')}). ` +
      'The walk matches verify-source.mjs, so build output and other untracked files are included: ' +
      'run from a clean checkout or remove them.');
  }

  const unsafe = rows.map(row => row.path).filter(path => !safePath(path));
  if (unsafe.length) refuse(`paths outside [a-zA-Z0-9._/-] or with empty, . or .. segments:\n${listed(unsafe)}`);
  manifest.files = rows.map(({ path, owner }) => {
    const full = join(root, path), bytes = readFileSync(full);
    return { path, mode: (lstatSync(full).mode & 0o111) ? '100755' : '100644', bytes: bytes.length, sha256: hash(bytes), owner };
  });
  manifest.sourceDigestSha256 = hash(Buffer.from(manifest.files.map(r => `${r.path}\t${r.mode}\t${r.bytes}\t${r.sha256}\n`).join('')));
  const after = JSON.stringify(manifest, null, 2) + '\n';

  const old = new Map(JSON.parse(before).files.map(row => [row.path, JSON.stringify(row)]));
  const added = actual.filter(path => !old.has(path));
  const removed = [...old.keys()].filter(path => !present.has(path));
  const changed = manifest.files.filter(row => old.has(row.path) && old.get(row.path) !== JSON.stringify(row)).map(row => row.path);
  const summary = [['added', added], ['removed', removed], ['changed', changed]]
    .filter(([, paths]) => paths.length).map(([label, paths]) => `${label} ${paths.length}:\n${listed(paths)}`).join('\n');
  if (after === before) {
    console.log(`${manifestPath} is current (${manifest.files.length} rows)`);
    return 0;
  }
  if (values.check) {
    console.log(`${manifestPath} is stale; a refresh would change it\n${summary || 'formatting or aggregate digest only'}`);
    return 1;
  }
  writeFileSync(file, after);
  console.log(`Rewrote ${manifestPath} (${manifest.files.length} rows)\n${summary || 'formatting or aggregate digest only'}`);
  return 0;
}

try {
  process.exitCode = refresh(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof Refusal) && !String(error?.code).startsWith('ERR_PARSE_ARGS')) throw error;
  console.error(`refresh-manifest: refused: ${error.message}`);
  process.exitCode = 2;
}
