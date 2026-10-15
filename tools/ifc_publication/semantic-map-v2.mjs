// Pure, side-effect-free validation of a reviewed IFC semantic correspondence.
// This does not read IFC bytes, authorize native records, or publish geometry.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const IFC_ID = /^[0-3][0-9A-Za-z_$]{21}$/;
const occurrenceId = (value, context) => {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128 || /[\u0000-\u001f\u007f]/u.test(value)) fail(context);
};
const fail = message => { throw new Error(`invalid-semantic-map: ${message}`); };
const object = (value, keys, context) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail(`${context} keys`);
};
const id = (value, context) => { if (!UUID.test(value)) fail(context); };
const sha = (value, context) => { if (!SHA.test(value)) fail(context); };
const ifcId = (value, context) => { if (typeof value !== 'string' || !IFC_ID.test(value)) fail(context); };
const name = (value, context) => {
  if (value !== null && (typeof value !== 'string' || value.length < 1 || value.length > 256)) fail(context);
};
const array = (value, max, context) => {
  if (!Array.isArray(value) || value.length > max) fail(context);
};
const unique = (rows, key, context) => {
  const seen = new Set();
  for (const row of rows) { const value = key(row); if (seen.has(value)) fail(`${context} duplicate`); seen.add(value); }
};
const pair = value => value === null ? null : JSON.stringify(value);

function validateFloor(row) {
  object(row, ['floorId', 'ifcBuildingStoreyGlobalId', 'atlasPlaceId', 'displayName'], 'floor');
  id(row.floorId, 'floorId');
  ifcId(row.ifcBuildingStoreyGlobalId, 'IfcBuildingStorey GlobalId');
  if (row.atlasPlaceId !== null) id(row.atlasPlaceId, 'floor atlasPlaceId');
  name(row.displayName, 'floor display name');
}

function validateRoom(row) {
  object(row, ['roomId', 'atlasPlaceId', 'packagePlace', 'displayName', 'occurrences'], 'room');
  id(row.roomId, 'roomId');
  if (row.atlasPlaceId !== null) id(row.atlasPlaceId, 'atlasPlaceId');
  if (row.packagePlace !== null) {
    object(row.packagePlace, ['packagePlaceKey', 'packagePlaceUuid'], 'package place');
    if (typeof row.packagePlace.packagePlaceKey !== 'string' ||
        row.packagePlace.packagePlaceKey.length < 1 || row.packagePlace.packagePlaceKey.length > 256) fail('package place key');
    id(row.packagePlace.packagePlaceUuid, 'package place UUID');
  }
  name(row.displayName, 'room display name');
  array(row.occurrences, 256, 'room occurrences');
  if (!row.occurrences.length) fail('room needs a space occurrence');
  for (const occurrence of row.occurrences) {
    object(occurrence, ['spaceOccurrenceId', 'ifcSpaceGlobalId', 'floorId'], 'space occurrence');
    occurrenceId(occurrence.spaceOccurrenceId, 'space occurrence ID');
    ifcId(occurrence.ifcSpaceGlobalId, 'IfcSpace GlobalId');
    id(occurrence.floorId, 'occurrence floorId');
  }
}

function validateGroup(row) {
  object(row, ['groupId', 'ifcCircuitGlobalId', 'atlasCircuitId', 'displayName', 'historicalLabels', 'membershipStatus'], 'electrical group');
  id(row.groupId, 'groupId');
  if (row.ifcCircuitGlobalId !== null) ifcId(row.ifcCircuitGlobalId, 'IfcDistributionCircuit GlobalId');
  if (row.atlasCircuitId !== null) id(row.atlasCircuitId, 'atlasCircuitId');
  name(row.displayName, 'group display name');
  if (!['unknown', 'reviewed'].includes(row.membershipStatus)) fail('group membership status');
  if (row.membershipStatus === 'reviewed' && (row.ifcCircuitGlobalId === null || row.atlasCircuitId === null)) fail('reviewed group needs reviewed IFC and Atlas correspondence');
  array(row.historicalLabels, 256, 'historical labels');
  for (const label of row.historicalLabels) {
    object(label, ['text', 'evidenceId', 'status'], 'historical label');
    if (typeof label.text !== 'string' || label.text.length < 1 || label.text.length > 256) fail('historical label text');
    id(label.evidenceId, 'historical label evidence');
    if (label.status !== 'unverified') fail('historical label may not assert confirmed wiring');
  }
  unique(row.historicalLabels, label => `${label.evidenceId}\0${label.text}`, 'historical labels');
}

