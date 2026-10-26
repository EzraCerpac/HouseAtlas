# Read-only native Access validation

`AccessBoundary` exposes two administrative integrity methods. Neither is a
route, agent tool or authorization grant.

| Method | Selected persistence | Owner precondition |
| --- | --- | --- |
| `validate_closed_existing_read_only(path)` | A new SQLite connection opened only with `READ_ONLY` and `NOFOLLOW`; no create flag | A trusted existing regular file in a coherent closed cut, fenced against writers and path replacement for the entire call |
| `validate_current_read_only(&mut self)` | The boundary's original owned connection and a deferred read transaction | Exclusive borrowing of the boundary and separate owner coordination for any observation spanning Core, Atlas, vault or runtime state |

Both methods reuse the compiled validator in `backend/src/access/existing.rs`.
It compares the entire ordered SQLite catalogue with the compiled Access DDL
using the existing token comparison, requires exactly one `access_meta` row
with the compiled version, and validates the persisted opaque epoch's spelling.
The catalogue, metadata and epoch SELECTs share one read transaction. This is
the existing Access schema/meta/epoch check, not exhaustive validation of every
Access row, the Atlas profile, document closure or application readiness.

The compiled reference schema is constructed in a separate private in-memory
database. Initialization SQL never runs against the selected persistence.
The closed method constructs no `AccessBoundary`, `AccessConfig`, credentials,
session or epoch. The current method opens no replacement connection and changes
no connection pragmas or busy policy. Neither method calls `authorize`,
`session_info` or a session refresh; neither updates `last_seen`.
`open_existing` retains its normal read-write continuation and existing behavior.

SQL read-only does not establish blanket filesystem no-write behavior for live
SQLite WAL/SHM state. The closed method does not stop a service, acquire a lease,
fence a process, select a snapshot or establish sidecar coherence. It must not
be applied to an arbitrary running path as proof of a no-write inspection.
Its connection uses the existing five-second SQLite busy timeout; synchronous
SQLite and filesystem calls are not preempted by a caller deadline. The
current method retains the owner's original busy policy and must run outside
an existing transaction. Its single Access snapshot alone is not a coherent
whole-Core observation or evidence that a configured model/source is usable.
These caller obligations remain part of the native owner's binding.

The existing generated persistent-session checkpoint covers both methods and
normal reopen. It compares database bytes, the opaque epoch and every stored
session field before and after validation, checks the current connection's
change count, then verifies that the original session still authorizes the same
actor through normal use. The generated file is closed and has no concurrent
writer or replacement. This ordinary positive case does not qualify live
WAL/SHM behavior, process fencing, whole-profile validation or target deployment.

Use the repository's pinned Rust 1.99.0 environment and an owned disposable
Cargo target outside the checkout. The only scoped positive command is:

```sh
cargo test --offline --locked -p houseatlas-backend --lib access::healthy::healthy_persistent_session_checkpoint -- --exact --test-threads=1
```

No real service, native account, credentials, household data, new maintenance
grant or runtime operation is needed for this generated case. A whole-profile
compiled read validator, a coherent running/closed native cut and actual
application-read readiness remain separate owner integrations.
