/** INTERNAL frontend presentation model for one canonical model publication.
 *
 * Not a wire contract. adapter.ts maps the proposed v2 scene read into this
 * shape (or reports it unavailable); fixtures may build it directly. It grants
 * no authority and implies no physical registration beyond what it states.
 *
 * Identity: a logical room (stable roomId, display label, nullable reviewed
 * Atlas link) owns one or more floor-qualified space occurrences. Geometry and
 * selection target an exact occurrence token; labels never act as keys.
 *
 * Frame: GLB-declared metres, +Y up. Plan coordinates are that frame's (x, z),
 * so equal x/z on one floor are the same place. Floors share one frame only
 * when `registration` says so; otherwise each floor is shown on its own. */
export const PRESENTATION_KIND = 'houseatlas.frontend.canonical-model-presentation.internal.v2' as const;

export type PlanPoint = readonly [x: number, z: number];
export type PlanRing = readonly PlanPoint[];
/** One feature: rings combine even-odd (holes); separate features union. */
export type PlanShape = readonly (readonly PlanRing[])[];

export interface ArtifactPin {
  readonly label: string;
  readonly floorId: string | null;
  readonly sha256: string;
  readonly bytes: number | null;
}

export type PresentationOrigin =
  /** Generated public data built directly for fixtures and tests. */
  | { readonly kind: 'synthetic-fixture'; readonly coverage: 'publisher-shaped' | 'generated-presentation-coverage' }
  /** Produced by adapter.ts from a scene read; transport says who served it. */
  | { readonly kind: 'adapted-publication'; readonly adapter: string; readonly transport: 'synthetic-fixture' | 'service' };

export interface PublicationPin {
  readonly publicationId: string;
  readonly sourceRevisionId: string;
  readonly sourceRevisionSha256: string | null;
  readonly sourceIfcSha256: string | null;
  readonly semanticMapRevision: string;
  readonly semanticMapSha256: string | null;
  readonly selection: { readonly mode: 'published' | 'preview'; readonly revision: string | null };
  readonly validation: string | null;
  readonly publishedAt: string | null;
  readonly sourceDate: string | null;
  readonly retrievedAt: string | null;
  readonly owner: string;
  readonly artifacts: readonly ArtifactPin[];
}

export interface CoordinateFacts {
  readonly renderer: { readonly units: 'm'; readonly upAxis: 'Y' };
  readonly source: { readonly units: 'mm' | 'unknown'; readonly upAxis: 'Z' | 'unknown'; readonly basis: 'converter-declaration' | 'unknown' };
  readonly converters: readonly { readonly floorId: string | null; readonly name: string; readonly version: string; readonly configSha256: string }[];
  readonly physicalAlignment: 'unknown';
}

export type FloorRegistration =
  /** No reviewed cross-floor transform: each floor is shown alone in its own frame. */
  | { readonly kind: 'isolated-floors' }
  /** All floors are in one frame; basis states why (generated coverage only today). */
  | { readonly kind: 'shared-frame'; readonly basis: string };

export interface PlanFeature {
  /** Exact space occurrence token, or null for walls and display-only features. */
  readonly occurrenceId: string | null;
  readonly role: 'space' | 'wall' | 'opening' | 'other';
  readonly rings: readonly PlanRing[];
}

export interface PresentationFloor {
  readonly floorId: string;
  readonly label: string;
  readonly short: string;
  readonly ifcStoreyGlobalId: string | null;
  /** Only a supplied elevation is shown; none is derived. */
  readonly elevation: { readonly metres: number; readonly basis: string } | null;
  readonly plan: { readonly features: readonly PlanFeature[] } | null;
}

export interface SpaceOccurrence {
  /** Raw opaque token, preserved exactly. */
  readonly spaceOccurrenceId: string;
  /** Explicit floor link; null means unknown. */
  readonly floorId: string | null;
  readonly ifcGlobalId: string | null;
}

export interface PresentationRoom {
  readonly roomId: string;
  readonly label: string;
  /** Reviewed Atlas place link; null until reviewed. */
  readonly atlasPlaceId: string | null;
  readonly occurrences: readonly SpaceOccurrence[];
}

