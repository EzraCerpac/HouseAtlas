import { constants } from 'node:fs';
import { lstat, open, readdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

// Typical snapshots are well under 1 KiB; the worst case is four 256-code-point texts of four-byte characters.
export const MAX_SNAPSHOT_BYTES = 8 * 1024;
export const COVER_NAME = /^cover-[0-9a-f]{64}\.(?:jpg|png)$/;
// For refusing other paths that could alias a cover name on a case-insensitive file system.
export const COVER_LIKE = new RegExp(COVER_NAME.source, 'i');
export type Hooks = { beforeRename?: () => void | Promise<void> };

// A new exclusive 0600 sibling temp file, then a rename over the target: readers see the old or the new complete
// file. No fsync: a crash can only lose freshness (readers treat an old `checkedAt` as unknown), and readers verify
// a cover's digest.
async function replace(path: string, data: string | Buffer, hooks: Hooks): Promise<void> {
  const temp = `${path}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  // O_EXCL (never follows or reuses an existing name): only a file created here is ever cleaned up.
  const file = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    try { await file.writeFile(data); } finally { await file.close(); }
    await hooks.beforeRename?.();
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}

export function snapshotWriter(path: string, hooks: Hooks = {}) {
  return async (text: string): Promise<void> => {
    if (Buffer.byteLength(text) > MAX_SNAPSHOT_BYTES) throw new Error('Snapshot exceeds byte limit');
    await replace(path, text, hooks);
  };
}

/** Cover files live beside the snapshot, named by `coverName`; the directory should be the helper's alone. */
export function coverFiles(dir: string, hooks: Hooks = {}) {
  return {
    write: (name: string, bytes: Buffer): Promise<void> => {
      if (!COVER_NAME.test(name)) throw new Error('Not a cover file name');
      return replace(join(dir, name), bytes, hooks);
    },
    /** Removes every regular cover file except `keep`; never touches any other name or file type. Throws after trying all. */
    async prune(keep: string | null): Promise<void> {
      let failure: unknown = null;
      for (const name of await readdir(dir)) {
        if (name === keep || !COVER_NAME.test(name)) continue;
        try { if ((await lstat(join(dir, name))).isFile()) await unlink(join(dir, name)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') failure = error; }
      }
      if (failure) throw failure;
    },
  };
}
