import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function readReportZip(bytes) {
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length > 262144) throw new Error();
    const payload = execFileSync('python3', ['-I', fileURLToPath(new URL('./read-report-zip.py', import.meta.url))],
      { input: bytes, maxBuffer: 8 * 1024 * 1024, timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH, LANG: 'C.UTF-8' } });
    const entries = JSON.parse(payload.toString('utf8'));
    const artifactSha256 = createHash('sha256').update(bytes).digest('hex');
    if (Object.keys(entries).length === 1 && typeof entries['availability.json'] === 'string') {
      return { kind: 'availability', record: JSON.parse(entries['availability.json']), artifactSha256 };
    }
    if (Object.keys(entries).length === 2 && typeof entries['base.json'] === 'string' && typeof entries['head.json'] === 'string') {
      return { kind: 'measurements', baseRun: JSON.parse(entries['base.json']), headRun: JSON.parse(entries['head.json']), artifactSha256 };
    }
    throw new Error();
  } catch { throw new Error('Invalid performance artifact'); }
}
