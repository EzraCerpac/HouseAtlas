# Room anchor save validation

Issue #149 aligns scene-association saves with the retained scene reader. Each
anchor referenced by a room must match that room's source floor and original
hash and contain exactly one target with the room's package key and UUID.
Browser preparation checks this before creating a prepared write. Native Media
qualification repeats it before the Stock scene command can write records,
history or the building's current scene head. Receipt anchors that no room
references retain their existing multi-target support.

The change does not rewrite retained sources, receipts, predecessor associations
or history. An existing unavailable association remains unavailable; no migration
or fallback is introduced.

## Scoped synthetic acceptance

The two issue-specific entrypoints belong to the separate synthetic regression
lane in the root README. Inspect their complete bodies and imported production
code before running. They use generated fixture data and disposable temporary
roots, with no household data, real credentials, providers or deployment.
Only the exact named room-anchor cases are released by this issue request;
broader held checks and ordinary CI remain unchanged.

Use Node 26.10.0, npm 11.19.1 and Rust 1.99.0 with the repository's locked
dependencies. Set an unused external Cargo target directory. The native example
uses the real in-process request router and disposable SQLite/Media owners;
it opens no listener. The browser harness uses its own Chromium process and
synthetic ports; it must not attach to a user's browser session.
Its fixture button executes the production preflight in Chromium; the retained
reader is checked separately. It does not exercise the complete application UI
or dispatch a browser write. Native save/reopen is exercised by the Rust example.

```sh
CARGO_TARGET_DIR=/tmp/houseatlas-issue149-target cargo run --offline --locked -p houseatlas-backend --example issue-149-room-anchor-acceptance
HOUSEATLAS_CHROMIUM="/absolute/path/to/inspected/chromium" node frontend/lantern-tests/issue-149-room-anchor-acceptance.mjs
```

Acceptance covers ambiguous two-target, missing and mismatched room anchors,
including floor/hash mismatch; singleton room targets; unrelated generic
multi-target anchors; and retained source/history preservation. Outcomes and
the exact tested source pin must be reported separately from general product,
security, recovery or deployment qualification.
