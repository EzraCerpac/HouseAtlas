`plan_existing_asset_attachment(root, asset, measured, native)` maps a new
attachment to already retained bytes. Inputs are the parsed new wire3 root,
Storage's private-constructor `ExistingOriginalAsset`, and Media's measured
`vault::PreparedOriginal`. It returns a privately constructed
`ExistingAssetAttachmentPlan` borrowing those exact inputs; `plan()` exposes
the ordinary immutable `AtlasCommandPlan`. This is plan data, not authority,
a lookup receipt, a live upload seal or a consumed-token carrier.

The accepted representation is an ordered two-child `atlas.batch.execute`:
`atlas.evidence.create` referencing exactly that existing asset, followed by
`atlas.identity.replace` for the canonical location identity with the new
evidence ID. Both children and the root must retain an exact asset revision
guard. The identity replacement retains its submitted Atlas revision and full
payload. All root/child envelopes, keys, reasons, guards and audit linkage pass
unchanged through the existing native mapper and transaction. There is no asset
create/review/replace group and no invented asset audit or successful upload
receipt. The existing asset's source licence, purpose, evidence IDs, timestamps,
availability and audit history are unchanged. The submitted measured original
must retain the exact existing purpose; evidence and geometry originals are
not relabelled or interchanged.

The mapper checks active available Atlas ownership, exact workspace/home,
scoped storage key, digest, measured byte size and content type. It compares
numeric values canonically without narrowing JSON numbers. It neither selects
an asset globally nor weakens the unique scoped manifest key.

Produce the measured input through PR63 Media's
`NativeUploadStages::prepare_original_for_resolution` with the exact original
AT11 guard/principal, admission and bounded body. It retains bytes under durable
admission limits without issuing a second asset ID or token. Media pin:
`ea8ef14e05795334b3d79ae9c95c0a456f8b0308`; root must reconcile its pinned
`png = "=0.18.1"` dependency and lock entries.

Use PR57 Storage's `resolve_original_asset_with_authorization` with the genuine
original principal, original authorizer, exact scope and actual measured
`PreparedOriginal`. Its return value is the only accepted asset input: no
fabricated record or reconstructed manifest can create this carrier. Storage
checks the persisted row/manifest association and independently verifies retained
bytes through the genuine Media runtime before returning. Pin:
`f5ec22394a6ffbfcf8682ea8150902d6e88f646b`.

Owner composition remains required: retain the same original witness, graph
and access fence; recheck the asset
revision/availability, complete original guards and final graph inside Storage's
ordinary transaction; then authorize every returned record. An asset reference
does not carry permission to read its bytes. Existing source provenance must not
be overwritten by the new statement's metadata.

The host must choose this new two-command representation before preparation,
rather than dropping or relabelling an already prepared asset-create child.
Use ordinary `execute_stock_json_with_authorization`, not the staged-create
consumer: a fresh statement about an existing asset is a new intent, not replay
of its original upload. The original consumption row remains linked to the
first asset creation. Pending-stage disposal and upload quota remain Media's
responsibility; native lookup and immutable persisted associations remain
Storage's. `committed_upload_with_authorization` returns the actual immutable
`ConsumedUpload` for the first token only after native/stock/audit association
checks; reuse creates no second consumption. Neither checked Storage carrier
grants permission to attach or clean up a stage. Root HTTP/React composition is
outside this namespace. Complete current PLACE evidence revision guards must
remain on the submitted root and children along with the existing asset guard.
