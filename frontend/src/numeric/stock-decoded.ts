import { ExactDecimal, isExactDecimal } from './decimal';
import type { LosslessJson } from './lossless-json';
import { exactStockSafeInteger } from './schema-validator';
import type { EvidencePayload, GeometryPayload, LocationSemanticsPayload, LocationElevation } from '../api/generated/contracts';

/** Internal decoded shapes. Canonical wire and generated DTO types remain unchanged. */
export type DecodedGeometryPayload = Omit<GeometryPayload, 'scale' | 'transform'> & {
  scale: ExactDecimal | null;
  transform: ExactDecimal[] | null;
};
export type DecodedLocationElevation = Exclude<LocationElevation, { status: 'known' }> |
  { status: 'known'; metres: ExactDecimal; datumAtlasId: string };
export type DecodedLocationSemanticsPayload = Omit<LocationSemanticsPayload, 'elevation'> & {
  elevation?: DecodedLocationElevation;
};
export type DecodedEvidencePayload = Omit<EvidencePayload, 'provenance'> & {
  provenance: Omit<EvidencePayload['provenance'], 'sourceRevision'> & {
    sourceRevision: string | null;
  };
};

type ObjectNode = { [key: string]: unknown };
function object(value: unknown): ObjectNode {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || isExactDecimal(value))
    throw new TypeError('Validated stock result was not an object');
  return value as ObjectNode;
}
function exact(value: unknown): ExactDecimal {
  if (!isExactDecimal(value)) throw new TypeError('Validated stock number was not exact');
  return value;
}
function records(value: LosslessJson): ObjectNode[] {
  const root = object(value);
  // Only these fields have schema bounds and are intentionally converted to Number.
  exactStockSafeInteger(root.schemaVersion as LosslessJson);
  const data = object(root.data!);
  if (!Array.isArray(data.records)) throw new TypeError('Validated stock records were not an array');
  return data.records.map(object);
}
export function decodeGeometryResult(value: LosslessJson): void {
  for (const record of records(value)) {
    record.revision = exactStockSafeInteger(record.revision as LosslessJson);
    const payload = object(record.payload!);
    payload.geometryVersion = exactStockSafeInteger(payload.geometryVersion as LosslessJson);
    if (payload.scale !== null) exact(payload.scale!);
    if (payload.transform !== null) {
      if (!Array.isArray(payload.transform)) throw new TypeError('Validated geometry transform was not an array');
      payload.transform.forEach(exact);
    }
  }
}
export function decodeTopologyResult(value: LosslessJson): void {
  for (const record of records(value)) {
    record.revision = exactStockSafeInteger(record.revision as LosslessJson);
    const payload = object(record.payload!);
    if (payload.elevation !== undefined) {
      const elevation = object(payload.elevation);
      if (elevation.status === 'known') exact(elevation.metres!);
    }
  }
}
/** Primitive display text retains integer syntax without changing the canonical wire. */
export function decodeEvidenceResult(value: LosslessJson): void {
  const root = object(value);
  const evidenceRecords = records(value);
  root.schemaVersion = exactStockSafeInteger(root.schemaVersion as LosslessJson);
  for (const record of evidenceRecords) {
    record.revision = exactStockSafeInteger(record.revision as LosslessJson);
    const provenance = object(object(record.payload).provenance);
    if (provenance.sourceRevision !== null && typeof provenance.sourceRevision !== 'string') {
      provenance.sourceRevision = exact(provenance.sourceRevision).token;
    }
  }
}
