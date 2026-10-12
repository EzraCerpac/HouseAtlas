# Native targets for reviewed scan rooms

`roomMappings[].targets[]` retains the package room key and UUID and may also
carry `atlasPlaceId`, a native Atlas identity UUID. The Atlas identity is an
explicit owner selection; it is never inferred from or substituted with the
package UUID. Omitting the field remains equivalent to `null`, so existing
frozen selections and saved associations keep their prior meaning. When
provided, the exact Atlas identity is preserved through preparation, submit,
readback and exact-current reuse comparison.

Before the documentary text owner reserves either source, the importer resolves
all distinct non-null Atlas targets with the existing bounded Stock
`TopologyClient` read owner. It reads the selected building's active identity
members, active location semantics and active relations. All pages must be
current, scope-resolved to the selected workspace and home, and tied to the
same snapshot digest. The selected building must be an active location with one
accepted `building` classification. Each target must be an active location
with exactly one accepted classification, may not itself be classified as a
building, and must satisfy the existing reviewed scene place membership rule:
an accepted direct building membership, or an accepted level membership to
an accepted floor whose accepted building membership is the selected building.
Direct member floors remain valid. Other accepted native classifications,
including `other` circulation places, retain their Atlas classification; the
documentary package's use of the word “room” does not rewrite native semantics.
Multiple independently reviewed package targets may converge on one native
Atlas place. Each source mapping still has to match its own accepted package
targets and anchor membership; shared native IDs are deduplicated only for
current-place validation and revision guards.
Ambiguous membership parents, unreviewed targets, unavailable pages, scope
mismatch, or owner withdrawal refuse before text custody.

The verified current building and selected target identities, plus their
accepted location-semantics records, are carried into the scene request's
revision preconditions. Each revision is checked again through its existing
Stock record GET against the same topology snapshot before preparation. The
building's accepted classification is guarded even when every optional native
target is omitted or explicitly null.

Pure capacity preflight reserves the worst-width request guards before any
documentary custody: building identity and classification, each explicit target
identity and classification, document and geometry references, and a possible
prior scene head. Reviewed classification record IDs are known only after the
current topology read, so preflight reserves their UUID width with placeholders
when checking the existing 1 MiB command ceiling. This keeps a near-limit request
from passing preflight and failing only after text custody.

The check uses existing GET-only authenticated reads and grants. It does not
create topology, alter labels, project source-room text into Atlas, or change the
backend's reviewed-scene association contract. A later association write still
uses its existing independent reviewed-place validation.

For a source intake whose two documentary originals are already retained,
`associateRetainedScene(input, references, signal)` accepts their exact current
evidence IDs, original asset IDs and SHA-256 values; optional evidence and asset
revisions pin a prior source-ledger observation. It opens the current
read-owned evidence originals, verifies their text bytes, sizes, licenses and
requested revisions against the supplied files, then prepares the scene from
those same retained IDs. It does not reserve or create assets/evidence, replace
building identity, or synthesize text receipts/results. A scene attempt remains
held if dispatch is unknown; `reconcileRetainedScene(signal)` is GET-only and
never resends it. Current topology, full scope, geometry/floor keys, previous
head, and the building/target revision guards remain required.
A local pre-dispatch hook rejection leaves this continuation unclaimed because
no scene request was submitted; once the hook succeeds, submitted unknown and
acknowledged-partial outcomes retain their existing reconciliation behavior.

The inspected generated-only fake-transport regression cases are:

```sh
node frontend/lantern-tests/native-scan-import-scene.mjs committed
node frontend/lantern-tests/native-scan-import-scene.mjs floor-selection
node frontend/lantern-tests/native-scan-import-scene.mjs native-room-target
node frontend/lantern-tests/native-scan-import-scene.mjs native-room-target-explicit-null
node frontend/lantern-tests/native-scan-import-scene.mjs native-room-target-other
node frontend/lantern-tests/native-scan-import-scene.mjs native-room-target-floor-direct
node frontend/lantern-tests/native-scan-import-scene.mjs native-room-target-many-to-one
node frontend/lantern-tests/native-scan-import-scene.mjs native-room-target-invalid
node frontend/lantern-tests/native-scan-import-scene.mjs native-room-target-wrong-classification
node frontend/lantern-tests/native-scan-import-scene.mjs native-room-target-duplicate-classification
node frontend/lantern-tests/native-scan-import-scene.mjs native-room-target-wrong-scope
node frontend/lantern-tests/native-scan-import-scene.mjs native-room-target-owner-withdrawal
node frontend/lantern-tests/native-scan-import-scene.mjs retained-documents
node frontend/lantern-tests/native-scan-import-scene.mjs retained-documents-unknown
node frontend/lantern-tests/native-scan-import-scene.mjs retained-documents-before-dispatch
```

These cases use generated identities and a local fake transport only. They do
not exercise live providers, credentials, databases, imports, real concurrency,
crash recovery or household data.
