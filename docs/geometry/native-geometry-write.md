# Native geometry custody write port

`createNativeGeometryWriteClient` is an optional host port. It prepares and sends
two independent custody commits through the existing native HTTP owner. It is
not mounted by this change. The host supplies the current actual application
session, full workspace/home scope, Stock admission and change subscription.
Session and CSRF values stay inside that boundary; public bindings contain scope
only. This does not issue credentials, grants or additional access.

The required `NativeGeometryHostContext.sessionIdentity` is a stable opaque
object supplied by Root's actual canonical native session owner. That owner
must rotate it on session replacement/logout; it must not be derived from
actor, CSRF or expiry strings or minted per DTO read. The actual native
`integration/main.tsx` current-session object can supply this identity while it
is canonical. The generic Stock facade's cloned DTO is not this identity.
Fresh clones of session/scope/admission DTOs are supported: equal complete
values keep the public binding stable. Changed owner identity, actor, CSRF,
expiry or workspace/home rotates the ledger epoch; expired/missing context
masks it. Changed admission revision/ordered commands masks a held binding
without discarding same-session/scope unknown custody. The host must notify the
subscription on these changes so active uploads are aborted and withheld.
The last accepted owner/tuple/scope epoch is retained separately from that
nullable binding. Restoring the same actual context after a temporary missing
view/admission unmasks its existing ledger and unknown hold; it does not create
a fresh custody epoch. The port cannot manufacture a canonical session identity
on restoration.

An original uses fixed POST
`/api/atlas/geometry/v1/workspaces/{workspaceId}/homes/{homeId}/originals`.
It accepts a nonempty USDZ (`model/vnd.usdz+zip`) or IFC (`application/x-step`)
Blob of at most 10 MiB. A derivative uses fixed POST
`/api/atlas/geometry/v1/workspaces/{workspaceId}/homes/{homeId}/originals/{originalAssetId}/derivative`.
It accepts at most 8 MiB of the immutable authored mesh profile under
`application/vnd.houseatlas.magicplan-authored-mesh+json`. The derivative requires
the USDZ original's correlated receipt from this client and current session/scope;
the current native derivative owner does not support an IFC original.
Both multipart exchanges send metadata first, then the exact immutable file
bytes, explicit filename, MIME and supplied source licence. Hashing measures the
bytes locally; the server independently qualifies content, lineage and custody.
The port does not parse a mesh as ordinary text or assert conversion acceptance.

Prepared IDs, metadata and Blob bytes are immutable and locally branded. The
original receipt retains the complete server-sealed Stock request and result.
The exact frozen Stock evaluator checks both closed roots; correlation also
checks request/context/target, single fresh asset/revision/audit, source licence,
purpose, MIME, hash, byte length, original guard and native intent digest. The
operation UUID is issued by storage, independently of the input idempotency key.
Numbers in retained roots stay `ExactDecimal` nodes with their original wire
tokens. The digest view converts only schema-bounded safe integer control
leaves and follows the existing native JCS root exclusions; it does not rewrite
the retained receipt or establish a transaction epoch.

Each prepared input can be submitted once. Before the single POST the memory
ledger records its exact metadata/file and unknown outcome. Headers and receipt
body share a 30-second settlement bound, with an owned reader and 1 MiB response
limit. Current session/CSRF/scope/admission and abort guards fence every awaited
result. A malformed, non-200, timed-out, aborted or changed-context response
leaves custody unknown. An unknown current-session entry holds further writes;
it does not imply non-admission, rollback or safe retry. No extra session GET,
automatic resubmission or old-server response fallback is added.

The client retains at most 16 submitted entries, without evicting an unresolved
input or receipt. The memory ledger survives form/view remounts while the host
keeps the same client instance. It is visible only under the same current
session/scope epoch; it is not durable browser storage and does not survive full
page or client recreation. A lost custody response can hide the server-issued
asset ID and upload token. The submitted multipart metadata alone is therefore
insufficient for the retained POST's complete Stock-body contract. This port
does not invent request-ID inspection or permit another upload. Such outcomes
require an explicit owner reconciliation before further custody is released.

Successful custody is always `not-associated`. The original and derivative are
separate commits; either may remain unassociated if later work is held or fails.
The derivative's selected original creation revision is one. A changed original
is withheld rather than substituted silently. This check is receipt correlation,
not a fresh graph admission before dispatch.

## Association prerequisite

The existing association route executes an atomic three-child Stock batch:
`evidence.create`, `geometry.create`, `identity.replace`. It needs the actual
fresh building identity and both retained assets from one qualified graph, full
original references and revision guards, and server-owned `importedAt`. The
existing building descriptor GET offers already associated geometry; it does not
disclose unassociated assets or provide the identity preimage needed for replace.
The current exact frontend read evaluator has no `atlas.asset.get` root, no
`atlas.identity.replace` input root and no matched same-graph read fingerprint
for these records. There is no exposed association method in this port. A
separate coordinated exact read/current-graph and full-preimage seam must be
reviewed before the host can prepare the association. Frozen Atlas schema,
generated types and SQL are unchanged.

## Source-only healthy helper

`frontend/lantern-tests/native-geometry-write.mjs` proposes one ordinary healthy
workflow with two successful fake transports returning actual `Response`
bodies. It loads this actual client and the actual exact evaluator, inspects
multipart ordering and byte identity, and checks complete correlated receipts
and the memory ledger. Its tiny synthetic blobs do not claim real IFC/USDZ or
mesh qualification. It executes no server, listener, private media, association,
provider, failure/control, timeout or retry case. Root must inspect/register the
full helper and release its exact named command before execution. Source review
alone does not establish native runtime, upload acceptance or deployment.
