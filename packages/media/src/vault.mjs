import { createHash } from 'node:crypto';
import { constants, openSync, closeSync, fstatSync, readSync, writeFileSync, fsyncSync, mkdirSync, lstatSync, realpathSync, readdirSync, mkdtempSync, linkSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { canonicalJson, validateShape } from '../../contracts/src/index.mjs';
import { MAX_BYTES, deny, timed, collect } from './bytes.mjs';
import { validateContent } from './content.mjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function privateDirectory(path) {
  const absolute = resolve(path);
  try { mkdirSync(absolute, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const info = lstatSync(absolute);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077)) deny(503);
  return realpathSync(absolute);
}
export function readPrivate(path, maxBytes) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > maxBytes) deny(413);
    const chunks = []; let size = 0;
    while (true) {
      const chunk = Buffer.alloc(Math.min(65536,maxBytes+1-size)), count = readSync(fd,chunk,0,chunk.length,null);
      if (!count) break; size += count; if (size > maxBytes) deny(413); chunks.push(chunk.subarray(0,count));
    }
    if (size !== stat.size) deny(413);
    return Buffer.concat(chunks,size);
  } finally { closeSync(fd); }
}
export function writePrivate(path, bytes, mode = 0o600) {
  const fd = openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,mode);
  try { writeFileSync(fd,bytes); fsyncSync(fd); } finally { closeSync(fd); }
}
export function syncDirectory(path) { const fd = openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW); try { fsyncSync(fd); } finally { closeSync(fd); } }
const scopeKey = scope => { validateShape('scope',scope); return sha256(canonicalJson(scope)); };
export const storageKeyFor = (scope,digest) => `atlas-v1:${scopeKey(scope)}:${digest}`;

function pinDirectory(path) {
  const info = lstatSync(path,{bigint:true});
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077n) || realpathSync(path) !== path) deny(503);
  return {path,dev:info.dev,ino:info.ino};
}
function assertDirectory(pin) {
  const current = pinDirectory(pin.path);
  if (current.dev !== pin.dev || current.ino !== pin.ino) deny(503);
}

