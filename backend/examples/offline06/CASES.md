# Offline-06 exact case review packet

Base: `54d46f2b4f660c0397865a3e5c30ece438929d35`.
Branch: `codex/offline06-atomic-recovery-20261022`.
Sole implementation writer: the existing offline-06 task
`01a14bb9-28e9-77ad-8226-12594480a0dc`.
Source review/integration owner: `01a13158-c477-746d-8023-299d117550d6`.

**Prepared for review. None of the new cases has been compiled or executed.**
These commands are proposals for exact-case approval, not an execution release.
No workflow, dependency, runtime hook, router, migration, registration or
publication-manifest change is included. Source owner retains those paths.

## Default invocation remains the existing healthy case

```sh
cargo run --offline --locked -p houseatlas-backend --example healthy-offline-intent-reconciliation
```

With no arguments the dispatcher calls the unchanged `qualify()` body. Its
original generated real-Access/Axum healthy fixture is not extended implicitly.
There is no `all` selector, test discovery or automatic retry. The new case
names below are individually selected. Use Rust 1.99.0 and a separately owned
scratch build target; inspect bodies/imports before a released run.

## Exact proposed cases

```sh
cargo run --offline --locked -p houseatlas-backend --example healthy-offline-intent-reconciliation -- --case late-precommit-rollback
cargo run --offline --locked -p houseatlas-backend --example healthy-offline-intent-reconciliation -- --case duplicate-shared-store
cargo run --offline --locked -p houseatlas-backend --example healthy-offline-intent-reconciliation -- --case duplicate-independent-connections
cargo run --offline --locked -p houseatlas-backend --example healthy-offline-intent-reconciliation -- --case child-process-outcome
```

| Case/body in `atomic_recovery.rs` | Exact assertions and interpretation |
| --- | --- |
| `late_failure` | Generated native Store invokes the existing Stock precommit authorization callback after `commands.rs` calls `extension.persist`. Require the exact `offline06-late-fault` error plus a captured precommit frame containing the expected request, candidate and staged commit. Compare every cell of every row in all seven tables with the pre-attempt snapshot. Real HTTP lookup must report the failed key missing with `retrySafety:not-established`. A **different** fresh intent is the positive control; the failed key is never resubmitted. |
| `shared_store` | Two explicitly selected identical submissions start from two threads, but use one `Arc<Mutex<Store>>` and therefore one connection. Require one fresh and one existing retained-hit result with the same durable operation ID; all seven table counts increase only once. This demonstrates application mutex serialization, **not independent-connection SQLite concurrency**. |
| `independent_connections` | Open two actual Stores/connections before the write, both with zero busy timeout. Hold writer A in the existing precommit callback after staging. A separate raw SQLite `BEGIN IMMEDIATE` must return BUSY/LOCKED. Writer B's one explicitly competing submission must return `storage-unavailable` before reaching intake. An independent reader must still see the full seven-table preimage while A is uncommitted. Release A; require one committed operation/receipt identity and one-row deltas. B is **not retried**: inspect the committed outcome through real HTTP. This is contention with one success/one busy response, not two successful concurrent completions. |
| `process_reader` / internal `child_outcome` | Parent performs one fresh actual HTTP Stock write, writes a private generated ticket, then closes all parent Store/Access handles. Spawn `current_exe --child-outcome` as a new OS process. Ticket arrives on bounded stdin, with no password/cookie/CSRF in argv or environment. Child opens only the parent's marked private generated temporary root, uses existing Access login and the existing retained-intent handler, verifies the original receipt and a missing-key unknown result, and checks complete tables/DB/WAL unchanged. Parent verifies distinct PID, echoed token, operation ID and successful exit. This is a real child process, not a Store reopen within the parent. |

The seven tables are `records`, `audits`, `receipts`, `stock_operations`,
`stock_groups`, `stock_keys`, and `stock_audit_links`. Full-row comparison retains
cell types and binary floating-point bits; it is not a count-only rollback test.
Snapshots reject more than 256 rows per generated table. Fixture setup uses
`lifecycle::prepare` exclusively under fresh `houseatlas-offline06-case-*`
temporary roots; no existing household database is an input.

## Synthetic transaction peer and replay boundary

The late-failure and duplicate cases compose the existing native storage engine
with a narrowly scoped **test-only** `Probe` implementing existing authorization
ports. It accepts only the fixed generated principal/scope and selected original
intent. It does not create a production grant, access framework or runtime hook.
These cases qualify SQLite/Stock transaction behavior, not original Access
authorization. Outcome reads and the parent write in the child-process case use
the existing actual Access/Axum owners. The default healthy path is unchanged.

The shared-Store case intentionally reaches the native engine's **existing**
retained-hit branch and asserts its `replayed` flag. This is not automatic replay,
but it is an explicitly submitted duplicate mutation. The reviewer must confirm
that this exact retained-hit/replay control is within the requested release
before executing it; general replay remains held. If that interpretation is not
accepted, hold this case rather than replacing it with a weaker duplicate-read
case and calling it mutation concurrency. The independent-connection case does
not resubmit its busy request.

## Bounds, evidence and exclusions

Each new case has its own fresh generated Store. Writer gate waits are bounded
at ten seconds. HTTP exchanges retain the healthy helper's fifteen-second local
deadline and bounded body reader. Child input/output is limited to 64 KiB, with
a cleared environment and a thirty-second protective deadline; timeout cleanup kills/reaps only that owned
child and is a **failed run**, never an exercised crash-recovery case. Passwords,
cookies and CSRF remain in the generated private fixture. Normal completion
closes handles and removes the temporary fixture.

Successful cases emit `offline06-opt-in-case/1` JSON naming the exact case and
its limited conclusion. A passing command exit is mandatory; there are no saved
or invented passing results in this preparation. Record exact source/command,
exit status and emitted JSON after a separately reviewed execution release.

No new case has run, and the default case was not rerun in this preparation.
There is no power interruption, crash injection, automatic replay, production
or household mutation, native service listener, provider, NAS, browser, device,
Scope A, populated restore or full offline editing/sync claim.
