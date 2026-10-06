import { DatabaseSync, backup } from 'node:sqlite';
import { lstatSync, existsSync, mkdtempSync, rmSync, renameSync, chmodSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { canonicalJson, validateSnapshot, validateShape, CONTRACT_VERSION } from '../../contracts/src/index.mjs';
import { MIGRATIONS, DATABASE_VERSION } from '../../storage/src/migrations.mjs';
import { AssetVault, sha256, storageKeyFor, readPrivate, writePrivate, privateDirectory, syncDirectory } from './vault.mjs';
import { MAX_BYTES, deny, exact } from './bytes.mjs';

const MAX_DATABASE = 64*1024*1024, MAX_TOTAL = 256*1024*1024, MAX_ASSETS = 10000;
const EXCLUSIONS = ['HomeBox originals','access database and sessions','credentials','server configuration','Network source state'];
const checkSignal = signal => { if (signal != null && !(signal instanceof AbortSignal)) deny(422); if (signal?.aborted) deny(503); };
function databaseAssets(path) {
  const bytes = readPrivate(path,MAX_DATABASE);
  if (!bytes.subarray(0,16).equals(Buffer.from('SQLite format 3\0'))) deny(503);
  const db = new DatabaseSync(path,{readOnly:true});
  try {
    if (db.prepare('PRAGMA user_version').get().user_version !== DATABASE_VERSION || db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) deny(503);
    const migrations = db.prepare('SELECT version,sha256 FROM atlas_migrations ORDER BY version').all();
    if (migrations.length !== MIGRATIONS.length || migrations.some((r,i)=>r.version !== MIGRATIONS[i].version || r.sha256 !== sha256(MIGRATIONS[i].sql))) deny(503);
    const contractVersion = db.prepare("SELECT value FROM atlas_metadata WHERE key='contractVersion'").get()?.value;
    if (contractVersion !== CONTRACT_VERSION) deny(503);
    const snapshot = {contractVersion,synthetic:true};
    for (const [field,table] of [['sources','sources'],['records','records'],['homeboxEntities','projections'],['caches','caches'],['networkRelations','network_relations']]) snapshot[field] = db.prepare(`SELECT body FROM ${table} ORDER BY rowid`).all().map(r=>JSON.parse(r.body));
    validateSnapshot(snapshot);
    const assets = snapshot.records.filter(r=>r.recordType === 'asset').sort((a,b)=>canonicalJson([a.workspaceId,a.homeId,a.recordId]).localeCompare(canonicalJson([b.workspaceId,b.homeId,b.recordId])));
    if (assets.length > MAX_ASSETS) deny(413);
    const manifests = db.prepare('SELECT workspace_id,home_id,record_id,storage_key,body FROM asset_manifests').all();
    if (manifests.length !== assets.length || assets.some(a=>!manifests.some(m=>m.workspace_id === a.workspaceId && m.home_id === a.homeId && m.record_id === a.recordId && m.storage_key === a.payload.storageKey && canonicalJson(JSON.parse(m.body)) === canonicalJson(a.payload)))) deny(503);
    return {assets,bytes,contractVersion};
  } finally { db.close(); }
}
function assetEntry(record,blob) {
  return {workspaceId:record.workspaceId,homeId:record.homeId,assetId:record.recordId,revision:record.revision,lifecycle:record.lifecycle,...structuredClone(record.payload),blob};
}
function noExistingDestination(destination) {
  if (existsSync(destination)) deny(409);
  // existsSync is false for a dangling symlink.
  try { lstatSync(destination); deny(409); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

// Offline/admin interface only. SQLite's backup creates one complete DB state.
// Installed originals cannot be purged, so copying that state's references is
// coherent while subsequent Atlas commits occur. No HomeBox originals are read.
export async function captureRecovery({databasePath,vault,destination,signal,fault = () => {}}) {
  checkSignal(signal); if (!(vault instanceof AssetVault)) throw new TypeError('Atlas vault required');
  destination = resolve(destination); noExistingDestination(destination);
  const parent = privateDirectory(dirname(destination)), staged = mkdtempSync(join(parent,'.atlas-capture-'));
  let source, published = false;
  try {
    readPrivate(databasePath,MAX_DATABASE); // Reject links, directories and oversized state before backup.
    source = new DatabaseSync(databasePath,{readOnly:true});
    await backup(source,join(staged,'atlas.sqlite')); source.close(); source = null; checkSignal(signal);
    const copied = new DatabaseSync(join(staged,'atlas.sqlite'));
    try { copied.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;'); } finally { copied.close(); }
    chmodSync(join(staged,'atlas.sqlite'),0o600);
    const {assets,bytes,contractVersion} = databaseAssets(join(staged,'atlas.sqlite'));
    fault('after-database'); checkSignal(signal);
    privateDirectory(join(staged,'originals')); let total = bytes.length;
    const entries = assets.map((record,index)=> {
      checkSignal(signal); let original, blob = null;
      try {
        const key = storageKeyFor({workspaceId:record.workspaceId,homeId:record.homeId},record.payload.sha256);
        if (record.payload.availability === 'available' || record.payload.storageKey === key) original = vault.readRetained(record);
      }
      catch (error) {
        if (record.payload.availability === 'available' || error.code !== 'ENOENT') throw error;
      }
      if (original) {
        total += original.length; if (total > MAX_TOTAL) deny(413);
        blob = `${index}.blob`; writePrivate(join(staged,'originals',blob),original,0o400);
      }
      return assetEntry(record,blob);
    });
    const manifest = {format:'houseatlas-owned-recovery/1',contractVersion,databaseSchema:DATABASE_VERSION,database:{file:'atlas.sqlite',sha256:sha256(bytes),byteSize:bytes.length},assets:entries,exclusions:EXCLUSIONS,captureMethod:'sqlite-backup-and-retained-immutable-originals'};
    writePrivate(join(staged,'manifest.json'),Buffer.from(canonicalJson(manifest)));
    syncDirectory(join(staged,'originals')); syncDirectory(staged);
    verifyRecovery({bundle:staged}); checkSignal(signal); fault('before-publish');
    noExistingDestination(destination); renameSync(staged,destination); published = true; syncDirectory(parent);
    return structuredClone(manifest);
  } finally { source?.close(); if (!published) rmSync(staged,{recursive:true,force:true}); }
}

export function verifyRecovery({bundle}) {
  if (lstatSync(bundle).isSymbolicLink() || !lstatSync(bundle).isDirectory()) deny(503);
  const manifest = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(readPrivate(join(bundle,'manifest.json'),16*1024*1024)));
  exact(manifest,['format','contractVersion','databaseSchema','database','assets','exclusions','captureMethod']);
  exact(manifest.database,['file','sha256','byteSize']);
  if (manifest.format !== 'houseatlas-owned-recovery/1' || manifest.contractVersion !== CONTRACT_VERSION || manifest.databaseSchema !== DATABASE_VERSION || manifest.database.file !== 'atlas.sqlite' || manifest.captureMethod !== 'sqlite-backup-and-retained-immutable-originals' || !Array.isArray(manifest.assets) || manifest.assets.length > MAX_ASSETS) deny(503);
  if (canonicalJson(manifest.exclusions) !== canonicalJson(EXCLUSIONS)) deny(503);
  const {assets,bytes} = databaseAssets(join(bundle,'atlas.sqlite'));
  if (sha256(bytes) !== manifest.database.sha256 || bytes.length !== manifest.database.byteSize || assets.length !== manifest.assets.length) deny(503);
  const originals = join(bundle,'originals');
  if (lstatSync(originals).isSymbolicLink() || !lstatSync(originals).isDirectory()) deny(503);
  const expectedFiles = []; let total = bytes.length;
  for (let index = 0; index < assets.length; index++) {
    const record = assets[index], entry = manifest.assets[index], blob = entry?.blob;
    if (blob !== null && blob !== `${index}.blob`) deny(503);
    if (canonicalJson(assetEntry(record,blob)) !== canonicalJson(entry) || (record.payload.availability === 'available' && blob === null)) deny(503);
    if (blob !== null) {
      const original = readPrivate(join(originals,blob),MAX_BYTES);
      if (original.length !== record.payload.byteSize || sha256(original) !== record.payload.sha256) deny(503);
      total += original.length; if (total > MAX_TOTAL) deny(413); expectedFiles.push(blob);
    }
  }
  if (canonicalJson(readdirSync(originals).sort()) !== canonicalJson(expectedFiles.sort()) || canonicalJson(readdirSync(bundle).sort()) !== canonicalJson(['atlas.sqlite','manifest.json','originals'])) deny(503);
  return {manifest:structuredClone(manifest),assets:structuredClone(assets)};
}

// Produces a NEW absent destination containing atlas.sqlite and media/. All
// verification precedes publication. No existing database/source is overwritten.
// AT15 must separately restore config/access state and invalidate sessions.
export function restoreRecovery({bundle,destination,fault = () => {}}) {
  destination = resolve(destination); noExistingDestination(destination);
  const verified = verifyRecovery({bundle}), parent = privateDirectory(dirname(destination)), staged = mkdtempSync(join(parent,'.atlas-restore-'));
  let published = false;
  try {
    const databaseBytes = readPrivate(join(bundle,'atlas.sqlite'),MAX_DATABASE);
    if (sha256(databaseBytes) !== verified.manifest.database.sha256) deny(503);
    writePrivate(join(staged,'atlas.sqlite'),databaseBytes);
    const vault = new AssetVault({root:join(staged,'media')});
    for (let i = 0; i < verified.assets.length; i++) {
      const blob = verified.manifest.assets[i].blob;
      if (blob !== null) vault.restoreRetained(verified.assets[i],readPrivate(join(bundle,'originals',blob),MAX_BYTES));
      fault('after-original',i);
    }
    databaseAssets(join(staged,'atlas.sqlite')); syncDirectory(staged); fault('before-publish');
    noExistingDestination(destination); renameSync(staged,destination); published = true; syncDirectory(parent);
    return {databasePath:join(destination,'atlas.sqlite'),vaultRoot:join(destination,'media'),manifest:verified.manifest};
  } finally { if (!published) rmSync(staged,{recursive:true,force:true}); }
}
