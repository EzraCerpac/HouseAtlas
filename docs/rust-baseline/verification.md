# AT51 verification

Verified on 2026-10-06 in the isolated `codex/rust-at51` checkout based on public
`EzraCerpac/HouseAtlas` commit `9f7561d99e09a680ec5282ca0c8aed4e10c6cbc9`.
The checkout had one reachable commit and no private ancestry. All changes are
new files in the assigned AT51 namespace; original tracked files are unchanged.

The activated source compiler versions were Rust/cargo 1.99.0, Node 26.10.0
and npm 11.19.1. Exact frontend and contracts npm locks installed successfully
with `--ignore-scripts --no-audit --no-fund`. Cargo resolved its pinned direct
dependencies into Cargo.lock and compiled the actual application library.

The successful final command was:

```sh
source /workspace/.houseatlas-setup/rust-react-sqlite/activate.sh
CARGO_TARGET_DIR=/workspace/.houseatlas-setup/rust-at51-target \
  node tools/rust-baseline/check.mjs
```

The runner and every executable script body were inspected before execution.
The exact runner command list is in README.md and `tools/rust-baseline/check.mjs`.
Results:

- Generator `--check`: three deterministic generated sources match all 48 core
  definitions, the root document union and bare HTTP history schema.
- Local Ajv compilation: all 48 core definitions and the history schema compile;
  10 explicitly named healthy synthetic fixtures and two context committed
  records pass shape validation.
- Existing HTTP history checker: all 14 static compatibility, local schema and
  fixed valid-example checks pass; core schema and original OpenAPI digests match.
- `cargo fmt --all --check`, `cargo check --locked ... --lib --examples` and
  `cargo clippy --locked ... --lib --examples -- -D warnings`: pass.
- `healthy-contracts`: 13 typed schema and JSON/DTO round-trip calls pass across
  the named fixtures, committed records and root document union. Required null
  circuit label/panel and empty history retain their wire meaning.
- `healthy-dependencies`: a disposable SQLite 3.53.2 transaction and an in-memory
  Axum/Tower request pass. No application route or listener is provisioned.
- Frontend `tsc --noEmit`: passes with strict mode, unchecked-index protection,
  exact optional properties, generated DTOs and healthy literal consumers.
- Vite 8.3.3 production library build: passes, three modules, 21.37 kB output.
  This is the React compiler scaffold, not an application bundle or UI acceptance.

The healthy fixture list is explicit in `check-contracts.mjs` and
`examples/healthy_contracts.rs`; no glob or legacy package test alias runs.
The complete final runner output is retained outside the source tree at
`/tmp/houseatlas-at51-check.log` for integration review.

Frozen schema input SHA-256 digests:

| Input | SHA-256 |
| --- | --- |
| Core atlas.schema.json | `ef00707b251051da4157598833d4c91d15d01b73eebfa049daf8c52a2ff23806` |
| HTTP http-history.v1.1.0.schema.json | `bf9dd4d7894d668a271234f2db2879f302e26f32c62746d8c37784958952248a` |

This evidence covers source compilation and healthy schema/dependency examples.
It does not cover peer feature behavior, graph/authorization rules, provider or
native links, persistent migrations, fault/recovery, concurrency, qualification
controls, actual-user acceptance or deployment. All previously stopped controls
remain unrun. No credentials, grants, private data, live provider calls, listeners,
remote pushes, PRs or merges were used. The original publication source allowlist
needs its owner's expanded-tree reconciliation before a new publication check.
