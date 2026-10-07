`plan_existing_asset_attachment(principal, root, asset, measured, native)` maps
one new evidence attachment to already retained bytes. It accepts the actual
AT11 principal, parsed wire3 root, Storage's private-constructor
`ExistingOriginalAsset`, and Domain's private `MeasuredAttachmentOriginal`.
The resulting private `ExistingAssetAttachmentPlan` borrows both checked inputs
and exposes the ordinary immutable `AtlasCommandPlan`. Planning supplies no new
attachment authority, live stage or consumed-token receipt.

The accepted representation is an ordered two-child `atlas.batch.execute`:
`atlas.evidence.create` referencing exactly the existing asset, followed by
`atlas.identity.replace` for the canonical location with the new evidence ID.
The asset and measurement must both have purpose `evidence-original`. Geometry
originals belong to a separately qualified geometry flow. Root and children
retain the exact asset revision guard and all current PLACE evidence guards.
Submitted envelopes, keys, reasons, guard order and payloads pass unchanged
through the existing native mapper and transaction. The asset's licence,
purpose, evidence IDs, timestamps, manifest and audit history remain unchanged.

## Current intake measurement

`measure_attachment_original(identity, stages, guard, original, admission,
body, budget)` is the only constructor of `MeasuredAttachmentOriginal`. The
identity contains the original outer root request ID and idempotency key, not
the fresh asset child IDs. The constructor checks canonical IDs and evidence
purpose, then calls the actual Media owner's
`NativeUploadStages::prepare_original_for_resolution` on the current body under
the original AT11 mutation guard and durable admission limits. It retains the
same original principal allocation and owns the measured value privately.

The receipt has no public fields, constructor from a `PreparedOriginal`, mutable
accessor, Clone or deserializer. Its `prepared()` getter returns only a shared
reference for Storage's actual scoped resolver. Reconstructing a public Media
data value cannot reconstruct the receipt. The planner requires pointer identity
with the actual principal and exact original outer request ID/key, in addition
to scope, purpose, key, digest, canonical size and content type. A receipt for
another original request cannot qualify this intent. Media remains responsible
for actual bytes, bounds, quota, validation and retained storage; this domain
bridge creates no second vault or provider framework.

## Root adoption

The baseline is landed main `87ad201140edb7b3afdb4396095a320c2926eafe`, including
the actual PR57 Storage and PR63 Media implementations and pinned PNG dependency.
Root must replace its direct measurement call with the domain constructor above,
passing `UploadMetadata.request_id` and `UploadMetadata.idempotency_key`. Pass
`measured.prepared()` to `resolve_original_asset_with_authorization` under the
same genuine original principal/authorizer and exact scope. Carry the intact
receipt through `plan_existing_upload_batch`, `qualify_existing` and
`execute_existing`; the domain factory additionally receives that original
principal. Root's metadata purpose/type comparisons use `measured.prepared()`.
No Storage or Media interface change is needed.

Retain the same original prepared witness, complete graph, principal, captured
grants and access fence. Storage rechecks revision guards, availability and the
final graph in its ordinary stock transaction, then every result is authorized.
Use `execute_stock_json_with_authorization`: the existing-asset intent emits no
asset create/review/replace command and no second consumption. Choose the
two-child representation before preparation; do not rewrite a prepared asset
creation. Newly submitted metadata cannot overwrite the existing provenance.

`committed_upload_with_authorization` supplies the actual checked first-token
`ConsumedUpload` after native/stock/audit association checks. Fresh guarded Media
cleanup remains serialized with restore and removes only matching pending
metadata. Neither a lookup miss nor a plan grants cleanup permission.

## PR70 review dispositions

[Evidence-only reuse](https://github.com/EzraCerpac/HouseAtlas/pull/70#discussion_r4206516574)
is valid and corrected: both the intake producer and planner require evidence
purpose, matching the fresh root attachment profile. The old public planner
accepted geometry-original even though the mounted qualifier restricted it.

[Measured-original binding](https://github.com/EzraCerpac/HouseAtlas/pull/70#discussion_r4206516581)
is valid and corrected at the domain seam: the former public data input is
replaced by the privately produced, principal/request-bound receipt. Storage's
retained-byte proof still establishes the existing asset; the new receipt
establishes current intake measurement. Root must adopt the new signatures
before integration can resolve this finding. Static source, compilation and
healthy current-intake evidence do not execute the deferred negative controls.
