# JavaScript core reference

Status: reference baseline. The running service is the Rust backend in
`backend/` with the React interface in `frontend/`; see
[docs/rust-integration/README.md](../docs/rust-integration/README.md). The
product does not deploy, import or serve this tree.

`server/` is the JavaScript core composition. `src/service.mjs`
(`createCoreService`) and `src/router.mjs` (`createCoreRouter`) take WHATWG
Requests and return Responses; `browser/host.mjs` is the browser host the
router serves. `service.mjs` and `router.mjs` open no listener and implement
no upstream fetch. [docs/core-integration/README.md](../docs/core-integration/README.md)
describes the composition.

The bytes are unchanged since `9f7561d` except for `49f1cf7`, which aligned
one expectation in `test/correction-3.positive.mjs` with the reviewed contract
`1.1.0`. Behavior is not frozen: these modules import the live
`packages/contracts`, `packages/access`, `packages/media`, `packages/storage`,
`adapters/homebox` and `adapters/network`, which keep changing. This status
does not extend to those packages.

## What still uses it

- `npm run build:ordinary` syntax-checks `src/` and `browser/` and asserts
  that `service.mjs` and `router.mjs` contain no listener or fetch call.
- `npm run test:ordinary` runs `test/correction-3.positive.mjs`: one healthy
  synthetic Request group against these modules and the current contracts.
- Held controls, outside ordinary CI: `test/core.test.mjs`,
  `test/controller-integration.test.mjs` and
  `test/native-navigation.positive.mjs`. `tools/core-integration/preview.mjs` and
  `browser-harness.mjs` import `test/support.mjs`; `failure-controls.mjs`
  runs `test/core.test.mjs` against mutants of `src/service.mjs`.
- Behavioral references for the Rust port:
  [backend/src/domain/README.md](../backend/src/domain/README.md)
  (`src/{http-contract,public-dto,service}.mjs`) and
  [backend/src/providers/network/README.md](../backend/src/providers/network/README.md)
  (`src/network-sidecar.mjs`).
- `src/recovery.mjs` is a documentary reference for the legacy JavaScript
  recovery bundle (`houseatlas-core-recovery/1`, schema3); see
  [recovery and rollback](../docs/operations/recovery-and-rollback.md).
  The Rust storage refuses existing legacy JavaScript databases
  (`backend/src/storage/migrations.rs`) and supplies no JavaScript database
  migration.

## Changes

Do not extend this tree; port behavior to `backend/`. Edit it only for
alignment forced by a shared contract change, as in `49f1cf7`, and refresh the
publication manifest.
