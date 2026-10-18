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

For separately authorized retained local inputs, explicitly name each file:

```sh
node tools/electrical_registry/registry.mjs /private/ledger.json /private/new-registry.json \
  --room-mapping /private/room-receipt.json \
  --artifact /private/original-photo.heic --artifact /private/upright-photo.jpg
```

Output is created exclusively with mode 0600; an existing output is never
overwritten. Only supplied files are read. Each JSON input is bounded to 16 MiB,
64 nesting levels and 1,000,000 object/array members; each ledger table has at
most 10,000 rows. Invalid UTF-8 and duplicate decoded object keys are rejected
before JSON parsing can silently replace evidence. This applies to both the
ledger and optional room receipt. Source matching uses actual SHA-256 bytes; a path,
claimed hash or source label does not establish availability. A supplied room
receipt must match both the ledger's receipt ID and its exact byte digest.
No URL fetching or missing-file fallback exists.

Validation checks unique identities, reciprocal sheet/region and group/fixture
membership, package key/UUID consistency, normalized source coordinates with
each point inside its own box (including the edges), source-photo pins,
explicit null or nonempty fixture uncertainty, and approximate registration joins.
The registry preserves source points, quantity uncertainty, original source
dates, interpretation date, labels, association basis and receipt identities.
Its counts describe documentary records, never installed devices. Per-room, per-region
and per-sheet counts retain unassigned records, while association-instance
counts remain separate from distinct-record counts. A room's registration count
includes only non-proposed receipts for its exact package key/UUID pair; global
counts deduplicate fixtures across receipts. Every projected registration retains
its nonempty `basis` and `reviewQualification` text, including proposed receipts.

The existing v1 contract cannot express calibrated physical placements or
verified current circuits. This tool requires its explicit null transforms,
coordinates, routes and circuits; it does not silently discard known placement.
Approximate display registration is reported separately and never promoted to
physical calibration. A future calibrated contract needs a separately reviewed
model/source revision binding, coordinate frame, units, calibration evidence
and uncertainty. It cannot be inferred from source points or room names.

Byte-consistent room receipts establish historical documentary context only.
They do not validate a current model crosswalk, native custody, access, original
PDF page identity or installed fixture completeness. Local source files can be
reported absent without claiming the underlying originals were lost. Fresh
owner reconciliation is required before applying historical room associations
to a different publication.

Publication manifest changes are limited to the source owner's released rows
for these three files. Existing rows and logical owners are preserved; final
composition and integration remain with the sole source owner. No CI changes
are included.
