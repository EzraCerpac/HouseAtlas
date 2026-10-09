// Lantern presentation model. Source-backed records retain their original
// HouseAtlas records in the adapter; dormant reference fixtures are not mounted.

export type Pt = [number, number];

/** How sure we are about a fact, and who said it. */
export type Claim = 'confirmed' | 'owner' | 'source' | 'disputed' | 'unknown';

export type SpaceKind =
  | 'living'
  | 'kitchen'
  | 'wet'
  | 'sleep'
  | 'circulation'
  | 'work'
  | 'service'
  | 'stair'
  | 'outdoor';

export type Overlay = 'spaces' | 'belongings' | 'electrical' | 'water' | 'network' | 'upkeep';

export type EntityKind =
  | 'space'
  | 'item'
  | 'unknown'
  | 'container'
  | 'panel'
  | 'circuit'
  | 'outlet'
  | 'valve'
  | 'device'
  | 'cable'
  | 'doc'
  | 'task';

export type System = 'HomeBox' | 'Atlas';

export interface Floor {
  id: string;
  name: string;
  short: string;
  /** Vertical order, 0 = lowest drawn floor. */
  order: number;
  hasPlan: boolean;
  note?: string;
}

export interface Space {
  id: string;
  name: string;
  floorId: string;
  kind: SpaceKind;
  shape?: Pt[];
  geometry: 'reviewed' | 'none';
  geometrySourceId?: string;
  formerNames?: { name: string; until: string }[];
  homeboxRef?: string;
  note?: string | undefined;
  semanticKind?: import('../../app/types').Entry['semanticKind'] | undefined;
}

export interface Opening {
  floorId: string;
  a: Pt;
  b: Pt;
  type: 'door' | 'window' | 'glazed' | 'open';
}

/** Cupboards, cabinets and shelving: places that hold things but are not rooms. */
export interface Container {
  id: string;
  name: string;
  spaceId: string;
  kind: string;
  pos?: Pt;
  size?: Pt;
  homeboxRef: string;
  rev: number;
  note?: string;
}

export type Illustration =
  | 'dishwasher'
  | 'fridge'
  | 'oven'
  | 'washer'
  | 'boiler'
  | 'sofa'
  | 'tv'
  | 'piano'
  | 'desk'
  | 'router'
  | 'printer'
  | 'clock'
  | 'tent'
  | 'drill'
  | 'bike'
  | 'freezer'
  | 'alarm'
  | 'lamp'
  | 'box'
  | 'stove'
  | 'mower'
  | 'dehumidifier';

export interface Item {
  id: string;
  name: string;
  category: string;
  spaceId?: string | undefined;
  containerId?: string | undefined;
  pos?: Pt | undefined;
  locationClaim: Claim;
  locationNote?: string;
  manufacturer?: string | undefined;
  model?: string | undefined;
  serial?: string | undefined;
  acquired?: string;
  note?: string | undefined;
  illustration: Illustration;
  homeboxRef: string;
  rev: number;
}

export interface Panel {
  id: string;
  name: string;
  spaceId: string;
  pos?: Pt;
  claim: Claim;
  evidenceIds: string[];
  note?: string;
}

export interface Circuit {
  id: string;
  panelId: string;
  ref: string;
  label: string;
  rating: string;
  protection: string;
  claim: Claim;
  claimNote: string;
  evidenceIds: string[];
  color: string;
}

export interface Outlet {
  id: string;
  label: string;
  kind: string;
  spaceId: string;
  pos?: Pt;
  circuitId?: string;
  claim: Claim;
  evidenceIds: string[];
  note?: string;
}

/** A documented "this item is plugged into that outlet" fact. Never inferred. */
export interface Load {
  id: string;
  itemId: string;
  outletId: string;
  claim: Claim;
  evidenceIds: string[];
  note?: string;
}

export interface Valve {
  id: string;
  name: string;
  kind: string;
  spaceId?: string;
  pos?: Pt;
  serves: string;
  documentedState: string;
  stateClaim: Claim;
  stateObservedAt?: string;
  locationClaim: Claim;
  evidenceIds: string[];
  note?: string;
}

export type Confidence = 'high' | 'medium' | 'low';

export interface Observation {
  id: string;
  observedAt: string;
  retrievedAt: string;
  source: string;
  confidence: Confidence;
  summary: string;
}

export interface Device {
  id: string;
  name: string;
  kind: string;
  spaceId?: string;
  pos?: Pt;
  locationClaim: Claim;
  itemId?: string;
  hardware: string;
  observations: Observation[];
  note?: string;
}

