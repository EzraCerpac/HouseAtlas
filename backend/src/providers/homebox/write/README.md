# AT37 HomeBox write component

The `stock` component maps the supported stock.2/wire3 HomeBox write families,
uses durable injected admission, dispatches once, and records scoped native
readback evidence. See [stock/README.md](stock/README.md) for coverage and exact
peer prerequisites. It contains no HTTP client, listener, credentials,
source grant store, router, database implementation or provider calls. The four
injected peers are application ports within the Rust modular monolith.

The published base is `9f7561d99e09a680ec5282ca0c8aed4e10c6cbc9`. Its HomeBox
adapter and contracts describe GET-only projections and verified native links.
The portable stock.2 catalog and pinned native Swagger are now available and
used by `stock`. The original two-field mapper below remains an isolated
synthetic reference API; its routes are not native stock routes. Successful
examples do not qualify any registered HomeBox build or deployment.

## Mapping and execution

`CatalogMapper::new(identity, operations)` receives trusted application catalog
entries. Each `SingleFieldOperation` specifies the exact method, relative entity
route, body field and GET readback route/field. Registration must establish that
the route accepts a single-field payload; full-object replacement operations
cannot use this mapper. Empty catalogs enable nothing. Names and collection IDs
use the published bounds. The collection ID stays opaque and case-sensitive;
UUIDs serialize in canonical lowercase spelling.

`HomeBoxWriter::execute(command)` obtains operation-specific authorization,
maps the request, atomically reserves activity, reacquires current authorization
after the asynchronous reservation, and invokes dispatch once. Both I/O ports
receive catalog identity and the access peer's source epoch. A real driver must
refuse synthetic catalogs, independently accept only reviewed catalog identities,
enforce the epoch and source/tenant binding, refuse redirects, bound I/O and cancel
on future drop. The module supplies no such real driver.

Dispatch evidence is recorded before readback. Acknowledgement plus a matching
readback reports `AcknowledgedAndObserved`; this does not prove exclusive
attribution, temporal ordering, atomicity or an all-writer concurrency guarantee.
An observation preserved from a pending reservation may predate acknowledgement.
Matching field
values or timestamps are not provider CAS. Unknown dispatch evidence stays
`UnknownOutcome` even if the current field value matches. Missing readback is
an observation, not deletion or proof that the request had no effect. Wrong-scope
receipts cannot establish acknowledgement or matching readback. Raw upstream
responses and errors never enter the port results or activity records.

An existing operation reservation returns its original recorded activity after
current authorization, with `reused: true`, and causes no new dispatch/readback.
A reserved activity with no outcome may already have been sent; it must never be
dispatched again. `reconcile(target, operation_id)` performs an authorized
readback only and preserves the earlier dispatch certainty. Persistence errors
after reservation return `RecoveryRequired` with the operation ID. Recovery uses
the retained activity and readback, never an automatic write retry.

## Proposed peer interfaces

AT51 can include this module as `providers::homebox::write`. There is no runtime
framework dependency. The external compiler harness pins `serde = 1.0.228`
with `derive`, `serde_json = 1.0.145`, and `uuid = 1.18.1` with `serde`, using
Rust 1.99.0/edition 2024. AT51 owns final manifests and locks. These local scope
seam types mirror the published `scope`/`sourceKey`/`sourceRef` definitions and
can be adapted to AT51's shared generated types when their exact API arrives.
The serialized provider command/activity types are proposals, not additions to
the accepted Atlas HTTP or record schemas.

AT11 implements `AuthorizationPort::authorize(AuthorizationRequest)`. Execute
authorization sees target, field/value and catalog; reconciliation first checks
the scoped activity lookup and then the original command/catalog. The result
contains the server-derived actor UUID and an opaque source epoch. The peer owns
current write capability, membership, reviewed entity partitions, quarantine,
source epoch and transport entry checks. No user-supplied actor is accepted.

AT07 implements `ActivityPort::{reserve, record_dispatch, save_outcome, load}`. The durable key is
`(workspaceId, homeId, actorId, operationId)`, with the complete source, target,
intent, catalog and request bytes bound to the attempt. A new reservation starts
at private `activityVersion: 1`. `record_dispatch` atomically merges dispatch
evidence against the exact attempt and current activity state, preserving any
already recorded observation. Unknown may be refined to known evidence; known
evidence cannot regress or conflict. It increments the current private version
once, independently of earlier readback versions, so an overlapping reconciliation
cannot discard a newly received acknowledgement. `save_outcome` must atomically match the exact
attempt and expected private activity version, then increment that version once.
A version conflict leaves the record unchanged; observation updates preserve
existing dispatch certainty. This version protects local
activity evidence; it is neither an Atlas revision nor provider CAS. The component
checks the returned attempt, increment and outcome. Keep reservations durably;
expiry must not enable duplicate dispatch. The storage peer owns ordered activity
events/timestamps and any authorized activity listing. There is no Atlas record,
audit, revision or projection/cache write from this component.

The transport owner implements `DispatchPort::dispatch(mapped, authority)` and
`ReadbackPort::readback(mapped, authority)`. The dispatch result distinguishes
acknowledgement, proven no-write, proven not-sent and unknown. Generic HTTP error
status does not prove no write. The readback peer returns the exact qualified
entity, decoded catalog field, original source date and retrieval date. Dates
must be validated by the decoder; this module preserves their supplied spelling.
Provider idempotency and preconditions can be claimed only from the exact catalog
and qualified driver, never from a local reservation.

## Source and validation evidence

The healthy group `healthy_synthetic_entity_field_writes` reuses the published
`adapters/homebox/fixtures/metadata.normalized-synthetic-v1.json` entity, source
registration, arbitrary type, null parent, attachment metadata and source dates.
It performs two different synthetic field commands and one further healthy
readback reconciliation. It checks the separate published
`packages/contracts/history/fixtures/recorded.audit-array.json` circuit audit
fixture, without adding or repurposing an Atlas history entry. Authorization,
dispatch, readback and activity peers in that group are in-memory stand-ins.
No production SQLite, access or transport integration is claimed.

The task-owned harness lives outside the repository, imports this module's actual
`mod.rs`, and retains its own manifest/lock. With the pinned runtime active, set
`AT37_HARNESS_DIR` to that external harness directory. Inspected, scoped checks are:

```sh
rustfmt --edition 2024 --check backend/src/providers/homebox/write/mod.rs
cargo check --locked --manifest-path "$AT37_HARNESS_DIR/Cargo.toml"
cargo clippy --locked --manifest-path "$AT37_HARNESS_DIR/Cargo.toml" --all-targets -- -D warnings
cargo test --locked --manifest-path "$AT37_HARNESS_DIR/Cargo.toml" homebox_write::healthy_examples::healthy_synthetic_entity_field_writes -- --exact --nocapture
cargo build --locked --manifest-path "$AT37_HARNESS_DIR/Cargo.toml"
node --check packages/contracts/history/check-history.mjs
node packages/contracts/history/check-history.mjs
```

The existing history checker performs only its 14 static/schema/valid-example
checks against the unchanged published schema/history fixtures. Legacy broad
suites and stopped guard-reversal, mutation/omission, adversarial, fault, crash,
concurrency, rejection and negative-consumer controls remain unrun. This includes
uncertain-outcome simulations and duplicate/revocation controls; those paths are
coded and source-reviewed, not behavior-qualified by the healthy example.

The original two-field API is not the stock implementation. Use `stock::StockWriter`
and its documented typed peer adapters for the exact stock operation set. Shared
generated wire DTOs and concrete access/storage/transport adapters remain owned
by their maintainers; standalone source compilation uses injected synthetic peers.
