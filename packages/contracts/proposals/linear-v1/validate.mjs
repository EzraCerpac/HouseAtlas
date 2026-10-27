import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const schema = JSON.parse(readFileSync(new URL('./schema.json', import.meta.url)));
const ajv = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true });
addFormats(ajv);
const validateShape = ajv.compile(schema);

// Proposal-only alignment with PR #453's DecimalToken/ExactQuantity family.
// Share the decimal rules with the proposal; this is not an online wire DTO.
const validateMetricLengthShape = ajv.compile({
  type: 'object', additionalProperties: false,
  required: ['decimalToken', 'unit', 'quantityKind'],
  properties: {
    decimalToken: schema.properties.value.anyOf[1].properties.decimal,
    unit: { type: 'string', enum: ['mm', 'cm', 'm'] },
    quantityKind: { const: 'length' },
  },
});

/** Exact scalar compatibility only; no target, provenance, receipt or write
 * admission. The candidate online API remains occurrence-area only. */
export function validateMetricLengthValue(value) {
  return validateMetricLengthShape(value);
}

/** Proposal shape and intrinsic token consistency only. No input mutation,
 * reference resolution, geometry validation or native authority. */
export function validateLinearProposal(proposal) {
  if (!validateShape(proposal)) return false;
  const definition = proposal.definition;
  if (definition.kind === 'height-between-datums') {
    return definition.lowerDatumRef !== definition.upperDatumRef;
  }
  if (definition.kind === 'explicit-boundary-sum') {
    const seen = new Set();
    for (const tokens of [definition.outerRingRefs, definition.holeRingRefs, definition.excludedBoundaryRefs]) {
      for (const token of tokens) {
        if (seen.has(token)) return false;
        seen.add(token);
      }
    }
  }
  return true;
}

// Documentary shape corresponding to PR #453's internal SemanticFeature::Wall.
// The current online wire still accepts only a room feature.
const featureId = { type: 'string', minLength: 1, maxLength: 128,
  pattern: '^[A-Za-z0-9_.:$-]+(?![\\s\\S])' };
const validateStraightWallShape = ajv.compile({
  type: 'object', additionalProperties: false,
  required: ['kind', 'wallId', 'endpointIds'],
  properties: {
    kind: { const: 'wall' }, wallId: featureId,
    endpointIds: { type: 'array', minItems: 2, maxItems: 2,
      uniqueItems: true, items: featureId },
  },
});

/** Syntax and canonical ordering only. No claim that any token exists, is
 * source-owned, identifies an endpoint or survives publication replacement. */
export function validateStraightWallReference(value) {
  return validateStraightWallShape(value) && value.endpointIds[0] < value.endpointIds[1];
}