export interface NetLink {
  id: string;
  from: string;
  to: string;
  kind: 'wired' | 'wireless';
  observedAt: string;
  retrievedAt: string;
  source: string;
  confidence: Confidence;
}

/** Owner-documented physical cabling. Separate from observed logical links. */
export interface CableRun {
  id: string;
  name: string;
  fromId: string;
  toId: string;
  medium: string;
  claim: Claim;
  evidenceIds: string[];
  note: string;
}

export type DocKind =
  | 'manual'
  | 'photo'
  | 'receipt'
  | 'report'
  | 'export'
  | 'note'
  | 'schedule'
  | 'unknown';

export type PreviewKind =
  | 'manual'
  | 'receipt'
  | 'eicr'
  | 'boiler-report'
  | 'panel-photo'
  | 'stopcock-photo'
  | 'ap-photo'
  | 'wallplate-photo'
  | 'router-export'
  | 'leaflet'
  | 'survey'
  | 'note'
  | 'insurance'
  | 'media'
  | 'none';

export interface Doc {
  id: string;
  title: string;
  kind: DocKind;
  storage: 'stored' | 'link';
  fileName?: string;
  sizeKb?: number;
  pages?: number;
  url?: string;
  linkCheckedAt?: string;
  source: string;
  addedBy: string;
  addedAt: string;
  capturedAt?: string;
  retrievedAt?: string;
  linkedTo: string[];
  version: number;
  versions?: { v: number; at: string; note: string }[];
  preview: PreviewKind;
  /** For user-added media: which demo tray illustration was attached. */
  mediaVariant?: string | undefined;
  summary?: string;
  owner: System;
}

export interface Task {
  id: string;
  title: string;
  targetId: string;
  due?: string;
  status: 'scheduled' | 'done' | 'unknown';
  completedAt?: string;
  completedBy?: string;
  note?: string | undefined;
  cadence?: string | undefined;
  /** HomeBox maintenance cost, including zero. The source records no currency. */
  cost?: number | undefined;
  evidenceIds: string[];
  docIds?: string[] | undefined;
}

export interface HistoryEvent {
  id: string;
  targetId: string;
  at: string;
  who: string;
  what: string;
  system: System | 'Network';
}

export type WriteStatus = 'queued' | 'running' | 'completed' | 'uncertain' | 'conflict' | 'discarded';

export interface ConflictInfo {
  field: string;
  base: string;
  mine: string;
  theirs: string;
  theirsBy: string;
  theirsAt: string;
  baseRev: number;
  theirsRev: number;
}

export type Patch =
  | { op: 'updateItem'; id: string; set: Partial<Item> }
  | { op: 'renameContainer'; id: string; name: string }
  | { op: 'linkDoc'; docId: string; targetId: string }
  | { op: 'addDoc'; doc: Doc }
  | {
      op: 'completeTask';
      id: string;
      completedAt: string;
      completedBy: string;
      note?: string | undefined;
      evidenceIds: string[];
    }
  | { op: 'addTask'; task: Task }
  | { op: 'none' };

export interface WriteOp {
  id: string;
  title: string;
  targetId: string;
  system: System;
  status: WriteStatus;
  createdAt: string;
  updatedAt: string;
  patch: Patch;
  origin: 'you' | 'assistant';
  /** Forces the simulated outcome (used by seeded demo cases and proposals). */
  forceOutcome?: 'completed' | 'uncertain' | 'conflict';
  conflict?: ConflictInfo;
  note?: string;
}

export interface SourceStatus {
  homeboxSyncedAt: string;
  networkObservedAt: string;
  networkRetrievedAt: string;
  geometryReviewedAt?: string;
}

export interface HouseData {
  id: string;
  displayNow?: string;
  name: string;
  tagline: string;
  geometry: 'reviewed' | 'none';
  floors: Floor[];
  spaces: Space[];
  openings: Opening[];
  containers: Container[];
  items: Item[];
  panels: Panel[];
  circuits: Circuit[];
  outlets: Outlet[];
  loads: Load[];
  valves: Valve[];
  devices: Device[];
  links: NetLink[];
  cables: CableRun[];
  docs: Doc[];
  tasks: Task[];
  history: HistoryEvent[];
  writes: WriteOp[];
  sources: SourceStatus;
  people: string[];
}

export interface Selection {
  kind: EntityKind;
  id: string;
}
