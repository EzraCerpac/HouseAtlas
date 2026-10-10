import type { HouseData } from './types';

// "Quarry Lane Cottage" is an invented house with no reviewed plan. It shows how
// the atlas works room-first when there is no geometry at all.

export const quarryLane: HouseData = {
  id: 'quarry',
  name: 'Quarry Lane Cottage',
  tagline: 'Two-storey cottage, no reviewed plan yet',
  geometry: 'none',
  people: ['Mira', 'Tomas', 'Ada'],
  sources: {
    homeboxSyncedAt: '2026-10-07T07:40:00',
    networkObservedAt: '2026-10-05T21:02:00',
    networkRetrievedAt: '2026-10-05T21:30:00',
  },
  floors: [
    { id: 'q-fl-u', name: 'Upstairs', short: '1', order: 1, hasPlan: false },
    { id: 'q-fl-g', name: 'Downstairs', short: '0', order: 0, hasPlan: false },
  ],
  spaces: [
    { id: 'sp-q-kitchen', name: 'Kitchen', floorId: 'q-fl-g', kind: 'kitchen', geometry: 'none', homeboxRef: 'Location 0201' },
    { id: 'sp-q-sitting', name: 'Sitting room', floorId: 'q-fl-g', kind: 'living', geometry: 'none', homeboxRef: 'Location 0202', note: 'Wood stove on the chimney breast.' },
    { id: 'sp-q-porch', name: 'Porch', floorId: 'q-fl-g', kind: 'circulation', geometry: 'none', homeboxRef: 'Location 0203' },
    { id: 'sp-q-bath', name: 'Bathroom', floorId: 'q-fl-u', kind: 'wet', geometry: 'none', homeboxRef: 'Location 0204' },
    { id: 'sp-q-bed', name: 'Bedroom', floorId: 'q-fl-u', kind: 'sleep', geometry: 'none', homeboxRef: 'Location 0205' },
  ],
  openings: [],
  containers: [
    { id: 'ct-q-dresser', name: 'Kitchen dresser', spaceId: 'sp-q-kitchen', kind: 'Dresser', homeboxRef: 'Location 0301', rev: 1 },
    { id: 'ct-q-eaves', name: 'Eaves cupboard', spaceId: 'sp-q-bed', kind: 'Cupboard', homeboxRef: 'Location 0302', rev: 1 },
  ],
  items: [
    { id: 'it-q-stove', name: 'Wood stove', category: 'Heating', spaceId: 'sp-q-sitting', locationClaim: 'confirmed', model: 'Emberline 5 (fictional)', illustration: 'stove', homeboxRef: 'Item 0601', rev: 1 },
    { id: 'it-q-heater', name: 'Electric water heater', category: 'Heating', spaceId: 'sp-q-bath', locationClaim: 'owner', illustration: 'boiler', homeboxRef: 'Item 0602', rev: 1 },
    { id: 'it-q-binder', name: 'Recipe binder', category: 'Books', spaceId: 'sp-q-kitchen', containerId: 'ct-q-dresser', locationClaim: 'owner', illustration: 'box', homeboxRef: 'Item 0603', rev: 1 },
    { id: 'it-q-quilts', name: 'Spare quilts', category: 'Linen', spaceId: 'sp-q-bed', containerId: 'ct-q-eaves', locationClaim: 'owner', illustration: 'box', homeboxRef: 'Item 0604', rev: 1 },
    { id: 'it-q-kettle', name: 'Kettle', category: 'Appliance', spaceId: 'sp-q-kitchen', locationClaim: 'owner', illustration: 'box', homeboxRef: 'Item 0605', rev: 1 },
    { id: 'it-q-ladder', name: 'Step ladder', category: 'Tools', locationClaim: 'unknown', locationNote: 'Borrowed by a neighbour, maybe.', illustration: 'box', homeboxRef: 'Item 0606', rev: 1 },
  ],
  panels: [
    { id: 'pn-q-fuse', name: 'Fuse box', spaceId: 'sp-q-porch', claim: 'owner', evidenceIds: [], note: 'Old rewireable fuses. Not inspected.' },
  ],
  circuits: [
    { id: 'ci-q-1', panelId: 'pn-q-fuse', ref: 'F1', label: 'Sockets', rating: '30 A', protection: 'Rewireable fuse', claim: 'owner', claimNote: 'Owner’s note on the fuse carrier.', evidenceIds: [], color: '#2F56E0' },
    { id: 'ci-q-2', panelId: 'pn-q-fuse', ref: 'F2', label: 'Unknown', rating: '15 A', protection: 'Rewireable fuse', claim: 'unknown', claimNote: 'No label.', evidenceIds: [], color: '#7A8394' },
  ],
  outlets: [
    { id: 'ou-q-k1', label: 'K1', kind: 'Double socket', spaceId: 'sp-q-kitchen', circuitId: 'ci-q-1', claim: 'owner', evidenceIds: [] },
    { id: 'ou-q-b1', label: 'B1', kind: 'Fused spur', spaceId: 'sp-q-bath', claim: 'unknown', evidenceIds: [] },
  ],
  loads: [
    { id: 'ld-q-kettle', itemId: 'it-q-kettle', outletId: 'ou-q-k1', claim: 'owner', evidenceIds: [] },
    { id: 'ld-q-heater', itemId: 'it-q-heater', outletId: 'ou-q-b1', claim: 'owner', evidenceIds: [] },
  ],
  valves: [
    { id: 'vl-q-stopcock', name: 'Stopcock', kind: 'Stopcock', serves: 'Whole cottage', documentedState: 'Unknown', stateClaim: 'unknown', locationClaim: 'unknown', evidenceIds: [], note: 'Not yet located. Possibly under the kitchen sink or in the porch.' },
  ],
  devices: [
    {
      id: 'nd-q-router',
      name: 'Router',
      kind: 'Router',
      spaceId: 'sp-q-sitting',
      locationClaim: 'owner',
      hardware: 'Hardware ID ending 21:aa (demo)',
      observations: [
        { id: 'ob-q1', observedAt: '2026-10-05T21:02:00', retrievedAt: '2026-10-05T21:30:00', source: 'Router client list export', confidence: 'high', summary: 'Listed itself as the gateway for 2 clients.' },
      ],
    },
  ],
  links: [],
  cables: [],
  docs: [
    { id: 'doc-q-stove', title: 'Wood stove manual', kind: 'manual', storage: 'stored', fileName: 'emberline5.pdf', sizeKb: 1900, pages: 24, source: 'Uploaded to HomeBox', addedBy: 'Tomas', addedAt: '2026-05-02T10:00:00', linkedTo: ['it-q-stove'], version: 1, preview: 'manual', owner: 'HomeBox' },
    { id: 'doc-q-chimney', title: 'Chimney sweep certificate, 2025', kind: 'report', storage: 'link', url: 'https://sweep.example.invalid/cert/demo-2025', linkCheckedAt: '2026-05-02T10:10:00', source: 'Link added in Atlas', addedBy: 'Tomas', addedAt: '2026-05-02T10:10:00', linkedTo: ['it-q-stove'], version: 1, preview: 'none', owner: 'Atlas' },
  ],
  tasks: [
    { id: 'mt-q-sweep', title: 'Sweep chimney', targetId: 'it-q-stove', due: '2026-10-20', status: 'scheduled', evidenceIds: [], docIds: ['doc-q-stove'] },
    { id: 'mt-q-porch', title: 'Check porch roof after storms', targetId: 'sp-q-porch', status: 'done', completedAt: '2026-09-12', completedBy: 'Mira', evidenceIds: [] },
  ],
  history: [
    { id: 'hq-1', targetId: 'it-q-stove', at: '2026-05-02T10:00:00', who: 'Tomas', what: 'Added to HomeBox in Sitting room', system: 'HomeBox' },
  ],
  writes: [],
};
