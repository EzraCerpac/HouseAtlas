# Documentary electricity overlay

`frontend/src/lantern/overlays/electricity` exports `ElectricityOverlayPanel`,
its immutable domain types, and `adaptDocumentaryElectricity`. The geometry
owner mounts it alongside the source mesh viewer through the shared overlay
host. This module does not edit the viewer, renderer, native contracts or routes.

The panel reuses Lantern's actual `Icon`, `ClaimBadge`, `Note`, `Section` and
`LAYER.electrical` components/palette, and adapts its original electrical legend
rows. Literal drawing labels filter source sheets; they are not circuit records
or proof of current membership. No mock `buildPins` coordinates are used.

Props are `active`, opaque authorized `viewKey`, nullable `data`, optional
`selectedFloor:{id,label}|null`, `selectedPlaceId:string|null`, optional
`selectedPackagePlaces:ElectricityPackagePlaceSelection|null`, optional
`onSelectionChange({kind:'electricity-evidence',id}|null)`, and optional
`onOpenSource(sheetId,pdfPage)`. The selection ID is the package documentary ID,
not a native Evidence ID. The source callback must use the owner's actual current
native file resolver. A photo path/hash or PDF page does not establish file
availability. The panel performs no reads, writes, diagnostics or file fetches.

The host must immediately fence data and selection on native session, scope,
access or revision invalidation and supply a fresh `viewKey`. Inactive panels
render no data. A data/view-key mismatch renders only unavailable status.
All export selectors are source context only. No matching or floor filtering
uses exported labels, ordinals, source ancestry, aliases or mesh names. Exact
native place IDs can filter reconciled room associations; choosing the genuine
building shows the complete collection, including unassigned drawings.

`selectedPackagePlaces` is a separate geometry-owned canonical receipt
projection: `{viewKey,status:'accepted'|'proposed'|'unmatched',receiptId,
receiptSha256,sourceAnchorIds,targets:[{packagePlaceKey,packagePlaceUuid}],
unresolvedLabels}`. The host verifies the actual receipt and source hashes;
this module's field checks do not authenticate a hash. The stored canonical
target's `stablePackagePlaceUuid` projects to `packagePlaceUuid`, never to a
native ID. Accepted selections filter documentary associations by exact key and
UUID pairs, unioning targets without merging room identities. Accepted package
selection takes precedence over native filtering, since the documentary
projection may not yet carry newly created room native IDs. Without package
selection, exact native filtering retains its original behavior. The host must
reconcile native and package selection through actual receipts and clear source
context when changing to an independent native place selection. A partial multi-space anchor shows
its unresolved parts explicitly and filters only its matched targets. Null means
no source-room selection. Proposed, unmatched or unavailable selections show no
room-specific sheets. The host must keep selection immutable, refresh it with
the current view, and clear parent-owned selection on context invalidation.

The geometry receipt authorizes a source-anchor-to-place association only.
It does not promote an inferred drawing association, reconstruct a historical
room footprint, establish physical mesh scale/alignment, or place electrical
symbols, devices or cables. In particular a source anchor spanning two hallway
components does not create a single room or equate a related landing identity.

`adaptDocumentaryElectricity` accepts the prepared documentary v1 source,
package room registry v1, an owner-reconciled native receipt map v1, and context.
It preserves one record per drawing, literal labels, source photo hashes and PDF
pages, direct readings, inferred proximity notes, uncertainty, unknown dates,
owner aliases and explicit historical transformations. Registry key/UUID joins
must agree. Candidate-name keys never resolve identities. Native IDs come only
from the explicit reconciled receipt map, never from package UUIDs or names.

Room association status (`owner-reported` or `inferred`) is separate from spatial
mapping. Version 1 always emits `mappingStatus:'unmatched'` and `coordinate:null`.
Historical splits produce distinct current-space associations, preserving the
historical label and alteration statement; changed use is not an alias. Photo
crop coordinates stay under `sourceImageRegion` in normalized photo space.
Source date, fact time, retrieval time and interpretation date remain distinct.

