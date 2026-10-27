import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Complete local runtime closure for this tool. Node core APIs and Vite's
// resulting production adapter bundle have separately recorded identities.
// Adding another runtime import requires extending this explicit allowlist.
export const measurementDriverPaths = Object.freeze([
  '.mise/tasks/perf-host-client',
  'tools/perf/host-client/compare.mjs',
  'tools/perf/host-client/driver-identity.mjs',
  'tools/perf/host-client/fixture.mjs',
  'tools/perf/host-client/options.mjs',
  'tools/perf/host-client/run.mjs',
  'tools/perf/host-client/transport.mjs',
]);
export function measurementDriverIdentity(root) {
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const files = measurementDriverPaths.map(path => {
    const bytes = readFileSync(join(root, path));
    assert(bytes.length <= 1024 * 1024, 'Measurement driver source bound');
    return { path, bytes: bytes.length, sha256: hash(bytes) };
  });
  const format = 'houseatlas-host-client-driver/1';
  const manifest = format + '\n' + files.map(row =>
    row.path + '\t' + row.bytes + '\t' + row.sha256 + '\n').join('');
  return { format, sha256: hash(manifest), files };
}
