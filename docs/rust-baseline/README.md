# Rust baseline

AT51 adds shared scaffolding on published HouseAtlas commit
`9f7561d99e09a680ec5282ca0c8aed4e10c6cbc9`. The `houseatlas-backend` library
(`houseatlas_backend` in Rust) exports `contracts`. No feature module, application
router, persistent storage implementation or server executable is supplied here.
Module owners integrate their implementations separately.

The existing schemas remain the contract inputs:

- `packages/contracts/schemas/atlas.schema.json`, core record schema 1 / contract 1.0.0.
- `packages/contracts/history/http-history.v1.1.0.schema.json`, bare recorded audit array.

The frontend package pins React 19.3.0, TypeScript 7.0.2 and Vite 8.3.3.
Its strict compiler configuration includes generated contracts, future frontend
source and the named healthy baseline consumers. Vite currently compiles the
React baseline library in `tools/rust-baseline/react-compile.tsx`. The UI owner
must replace that entry when the application exists. The example defines no
screen, mounts no component and opens no listener.

## Dependencies and types

The Cargo workspace uses Rust 1.99.0, edition 2024 and resolver 3. Direct registry
dependencies are exact pins; Cargo.lock locks transitives. Axum 0.8.9 and Tokio
1.53.2 support later in-process request/service composition. rusqlite 0.40.2 uses
bundled SQLite through locked libsqlite3-sys 0.38.2. serde 1.0.229 and serde_json
1.0.151 support wire DTOs; jsonschema 0.58.6 validates local schema constraints
with its HTTP/file resolver features disabled. Tower 0.5.3 is a development
dependency for the named in-memory request example. No provider client or
credentials are configured.

Generated types use PascalCase schema definition names, camelCase wire fields
and snake_case Rust fields. `AtlasRecord` represents `$defs/record`; `Record` is
its compatibility alias. `AtlasDocument` represents the schema root union.
`HttpHistory` is `Vec<Audit>` in Rust and `Audit[]` in TypeScript. It has no response
envelope or invented prehistory. Scope keys stay strings in DTOs and preserve the
published exact wire representation; schema validation checks their UUID shape.

`houseatlas_backend::contracts` reexports generated types and provides
`decode<T: Contract>`, `validate<T: Contract>` and `encode<T: Contract>`.
These check the locally embedded schema in addition to Serde shape checks.
Typed DTOs alone do not establish graph, authorization, current source authority,
transaction ordering, mutation receipts or other behavioral invariants. Their
feature owners must implement those checks at integration boundaries.

Rust integer fields use `JsonInteger`, preserving integral values in serde_json's
i64/u64/finite-f64 number model. Construct ordinary revisions with
`JsonInteger::from(1_i64)` and inspect them with `as_number().as_i64()` or
`as_number().as_u64()`. Canonical schema bounds remain enforced by the boundary
helpers. This is not an arbitrary-precision numeric contract. `ConstInt<1>` and
`ConstBool<true>` represent literal schema markers; required nullable fields use
`Option<T>`, and optional wire fields use `Optional<T>` to preserve omission
separately from present null. Open HomeBox wire shapes retain extra fields in
their `additional_properties` maps; canonical closed DTOs deny unknown fields.
General numeric fields use `JsonNumber` with a private serde_json number,
`From<i64/u64>` and checked `from_f64(value) -> Option<JsonNumber>`. Non-finite
values cannot be constructed through that API and converted silently into null.

## Compiler and ordinary example commands

Use the pinned Rust, Node 26.10.0 and npm 11.19.1 toolchains on PATH. In this cloud
environment, activate the already installed task tools first:

```sh
source /workspace/.houseatlas-setup/rust-react-sqlite/activate.sh
```

Inspect the following scripts before running them. Install exact locks without
npm lifecycle scripts, then run the scoped baseline CI command:

```sh
npm ci --prefix packages/contracts --ignore-scripts --no-audit --no-fund
npm ci --prefix frontend --ignore-scripts --no-audit --no-fund
node tools/rust-baseline/check.mjs
```

`check.mjs` uses a temporary Cargo target outside the checkout, or a caller-supplied
`CARGO_TARGET_DIR`, and invokes these exact source compiler commands:

```sh
node tools/rust-baseline/generate-contracts.mjs --check
node tools/rust-baseline/check-contracts.mjs
node packages/contracts/history/check-history.mjs
cargo fmt --all --check
cargo check --locked -p houseatlas-backend --lib --examples
cargo clippy --locked -p houseatlas-backend --lib --examples -- -D warnings
cargo run --locked -p houseatlas-backend --example healthy-contracts
cargo run --locked -p houseatlas-backend --example healthy-dependencies
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

Regenerate DTOs deliberately with `node tools/rust-baseline/generate-contracts.mjs`;
commit both language outputs together. The generator uses pinned Node builtins
and the pinned Rust formatter, and records input digests. Its `--check` mode
compares generated output without changing checked-in files.

`healthy-dependencies` commits a synthetic row to disposable in-memory SQLite
and sends a healthy request directly through Axum/Tower. It opens no socket and
implements no application route. `healthy-contracts` and `check-contracts.mjs`
name only published healthy synthetic core/history examples. These commands do
not execute feature mutations or any stopped rejection, guard-reversal,
mutation/omission, adversarial, fault/crash, concurrency or negative-consumer
control. Those controls remain deferred qualification.

The existing HTTP history checker adds 14 static compatibility, local schema and
fixed valid-history checks, including the published core-schema/OpenAPI digests.

## Integration boundary

AT51 does not declare unavailable peer modules or supply peer stubs. Their
`pub mod` declarations and any new direct dependencies require reconciliation
in this owner lane after the source modules are accepted. Future module tests
also require explicitly named authorized Cargo targets; automatic test/example
discovery is disabled in the initial backend manifest.

The published schema inputs do not define an access principal, the complete
browse-home response or the raw Network inventory envelope. AT51 generates the
normalized core/source/history shapes that exist, including `NetworkRelation`
and `NetworkEndpoint`. Feature owners must settle any additional exact contract
inputs before adding versioned shared DTOs; their independent implementations
can continue with narrow local interfaces meanwhile.

The existing publication source allowlist describes the original JavaScript
snapshot. Its maintainer must reconcile the accepted expanded Rust/React tree
before publication verification can certify a new full file set. AT51 does not
edit that manifest, existing schemas, legacy scripts or qualification gates.
This baseline includes no hosted CI workflow, remote push, PR, deployment or
provider/native-route qualification.
