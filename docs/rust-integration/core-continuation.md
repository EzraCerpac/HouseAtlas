# Native core ordinary evidence

This records the earlier immutable native core checkpoint. The subsequent owned-media
continuation and its updated module bindings are recorded in owned-media.md.

The local source runner passed with Rust/cargo 1.99.0, Node 26.10.0,
npm 11.19.1, application SQLite 3.53.2 and Chrome 151.0.7922.173.

| Check | Observed result |
| --- | --- |
| Generation/schema/history | Corrected baseline generation and 14 existing valid HTTP history checks passed |
| Actual source | Locked Rust library, binary and all declared module/example source compiled; rustfmt and warnings-denied Clippy passed |
| Named Rust examples | healthy-contracts, healthy-dependencies and healthy-native-semantics passed; no aggregate test command |
| Actual React | Strict TypeScript and Vite bundle passed |
| Browser | Home, room and item details; Settings; successful logout and login with username focus and cleared password |
| Canonical reads | Three record pages, one HomeBox page, empty Network page, record, empty history and scoped view all returned 200 |
| Fresh single write | Real editor circuit create at revision1, matching record readback and one real audit by actor7 |
| Fresh atomic batch | Two local identity creates, matching readbacks and one audit each; each command submitted once |
| Durable rows | 9 records, 2 projections, 3 audits, 3 command receipts, 1 batch receipt and 1 actual session |
| Browser requests | 39 observed requests all succeeded; favicon returned expected empty204; requests stayed on loopback |
| Lifecycle | Graceful ordinary shutdown0; disposable TLS/browser/databases and secret receipt removed |

Three independent source reviews inspected the bounded healthy write path and
ordinary script without running controls. The actual path is domain Commands,
SQLite engine and the same original access mutation principal under its held
transaction authorization. Feature source parity is checked against the exact
inputs in README.md. Production NativeContracts invokes shared native semantics;
it has no JS subprocess or synthetic authorizer.

The wider HomeBox/Network/stock components are source-compiled only. Empty
Network data does not demonstrate provider ingestion. The UI write form,
presence admission, cache publication, stock activity/dispatch, media, recovery,
alternate-home flow and numeric/target/provider qualification remain open.
No rejected request or stopped negative, replay, expiry, revocation, mutation,
fault, crash or concurrency control was run. Hosted exact-head CI is recorded
separately on the candidate PR; local results do not imply hosted results.

First-slice historical evidence is retained in verification.md and
read-corrections.md. The current scope and detailed limitations are in README.md.
