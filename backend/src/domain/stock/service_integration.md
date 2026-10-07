# Domain service integration

This successor preserves accepted main `5518094b05962796b97f428d92c16dc262400a26`,
including PR79's original attachment measurement and restricted staged asset
creation. It changes only Domain source. Root owns admission, HTTP/MCP/WebMCP
mounting, manifests and final integration; Storage and Media retain qualification.

## Access and list correction

PR99 `fe7e1f13c99bec2085f1f6a9dbad53efcea983c0` supplies the genuine
`AccessBoundary::authenticated_session_binding(&self, original: &Principal)`
API. `AtlasListBinding::capture` accepts no cookie text and borrows that exact
original principal. `AtlasListPrincipal` must extract the same retained opaque
allocation; every page checks that it is the binding's original. Pairing an
independently captured binding with another principal fails before cursor use. The download session
port implements this same API for Access principals and the existing retained
Media principal through its Access mutex. RequestPrincipal composition must
delegate using `p.principal.principal()` or its same retained handle.

List state reserves each complete bounded continuation chain before issuance.
It retains unexpired tokens, including consumed predecessors, while other
requests run. Identical session/query/snapshot/offsets reuse their correlation.
This addresses both predecessor eviction and eviction before result release.
Five-minute expiry and configured capacity remain limits; exhaustion fails
before new issuance. No concurrency, expiry or rejection control is qualified.
See `atlas_lists.md` for exact root list adoption and disclosure obligations.

## Direct writes and specialized derivation

`atlas_direct_operation(OperationId) -> Option<storage::Operation>` is the
closed 31-form mapping shared with the existing planner. Root flat admission
can use `.is_some()` while retaining its original editor, guard, graph, approval
and transaction checks. This includes the two existing forms and the remaining
29. A metadata mapping itself grants no admission. Batch admission must still
check every ordered child and its complete candidate/impact graph.

`plan_derived_atlas_commands(&ValidatedRequest, &AtlasDerivation, &impl Contract)`
maps six specialized single forms; existing media-sealed `asset.create` is the
seventh. `AtlasDerivation` is reproducible DATA, not a source witness, renderer
seal, authority, execution capability or stock receipt. It preserves originals
for binding review/restore/remap and asset review, an actual import time for
geometry, and server-qualified source state for binding create/remap. Empty
wire evidence arrays that violate frozen binding/journal minimums remain held.
Mixed specialized batches need explicit owner adoption.

Remap preserves the retired binding's identity/source/state/evidence and changes
its review status. Submitted new binding/journal/source/evidence IDs stay exact.
One group contains old replace, new create, journal create, retaining submitted
guards. Distinct UUIDv8 native IDs derive from a versioned domain separator,
root intent digest and entry position. Store `ATLAS_DERIVATION_FORMAT` and the
immutable derivation alongside root/child intent and actual native entries.

Required AT07 API remains absent: qualified derivation/execution through the
existing `StockTransaction`/`CommandTransaction`, with preimages compared in
that same original-principal authorization fence and full candidate validation.
Its current public generic executor and retained projection replan only direct
forms or consumed sealed uploads. History/recovery must reconstruct specialized
plans from retained derivation, never current records, a fresh clock or new IDs.
`enforce_current_presence_hold` must remain mandatory. No generic public
execute-arbitrary-plan entrypoint is proposed.

Required AT12 peer for `asset.review/request-preview` remains absent: a privately
constructed renderer receipt qualified against the exact original principal,
asset/scope/revision/bytes/policy and submitted receipt ID. A policy enum or UUID
in `AtlasDerivation` supplies none of that proof. Root/Storage must obtain and
revalidate the genuine receipt before allowing SafeRendered execution.

## Managed asset download

`NativeAtlasAssetDownloads::new(media, storage, sessions, contracts, handles)`
borrows the existing actual `MediaService`, `MediaStoragePort`, Access binding,
stock validator and one host-shared `AtlasDownloadHandles`.
Use `AtlasReads::new(...).with_list_pages(...).with_downloads(downloads)`.
The stock query returns the exact wire3 asset-download envelope after managed
Media HEAD verifies current authorized original bytes. Handles bind session,
scope, asset, complete current record digest and exact request. Capacity is
1000, TTL five minutes, no restart persistence or unexpired-handle eviction.

Root output authorization calls `validate_issued(original_p, prepared, data)` on
an owner sharing those handles, alongside its original witness/graph checks and
exact-target disclosure. `.redeem(current_p, token, Get|Head, budget)` resolves
the stored asset/scope and calls the same managed Media delivery, checking
current record and true session before and after. Tokens never supply authority
or override scope. Root maps redemption to an authenticated route and advertises
only a qualified download operation. Retained-principal adaptation clones the
existing opaque allocation; it must never authorize a replacement principal.

All stock results remain unreleased until normal `dispatch_prepared` schema,
correlation, disclosure and final original-authority checks finish. No listener,
provider, deployment, source-presence admission or renderer seal is added here.