// Trusted server filesystem constructor. No paths or keys supplied by a browser
// are ever opened. All originals are immutable and retained, including orphans.
export class AssetVault {
  #root; #blobs; #staging; #fault; #rootPin; #blobsPin; #stagingPin; #scopes = new Map();
  constructor({ root, fault = () => {} }) {
    if (typeof root !== 'string' || typeof fault !== 'function') throw new TypeError('Private server vault root required');
    this.#root = privateDirectory(root); this.#blobs = privateDirectory(join(this.#root,'blobs'));
    this.#staging = privateDirectory(join(this.#root,'staging')); this.#fault = fault;
    this.#rootPin = pinDirectory(this.#root); this.#blobsPin = pinDirectory(this.#blobs); this.#stagingPin = pinDirectory(this.#staging);
    for (const name of readdirSync(this.#blobs)) {
      if (!/^[0-9a-f]{64}$/.test(name)) deny(503);
      this.#scopes.set(name,pinDirectory(join(this.#blobs,name)));
    }
  }
  #assertHierarchy() {
    assertDirectory(this.#rootPin); assertDirectory(this.#blobsPin); assertDirectory(this.#stagingPin);
  }
  #scopeDirectory(scope,create = false) {
    this.#assertHierarchy();
    const key = scopeKey(scope), path = join(this.#blobs,key);
    if (!this.#scopes.has(key)) {
      if (create && privateDirectory(path) !== path) deny(503);
      this.#scopes.set(key,pinDirectory(path));
    }
    const pin = this.#scopes.get(key); assertDirectory(pin); return pin;
  }
  #removeTransaction(pin) {
    // Never follow a replaced parent or remove another operation's directory.
    // An unreachable original transaction stays retained for offline diagnosis.
    try { assertDirectory(this.#rootPin); assertDirectory(this.#stagingPin); assertDirectory(pin); }
    catch { return; }
    rmSync(pin.path,{recursive:true,force:true});
  }
  #path(record) {
    const scope = {workspaceId:record.workspaceId,homeId:record.homeId}, p = record.payload;
    validateShape('assetRecord',record);
    if (p.owner !== 'atlas' || !['geometry-original','evidence-original'].includes(p.purpose) || p.storageKey !== storageKeyFor(scope,p.sha256) || p.byteSize > MAX_BYTES) deny();
    const directory = this.#scopeDirectory(scope);
    return join(directory.path,`${p.sha256}.blob`);
  }
  #put(scope,bytes) {
    const digest = sha256(bytes), directory = this.#scopeDirectory(scope,true);
    const transaction = pinDirectory(mkdtempSync(join(this.#staging,'original-'))), staged = join(transaction.path,'bytes'), destination = join(directory.path,`${digest}.blob`);
    try {
      writePrivate(staged,bytes,0o400); this.#fault('after-stage');
      this.#assertHierarchy(); assertDirectory(directory); assertDirectory(transaction);
      try { linkSync(staged,destination); } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (sha256(readPrivate(destination,MAX_BYTES)) !== digest) deny(503);
      }
      syncDirectory(directory.path); this.#fault('after-install');
      this.#assertHierarchy(); assertDirectory(directory);
      return {storageKey:storageKeyFor(scope,digest),sha256:digest,byteSize:bytes.length};
    } finally { this.#removeTransaction(transaction); }
  }
  async prepareOriginal({ scope, purpose, contentType, body, signal, timeoutMs = 10000 }) {
    validateShape('scope',scope);
    if (!['geometry-original','evidence-original'].includes(purpose) || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) deny(422);
    return timed(signal,timeoutMs,async context => {
      const bytes = await collect(body,context); context.check(); validateContent(bytes,contentType,{check:context.check}); context.check();
      const identity = this.#put(scope,bytes); context.check();
      return Object.freeze({owner:'atlas',purpose,...identity,contentType,availability:'available',previewPolicy:contentType === 'image/png' ? 'safe-rendered' : 'download-only'});
    });
  }
  readRetained(record) {
    const bytes = readPrivate(this.#path(record),MAX_BYTES), p = record.payload;
    this.#scopeDirectory({workspaceId:record.workspaceId,homeId:record.homeId});
    if (bytes.length !== p.byteSize || sha256(bytes) !== p.sha256) deny(503);
    return bytes;
  }
  verifyAvailableAsset = record => {
    const bytes = this.readRetained(record); validateContent(bytes,record.payload.contentType);
    if (record.payload.previewPolicy === 'safe-rendered' && record.payload.contentType !== 'image/png') deny(415);
    return {sha256:sha256(bytes),byteSize:bytes.length};
  };
  // Offline recovery seam, never mounted as a domain command or upload route.
  restoreRetained(record,bytes) {
    validateShape('assetRecord',record);
    const scope = {workspaceId:record.workspaceId,homeId:record.homeId}, p = record.payload;
    if (p.owner !== 'atlas' || !['geometry-original','evidence-original'].includes(p.purpose) || p.storageKey !== storageKeyFor(scope,p.sha256) || bytes.length !== p.byteSize || sha256(bytes) !== p.sha256) deny(503);
    validateContent(bytes,p.contentType); this.#put(scope,Buffer.from(bytes));
  }
  // Only abandoned, unlinked temporary staging can be removed after a drained
  // process restart. Installed bytes are never deleted or treated as disposable.
  cleanupStagingAfterDrain() {
    // Integrator must ensure no other vault/process writer uses this directory.
    this.#assertHierarchy();
    for (const name of readdirSync(this.#staging)) {
      this.#assertHierarchy(); rmSync(join(this.#staging,name),{recursive:true,force:true});
    }
    syncDirectory(this.#staging);
  }
}
