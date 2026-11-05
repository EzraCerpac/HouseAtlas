import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

// A read projection only. The host owns canonical native records, source bytes,
// receipt verification/currentness and authorization. This module issues none.
const copy = value => structuredClone(value);
const canonical = value => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(key => [key, v[key]])) : v);
const equal = (a, b) => canonical(a) === canonical(b);
const key = pin => `${pin.recordType}:${pin.recordId}`;
const samePin = (a, b) => a && b && a.recordType === b.recordType && a.recordId === b.recordId && a.revision === b.revision;
const need = (condition, message) => { if (!condition) throw new TypeError(message); };

/** Exact subject the existing receipt/source owner must independently verify.
 * An id/hash match alone is insufficient. No receipt is created by this helper. */
export function electricalReviewSubject(data, kind, row) {
  return copy({ scope: data.scope, viewKey: data.viewKey,
    fixtureLedgerSha256: data.fixtureLedgerSha256, kind, row });
}

/** Schemas are supplied from pinned public resources; no file/URL is resolved.
 * The returned function accepts schema-valid data and independently current host
 * context. All omitted/null metadata is preserved in the returned source rows. */
export function createElectricalDataProjector(schema, nativeSchema) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  ajv.addSchema(nativeSchema);
  const validate = ajv.compile(schema);
  const validateRecord = ajv.compile({ $ref: `${nativeSchema.$id}#/$defs/record` });
  return function projectElectricalData(data, context) {
    need(validate(data), `Invalid electrical data contract: ${ajv.errorsText(validate.errors)}`);
    need(context && equal(data.scope, context.scope) && data.viewKey === context.viewKey,
      'Current workspace/home/view context required');
    need(Array.isArray(context.records) && context.records.length <= 10000 && Array.isArray(context.currentReviews)
      && context.currentReviews.length <= 10000, 'Bounded current native records and independently verified reviews required');
    const records = new Map();
    for (const record of context.records) {
      need(validateRecord(record) && ['identity', 'evidence', 'circuit', 'location-semantics'].includes(record.recordType),
        'Canonical native identity/evidence/circuit/location-semantics record required');
      need(record.workspaceId === data.scope.workspaceId && record.homeId === data.scope.homeId,
        'Cross-home native context refused');
      need(!records.has(key(record)), 'Duplicate native record identity');
      records.set(key(record), record);
    }
    const current = pin => {
      const record = pin && records.get(key(pin));
      return record && record.revision === pin.revision && record.lifecycle === 'active' ? record : null;
    };
    const currentEvidence = pin => pin?.recordType === 'evidence' && current(pin);
    const nativeEvidenceCurrent = record => record && record.payload.evidenceIds.every(id => {
      const evidence = records.get(`evidence:${id}`);
      return evidence?.lifecycle === 'active' && !['disputed', 'withdrawn', 'superseded'].includes(evidence.payload.provenance.uncertainty.status);
    });
    const documentary = context.documentary;
    need(documentary && documentary.sha256 === data.fixtureLedgerSha256
      && documentary.data?.schema === 'houseatlas.documentary-electrical-fixtures.v1'
      && documentary.data.viewKey === data.viewKey, 'Exact current documentary ledger bytes/view required');
    need(Array.isArray(documentary.data.groups) && Array.isArray(documentary.data.fixtures)
      && documentary.data.groups.length <= 10000 && documentary.data.fixtures.length <= 10000,
    'Bounded host-validated documentary groups/fixtures required');
    const groups = new Map(), fixtures = new Map();
    for (const fixture of documentary.data.fixtures) {
      need(typeof fixture.id === 'string' && !fixtures.has(fixture.id), 'Unique documentary fixture identity required');
      fixtures.set(fixture.id, fixture);
    }
    for (const group of documentary.data.groups) {
      need(typeof group.id === 'string' && !groups.has(group.id) && group.currentCircuitId === null
        && group.verifiedWiring === false && Array.isArray(group.fixtureIds)
        && new Set(group.fixtureIds).size === group.fixtureIds.length
        && group.fixtureIds.every(id => fixtures.get(id)?.group?.id === group.id),
      'Historic groups must retain reciprocal documentary membership and unknown wiring');
      groups.set(group.id, group);
    }
    for (const fixture of fixtures.values()) {
      need(fixture.group?.id === null || groups.get(fixture.group?.id)?.fixtureIds.includes(fixture.id),
        'Reciprocal documentary fixture/group identity required');
    }
    for (const table of [data.panels, data.breakers, data.mappings]) {
      need(new Set(table.map(row => row.id)).size === table.length, 'Duplicate electrical row identity');
    }
    need(new Set(data.panels.map(row => key(row.identity))).size === data.panels.length,
      'One panel descriptor per native identity');
    need(new Set(data.breakers.map(row => key(row.circuit))).size === data.breakers.length,
      'One breaker descriptor per native circuit');
    const assess = (kind, row) => {
      const reasons = [];
      if (row.basis === 'unknown') reasons.push('basis-unknown');
      if (row.review.confidence === 'unknown') reasons.push('confidence-unknown');
      if (row.review.status !== 'reviewed') reasons.push(`review-${row.review.status}`);
      if (!row.review.evidence.length || row.review.evidence.some(pin => {
        const evidence = currentEvidence(pin);
        return !evidence || ['disputed', 'withdrawn', 'superseded'].includes(evidence.payload.provenance.uncertainty.status);
      })) reasons.push('evidence-not-current');
      if (!row.review.receipt || !context.currentReviews.some(review => equal(review.receipt, row.review.receipt)
        && equal(review.subject, electricalReviewSubject(data, kind, row)))) reasons.push('exact-review-not-current');
      return reasons;
    };
    const panels = data.panels.map(row => {
      const reasons = assess('panel', row), identity = current(row.identity);
      if (identity?.payload.kind !== 'item' || !nativeEvidenceCurrent(identity)) reasons.push('panel-item-not-current');
      if (row.roomAssociation) {
        const room = current(row.roomAssociation.room), semantics = current(row.roomAssociation.semantics);
        if (room?.payload.kind !== 'location' || semantics?.payload.atlasId !== room?.recordId
          || semantics?.payload.semanticKind !== 'room' || semantics?.payload.reviewStatus !== 'accepted'
          || !nativeEvidenceCurrent(room) || !nativeEvidenceCurrent(semantics)) reasons.push('reviewed-room-not-current');
      }
      return { ...copy(row), status: reasons.length ? 'withheld' : 'current', reasons,
        reviewedRoomId: reasons.length ? null : row.roomAssociation?.room.recordId ?? null };
    });
    const panelByIdentity = new Map(panels.map(row => [key(row.identity), row]));
    const breakers = data.breakers.map(row => {
      const reasons = assess('breaker', row), circuit = current(row.circuit);
      if (!circuit) reasons.push('native-circuit-not-current');
      if (!nativeEvidenceCurrent(circuit)) reasons.push('native-circuit-evidence-not-current');
      if (row.panel) {
        const panel = panelByIdentity.get(key(row.panel));
        if (circuit?.payload.panel?.kind !== 'atlas-record' || !equal(circuit.payload.panel.ref,
          { recordType: row.panel.recordType, recordId: row.panel.recordId }) || !samePin(panel?.identity, row.panel)
          || panel?.status !== 'current') reasons.push('native-panel-link-not-current');
      } else if (circuit?.payload.panel?.kind === 'atlas-record') reasons.push('native-panel-descriptor-missing');
      if (row.position && !row.panel) reasons.push('position-without-panel');
      return { ...copy(row), status: reasons.length ? 'withheld' : 'current', reasons,
        nativeRecord: copy(circuit), panelRecordId: reasons.length ? null : row.panel?.recordId ?? null,
        effectiveDetails: reasons.length ? null : copy(Object.fromEntries(['position', 'ratingAmperes', 'protection']
          .filter(name => Object.hasOwn(row, name)).map(name => [name, row[name]]))) };
    });
    // A panel way can describe several poles, but cannot independently identify
    // two circuits. Never choose the first descriptor on a duplicate position.
    const ways = new Map();
    for (const row of breakers) if (row.panel && row.position) for (const way of row.position.ways) {
      const id = `${key(row.panel)}:${way}`;
      const prior = ways.get(id);
      if (prior) for (const conflict of [prior, row]) {
        if (!conflict.reasons.includes('conflicting-panel-position')) conflict.reasons.push('conflicting-panel-position');
        conflict.status = 'withheld'; conflict.panelRecordId = null; conflict.effectiveDetails = null;
      }
      ways.set(id, row);
    }
    const breakerByCircuit = new Map(breakers.map(row => [key(row.circuit), row]));
    let memberships = 0;
    const mappings = data.mappings.map(row => {
      const reasons = assess('mapping', row);
      const fixtureIds = row.target.kind === 'fixture' ? (fixtures.has(row.target.id) ? [row.target.id] : [])
        : groups.get(row.target.id)?.fixtureIds ?? [];
      memberships += fixtureIds.length;
      need(memberships <= 10000, 'Bounded expanded mapping membership required');
      if (!fixtureIds.length) reasons.push('documentary-target-unavailable');
      if (row.candidates.length !== 1) reasons.push('circuit-not-unique');
      for (const pin of row.candidates) if (!current(pin) || !samePin(breakerByCircuit.get(key(pin))?.circuit, pin)
        || breakerByCircuit.get(key(pin))?.status !== 'current') reasons.push('circuit-descriptor-not-current');
      if (row.basis === 'test') {
        const evidence = currentEvidence(row.test.evidence);
        if (row.test.outcome !== 'confirmed' || !equal([...row.test.fixtureIds].sort(), [...fixtureIds].sort())
          || !row.review.evidence.some(pin => samePin(pin, row.test.evidence))
          || evidence?.payload.provenance.evidenceBasis !== 'physical-survey'
          || evidence?.payload.provenance.factAt !== row.test.observedAt
          || evidence?.payload.provenance.uncertainty.status !== 'supported') reasons.push('test-not-confirmed-for-exact-target');
      }
      return { ...copy(row), fixtureIds: copy(fixtureIds), reasons, status: reasons.length ? 'withheld' : 'reviewed-association',
        currentCircuitId: reasons.length ? null : row.candidates[0].recordId,
        verifiedWiring: !reasons.length && row.basis === 'test' };
    });
    // Conflicting group and individual-fixture proposals also withhold. Labels
    // and input ordering cannot break a tie or override a reviewed disagreement.
    const candidatesByFixture = new Map();
    for (const row of mappings) for (const id of row.fixtureIds) {
      const candidates = candidatesByFixture.get(id) ?? new Set();
      for (const pin of row.candidates) candidates.add(key(pin));
      candidatesByFixture.set(id, candidates);
    }
    for (const row of mappings) if (row.fixtureIds.some(id => candidatesByFixture.get(id).size > 1)) {
      row.reasons.push('conflicting-fixture-circuit-candidates'); row.status = 'withheld';
      row.currentCircuitId = null; row.verifiedWiring = false;
    }
    return { schema: 'houseatlas.electrical-data-projection.v1', scope: copy(data.scope), viewKey: data.viewKey,
      fixtureLedgerSha256: data.fixtureLedgerSha256, panels, breakers, mappings,
      wireRoutes: null, physicalCableCoordinates: null, nativeQualified: false };
  };
}
