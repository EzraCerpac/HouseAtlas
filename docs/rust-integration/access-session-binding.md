# Access authenticated session binding

This independent integration candidate starts from accepted main
`49ba00d59259365e4979e6d654f19f5f0ccd1135`, tree
`16ab0c70c55a191e5ce7bfde6addefd3dd4810d7`, and consumes the original public
Access PR99 input `fe7e1f13c99bec2085f1f6a9dbad53efcea983c0`.
The three changed paths are `backend/src/access/boundary.rs`,
`backend/src/access/healthy.rs` and `backend/src/access/README.md`.
Their current preimages match the original source parent exactly; all three
resulting files retain the original owner bytes without adaptation. The source
manifest explicitly records their modes, lengths and digests and this document.
No dependency, host adapter, provider, router or peer namespace changes.

`AccessBoundary::authenticated_session_binding` first revalidates the original
principal and hashes a fixed domain separator, private boundary instance and
private session token digest. The opaque equality key supplies no authority or
durable identity. Every request still needs fresh authorization and revalidation.
The host does not yet consume this new method. This candidate therefore supplies
an owner seam for later coordinated integration, with no claim that host cursor
or MCP session correlation has been changed.

The permitted source runner checks locked Rust library/binary/examples,
rustfmt, warnings-denied Clippy, deterministic contracts/history, strict
TypeScript and the React production build. It executes only the four named
healthy native examples: `healthy-contracts`, `healthy-dependencies`,
`healthy-native-semantics` and `healthy-maintenance-calendar`.
The original Access healthy checkpoint is retained under `cfg(test)` and remains
UNRUN. No `cargo test`, test aggregate or `cfg(test)` execution is supplied.

All stopped negative, guard reversal, omission/mutation, replay, expiry,
revocation, denial, injected fault, recovery, crash and concurrency controls remain
UNRUN. No real provider, account, secret, household configuration, remote listener,
deployment or security/product acceptance is supplied. Detailed evidence remains
outside Git; this document records scope and the concrete results below.

The inspected source runner passed in full with locked dependencies, Rust
1.99.0, Node 26.10.0 and npm 11.19.1. The exact publication verifier passed
with 603 allowlisted source digests. The existing inspected
`healthy-core-loopback.mjs` also passed against the candidate's actual compiled
binary and React build: 41 observed loopback requests, successful viewer
sign-out/sign-in and editor login, canonical page/read flows, one fresh circuit
and one ordered two-identity batch. Read-only SQLite observation found nine
records, two projections, three audits, three receipts, one batch receipt and
one active session. No rejected request or provider call occurred. This regression
flow does not call the new binding method and does not qualify its unrun
checkpoint or stopped controls. Vite reported its existing large-chunk advisory;
the production build passed.
