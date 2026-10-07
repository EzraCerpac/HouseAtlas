# Qualified staged asset planning

`plan_staged_atlas_commands(root, staged, native)` borrows the actual sealed
`media::staged_upload::StagedAssetPlan` from accepted media
`f0d6b10f00bb93fc1c1dd4eb3ae66ee1fbe3f873`. It returns a privately constructed
`StagedAtlasCommandPlan` with read-only `plan()` and `staged()` accessors. The
wrapper has no constructor, deserializer, mutable or consuming accessor.
The plain plan can be cloned as data; it supplies no approval, execution
authority, media seal or consumed token.

The root may be its complete original `atlas.asset.create` request, or an
existing `atlas.batch.execute` containing exactly one matching asset-create
child. Matching uses the owner's canonical digest over the entire unchanged
envelope, including request ID, guards and nullable approval reference. The
published intent digest remains unchanged and retains its existing exclusions.
Evidence batch children must be `atlas.evidence.create` with an explicit submitted
connection through the asset's `evidenceIds` or the child's `atlas-asset`
reference. A reciprocal connection is optional. No link or target is invented.

The host's upload flow may instead use exactly three ordered children: asset
create, connected evidence create, and guarded `atlas.identity.replace` of its
PLACE. Published places use identity payload `kind: "location"`. That third
child must include the second child's evidence ID and an original Atlas target
revision precondition. Its complete submitted payload, target, revision and
guards pass through the existing replacement mapper unchanged. This factory
performs no standalone PLACE write and grants no transaction permission. The
host must supply the actual canonical Atlas identity target; a UI place label or
HomeBox source ID cannot supply it. Storage must verify the existing scoped
identity is a location as well as its original revision and final graph.

The existing mapper retains complete root and ordered child envelopes, child
indexes, IDs, keys, digests, reasons, separate root guards and native shape checks.
Only the asset's native payload comes from the measured sealed media payload;
evidence payloads remain submitted data. The ordinary unqualified asset-create
and asset-review mapper remains held. This factory opens no file or database,
reads no provider, fabricates no bytes/source witness and emits no receipt.

AT07 must implement the existing stock transaction's stage-token association and
unique consumption with the actual asset/manifest/audit/native and stock receipt
commit. That owner must retain the exact original principal, prepared witness,
graph and fence, and run its native transitions, original guards, final graph and
stock authorization/approval checks. The live stage has no restart authority.
A staged execution method should retain the existing generic authorization seam:
`principal: &A::Principal` with `B: StockAuthorization<Principal = A::Principal>`.
This accepts the host's actual `RequestPrincipal` when it is that associated type;
it must not reconstruct an access principal or replace the original authority.
A checked consumed-upload carrier, strict persisted-link loader and retained
planner are still required before reopened uploads can be projected or recovered.
No migration, standalone consume operation or compatibility fallback is added.

`plan_retained_staged_atlas_commands(root, consumed, native)` returns an
`AtlasCommandPlan` from storage's actual private-field `ConsumedUpload`. Storage
must first check the canonical binding/codec, complete original root and asset
envelopes, actor/scope/group ordinal, native receipt, creation audit and immutable
asset manifest before issuing the carrier in the same snapshot. The input root
is the parsed durable original root, not a newly renewed child envelope. The
factory uses `asset_request()`, `asset_id()` and the retained creation
`asset_payload()`, then checks `scope()` and `group_ordinal()` against its mapped
plan. It reuses the live single/batch/evidence/PLACE rules and preserves every
original root and child. Actual root/group operation and audit IDs remain checked
storage links; no ID is inferred from a request. Current asset fields and native
entries under validation do not supply the retained payload. No live media seal,
principal, grant, token consumption or historical guard authority is restored.

The retained factory is coded against the exact getter contract supplied by the
original AT07 owner. Actual schema-5 storage source and compiler reconciliation
are pending; the earlier storage06 compiler proof covers the published live
packet only. No proposal carrier or loader is added to the harness.

The task-owned external harness compiles actual domain/jobs on accepted
`d9e2b59ffef4b7ac2b11705df735b89d8371fdc5`, actual storage
`06eb465f6fe4b99530ef1636b46ea3e01e537106`, the accepted media pin above,
access `4a0cd4da563a32d26677755a608180c960765353` and contracts
`49d4a0a84baf05b3e16b5bd31833ebd0786c6d4c`. Manifests and locks stay outside Git.
The source introduces no dependency version; media's accepted pinned dependencies
are reused. Blocked AT36 recovery sources are absent from this branch and harness.

`examples/staged_assets_healthy.rs` creates four fresh actual sealed text stages
under a disposable vault using synthetic in-memory AT11 access and server IDs.
It maps single roots and ordered batches for both one-way links and both links,
including evidence-first order, the ordered three-child PLACE replacement,
unknown/permitted licence data and nullable/
non-null approval references. It checks complete originals, native IDs/guards,
sealed measured payloads and immutable binding digests. Licence/approval values
grant no authority. It executes no asset commit, token consumption, source
witness, provider, queue, reopen, replay or held control. Its named standalone
binary must receive a new output directory; legacy or broad aggregates stay held.
