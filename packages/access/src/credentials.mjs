import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const options = Object.freeze({ N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const pattern = /^scrypt:32768:8:1:([a-f0-9]{32}):([a-f0-9]{64})$/;
export const DUMMY_VERIFIER = `scrypt:32768:8:1:${'0'.repeat(32)}:${'0'.repeat(64)}`;
export const validVerifier = value => typeof value === 'string' && pattern.test(value);
export function validPassword(value) {
  return typeof value === 'string' && value.length >= 12 && Buffer.byteLength(value) <= 1024;
}
/** Server provisioning seam. Only synthetic passwords are provisioned by this package's tests. */
export async function hashPassword(password) {
  if (!validPassword(password)) throw new TypeError('Password must contain 12 characters and at most 1024 bytes');
  const salt = randomBytes(16);
  const hash = await derive(password, salt, 32, options);
  return `scrypt:32768:8:1:${salt.toString('hex')}:${hash.toString('hex')}`;
}
export async function verifyPassword(password, verifier) {
  const parsed = pattern.exec(validVerifier(verifier) ? verifier : DUMMY_VERIFIER);
  // Always perform the same derivation for absent/disabled users and malformed passwords.
  const hash = await derive(validPassword(password) ? password : 'invalid-synthetic-password', Buffer.from(parsed[1], 'hex'), 32, options);
  return validPassword(password) && validVerifier(verifier) && timingSafeEqual(hash, Buffer.from(parsed[2], 'hex'));
}
