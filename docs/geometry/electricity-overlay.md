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
