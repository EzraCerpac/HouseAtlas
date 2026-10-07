# Native contract semantics

This component ports the public HouseAtlas domain checks to Rust. It is separate
from the accepted generated DTOs and does not change their wire shapes or schema
bytes. It implements no service, router, provider adapter, transaction, grant or
asset verification framework.

## Storage and core interface

Use `houseatlas_backend::contracts::semantics` with the existing DTOs:

- `MutationTarget { scope: Scope, record: RecordRef }` composes an authorized route.
- `validate_snapshot(&Snapshot)` checks the complete graph.
- `assert_transition(current, command, target)` returns `Transition.next_revision`.
- `required_references` and `assert_guards` read current and proposed payloads,
  including retained binding/remap chains. Batch-created references are exempted.
- `validate_mutation_preconditions` calls transition validation before guards.
- `validate_final_candidate(candidate, &[FinalMutation])` checks the entire final
  graph first, then each submitted command's create decision in original order.
  Each `FinalMutation` retains its original preimage; this function does not
  build the candidate or replace storage authorization/precommit checks.
- `validate_result(result, PriorRecord::{Unspecified, Absent, Record})` preserves
  the published omitted/null/prior-record distinction and correlates the audit,
  committed record, lifecycle, timestamps and canonical before/after digests.
- `reference_closure` returns detached record references, explicit missing
  references, source references and exact source partitions. It includes forward
  dependencies and reverse affected dependencies across retained, proposed and
  final records. Optional receipt-result facts support the published closure
  computation; receipt lookup, replay decisions and replay controls are storage
  responsibilities and remain unqualified here.
- `canonical_json`, `canonical_digest`, `record_digest`, `batch_digest` and
  `mutation_digest` are native functions. Batch hashes use `{scope, ...batch}`;
  mutation hashes use `{target, command, batchId, batchHash}` exactly.

The input domain is schema-checked finite JSON in the published JavaScript
numeric model. Public typed wrappers validate shape at their boundary; the
standalone JavaScript guard/final helpers relied on previously validated callers.
`SemanticError` exposes the published domain code and message. Invalid URL
parsing is adapted from JavaScript's raw TypeError to typed `invalid-contract`;
the valid URL component checks retain the original domain rules.

## Canonical numbers and timestamps

Canonical hashing converts retained numeric tokens to finite IEEE-754 values,
matching the JavaScript JSON consumer. It intentionally rounds values that a
browser rounds; it does not claim exact unbounded-decimal digests. ECMAScript
number formatting uses pinned `ryu-js`, object keys sort by UTF-16 code units,
and SHA-256 hashes the canonical UTF-8 bytes. Wire numbers remain numbers.
Callers must reject duplicate input keys before constructing digest inputs;
JSON Values cannot recover discarded duplicates. HTTP intake parsing belongs
to the core owner. Rust strings contain valid Unicode scalars.

Timestamp strings are never rewritten. Ordered comparisons follow Node 26.10.0
V8's behavior for schema-admitted four-digit date-time strings: offsets,
ISO/legacy separator behavior, milliseconds, long-fraction parsing and NaN
comparisons are source-backed. This is not a general JavaScript date parser or
an implementation of local-time/date-only/expanded-year parsing.

The schema compiler registers the published Ajv-formats 3.0.1 date-time and URI
predicates. Date-time shape admissibility stays separate from `Date.parse`
comparisons, including strings that V8 parses to NaN. The URI expression retains
its original grammar with ASCII case folding; the copied expression's MIT
license is included. UUID schema patterns already require canonical lowercase
hyphenated IDs. These compatibility paths received static source review; the
healthy fixtures do not qualify their boundary cases.

## Implemented checks and integration boundary

The graph port includes scoped/permanent identity and source partition rules;
record/evidence/asset/reference closure; physical binding and location rules;
circuit/valve relations and evidence basis; optional geometry originals,
versions and mappings; historical reconciliation compatibility and cycles;
HomeBox projections/native-link components/parentage; cache metadata; and
passive Network endpoint/temporal rules. Transition rules cover revision CAS,
exhaustion, lifecycle, immutable identities and original assets, and append-only
evidence/geometry/journals. New reconciliation and accepted geometry checks are
separate from retained historical validity, preserving later retirement.

History remains a bare recorded audit array in storage sequence order. This
component validates its shape and committed results; it adds no invented
prehistory, sorting or continuity rule. Access, provider authority, source
presence, staged-file checks, receipt consistency, transaction/commit/replay
ordering and durable SQLite history retrieval remain with their module owners.

The integration owner must add exact dependencies `ryu-js =1.0.2`,
`sha2 =0.10.9`, `url =2.5.7` and `regex =1.13.1`, retaining serde_json `arbitrary_precision` and
`raw_value` plus jsonschema `arbitrary-precision`. Shared manifests/locks remain
outside this lane. A task-owned external Cargo harness compiles the actual
backend source at its path with these pins; it contains no alternate source or
JavaScript runtime oracle. Only inspected healthy examples may be run. Held
rejection, adversarial, guard-reversal, failure, concurrency and replay controls
remain deferred qualification.

## Actual source verification

The task-owned manifest at `/tmp/houseatlas-native-contracts/Cargo.toml` points
its `houseatlas_backend` library directly at `backend/src/lib.rs`. It selects
serde `=1.0.229` with `derive`, serde_json `=1.0.151` with the two features above,
jsonschema `=0.58.6` without default features and with `arbitrary-precision`, and
the four exact dependencies above. Its explicit examples point to
`semantics/examples/healthy.rs` and the accepted
`tools/rust-baseline/examples/healthy_contracts.rs`. It disables automatic
target discovery and has a task-owned locked dependency graph. No shared
manifest, lock, feature module, DTO, frontend output or schema was modified.

After activating the verified Rust 1.99.0 environment, the source compiler
commands are:

```sh
cargo check --locked --manifest-path /tmp/houseatlas-native-contracts/Cargo.toml --lib --examples
cargo clippy --locked --manifest-path /tmp/houseatlas-native-contracts/Cargo.toml --lib --examples -- -D warnings
cargo run --locked --manifest-path /tmp/houseatlas-native-contracts/Cargo.toml --example healthy-native-semantics
cargo run --locked --manifest-path /tmp/houseatlas-native-contracts/Cargo.toml --example healthy-contracts
```

The native semantic example checks the three published healthy snapshots,
healthy circuit creation, the ordered import-remap batch, canonical record and
request hashes, detached reference/source closure, and the three recorded
history fixtures with their supplied committed records. Its expected JSON is
committed. `examples/healthy-reference.mjs` is an inspected offline generator
that reads those same explicit fixtures and calls the published pure JS
reference functions. It does not instantiate storage or execute replay,
providers, service calls or controls. The native library and native example
never invoke JavaScript. Reference regeneration can use an external prefix
containing the exact published contracts npm lock dependencies:

```sh
HOUSEATLAS_REFERENCE_DEPENDENCIES=/tmp/houseatlas-native-js node backend/src/contracts/semantics/examples/healthy-reference.mjs
```

Healthy parity is evidence for these explicit inputs. Numeric and UTF-16
boundaries, date-time/URI variants, multiple historical remap chains, failure
ordering and rejected inputs remain source-reviewed and unqualified by this
example. Hosted ordinary CI is scoped to main events; this stacked draft does
not claim a hosted compiler run. Integration must wire these functions into
storage/core and add their dependencies to the shared lock before ordinary
source compiler CI can run from the shared manifest.
