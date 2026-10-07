# Scoped validation evidence

Base: `501ccf6507d5924b7acf36675140294596e990a4`, merged PR39 main.
Selected MCP revision: `2025-11-25`.
Toolchain: Rust/cargo/rustfmt/Clippy `1.99.0` from the selected workspace setup.
No additional library dependency was selected.

Compiler harness: an external disposable copy of the exact base, containing
byte-identical lifecycle Rust leaves and the five proposed root mounts. The
sole harness manifest addition explicitly registers `healthy.rs` as the
`healthy-mcp-lifecycle` example. Actual root Access, catalog, stock service,
contracts, native owners and SQLite remain compiled. No authority/service stub
or second application backend is present. Cargo.lock remains byte-identical to
base, SHA256 `5b94158b47ab26fec4c678a61721cd127a085f9157cba7742b35a48f262d79e5`.

Checks run after source inspection:

| Check | Outcome |
| --- | --- |
| Exact locked library/binary/all explicitly declared examples compilation | PASS |
| Locked Clippy for that same source with `-D warnings` | PASS |
| Whole harness `cargo fmt --all --check` | PASS |
| `rustfmt --edition 2024 --check` for every lifecycle Rust leaf | PASS |
| Exact Rust leaf byte parity with compiler harness | PASS |
| Base/harness Cargo.lock byte parity | PASS |
| All 538 base files retain exact mode/blob identity; nine additions stay in the assigned namespace | PASS |
| Git diff whitespace check | PASS |
| `git apply --check` for the root mount proposal against unchanged PR39 preimages | PASS |
| Source review of scope, authority, protocol reuse, cancellation and mount proposal | Completed by implementing agent |
| Explicit healthy in-process native lifecycle executable | PASS |

Actual compiler commands, with target and harness paths outside the source tree:

```sh
cargo check --locked --offline --manifest-path "$HARNESS/backend/Cargo.toml" --lib --bins --examples
cargo clippy --locked --offline --manifest-path "$HARNESS/backend/Cargo.toml" --lib --bins --examples -- -D warnings
cargo fmt --manifest-path "$HARNESS/Cargo.toml" --all --check
rustfmt --edition 2024 --check backend/src/transports/mcp/lifecycle/*.rs
git apply --check backend/src/transports/mcp/lifecycle/mount-proposal.patch
cargo run --locked --offline --manifest-path "$HARNESS/backend/Cargo.toml" --example healthy-mcp-lifecycle
```

The initial compiler retrieval used the already pinned Cargo.lock. Later checks
were offline. One ordinary manual-contains Clippy finding in the proposed root
scope lookup was corrected to `contains`; no warning was suppressed.

The healthy executable reported:

```text
PASS healthy native MCP lifecycle: two init/list/get sessions; exact text, integer and canonical correlation; confirmed Access rotation and fresh issuance; no listener or held controls
```

Each protocol session completed three requests and one initialized notification.
The actual native owner returned three admitted read families and one identity
record. A real Access rotation produced the confirmed notice; applying it closed
the old logical MCP session. The new cookie/CSRF receipt issued a genuine new
principal for fresh initialization and read. The canonical record data stayed
equal, with distinct canonical request UUIDs. No request used the old credential
after rotation, and no expiry/revocation/rejection control was run.

The selected positive IDs were string `"1"`, integer `1`, unsigned integer
`18446744073709551615`, and signed integer `-9223372036854775808`. Reply IDs
matched exactly. The actual shared StockResponse validator checked canonical
request UUID, command and scope; JSON text content equaled structuredContent.
No message, result or principal was fabricated by a test peer.

No mounted HTTP/browser/remote MCP runtime evidence is claimed. The root patch
is compiled and apply-checked only. Cancellation, limit errors, unknown IDs,
poisoned-registry handling and event/response races are source-reviewed only.
Previously held rejection, replay, expiry, revocation, fault/crash, concurrency,
adversarial and mutation/omission controls remain unrun. No aggregate test target
or replacement control wrapper was executed.

The unchanged root publication manifest does not yet register these leaves;
its allowlist check cannot certify this source input until parent integration.
The PR does not modify that manifest, workflows, module declarations or router.
No live endpoint, real credential/account/grant/source, NAS, deployment or merge
is authorized or performed by this leaf.
