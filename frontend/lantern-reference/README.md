# Lantern source adoption

The immutable source archive is `HouseAtlas-Lantern-B-Source.zip`, SHA256
`96a884bf935e6aedfa3e5b4f415cce8be295630fe052dc66c5497f8b87b1da63`.
`Claude-source-hashes.json` records all 44 authored reference files. The healthy
projection check verifies every archived file against those hashes.

All 39 authored `src/` files were adopted under `frontend/src/lantern/`.
The original layout, materials, icons, model renderer, camera, room index,
search, detail sheet, library, upkeep and responsive shell are reused. CSS
selectors are scoped to the Lantern host; local font files replace package
font imports. Type annotations/index guards satisfy the existing strict compiler.
The archive includes the original package/configuration files unchanged; the
integration retains HouseAtlas's existing dependency lock and build configuration.

## Source and operation boundaries

`Host.tsx` mounts below the existing SessionApp/AtlasApp and StockApplication.
`adapters/read.ts` projects the current authorized ReadyView and retains the
original entries, source references, cache states, dates, hierarchy, maintenance,
attachments and NativeLinks. Scope identifiers remain opaque source values.
Hierarchy never becomes physical placement. Arbitrary place kinds and unknown
records remain explicit. Relative upkeep uses ReadyView.now.

`state/store.tsx` owns local navigation, selection, search and motion only.
The prototype fixture modules, scripted assistant engine, simulated write queue,
conflict dialogs and drawn document previews remain inactive. Their authored
reference files are retained for traceability. They are not imported at runtime.
Prototype mutation buttons are disabled with a limitation beside the action.
No timer produces a write result, reconciliation, citation or successful receipt.

Existing PlaceEditor and verified native HomeBox links provide implemented
operations through their original authority and receipt boundaries. The Changes
view opens the mounted Atlas tools surface for existing features and canonical
command results. This transitional surface keeps feature access during adoption;
its forms remain within the original session/scope boundary. Changes does not
claim an empty operation history where no history DTO is supplied.

## Capability gaps

ReadyView supplies no reviewed room polygons, openings, anchors, dimensions,
circuits or valve/device placement. Lantern uses its original room-index fallback
with neutral place markers, unplaced records and no inferred scale or floorplan.
Saved passive Network relationships preserve source confidence, observation and
retrieval dates; they do not create device topology or physical cable positions.

The default integration has no configured optional AI application port, and the
backend RunOutcome has no citation DTO. The original AI settings surface reflects
actual host availability. No scripted assistant answers or citations are mounted.

HomeBox attachments retain their stored-file/external-link distinction. Only
issued safe same-origin media handles render an image or download link; failed
previews show the failure. A supplied link is not a completed transfer or evidence
of current availability. The media gateway checks validity on use. ReadyView has
no managed-link expiry metadata; an Atlas managed-download resolver and expiry
projection require the owning backend contract before new download UI is enabled.

Stock scopes retain their existing UUID admission rules. Legacy opaque HomeBox
collection IDs are shown unchanged through authorized view/cache routes. They
are never relabelled as UUIDs to fit stock commands. Provider writes remain
unavailable without durable host authority and the owning provider prerequisites.

## Verification

Run the four frontend commands listed in the root README, then
`npm run verify:publication` and the existing ordinary lane. The frontend
fixture check covers source integrity and healthy scoped projection only.
Browser QA uses isolated synthetic GET fixtures; it does not qualify real
provider writes, receipts, expiry/revocation or native browser tool invocation.
Source adoption is frontend-only and releases no main, deployment or G1–G5 gate.
