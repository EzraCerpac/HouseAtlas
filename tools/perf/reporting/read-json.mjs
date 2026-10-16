// A fixed, bounded data-only ingress. The measurement owner supplies validation.
import { constants, closeSync, fstatSync, openSync, readSync } from 'node:fs';

export function readMeasurement(file, validate) {
  let fd;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size < 2 || stat.size > 1024 * 1024) throw new Error();
    const bytes = Buffer.alloc(stat.size + 1);
    let length = 0, count;
    while (length < bytes.length && (count = readSync(fd, bytes, length, bytes.length - length, null)) > 0) length += count;
    if (length !== stat.size || fstatSync(fd).size !== stat.size) throw new Error();
    const value = JSON.parse(bytes.subarray(0, length).toString('utf8'));
    if (!validate(value)) throw new Error();
    return value;
  } catch {
    // File paths, validator diagnostics and raw values can originate in an
    // untrusted artifact. Do not echo them into logs or privileged comments.
    throw new Error('Invalid measurement artifact');
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