export interface PresentationMesh {
  /** Unique within the presentation, e.g. floor artifact + GLB mesh index. */
  readonly meshKey: string;
  /** Floor whose artifact supplied the mesh; null when unknown. */
  readonly floorId: string | null;
  readonly glbMeshIndex: number | null;
  /** Verified occurrence binding; null meshes are display-only. */
  readonly occurrenceId: string | null;
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
}

export type OverlayTone = 'electrical' | 'network' | 'water' | 'belongings' | 'upkeep';

export interface OverlayRecord {
  readonly id: string;
  readonly label: string;
  /** Joins a logical room only through its reviewed Atlas link. */
  readonly atlasPlaceId: string | null;
  readonly detail: string | null;
}

export interface OverlayLayer {
  readonly id: string;
  /** Must equal the presentation's publication or the layer is withheld. */
  readonly publicationId: string;
  readonly label: string;
  readonly tone: OverlayTone;
  readonly owner: string;
  readonly sourceDate: string | null;
  readonly retrievedAt: string | null;
  readonly freshness: 'current' | 'stale' | 'unknown';
  readonly records: readonly OverlayRecord[];
}

export interface CanonicalPresentation {
  readonly kind: typeof PRESENTATION_KIND;
  readonly origin: PresentationOrigin;
  readonly publication: PublicationPin;
  readonly coordinates: CoordinateFacts;
  readonly registration: FloorRegistration;
  readonly building: { readonly buildingId: string; readonly label: string; readonly scope: { readonly workspaceId: string; readonly homeId: string } | null };
  readonly floors: readonly PresentationFloor[];
  readonly rooms: readonly PresentationRoom[];
  readonly meshes: readonly PresentationMesh[];
  readonly overlays: readonly OverlayLayer[];
}

/** Explicit retained-input and work bounds, checked before any long scan. */
export const LIMITS = Object.freeze({
  floors: 64, rooms: 2048, occurrences: 4096, meshes: 8192,
  /** Retained Float32 position values across all meshes (~7.2 MB). */
  positionValues: 1_800_000,
  triangles: 300_000,
  ringPoints: 200_000,
  overlayLayers: 16, overlayRecords: 8192,
});
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA = /^[a-f0-9]{64}$/;
/** Opaque occurrence tokens: any text, bounded, no control characters. */
export function isOpaqueToken(value: unknown): value is string {
  // eslint-disable-next-line no-control-regex
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
}

export interface FloorFacts {
  /** Occurrence tokens linked to this floor, in room order. */
  readonly occurrenceIds: readonly string[];
  readonly hasPlan: boolean;
  readonly meshCount: number;
  /** Drawn (index-referenced) geometry range; null when the floor has no meshes. */
  readonly yRange: readonly [number, number] | null;
}

export interface AdmissionIssues {
  readonly occurrencesWithUnknownFloor: number;
  readonly occurrencesWithoutPlanShape: number;
  readonly planFeaturesDemoted: number;
  readonly meshBindingsDemoted: number;
  readonly displayOnlyMeshes: number;
  readonly overlayLayersWithheld: number;
}

export interface AdmittedPresentation {
  readonly source: CanonicalPresentation;
  readonly floorsById: ReadonlyMap<string, PresentationFloor>;
  readonly roomsById: ReadonlyMap<string, PresentationRoom>;
  /** Occurrence token -> its occurrence and logical room. */
  readonly occurrences: ReadonlyMap<string, { readonly occurrence: SpaceOccurrence; readonly room: PresentationRoom }>;
  /** Occurrence token -> explicit plan features (rings per feature) on its linked floor. */
  readonly planShapes: ReadonlyMap<string, PlanShape>;
  /** Occurrence token -> verified mesh keys. */
  readonly occurrenceMeshes: ReadonlyMap<string, readonly string[]>;
  /** Mesh key -> admitted occurrence binding (null = display-only). */
  readonly meshOccurrence: ReadonlyMap<string, string | null>;
  readonly floorFacts: ReadonlyMap<string, FloorFacts>;
  readonly overlays: readonly OverlayLayer[];
  readonly duplicateLabels: ReadonlySet<string>;
  readonly issues: AdmissionIssues;
}

