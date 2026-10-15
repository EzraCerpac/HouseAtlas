#!/usr/bin/env node
// Usage: node validate-cli.mjs MAP_JSON SOURCE_REVISION_JSON IFC_PROJECTION_JSON [PREVIOUS_MAP_JSON]
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {validateSemanticMap, validateIfcIdentityProjection} from './semantic-map-v2.mjs';

export function validateCliInputs(paths) {
  if (paths.length !== 3 && paths.length !== 4) throw new Error('usage: validate-cli.mjs MAP SOURCE PROJECTION [PREVIOUS_MAP]');
  const mapBytes = readFileSync(paths[0]);
  const map = JSON.parse(mapBytes.toString('utf8'));
  const source = JSON.parse(readFileSync(paths[1], 'utf8'));
  const projection = JSON.parse(readFileSync(paths[2], 'utf8'));
  const previous = paths[3] ? JSON.parse(readFileSync(paths[3], 'utf8')) : null;
  const digest = createHash('sha256').update(mapBytes).digest('hex');
  if (source.semanticMapRevisionId !== map.semanticMapRevisionId || source.semanticMapSha256 !== digest) {
    throw new Error('source semantic map revision or byte SHA mismatch');
  }
  validateSemanticMap(map, {previous, pins: {
    sourceRevisionId: source.revisionId,
    ifcOriginalSha256: source.ifcAsset.sha256,
    workspaceId: source.scope.workspaceId,
    homeId: source.scope.homeId,
    buildingId: source.scope.buildingId
  }});
  validateIfcIdentityProjection(map, projection);
  return {semanticMapRevisionId: map.semanticMapRevisionId,
    semanticMapSha256: digest, floors: map.floors.length, rooms: map.rooms.length,
    spaceOccurrences: map.rooms.reduce((sum, room) => sum + room.occurrences.length, 0),
    electricalGroups: map.electricalGroups.length};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(validateCliInputs(process.argv.slice(2))) + '\n'); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
