import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import { summarize } from '../contract/index.mjs';

const ids = ['frontend.startup_js.bytes', 'frontend.startup_js.gzip_bytes', 'frontend.bundle.largest_asset_bytes'];
const unavailable = (status, reason) => ids.map(id => ({ id, status, reason }));
export function childEnvironment(scratch) {
  return { PATH: dirname(process.execPath) + ':/usr/bin:/bin', NODE_ENV: 'production', NO_COLOR: '1', LANG: 'C.UTF-8', TZ: 'UTC', TMPDIR: scratch };
}
export function buildToolchain(root) {
  const version = name => {
    try {
      const result = JSON.parse(readFileSync(resolve(root, 'frontend/node_modules', name, 'package.json'))).version;
      return typeof result === 'string' && /^[0-9A-Za-z.+-]{1,64}$/.test(result) ? result : null;
    } catch { return null; }
  };
  return { buildVite: version('vite'), buildReact: version('react') };
}
/** Static startup script/modulepreload bytes, not observed browser requests or parse time. */
export function inspectBundle(directory) {
  let count = 0, largest = 0;
  function visit(path) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error('Nonregular bundle');
    if (stat.isDirectory()) for (const name of readdirSync(path)) visit(join(path, name));
    else {
      if (!stat.isFile() || ++count > 4096 || stat.size > 64 * 1024 * 1024) throw new Error('Bundle work bound');
      largest = Math.max(largest, stat.size);
    }
  }
  visit(directory);
  const index = resolve(directory, 'index.html'), stat = lstatSync(index);
  if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('Invalid built index');
  const html = readFileSync(index, 'utf8'), paths = new Set();
  for (const match of html.matchAll(/<(script|link)\b[^>]*>/g)) {
    const tag = match[0];
    const attribute = name => new RegExp(`\\b${name}=["']([^"']+)["']`).exec(tag)?.[1];
    if (match[1] === 'script' ? attribute('type') !== 'module' : attribute('rel') !== 'modulepreload') continue;
    const url = attribute(match[1] === 'script' ? 'src' : 'href');
    if (!url || !url.endsWith('.js') || url.startsWith('//') || /[?#\\]/.test(url) || /^[a-z]+:/i.test(url)) throw new Error('Unsupported startup asset');
    const path = resolve(directory, url.replace(/^\//, ''));
    if (!realpathSync(path).startsWith(realpathSync(directory) + '/') || lstatSync(path).isSymbolicLink()) throw new Error('Startup asset escaped bundle');
    paths.add(path);
  }
  if (paths.size < 1 || paths.size > 128) throw new Error('Invalid startup asset count');
  let bytes = 0, gzip = 0;
  for (const path of paths) { const data = readFileSync(path); bytes += data.length; gzip += gzipSync(data).length; }
  return { bytes, gzip, largest, startup: [...paths].map(path => relative(directory, path)).sort() };
}

export function measureBundle(root, scratch) {
  if (!existsSync(resolve(root, 'frontend/vite.config.ts'))) return unavailable('unsupported', 'feature-not-present');
  if (!existsSync(resolve(root, 'frontend/node_modules/vite/bin/vite.js'))) return unavailable('blocked', 'dependency-unavailable');
  try {
    const output = resolve(scratch, 'dist');
    execFileSync(process.execPath, [resolve(root, 'frontend/node_modules/vite/bin/vite.js'), 'build', '--outDir', output, '--emptyOutDir'],
      { cwd: resolve(root, 'frontend'), env: childEnvironment(scratch), stdio: 'pipe', timeout: 120_000, maxBuffer: 1024 * 1024 });
    const value = inspectBundle(output), samples = [value.bytes, value.gzip, value.largest];
    return ids.map((id, i) => ({ id, status: 'measured', samples: [samples[i]], summary: summarize([samples[i]]) }));
  } catch { return unavailable('failed', 'build-unavailable'); }
}
