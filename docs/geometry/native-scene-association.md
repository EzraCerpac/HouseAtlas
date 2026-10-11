# Native scene association

The optional review leaf binds a newly retained `text/plain` primary scene
original to a separate historical room-review original and current native
geometry. The scene text supplies documentary facts, not write authority. A
current Editor deliberately reviews one proposed association and sends one
`atlas.scene-association.create` Stock command. The native Media and Stock
owners repeat retained-byte, graph and transaction checks.

The host supplies a canonical current session identity, `ReadyView`, matching
Stock admission, current native geometry frame, and two genuine scoped evidence
IDs. It also supplies explicit source-floor and room-mapping decisions and
their current Stock guards. The leaf never finds candidates from filenames,
tags, source labels, package UUIDs, local storage or a fabricated asset ID.
Absent host-owned evidence IDs or guards leave the review unavailable.

Root instantiates **three distinct** `NativeEvidenceDocumentClient` owners:
primary review, historical review and mounted `NativeSceneSourceClient`. One
document owner withdraws its prior frame on every `open`, so sharing it would
silently invalidate an earlier original. The association client holds the two
review leases separately while a prepared intent is visible. The host owns the
third scene-reader client and all three binding subscriptions and disposal.
The leaf releases its prepared review leases on context change, input change,
abort, submit or unmount; it never disposes the host-owned clients.

The primary original must be closed `houseatlas.native-scene-source.v1` or
`.v2` JSON. Its `receiptCanonicalJson` is a literal, canonical, closed
four-key `houseatlas.native-scene-room-review.v1` receipt:
`profile`, `receiptId`, `sourceReceiptSha256`, `anchors`. The client rejects
duplicate decoded keys at every depth before the shared lossless parser runs,
checks re-canonicalization, compares complete anchor
membership with the proposed payload, and hashes the exact literal UTF-8 bytes
for `acceptedReceipt.canonicalSha256`. Separately, it hashes the actual
historical original bytes against `sourceReceiptSha256` and the historical
asset pin. These two hashes have different meanings. Current source-floor
bindings must match the native geometry frame by key, original asset/hash and
geometry ID/revision; room mappings must cover the retained room entries and
their accepted receipt anchors. Null Atlas place mappings remain unplaced.

The review action requires current `ReadyView.canEdit`, a scope/session-matching
Stock admission that includes `atlas.scene-association.create`, current original
leases, current geometry, an explicit review statement and reason, and no
unresolved earlier write. The backend Editor check is authoritative; the
session DTO does not contain a role. The submitted request is one closed Stock3
root at the existing `/api/atlas/stock/v3/workspaces/{w}/homes/{h}/commands`
route. A prepared intent retains one target UUID, request ID, idempotency key,
exact serialized body and RFC 8785 request digest. The digest removes only the
root requestId and approvalReceiptId before canonicalization. The client never
automatically retries a dispatched POST.

A foreground result is committed only when its closed Stock result matches the
request ID, command, scope and digest, `replayed === false`, exactly one active
target record with revision 1 and exact intended payload, and one audit ID.
Timeout, late result, abort after dispatch, transport error, replay or failed
correlation leaves the owner intent `unknown`. Pending outcomes are tagged by
the exact opaque session identity, actor, CSRF token, expiry, workspace and home;
building is filtered separately. A write-admission refresh or `canEdit` change
in that same session/scope keeps the unknown visible and blocks another write.
Prepared document leases retain their stricter admission-sensitive binding.
A replaced owner cannot see, resolve or resend a prior owner's unknown intent.
The UI offers authenticated readback even while create admission is unavailable.
Even a correlated commit
does not publish scene data until the dedicated authenticated current-head GET
returns that exact target and current geometry pins.
When UNKNOWN resolution confirms that exact target as the current head, the UI
refreshes the host scene so its independently mounted scene reader obtains that
current selection. This readback does not grant create admission or send another
write.

On normal mount and explicit refresh, the client reads
`GET /api/atlas/scene/v1/workspaces/{w}/homes/{h}/buildings/{b}/current`.
`no-current-association` is an empty state; `current-source-unavailable`,
conflict, malformed data, changed scope/session or withdrawn geometry withholds
the selection. An available raw stored scene-association record passes the
closed `sceneAssociationRecord` validator root, separately from the Stock
create receipt, and its validated primary document,
accepted receipt anchors and floor bindings become `NativeSceneSourceSelection`
for the current host view key. No latest-date heuristic or ephemeral browser
selection substitutes for the native current head. The host synchronously hides
the scene and releases its document and geometry leases on owner withdrawal.

Root owns integration in `main.tsx`, `Host.tsx`, `NativeScanAtlas.tsx` and the
exact Stock schema-validator registrations for scene create request/result.
This donor adds only the leaf client, UI and this document. It contains no
private household original, reviewed receipt, drawing, native deployment or
runtime acceptance.