Actual household projections and original media remain outside Git. This
adapter is local preparation, not native import/admission or retention proof.
Native original intake requires the installed evidence owner, fresh admission,
committed correlation and actual retained-byte readback. No fabricated source
Binding, duplicate place or direct database write is part of this module.

## Shared scene adapter

`ElectricitySceneLayer` returns a raw SVG `g` for the geometry owner's existing
scene. `ElectricitySceneInspector` fills its secondary DOM details slot. Both
accept `active`, `viewKey`, `data`, `mapping`, `anchors`, `ui`, `unplacedDock`,
`selection`, `onSelectionChange`, and the same optional native/package selection
context as the documentary panel. The inspector optionally accepts the owner's
actual `onOpenSource` resolver. The layer optionally accepts `labelPoint`.
There is no new shell, renderer, camera, network call or native write.
With no selection the inspector returns a small original-style legend trigger;
the drawing list appears only after explicit selection. The geometry host owns
the placement of `.electricity-scene-summary` and `.electricity-scene-inspector`
in its existing secondary details slot, alongside the corresponding network
classes. These selectors do not reserve or modify any shared shell CSS.

`ElectricitySceneAnchor` structurally matches the geometry-owned projected room
contract: `id/viewKey/floorKey/packagePlaceKey/packagePlaceUuid/sourceAnchorIds/
receiptId/receiptSha256/base/top/visible/basis:'schematic-room'`. Its points and
the dock are ephemeral coordinates in the same SVG viewBox; `ui` is viewBox
units per CSS pixel. These coordinates never enter the retained electrical
records, measured geometry or source photo crops.

The separate host-qualified `ElectricitySceneMapping` projection names the
current view and owner receipt ID/SHA, and exact accepted source associations
`{floorKey,sourceAnchorId,packagePlaceKey,packagePlaceUuid,unresolvedLabels}`.
The host verifies frozen receipt bytes and accepted membership before supplying
it. The pure `electricitySceneProjection` then joins the exact receipt, floor,
source anchor, package key and UUID. A partially unresolved cross-level anchor
produces no room marker; its matched component may still filter documentary
sheets through `selectedPackagePlaces`. No aliases, export placeholders, F
labels, source ordinals, native IDs or mesh paths establish display membership.

One document marker groups distinct source sheets per visible floor/place pair,
using the original Lantern file icon, electrical palette, stem/shadow/halo and
callout style. This is a room-level documentary association, not an electrical
fixture. No wire or circuit edges are drawn. Original `owner-reported`/`inferred`
confidence and historical split/change-use statements remain in the inspector.
Distinct drawing totals and room-association instance totals stay separate.
The dock retains all eligible drawings outside currently visible room markers,
including unassigned and off-plan evidence. It does not mean those drawings
lack documentary room associations.

Scene selections are separately tagged: `{kind:'electricity-room',anchorId}`,
`{kind:'electricity-evidence',id}` (package documentary ID), or
`{kind:'electricity-unplaced'}` / `{kind:'electricity-records'}` (the full list).
The host clears them on context/access changes
and reconciles native/package context through actual receipts. Marker dispatch
checks current visibility/membership again; neither module authenticates a
receipt or grants access. Source opening remains an explicit owner resolver.

The inspected healthy generic scene example is:

```sh
node frontend/lantern-tests/electricity-scene-read.mjs
```

It runs the original positive documentary example, then pure grouping and actual
React SVG/inspector static markup. No server, household data or native intake is
involved. Browser interaction and mounted-scene availability require separate
review; static markup and an unmounted frontend build do not establish them.

Inspect this complete named positive example before running it:

```sh
node frontend/lantern-tests/electricity-overlay-read.mjs
```

It uses generic synthetic drawings and local pure transforms/static real React
markup only, with no listener, account, household data or mutation. It checks
literal filters, owner alias/split/change-use records, unknown dates, independent
package/native identities, a healthy canonical package-selection projection
including multiple targets/unresolved components, and unmatched electrical
placement. It does not qualify browser
interaction, access invalidation, native intake or deployment. Existing frontend
typecheck/build commands remain in README; ordinary CI is unchanged.

