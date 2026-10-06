# HouseAtlas contracts

AT-02 canonical JSON Schema, boundary policy, pure semantic validators and
synthetic fixtures for Atlas-owned records and read-only source projections.
The adoption root is `packages/contracts` in the integrator's isolated repository.
Architecture and API documentation lives at `docs/contracts`.

Use Node 22 or later.
From this package directory, run:

```sh
npm ci --ignore-scripts
npm test
npm run build
```

For offline review in the original task environment, the copied dependency cache
is at `/tmp/houseatlas-contracts-npm-cache`.
Use `npm ci --offline --ignore-scripts --cache /tmp/houseatlas-contracts-npm-cache`.
Installed dependencies are verification inputs and are excluded from adoption.

Consumers import `@houseatlas/contracts` for pure helpers and may load the
canonical JSON Schema and policy through the package exports.
`homeboxPageWire` is a tested minimum for the tagged raw response.
All other source projection shapes are normalized Atlas read models.
Neither validator nor fixture harness implements production authorization,
storage, a HomeBox editor, an importer or a service.

Fixture names identify snapshots, commands, responses and raw wire pages.
Every fixture is synthetic; `.invalid` URLs and `00000000-...` UUIDs are examples.
Do not import these records into a real home.
