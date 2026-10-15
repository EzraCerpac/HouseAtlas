# Geodata wire v2

This explicitly selected successor is named `geodata-wire-v2`, with Atlas
contract `2.0.0` and agent URI `urn:houseatlas:agent:geodata-wire-v2`. It adds
source-neutral native Documents and a separate geodata asset arm to the whole
record, snapshot, reference, audit, mutation, guard, result and batch closure.
All eleven v1 record definitions remain identical in the successor schema;
v1 on-disk bodies and historical audit/receipt bytes require no rewriting.
The v1 schema, history, stock-wire3 inputs and generated outputs remain frozen.
The partially populated `stock-wire4` directory is not selected.

The catalog selects eight Document operations. It selects no provider stock
or presence capabilities and does not inherit an optional predecessor profile.
Catalog entries describe contracts; they register no tool, transport or route.
Runtime adapters must explicitly select the successor and enforce
[policy.json](policy.json), including trusted retained custody, exact asset pins,
preview derivation, lifecycle, atomicity and source authorization.
Schema validation alone cannot establish those semantic or trust properties.
Byte-read operation outputs select separate frames with an exact `original` or
`preview` mode. Preview framing reports measured `image/png`; its asset purpose
content type remains `application/vnd.houseatlas.geodata-preview+png`. Original
framing reports a MIME from the reviewed original admission family.

[resource-map.json](resource-map.json) resolves the complete schema closure
without network access. Catalog input/output fragments resolve against the
agent URI. [adoption-manifest.json](adoption-manifest.json) pins schema, history,
agent, resource map, catalog, policy and generator bytes. Generated headers
repeat those exact source pins. Generated Rust and TypeScript are separate
files; v1 consumers do not silently adopt v2.

From the repository root, using the pinned toolchain and installed contract
dependencies, the scoped healthy verification commands are:

```sh
node tools/rust-baseline/generate-contracts.mjs --v2 --check
node tools/rust-baseline/generate-contracts.mjs --check
node tools/rust-baseline/check-geodata-v2-contracts.mjs
```

Regenerate v2 deliberately with `node tools/rust-baseline/generate-contracts.mjs
--v2`. `--rust-only` is available with either version. Update reviewed input
pins before regeneration; outputs cannot authorize an unpinned input closure.
The generated Rust module expects the shared checked JSON scalar helpers and
its own `Contract` trait in its parent v2 module. Use a separately selected v2
validator; the v1 schema validator cannot validate v2 DTOs.

The healthy check compiles every definition, verifies exact source hashes,
compares preserved v1 record bodies, and validates named generated synthetic
record/read/history/batch and catalog examples. Its preview example asserts
shape only, with no renderer or qualification claim. It performs no writes,
source fetch, service invocation, persistence or recovery test. Other runtime
verification belongs to the native backend owner. Legacy conversion, actual
media qualification, private intake, frontend adoption and rollout require
their separately reviewed boundaries.