## Individual fixture evidence

`ElectricityFixtureDiagram` shows individual sockets, lighting marks, appliance
labels and unresolved symbols at their normalized upright-photo positions.
`ElectricalFixtureData` is a separate fixture ledger; the earlier sheet-level
adapter remains a secondary document index. Each glyph has a stable package ID,
sheet/region/cluster references, original and rendered photo hashes, its source
point and box, literal group evidence, quantity semantics and uncertainty.
Physical coordinates, wire routes and current circuit IDs remain null.
A source lighting label does not establish the number of installed lamps.

The diagram accepts `active`, `viewKey`, nullable `data`, `selectedRegionId`,
`selectedFixtureId`, `selectedGroup`, optional `selectedPackagePlaces`, and
`onRegionChange` / `onFixtureChange` / `onGroupChange`. The host supplies the
current region's exact `sourceImageUrl`, enables `showSourceImage`, and supplies
`onOpenSource(sheetId,pdfPage)` through its authorized source resolver. The
diagram makes no media or native requests of its own. A selected fixture has a
distinct pointer target, keyboard activation and an individual list entry.
Dense clusters can be zoomed without moving their source points. Group controls
emphasize historic associations while preserving the complete drawing.
Untraced source regions display no invented outline.
With no explicit region, the diagram uses only a region matching the current
accepted source-room receipt and exact package key/UUID. Otherwise it shows no
drawing or fixtures; the region selector remains available for deliberate browsing.

`ElectricityDrawingViewer` receives a nullable `source` and `onClose`. The source
includes sheet ID, title, PDF page, kind, exact content SHA, an already authorized
URL and custody (`private-local-copy` or `native-retained-asset`). File paths and
labels never become URLs. Image sources open at full readable width with fit,
zoom, scroll, Close/Escape and return focus. Semantically equivalent source
objects retain zoom and do not restart focus handling. PDF controls have an
explicit external link; the embedded preview stays outside the dialog's tab
sequence. Native custody is a host-established fact, not a value inferred from
a local file or a successful private browser rehearsal.

The native host opens saved originals only through `NativeEvidenceDocument`
and its current evidence-to-asset lease. The source-only `ElectricityDrawingViewer`
accepts a host-provided display URL; its PDF iframe does not grant an inline
native preview. A native PDF marked download-only stays a download. A verified
PNG viewing original may use the native PNG preview after its own current
evidence and asset checks. Package sheet IDs and source hashes cannot select
a native original by themselves.

`ElectricityFixtureLayer` is a raw SVG `g`. It accepts `active`, `viewKey`, `data`,
`placements`, optional `registrationPreviewId`, `selectedFixtureId`,
`selectedGroup`, `ui` and `onFixtureChange`. The geometry owner supplies ephemeral
display points, separately from unchanged source-photo points. A genuine
`ElectricalDiagramRegistration` must match the room-mapping receipt, source
hash, sheet/region, exact package key/UUID, approved source fixtures and source
anchors. Reviewed approximate placements use `reviewed-approximate-diagram`.
A separately requested preview of one proposed receipt uses
`proposed-diagram-alignment`; it has dashed rings and explicit proposed labels.
That preview does not accept a registration or create physical coordinates.
The host must show its qualification and keep unresolved source points visible
in the drawing/details rather than silently clamp them into a room.

Room naming alone never supplies fixture placement. A photo-to-region transform
and its review history belong to the geometry owner; measured scale, current
wiring and native circuit bindings remain separate facts. The host must clear
fixture, region, group and preview state with a changed scope/view, and connect
fixture selection to the exact source region and source-opening action.

The separately scoped positive fixture example is:

```sh
node frontend/lantern-tests/electricity-fixture-read.mjs
```

Inspect its body first. It uses three generic source symbols, pure projection
and real React static SVG/source-diagram markup. It checks one-X quantities,
unknown light quantity, per-fixture selection markup, historic group metadata,
untraced outlines and explicit proposed-preview styling. It has no listener,
household data, account, native mutation or adversarial case. Mounted source
access, pointer overlap, PDF focus and mobile layout require actual browser QA.
