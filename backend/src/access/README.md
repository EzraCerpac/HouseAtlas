# AT11 Rust access component

Owned namespace: `backend/src/access/**`. Published behavioral base:
`9f7561d99e09a680ec5282ca0c8aed4e10c6cbc9`, access package 0.1.3,
frozen contracts 1.0.0, dedicated access SQLite schema 1. No root manifest,
generated contract or shared migration is changed by this lane.

`mod.rs` can be included as the monolith's `access` module. It owns a private
SQLite connection, not a separate service. Sessions, memberships and source
registrations use the published dedicated access database tables. Salted scrypt
verifiers retain `scrypt:32768:8:1:<salt-hex>:<digest-hex>` spelling, with a
16-byte salt and 32-byte digest. Only SHA-256 session/CSRF digests persist.
The restore epoch and authority versions are private opaque values.

## Proposed integration interface

```rust
let principal = access.authorize(&request_evidence, &scope, Action::Mutate)?;
// The router may now parse its bounded mutation payload. Revalidate after awaits.
access.revalidate(&principal)?;
access.with_mutation_authorization(&principal, |authority| -> AccessResult<()> {
    // AT07 supplies this synchronous storage operation. Its own callbacks call:
    // authority.authorize(&scope, Capability::Mutate) before receipt lookup/replay
    // and immediately before its SQLite COMMIT.
    // Capture the returned storage receipt in a caller-owned result slot.
    authority.authorize(&scope, Capability::Mutate)?;
    Ok(())
})?;
```

The sketch's storage call is an integration seam, not implemented AT07 behavior.
The callback returns `Result<(), E>` with `E: From<AccessError>`, so an async
callback/future is not a valid return. A storage-specific error type preserves
its own conflict/error details while converting access failures. Capture storage
output locally. The borrowed guard cannot escape
the access writer fence and exposes no database connection or administrative
method. The access DB `BEGIN IMMEDIATE` orders independent access writers after
the synchronous storage operation. It supplies no distributed rollback across
the access and record databases. Storage must perform its final current check
before its own commit; a later check cannot undo committed records.

`Principal` has private provenance and only actor/scope/role getters plus a
`PrincipalView` DTO. No principal, grant, restore epoch or version is
deserializable. A cloned handle keeps its issued provenance. An editor's read
handle never becomes mutation authority. `revalidate` checks the current
persisted session, user/version, membership/version/role, restore epoch, origin,
absolute/idle expiry and monotonic timestamps, returning the same borrowed
principal. Handles from a different boundary instance cannot be used.

`Capability` covers `Read`, `ReadHistory`, `ReadAssetManifest`, `Mutate`,
`ReadCacheEntity(&SourceRef)` and `ReadCachePartition(&SourcePartition)`.
Partition metadata and entity authority are separate checks; empty generations
still need a partition check. Source grants retain the immutable qualified
preimage and source version; revalidation never enables or clears quarantine.
Source registration replacement preserves existing enabled state by default,
checks immutable ownership and disjoint partitions in one access transaction.
Ordinary principals have no configure-source or publish-cache capability.

The transaction guard also accepts retained grants acquired using its original
mutation principal:

```rust
TransactionAuthorization::revalidate_source<'g>(
    &self, original: &'g SourceGrant,
) -> AccessResult<&'g SourceGrant>;
TransactionAuthorization::revalidate_source_partition<'g>(
    &self, original: &'g PartitionGrant,
) -> AccessResult<&'g PartitionGrant>;
```

These checks read through the held access transaction and compare the captured
source version and complete private principal provenance, including issuance
action. They check current source ownership and entity allowlists while keeping
partition metadata authority separate. Success returns the exact original
borrowed handle; revalidation creates no replacement grant and opens no second
transaction. It validates authority at that point, not after the guard releases.
The access handles have no domain mutation contextId: AT07/AT51 still own binding
the retained grant set to the immutable mutation context and phase. An equal
clone preserves the same access capability; actor/scope DTO equality alone does
not establish ownership.

`AccessBoundary::{login,session_info,rotate_session,logout}` verify exact
configured HTTPS origins and the actual request evidence. The host cookie is
Secure, HttpOnly, SameSite=Strict and Path=/; unsafe calls require POST, Origin
and current CSRF. Safe requests without Origin need same-origin fetch metadata
and Referer. Rotation retains the original absolute expiry. Request budgets use
stable user IDs and persist across rotation/relogin. The synchronous component
permits one derivation at a time per mutable boundary instance.

Provisioning, membership/source administration, user-session revocation and
`invalidate_all_sessions` are trusted local persistence seams only; no routes,
account bootstrap or real account grants are supplied. Normal file-backed opens
use SQLite NOFOLLOW and mode 0600 on Unix. Restoring an old database requires the
recovery owner's explicit epoch invalidation; restoration is not self-detecting.

`AccessBoundary::open_existing(path, config)` is the strict recovery peer for
separately provisioned trusted access persistence. It validates the complete
compiled SQLite schema catalogue (tables, indexes, constraints and foreign-key
DDL), schema-1 metadata and the existing opaque epoch through read snapshots.
It uses a read-only validation connection before reopening without a CREATE
flag and revalidating; no initialization or migration SQL reaches the selected
database. It changes neither file permissions nor sessions/epoch. The normal
`open` constructor keeps its existing initialization behavior. Recovery can
separately call `invalidate_all_sessions` after successful strict reopen.

Schema 1 contains no database-instance lineage identifier. This checks exact
compiled access schema compatibility, not the historical provenance of a
same-schema file. Trusted selection, path pins, excluded writers and recovery
ordering remain caller-owned. No hostile replacement/race qualification is
claimed. A positive persistent checkpoint verifies byte-preserving strict reopen
and subsequent authorization using an existing synthetic session.