function validateTransition(event) {
  object(event, ['kind', 'entity', 'beforeIds', 'afterIds', 'evidenceIds'], 'transition');
  if (!['floor', 'room', 'spaceOccurrence', 'electricalGroup'].includes(event.entity)) fail('transition entity');
  array(event.beforeIds, 4096, 'transition before');
  array(event.afterIds, 4096, 'transition after');
  array(event.evidenceIds, 256, 'transition evidence');
  if (!event.evidenceIds.length) fail('transition evidence required');
  for (const value of [...event.beforeIds, ...event.afterIds]) {
    if (event.entity === 'spaceOccurrence') occurrenceId(value, 'transition occurrence ID');
    else id(value, 'transition UUID');
  }
  for (const value of event.evidenceIds) id(value, 'transition evidence UUID');
  for (const rows of [event.beforeIds, event.afterIds, event.evidenceIds]) unique(rows, x => x, 'transition IDs');
  const n = event.beforeIds.length, m = event.afterIds.length;
  if (!({create: n === 0 && m === 1, retire: n === 1 && m === 0,
    split: n === 1 && m >= 2, merge: n >= 2 && m === 1,
    rebind: n === 1 && m === 1 && event.beforeIds[0] === event.afterIds[0]})[event.kind]) fail('transition cardinality');
  if (event.kind !== 'rebind' && event.beforeIds.some(x => event.afterIds.includes(x))) fail('transition must allocate new identity');
}

/** Validates an exact JSON value, including cross-revision identity continuity.
 * Caller separately verifies the retained original's bytes/SHA, IFC entity type,
 * actual native records, evidence revisions, and independent authorization.
 */
