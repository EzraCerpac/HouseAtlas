# Network overlay beside provisional scans

`frontend/src/lantern/overlays/network/index.ts` exports `NetworkOverlayPanel`, `NetworkTopology`, and their typed documentary data/selection interface. This module performs no source reads or writes. The integration owner mounts it beside the scan and supplies a bounded authorized projection; no household inventory is checked into this module.

## Host contract

```tsx
<NetworkOverlayPanel
  active={overlayKind === 'network'}
  viewKey={viewKey}
  data={networkData}
  selectedFloor={selectedFloor /* { id, label } | null */}
  selectedPlaceId={selectedPlaceId /* native Atlas identity or null */}
  selectedPackagePlaces={selectedPackagePlaces /* exact reviewed receipt context or null */}
  onSelectionChange={selection => { /* device/link { kind, id } or null */ }}
/>
```

`data.viewKey` must equal the current host view. Supply a new immutable projection when authorization or scope changes, and remove data/unmount the panel when access is revoked. The host owns fencing its selection callback. Local selection is fenced to the supplied data object and view identity. The common overlay switch supports `none | network | electricity`; network never edits the shared scan renderer, route, source port, or native contracts.

The optional documentary `selectedPackagePlaces` context has the geometry owner's common fields: `viewKey`, `status`, `receiptId`, `receiptSha256`, `sourceAnchorIds`, `targets` (exact `packagePlaceKey` + `packagePlaceUuid` pairs), and `unresolvedLabels`. The host validates complete receipt membership and clears context on authorization/source changes. The module checks current view, accepted status and the supplied source's `roomMappingReceipt` ID/hash, then matches exact target pairs and source anchor identities. Accepted documentary context takes precedence over a native room selection while the retained projection still lacks native bindings. Null documentary context uses exact native place filtering when provided; otherwise it shows the building. An invalid or proposed context exposes no room-specific list, labels or placement details; all authorized building topology remains visible. Devices outside the selected room retain their topology nodes and connections with an outside-context label. Reviewed plan details are bounded to the selected source anchor IDs as well as the exact canonical key/UUID pair. The host clears documentary context on independent native selection changes. Multiple targets and unresolved span labels remain distinct.

A place may carry canonical documentary `sourcePlaceId`/`sourcePlaceUUID` plus reviewed `planAssociations` containing exact hash-scoped DXF anchor identity, source floor label/key, reference/handle and receipt hash. These optional fields preserve the original Network `sourceRoomId`, and never occupy native `placeId`. Reviewed text references remain separate from unmatched mesh mapping and null physical coordinates. Replacing source scans appends a new receipt; graph positions or text insertion points never carry forward device coordinates.

The floor object is context only. It never filters documentary associations or supplies room matching. `placeId` is a reviewed native place identity; `sourceRoomId` is a documentary identity, never a scan prim path. Equal room labels do not merge separate identities. Mobile and nonspatial endpoints remain visible in the topology and excluded from floor placement even if a contradictory association is supplied.

## Visible connections and acceptance

The diagram adapts the retained Lantern mock's router-first breadth-first layout and Bezier connections, using the existing network palette, glyphs, Icon, Note and ClaimBadge components. SVG nodes and links are selectable by pointer and keyboard. Link details resolve endpoint names and interfaces; selecting a device exposes its connected links. Unbound named endpoints and disconnected records remain visible.

Diagram x/y values are generated display positions only. They never become mesh positions. Every documentary coordinate and physical link path is explicitly `null`. Interface nodes collapse into their owning device in the diagram while original endpoint identities remain available in details. No floor, cable route, coverage measurement, or source-to-place binding is inferred from graph layout or a placeholder room name.

A user-accepted projection sets source/device/place/link acceptance fields. It displays solid connections and saved configuration wording, including accepted formerly proposed relations. It preserves historical source relation kinds, confidence, notes and timestamps internally; the accepted presentation hides historical uncertainty badges/notes. Physical placement and route limitations remain visible. Recorded-only projections retain their source evidence presentation. Acceptance of topology is independent of acceptance of scan mapping.

## Checks and ownership

Owned paths are this new network module, `frontend/lantern-tests/network-overlay-read.mjs`, and this document. The integrator owns mounting, shared interfaces, CI and deployment. Geometry owns the scan renderer. The scoped test uses generic fixtures and the actual TypeScript model to check distinct room identities, placement exclusions, endpoint ownership, all connections, accepted configuration provenance, null physical geometry and source immutability.

```sh
node frontend/lantern-tests/network-overlay-read.mjs
npm run typecheck --prefix frontend
npm run build --prefix frontend -- --configLoader runner
```

The final private handoff carries exact base/commit, source and build pins, actual browser observations and prerequisite renderer fix. A successful standalone panel rehearsal does not establish native mounting, CI or deployment acceptance.