export class PresentationError extends Error {}
function need(ok: unknown, why: string): asserts ok { if (!ok) throw new PresentationError(why); }
const finite = (value: number) => Number.isFinite(value) && Math.abs(value) <= 1e6;

/** Checks identity invariants and retained-input bounds, then demotes
 * unverifiable geometry links to display-only. Throws PresentationError only
 * when identity is ambiguous or a bound is exceeded. */
export function admitPresentation(source: CanonicalPresentation): AdmittedPresentation {
  need(source.kind === PRESENTATION_KIND, 'Unsupported presentation');
  const pin = source.publication;
  need(ID.test(pin.publicationId) && ID.test(pin.sourceRevisionId) && ID.test(pin.semanticMapRevision), 'Publication pin');
  need(pin.artifacts.every(artifact => SHA.test(artifact.sha256)), 'Artifact pin');
  need(ID.test(source.building.buildingId), 'Building identity');
  need(source.floors.length <= LIMITS.floors && source.rooms.length <= LIMITS.rooms && source.meshes.length <= LIMITS.meshes
    && source.overlays.length <= LIMITS.overlayLayers, 'Presentation bound');
  // Aggregate retained-input bounds before scanning any value.
  let positionValues = 0, indexValues = 0, ringPoints = 0, records = 0, occurrenceCount = 0;
  for (const mesh of source.meshes) { positionValues += mesh.positions.length; indexValues += mesh.indices.length; }
  for (const floor of source.floors) for (const feature of floor.plan?.features ?? []) for (const ring of feature.rings) ringPoints += ring.length;
  for (const layer of source.overlays) records += layer.records.length;
  for (const room of source.rooms) occurrenceCount += room.occurrences.length;
  need(positionValues <= LIMITS.positionValues && indexValues <= LIMITS.triangles * 3 && ringPoints <= LIMITS.ringPoints
    && records <= LIMITS.overlayRecords && occurrenceCount <= LIMITS.occurrences, 'Presentation bound');

  const floorsById = new Map<string, PresentationFloor>();
  for (const floor of source.floors) {
    need(ID.test(floor.floorId) && !floorsById.has(floor.floorId), 'Floor identity');
    need(floor.elevation === null || finite(floor.elevation.metres), 'Floor elevation');
    floorsById.set(floor.floorId, floor);
  }
  const roomsById = new Map<string, PresentationRoom>();
  const occurrences = new Map<string, { occurrence: SpaceOccurrence; room: PresentationRoom }>();
  let occurrencesWithUnknownFloor = 0;
  for (const raw of source.rooms) {
    need(ID.test(raw.roomId) && !roomsById.has(raw.roomId) && !floorsById.has(raw.roomId), 'Room identity');
    need(raw.atlasPlaceId === null || ID.test(raw.atlasPlaceId), 'Atlas link');
    const linked = raw.occurrences.map(occurrence => {
      need(isOpaqueToken(occurrence.spaceOccurrenceId) && !occurrences.has(occurrence.spaceOccurrenceId), 'Occurrence identity');
      const known = occurrence.floorId !== null && floorsById.has(occurrence.floorId);
      if (!known) occurrencesWithUnknownFloor++;
      return known ? occurrence : { ...occurrence, floorId: null };
    });
    const room: PresentationRoom = { ...raw, occurrences: linked };
    roomsById.set(room.roomId, room);
    for (const occurrence of linked) occurrences.set(occurrence.spaceOccurrenceId, { occurrence, room });
  }

  const planShapes = new Map<string, (readonly PlanRing[])[]>();
  let planFeaturesDemoted = 0;
  for (const floor of source.floors) for (const feature of floor.plan?.features ?? []) {
    need(feature.rings.length > 0 && feature.rings.every(ring => ring.length >= 3 && ring.every(([x, z]) => finite(x) && finite(z))), 'Plan geometry');
    if (feature.occurrenceId === null) continue;
    const target = occurrences.get(feature.occurrenceId);
    if (feature.role !== 'space' || target?.occurrence.floorId !== floor.floorId) { planFeaturesDemoted++; continue; }
    planShapes.set(feature.occurrenceId, [...(planShapes.get(feature.occurrenceId) ?? []), feature.rings]);
  }

  const meshOccurrence = new Map<string, string | null>(), occurrenceMeshes = new Map<string, string[]>();
  const yRanges = new Map<string, [number, number]>(), meshCounts = new Map<string, number>();
  let meshBindingsDemoted = 0, displayOnlyMeshes = 0;
  for (const mesh of source.meshes) {
    need(isOpaqueToken(mesh.meshKey) && !meshOccurrence.has(mesh.meshKey), 'Mesh identity');
    need(mesh.positions.length % 3 === 0 && mesh.indices.length % 3 === 0 && mesh.indices.length > 0, 'Mesh shape');
    const vertices = mesh.positions.length / 3;
    for (const index of mesh.indices) need(index < vertices, 'Mesh index');
    const floorId = mesh.floorId !== null && floorsById.has(mesh.floorId) ? mesh.floorId : null;
    // Ranges come from drawn (referenced) vertices only.
    let low = Infinity, high = -Infinity;
    for (const index of mesh.indices) {
      const base = index * 3;
      for (let axis = 0; axis < 3; axis++) need(finite(mesh.positions[base + axis]!), 'Mesh position');
      const y = mesh.positions[base + 1]!; if (y < low) low = y; if (y > high) high = y;
    }
    let occurrenceId: string | null = null;
    if (mesh.occurrenceId !== null) {
      const target = occurrences.get(mesh.occurrenceId);
      // A binding covers only an occurrence present in the same floor's plan features.
      if (target && floorId !== null && target.occurrence.floorId === floorId && planShapes.has(mesh.occurrenceId)) occurrenceId = mesh.occurrenceId;
      else meshBindingsDemoted++;
    }
    if (occurrenceId === null) displayOnlyMeshes++;
    else occurrenceMeshes.set(occurrenceId, [...(occurrenceMeshes.get(occurrenceId) ?? []), mesh.meshKey]);
    meshOccurrence.set(mesh.meshKey, occurrenceId);
    if (floorId !== null) {
      meshCounts.set(floorId, (meshCounts.get(floorId) ?? 0) + 1);
      const range = yRanges.get(floorId) ?? [Infinity, -Infinity];
      range[0] = Math.min(range[0], low); range[1] = Math.max(range[1], high); yRanges.set(floorId, range);
    }
  }

  const floorFacts = new Map<string, FloorFacts>();
  for (const floor of source.floors) floorFacts.set(floor.floorId, {
    occurrenceIds: [...occurrences.values()].filter(row => row.occurrence.floorId === floor.floorId).map(row => row.occurrence.spaceOccurrenceId),
    hasPlan: (floor.plan?.features.length ?? 0) > 0,
    meshCount: meshCounts.get(floor.floorId) ?? 0,
    yRange: yRanges.get(floor.floorId) ?? null,
  });
  const overlays = source.overlays.filter(layer => layer.publicationId === pin.publicationId && ID.test(layer.id));
  const labelCounts = new Map<string, number>();
  for (const room of source.rooms) { const key = room.label.trim().toLocaleLowerCase(); labelCounts.set(key, (labelCounts.get(key) ?? 0) + 1); }
  return {
    source, floorsById, roomsById, occurrences, planShapes, occurrenceMeshes, meshOccurrence, floorFacts, overlays,
    duplicateLabels: new Set([...labelCounts].filter(([, count]) => count > 1).map(([label]) => label)),
    issues: {
      occurrencesWithUnknownFloor, planFeaturesDemoted, meshBindingsDemoted, displayOnlyMeshes,
      occurrencesWithoutPlanShape: [...occurrences.keys()].filter(id => !planShapes.has(id)).length,
      overlayLayersWithheld: source.overlays.length - overlays.length,
    },
  };
}

/** Distinct logical rooms sharing a label (occurrences of one room are not duplicates). */
export function isDuplicateLabel(model: AdmittedPresentation, room: PresentationRoom): boolean {
  return model.duplicateLabels.has(room.label.trim().toLocaleLowerCase());
}

/** Short visible identity suffix for logical rooms whose labels repeat. */
export function shortId(id: string): string {
  return id.replace(/[^A-Za-z0-9]/g, '').slice(-4);
}
