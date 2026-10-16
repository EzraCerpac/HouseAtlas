import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** The installed three.js MIT notice, carried in every emitted chunk that
 * contains three.js code. The backend serves only its allowlisted static
 * types, so the notice travels as a leading JavaScript comment rather than as
 * a separate text file. The checked-in copy must equal the installed one. */
export function threeNoticeBanner(frontendRoot) {
  const installed = readFileSync(resolve(frontendRoot, 'node_modules/three/LICENSE'), 'utf8');
  const kept = readFileSync(join(resolve(frontendRoot), 'licenses/three-LICENSE.txt'), 'utf8');
  if (installed !== kept) throw new Error('licenses/three-LICENSE.txt differs from the installed three.js LICENSE');
  if (installed.includes('*/')) throw new Error('three.js LICENSE cannot be carried in a block comment');
  const { version } = JSON.parse(readFileSync(resolve(frontendRoot, 'node_modules/three/package.json'), 'utf8'));
  const banner = `/*! three.js ${version}\n${installed.trimEnd()}\n*/\n`;
  return chunk => chunk.moduleIds.some(id => id.replaceAll('\\', '/').includes('/node_modules/three/')) ? banner : '';
}