export function validateSemanticMap(current, {previous = null, pins = null} = {}) {
  object(current, ['schema', 'semanticMapRevisionId', 'previousSemanticMapRevisionId', 'sourceRevisionId',
    'ifcOriginalSha256', 'workspaceId', 'homeId', 'buildingId', 'floors', 'rooms', 'electricalGroups', 'transitions'], 'map');
  if (current.schema !== 'houseatlas.ifc-semantic-map.v2') fail('schema');
  for (const key of ['semanticMapRevisionId', 'sourceRevisionId', 'workspaceId', 'homeId', 'buildingId']) id(current[key], key);
  if (current.previousSemanticMapRevisionId !== null) id(current.previousSemanticMapRevisionId, 'previous revision');
  sha(current.ifcOriginalSha256, 'IFC original digest');
  if (pins) {
    object(pins, ['sourceRevisionId', 'ifcOriginalSha256', 'workspaceId', 'homeId', 'buildingId'], 'source pins');
    for (const key of Object.keys(pins)) if (current[key] !== pins[key]) fail(`source pin mismatch: ${key}`);
  }
  array(current.floors, 256, 'floors');
  if (!current.floors.length) fail('at least one floor required');
  array(current.rooms, 4096, 'rooms');
  array(current.electricalGroups, 4096, 'electrical groups');
  array(current.transitions, 8192, 'transitions');
  current.floors.forEach(validateFloor);
  current.rooms.forEach(validateRoom);
  current.electricalGroups.forEach(validateGroup);
  current.transitions.forEach(validateTransition);
  unique(current.floors, row => row.floorId, 'floor ID');
  unique(current.floors, row => row.ifcBuildingStoreyGlobalId, 'IfcBuildingStorey GlobalId');
  unique([...current.floors, ...current.rooms, ...current.electricalGroups],
    row => row.roomId ?? row.floorId ?? row.groupId, 'app entity ID');
  const occurrences = current.rooms.flatMap(room => room.occurrences.map(occurrence => ({...occurrence, roomId: room.roomId})));
  if (occurrences.length > 16384) fail('space occurrence count');
  unique(occurrences, row => row.spaceOccurrenceId, 'space occurrence ID');
  unique([...current.floors.map(row => row.ifcBuildingStoreyGlobalId),
    ...occurrences.map(row => row.ifcSpaceGlobalId),
    ...current.electricalGroups.map(row => row.ifcCircuitGlobalId).filter(Boolean)],
    value => value, 'IFC GlobalId');
  const floorIds = new Set(current.floors.map(row => row.floorId));
  for (const row of occurrences) if (!floorIds.has(row.floorId)) fail('occurrence references unknown floor');
  unique([...current.floors, ...current.rooms].filter(row => row.atlasPlaceId !== null),
    row => row.atlasPlaceId, 'Atlas place ID');
  unique(current.rooms, row => row.roomId, 'room ID');
  unique(occurrences, row => row.ifcSpaceGlobalId, 'IfcSpace GlobalId');
  unique(current.rooms.filter(row => row.packagePlace !== null), row => pair(row.packagePlace), 'package place');
  unique(current.rooms.filter(row => row.packagePlace !== null), row => row.packagePlace.packagePlaceKey, 'package place key');
  unique(current.rooms.filter(row => row.packagePlace !== null), row => row.packagePlace.packagePlaceUuid, 'package place UUID');
  unique(current.electricalGroups, row => row.groupId, 'group ID');
  unique(current.electricalGroups.filter(row => row.ifcCircuitGlobalId !== null), row => row.ifcCircuitGlobalId, 'IfcDistributionCircuit GlobalId');
  unique(current.electricalGroups.filter(row => row.atlasCircuitId !== null), row => row.atlasCircuitId, 'Atlas circuit ID');
  if (previous === null) {
    if (current.previousSemanticMapRevisionId !== null || current.transitions.length) fail('initial map has predecessor or transitions');
    return current;
  }
  if (current.previousSemanticMapRevisionId !== previous.semanticMapRevisionId ||
      current.semanticMapRevisionId === previous.semanticMapRevisionId) fail('previous revision pin');
  if (previous.schema !== current.schema) fail('previous profile mismatch');
  for (const key of ['workspaceId', 'homeId', 'buildingId']) if (current[key] !== previous[key]) fail(`scope changed: ${key}`);
  for (const entity of ['floor', 'room', 'electricalGroup']) {
    const collection = entity === 'floor' ? 'floors' : entity === 'room' ? 'rooms' : 'electricalGroups';
    const idKey = entity === 'floor' ? 'floorId' : entity === 'room' ? 'roomId' : 'groupId';
    const ifcKey = entity === 'floor' ? 'ifcBuildingStoreyGlobalId' : entity === 'room' ? null : 'ifcCircuitGlobalId';
    const old = new Map(previous[collection].map(row => [row[idKey], row]));
    const next = new Map(current[collection].map(row => [row[idKey], row]));
    const oldIfcOwners = new Map(ifcKey ? previous[collection].filter(row => row[ifcKey] !== null).map(row => [row[ifcKey], row[idKey]]) : []);
    const before = new Set(), after = new Set();
    for (const event of current.transitions.filter(row => row.entity === entity)) {
      for (const value of event.beforeIds) { if (!old.has(value) || before.has(value)) fail('missing/repeated transition predecessor'); before.add(value); }
      for (const value of event.afterIds) { if (!next.has(value) || after.has(value)) fail('missing/repeated transition successor'); after.add(value); }
      if (event.kind === 'rebind') {
        const a = old.get(event.beforeIds[0]), b = next.get(event.afterIds[0]);
        if ((!ifcKey || a[ifcKey] === b[ifcKey]) && (entity !== 'floor' || a.atlasPlaceId === b.atlasPlaceId) &&
            (entity !== 'room' || (a.atlasPlaceId === b.atlasPlaceId && pair(a.packagePlace) === pair(b.packagePlace))) &&
            (entity !== 'electricalGroup' || (a.atlasCircuitId === b.atlasCircuitId && a.membershipStatus === b.membershipStatus))) fail('unnecessary rebind');
      }
    }
    for (const [key, a] of old) {
      const b = next.get(key);
      if (!b && !before.has(key)) fail('identity removed without transition');
      if (b && before.has(key) !== after.has(key)) fail('partial identity transition');
      if (b && !before.has(key)) {
        if (ifcKey && a[ifcKey] !== b[ifcKey]) fail('IFC GlobalId changed without rebind');
        if (entity === 'floor' && a.atlasPlaceId !== b.atlasPlaceId) fail('floor correspondence changed without rebind');
        if (entity === 'room' && (a.atlasPlaceId !== b.atlasPlaceId || pair(a.packagePlace) !== pair(b.packagePlace))) fail('room correspondence changed without rebind');
        if (entity === 'electricalGroup' && (a.atlasCircuitId !== b.atlasCircuitId || a.membershipStatus !== b.membershipStatus)) fail('electrical correspondence changed without rebind');
      }
      if (b && entity === 'electricalGroup') {
        for (const label of a.historicalLabels) if (!b.historicalLabels.some(x => x.evidenceId === label.evidenceId && x.text === label.text && x.status === label.status)) fail('historical label lost');
      }
    }
    for (const key of next.keys()) if (!old.has(key) && !after.has(key)) fail('identity added without transition');
    for (const [key, row] of next) if (ifcKey && !old.has(key) && oldIfcOwners.has(row[ifcKey])) fail('new identity reused old IFC GlobalId');
  }
  const flatten = map => new Map(map.rooms.flatMap(room => room.occurrences.map(row =>
    [row.spaceOccurrenceId, {...row, roomId: room.roomId}])));
  const oldOccurrences = flatten(previous), newOccurrences = flatten(current);
  const oldGlobalIds = new Set([...oldOccurrences.values()].map(row => row.ifcSpaceGlobalId));
  const before = new Set(), after = new Set();
  for (const event of current.transitions.filter(row => row.entity === 'spaceOccurrence')) {
    for (const value of event.beforeIds) {
      if (!oldOccurrences.has(value) || before.has(value)) fail('missing/repeated occurrence predecessor');
      before.add(value);
    }
    for (const value of event.afterIds) {
      if (!newOccurrences.has(value) || after.has(value)) fail('missing/repeated occurrence successor');
      after.add(value);
    }
    if (event.kind === 'rebind') {
      const a = oldOccurrences.get(event.beforeIds[0]), b = newOccurrences.get(event.afterIds[0]);
      if (a.ifcSpaceGlobalId === b.ifcSpaceGlobalId && a.floorId === b.floorId && a.roomId === b.roomId) fail('unnecessary occurrence rebind');
    }
  }
  for (const [key, a] of oldOccurrences) {
    const b = newOccurrences.get(key);
    if (!b && !before.has(key)) fail('occurrence removed without transition');
    if (b && before.has(key) !== after.has(key)) fail('partial occurrence transition');
    if (b && !before.has(key) && (a.ifcSpaceGlobalId !== b.ifcSpaceGlobalId || a.floorId !== b.floorId || a.roomId !== b.roomId)) fail('occurrence correspondence changed without rebind');
  }
  for (const [key, row] of newOccurrences) {
    if (!oldOccurrences.has(key) && !after.has(key)) fail('occurrence added without transition');
    if (!oldOccurrences.has(key) && oldGlobalIds.has(row.ifcSpaceGlobalId)) fail('new occurrence reused old IFC GlobalId');
  }
  return current;
}