## Provider lifecycle peer

`LifecyclePolicy` is empty by default and becomes immutable when the boundary is
constructed. Trusted startup configuration may supply `LifecycleRule::new`
approvals naming the user ID, actor ID, exact full `SourceRegistration`, separate
`ConfigureSource` or `PublishCache` capability, and principal issuance `Action`.
Provider registry metadata and ordinary role/read permission supply no approval.
No real owner rules are supplied here.

Configuration additionally requires an existing CSRF-checked mutation principal
with editor membership. Publication may use a read-issued principal only when
that exact subject/action/registration/operation is independently approved. The
policy constructor is an internal host seam, never a request deserializer.

The access-owned methods fit PR #25's `TrustedLifecycleAuthority` contract:

| Consumer operation | Access method |
| --- | --- |
| Capture | `access.capture_lifecycle(principal, registration, capability)` |
| Revalidate | `access.revalidate_lifecycle(principal, grant, registration, capability)` |
| Revalidate held fence | `guard.revalidate_lifecycle(grant, registration, capability)` |
| Install | `access.install_source_authorized(principal, grant, registration)` |
| Synchronous fence | `access.with_lifecycle_authorization(principal, grant, registration, capability, operation)` |

The small host adapter maps the two capability enums explicitly and converts
reference-returning checks with `.map(|_| ())`. `LifecycleGrant` is opaque,
nonserializable and bound to full genuine principal provenance, boundary
instance, approved registration and named capability. Publication pins the
original enabled partition version. Configuration does not require an existing
or readable source; installation checks and writes inside the same access
transaction using the existing registration rules with quarantine preserved.

The dedicated fence borrows the exact supplied principal. It validates the
original lifecycle grant at entry and after the synchronous callback without
issuing replacement authority. Previously captured entity/partition grants must
also be checked through that guard for disclosure; publication authority adds
no entities. Release the access fence before provider I/O. Storage must perform
its own checks immediately before its COMMIT: the final access check cannot
undo a separate committed storage transaction.

The healthy configured example uses explicit synthetic startup rules, creates
and replaces a registration, then publishes disposable metadata while checking
the original lifecycle/entity/partition handles. It is not provider generation
completion or AT07 storage-fence qualification. The exact PR #25 trait also
compiles against a thin external adapter. The host adapter, original request
grant handoff, scoped methods on the actual store, and access-side quarantine
orchestration remain consumer-owned integration inputs.

## Dependencies for AT51

Direct dependency versions proposed for the shared application manifest:

```toml
base64 = "=0.22.1"
getrandom = "=0.3.4"
rusqlite = { version = "=0.40.2", features = ["bundled"] }
scrypt = { version = "=0.11.0", default-features = false }
serde = { version = "=1.0.228", features = ["derive"] }
serde_json = "=1.0.145"
sha2 = "=0.10.9"
subtle = "=2.6.1"
url = "=2.5.7"
```

AT51 owns application manifests/locks and the shared contract import paths.
The small serde types mirror frozen `scope`, `sourceKey`,
`sourceRef`, `sourceRegistration` spellings and reject unknown fields.
Canonical IDs preserve lowercase UUID spelling, and opaque collection/external
IDs preserve Unicode with a 4096-code-point ceiling. These bridge types must
be reconciled with the AT51 generated contract types rather than duplicated
throughout the application. `PrincipalView` is the existing four-field safe DTO,
not a new authority wire contract. Errors map to existing frozen apiError codes;
the router supplies requestId and null currentRevision.

## Healthy checkpoints

`healthy.rs` contains four positive synthetic checkpoints: viewer
login/read/history/manifest and session-info/rotation/logout; editor
CSRF-issued principal and current source/empty-partition checks around a real
disposable SQLite commit; file-backed session persistence/strict reopen/mode;
and explicitly configured lifecycle registration/publication with retained grants.
Identities, origin and clock reuse `packages/access/test/fixtures.mjs`.
The empty recorded history fixture is reused directly from
`packages/contracts/history/fixtures/empty.audit-array.json`; it remains a
bare array. AT11 checks history authority, not durable history traversal.
The local record transaction is a small synthetic peer, not AT07's
graph/receipt/audit implementation. Actual integrated storage composition
requires validation after lane reconciliation.

The shared build manifest and migration CI are maintained centrally. The
existing snapshot publication allowlist does not include this new namespace;
its integrity check requires a coordinated manifest update. This component
changes neither the allowlist nor the workflow.

## Remaining exact inputs

AT51 must supply the shared contract import paths, router/body streaming and
HTTP response mapping (ISO expiresAt, schemaVersion, private/no-store headers,
Set-Cookie and sanitized apiError envelope). `RequestEvidence` must come from
actual headers and a trusted request URL; the router must reject ambiguous
duplicate header transport and enforce JSON content type, real stream byte
bounds/owned chunks, UTF-8, depth and duplicate-key requirements on mutation
bodies. AT11 checks strict login JSON and its 4096-byte bound, but does not own
an HTTP/body framework. The embedding runtime must schedule synchronous
SQLite/scrypt work without blocking its async executor.

AT07/AT51 must reconcile the real transaction callbacks and source closure
precommit checks, including historical retained grants. Media resolution,
provider generation/fence orchestration and later admission witnesses belong to
their owners. The public tree explicitly holds new source-presence admissions
pending an atomic generation/epoch witness; this component supplies none.

Previously stopped rejection/guard-reversal/mutation/omission/adversarial/fault/
crash/concurrency/negative-consumer controls and legacy broad aggregates remain
unrun. These healthy results do not qualify security, NAS locking, real browser/
proxy behavior, live providers, recovery faults, deployment or production.
