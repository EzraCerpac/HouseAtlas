import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const schema = JSON.parse(readFileSync(new URL('./schema.json', import.meta.url)));
const ajv = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true });
addFormats(ajv);
const validateShape = ajv.compile(schema);

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
