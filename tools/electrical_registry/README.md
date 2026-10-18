# Documentary placement registry

An offline, data-only registry for the existing
`houseatlas.documentary-electrical-fixtures.v1` ledger. No UI, transport,
native write, source discovery, model selection or production read is included.
Real ledgers, diagrams, registry outputs and evidence reports stay outside Git.

Inspect `registry.mjs` and `registry.test.mjs`, then run the four generated
positive cases and five specifically requested review regressions with Node 26.10.0:

```sh
node --test --test-concurrency=1 tools/electrical_registry/registry.test.mjs
```

The cases cover explicit unknowns, unassigned regions, distinct same-label room
identities, multi-room source associations, unknown light quantities, supplied
source-byte matching and approximate/proposed registrations. The five focused
regressions cover uncertainty omission/type, point/box containment, conflicting
plain/escaped duplicate JSON keys, registration provenance and room-specific
registration counts. They use generated memory data only. This scoped review
coverage does not authorize unrelated held controls or existing broad suites.
The healthy examples also retain required fixture label/glyph text, complete
assigned and unassigned group metadata, and an empty-membership registration
receipt. No additional omission controls were run for those three follow-ups.
The final contract-alignment pass adds healthy examples for unique source symbols,
explicit cluster IDs, UUID room identities, bounded quantities and equivalent
scientific notation. It adds no malformed-input, load or denial controls.

For separately authorized retained local inputs, explicitly name each file:

```sh
node tools/electrical_registry/registry.mjs /private/ledger.json /private/new-registry.json \
  --room-mapping /private/room-receipt.json \
  --artifact /private/original-photo.heic --artifact /private/upright-photo.jpg
```

Output is created exclusively with mode 0600; an existing output is never
overwritten. Only supplied files are read. Each JSON input is bounded to 16 MiB,
64 nesting levels and 1,000,000 object/array members; each ledger table has at
most 10,000 rows and each region has at most 64 place associations. Identity and
documentary text use the v1 field bounds; source quantities and PDF pages range
from 1 through 10,000 (quantities may be explicitly null). Numeric tokens are at
most 128 characters and must retain their exact decimal value through JavaScript
number serialization; equivalent exponent notation is accepted. This conservative
offline reader rejects lossy numeric input before rounded coordinates or counts
can pass validation. Invalid UTF-8 and duplicate decoded object keys are rejected
before JSON parsing can silently replace evidence. This applies to both the
ledger and optional room receipt. Source matching uses actual SHA-256 bytes; a path,
claimed hash or source label does not establish availability. A supplied room
receipt must match both the ledger's receipt ID and its exact byte digest.
No URL fetching or missing-file fallback exists.

Validation checks unique identities, reciprocal sheet/region and group/fixture
membership, package key/UUID consistency, normalized source coordinates with
each point inside its own box (including the edges), source-photo pins,
explicit null or nonempty fixture uncertainty, and approximate registration joins.
Required projected titles, labels, annotations and explicit cluster IDs are
validated before serialization. Source symbol keys are globally unique; package
room UUIDs use the v1 lowercase UUID format. Registrations, reciprocal memberships
and room/region/sheet record collections are indexed rather than repeatedly
scanning unrelated fixtures or receipts for every summary.
The registry preserves source points, quantity uncertainty, original source
dates, interpretation date, labels, association basis and receipt identities.
Its counts describe documentary records, never installed devices. Per-room, per-region
and per-sheet counts retain unassigned records, while association-instance
counts remain separate from distinct-record counts. A room's registration count
includes only non-proposed receipts for its exact package key/UUID pair; global
counts deduplicate fixtures across receipts. Every projected registration retains
its nonempty `basis` and `reviewQualification` text, including proposed receipts.
The top-level `registrationReceipts` table preserves every full receipt, including
empty fixture membership; those receipts add no registered-fixture counts.

The existing v1 contract cannot express calibrated physical placements or
verified current circuits. This tool requires its explicit null transforms,
coordinates, routes and circuits; it does not silently discard known placement.
Approximate display registration is reported separately and never promoted to
physical calibration. A future calibrated contract needs a separately reviewed
model/source revision binding, coordinate frame, units, calibration evidence
and uncertainty. It cannot be inferred from source points or room names.

Byte-consistent room receipts establish historical documentary context only.
The documented offline envelope differs from the smaller native admission
envelope; this validator does not replace the native source reader or its host
receipt and current-view checks.
They do not validate a current model crosswalk, native custody, access, original
PDF page identity or installed fixture completeness. Local source files can be
reported absent without claiming the underlying originals were lost. Fresh
owner reconciliation is required before applying historical room associations
to a different publication.

Publication manifest changes are limited to the source owner's released rows
for these three files. Existing rows and logical owners are preserved; final
composition and integration remain with the sole source owner. No CI changes
are included.