/** Checks a trusted structural extraction from the exact pinned IFC bytes.
 * The extractor must traverse IfcRelDefinesByProperties on each occurrence,
 * not only resolve Pset values by name, so shared Psets can be detected.
 */
export function validateIfcIdentityProjection(map, projection) {
  object(projection, ['entities', 'spatialAggregates', 'groupAssignments'], 'IFC projection');
  array(projection.entities, 16384, 'IFC entities');
  array(projection.spatialAggregates, 16384, 'IFC spatial aggregates');
  array(projection.groupAssignments, 16384, 'IFC group assignments');
  const entities = new Map(), appTypes = new Map(), spaceKeys = new Set(), psets = new Set();
  for (const row of projection.entities) {
    object(row, ['type', 'globalId', 'predefinedType', 'identityPset'], 'IFC entity');
    if (!['IfcBuildingStorey', 'IfcSpace', 'IfcDistributionCircuit'].includes(row.type)) fail('IFC entity type');
    ifcId(row.globalId, 'IFC entity GlobalId');
    if (row.type === 'IfcDistributionCircuit' && row.predefinedType !== 'ELECTRICAL') fail('circuit predefined type');
    if (row.type !== 'IfcDistributionCircuit' && row.predefinedType !== null) fail('spatial predefined type projection');
    object(row.identityPset, row.type === 'IfcSpace'
      ? ['name', 'occurrenceGlobalId', 'EntityId', 'spaceOccurrenceId', 'SchemaVersion']
      : ['name', 'occurrenceGlobalId', 'EntityId', 'SchemaVersion'], 'identity Pset');
    if (row.identityPset.name !== 'HouseAtlas_Identity' || row.identityPset.SchemaVersion !== 1) fail('HouseAtlas identity Pset');
    ifcId(row.identityPset.occurrenceGlobalId, 'identity Pset occurrence');
    id(row.identityPset.EntityId, 'identity EntityId');
    if (row.type === 'IfcSpace') occurrenceId(row.identityPset.spaceOccurrenceId, 'IFC OccurrenceKey');
    const priorType = appTypes.get(row.identityPset.EntityId);
    if (entities.has(row.globalId) || psets.has(row.identityPset.occurrenceGlobalId) ||
        (priorType && (priorType !== 'IfcSpace' || row.type !== 'IfcSpace')) ||
        (row.type === 'IfcSpace' && spaceKeys.has(row.identityPset.spaceOccurrenceId))) fail('shared or duplicate IFC identity');
    entities.set(row.globalId, row);
    appTypes.set(row.identityPset.EntityId, row.type);
    if (row.type === 'IfcSpace') spaceKeys.add(row.identityPset.spaceOccurrenceId);
    psets.add(row.identityPset.occurrenceGlobalId);
  }
  for (const floor of map.floors) {
    const row = entities.get(floor.ifcBuildingStoreyGlobalId);
    if (!row || row.type !== 'IfcBuildingStorey' || row.identityPset.EntityId !== floor.floorId) fail('IfcBuildingStorey identity mismatch');
  }
  for (const room of map.rooms) {
    for (const occurrence of room.occurrences) {
      const row = entities.get(occurrence.ifcSpaceGlobalId);
      if (!row || row.type !== 'IfcSpace' || row.identityPset.EntityId !== room.roomId ||
          row.identityPset.spaceOccurrenceId !== occurrence.spaceOccurrenceId) fail('IfcSpace occurrence identity mismatch');
    }
  }
  const mappedSpaceIds = new Set(map.rooms.flatMap(room => room.occurrences.map(row => row.ifcSpaceGlobalId)));
  const mappedStoreyIds = new Set(map.floors.map(row => row.ifcBuildingStoreyGlobalId));
  for (const row of entities.values()) {
    if (row.type === 'IfcSpace' && !mappedSpaceIds.has(row.globalId)) fail('unmapped IfcSpace occurrence');
    if (row.type === 'IfcBuildingStorey' && !mappedStoreyIds.has(row.globalId)) fail('unmapped IfcBuildingStorey');
  }
  const roomToStorey = new Map(), aggregates = new Set();
  for (const edge of projection.spatialAggregates) {
    object(edge, ['globalId', 'relatingStoreyGlobalId', 'relatedSpaceGlobalIds'], 'IFC spatial aggregate');
    ifcId(edge.globalId, 'IfcRelAggregates GlobalId');
    ifcId(edge.relatingStoreyGlobalId, 'IfcRelAggregates storey');
    array(edge.relatedSpaceGlobalIds, 4096, 'IfcRelAggregates spaces');
    if (!edge.relatedSpaceGlobalIds.length || aggregates.has(edge.globalId)) fail('empty/duplicate IFC spatial aggregate');
    aggregates.add(edge.globalId);
    if (entities.get(edge.relatingStoreyGlobalId)?.type !== 'IfcBuildingStorey') fail('IFC aggregate parent is not storey');
    for (const space of edge.relatedSpaceGlobalIds) {
      ifcId(space, 'IfcRelAggregates space');
      if (entities.get(space)?.type !== 'IfcSpace' || roomToStorey.has(space)) fail('IFC space has invalid/multiple storey');
      roomToStorey.set(space, edge.relatingStoreyGlobalId);
    }
  }
  const floorStoreys = new Map(map.floors.map(floor => [floor.floorId, floor.ifcBuildingStoreyGlobalId]));
  for (const room of map.rooms) for (const occurrence of room.occurrences) {
    if (roomToStorey.get(occurrence.ifcSpaceGlobalId) !== floorStoreys.get(occurrence.floorId)) fail('occurrence IFC storey membership mismatch');
  }
  for (const group of map.electricalGroups) {
    if (group.ifcCircuitGlobalId === null) continue;
    const row = entities.get(group.ifcCircuitGlobalId);
    if (!row || row.type !== 'IfcDistributionCircuit' || row.identityPset.EntityId !== group.groupId) fail('IfcDistributionCircuit identity mismatch');
  }
  const assignmentIds = new Set();
  const circuitsWithMembership = new Set();
  for (const edge of projection.groupAssignments) {
    object(edge, ['globalId', 'relatingGroupGlobalId', 'relatedObjectGlobalIds'], 'IFC group assignment');
    ifcId(edge.globalId, 'IfcRelAssignsToGroup GlobalId');
    ifcId(edge.relatingGroupGlobalId, 'IfcRelAssignsToGroup group');
    array(edge.relatedObjectGlobalIds, 16384, 'IfcRelAssignsToGroup members');
    if (!edge.relatedObjectGlobalIds.length || assignmentIds.has(edge.globalId)) fail('empty/duplicate IFC group assignment');
    assignmentIds.add(edge.globalId);
    for (const member of edge.relatedObjectGlobalIds) ifcId(member, 'IfcRelAssignsToGroup member');
    unique(edge.relatedObjectGlobalIds, x => x, 'IFC group assignment members');
    const circuit = entities.get(edge.relatingGroupGlobalId);
    if (circuit?.type === 'IfcDistributionCircuit') circuitsWithMembership.add(circuit.globalId);
  }
  for (const group of map.electricalGroups) {
    if (group.membershipStatus === 'reviewed' && !circuitsWithMembership.has(group.ifcCircuitGlobalId)) fail('reviewed membership needs IfcRelAssignsToGroup');
  }
  return map;
}

/** Same immutable map revision may be retried only with identical retained bytes. */
export function classifySemanticMapIngest(map, retainedSha256, {previous = null, existing = null} = {}) {
  validateSemanticMap(map, {previous});
  sha(retainedSha256, 'semantic map retained digest');
  if (existing === null) return 'new';
  object(existing, ['semanticMapRevisionId', 'sha256', 'workspaceId', 'homeId', 'buildingId'], 'existing revision');
  if (existing.semanticMapRevisionId !== map.semanticMapRevisionId ||
      existing.sha256 !== retainedSha256 ||
      existing.workspaceId !== map.workspaceId || existing.homeId !== map.homeId ||
      existing.buildingId !== map.buildingId) fail('revision ID reused with different content or scope');
  return 'idempotent';
}
