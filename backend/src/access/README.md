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

```rust
AccessBoundary::authenticated_session_binding(
    &self, original: &Principal,
) -> AccessResult<[u8; 32]>;
```

This seam first calls `self.revalidate(original)?` with all existing current
session, epoch, user, membership, role and issuer checks unchanged. It then
returns SHA-256 of the exact concatenation
`b"HouseAtlas.Access.authenticated_session_binding.v1\0"`, the 32-byte Access
boundary instance, and the private session token digest's 64 lowercase hex
bytes. Fixed-width instance and digest fields make the preimage unambiguous;
the digest remains private and the cookie is never returned. No adapter text,
scope, action, unrelated cookies, nonce, renewal, write or policy enters this
derivation. Reissued principals for the same active session within one boundary
have the same binding across scopes, actions and cookie ordering. Independent
valid session credentials have distinct bindings.

The result is an opaque correlation equality key, never authority or durable
identity. It is process-instance/session bound, changes with rotation or a new
login, and does not survive boundary reopen. Consumers must obtain fresh
request authorization and revalidation on each request; a stored binding
cannot authorize a later request. Existing revalidation APIs still return the
exact original borrowed handles.

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

## Offline recovery discovery

`OfflineRecoveryAuthority::default()` is disabled. An explicitly approved trusted
administrative startup path may construct the separate issuer:

```rust
// Synthetic example only; the owner must independently approve this operation.
let approval = OfflineRecoveryApproval::discovery_validation(deployment_id, queues)?;
let authority = OfflineRecoveryAuthority::from_trusted_administrative_approval(approval);
let grant = authority.capture_discovery(queues)?;
```

The approval is a trusted host assertion, not administrator authentication. It
permits only offline discovery/validation over that exact deployment and COMPLETE
ordered `QueueConfig` registry, including empty queues. Construction reuses the
domain's `TrustedQueueRegistry::new` structural checks and requires every queue
to belong to the approved deployment. Revalidation compares every configuration
field, physical identity/digest, dispatcher, retry/admission setting and ordered
alias. It requires full requested registration membership. No subsets, sorting,
normalization, actor IDs or restored image can issue or widen this permission.

`RecoveryDiscoveryGrant` privately retains its independently allocated issuer
and immutable approval. The handle has no constructor, serialization, clone,
debug output or raw database access. Matching metadata on a different issuer
cannot recreate its identity. Neither issuer nor grant depends on a browser
session, restore epoch, `AccessBoundary` instance, SQL connection, vault or lock.
Keep the SAME issuer/grant alive outside the old `Core` throughout source close,
strict reopen and the host's explicit session reset. Recreating an issuer
requires a new grant even when its configuration is equal.

The concrete authority directly implements the existing
`domain::queue_recovery::RecoveryDiscoveryAuthority`, with
`type Grant = RecoveryDiscoveryGrant`. Supply it and the grant to the existing
`QueueRecoveryBindings`; no new authority port or adapter is required. Inherent
`revalidate_discovery(grant, queues, registration)` returns `AccessResult<()>`;
the trait maps failures to sanitized `owner-unavailable` storage errors. Checks
perform metadata work only and can run under the existing storage read lock.
Discovery approval supplies no dispatch, resume, reconciliation, mutation or
read-disclosure authority, nor original enqueue/media/native evidence.

`recovery_healthy.rs` exercises explicit synthetic approval for two disposable
queue configurations through both the inherent API and exact existing trait.
No access persistence is changed, and no reset/invalidation/denial/race control
is executed. Session-reset independence is established by the source structure;
this example does not qualify the composed recovery host. Actual production
issuer approval, complete registry and trusted physical database mapping remain
unconfigured. No production call site is added.

## Shared canonical issuer

`SharedAccess` is a cloneable process-local host bridge over the exact existing
`Arc<Mutex<AccessBoundary>>` used by Core/MCP. Its public interface is:

```rust
SharedAccess::from_existing(existing: Arc<Mutex<AccessBoundary>>) -> SharedAccess
shared.as_existing() -> &Arc<Mutex<AccessBoundary>>
shared.try_lock() -> AccessResult<MutexGuard<'_, AccessBoundary>>
```

The constructor moves the supplied Arc into the wrapper. Cloning shares that
same allocation, mutex, database connection, issuer identity, configuration,
sessions and versions. It opens no database, creates no policy and recreates no
principal or grant. Equal configuration on another boundary still describes a
different issuer. Pass the actual canonical handle; do not create another memory
boundary to import root-issued principals. There is no global issuer registry,
fallback, raw database access or private grant constructor.

Root may pass `SharedAccess::from_existing(core.access.clone())` to the Network
owner's shared-handle constructor. Existing `app::Access` and its `Arc::clone`
call sites need no type migration. The Network owner keeps this bridge as its
backing handle and delegates lock acquisition to `try_lock`. Its accepted
`ProviderLease::retain_original` call can use `shared.as_existing()` to preserve
the existing exact `&app::Access` ABI and original authority handles. This
constructor/wiring remains provider/root-owned; no consumer files change here.

Contention and poisoning return sanitized `Unavailable`; the bridge never
waits for the mutex, clears poison or reopens a substitute issuer. Boundary
operations still perform synchronous SQLite/filesystem/scrypt work. A shared
file-backed canonical issuer does not inherit the Network leaf's former
memory-only callback profile. Owners must reconcile worker scheduling and
deadline bounds for their selected canonical boundary. Clone the handle into
the synchronous worker, acquire/drop its guard there, and release it before
provider I/O or an await. Trusted callers retain the boundary's existing
administrative APIs; this bridge does not prohibit whole-boundary replacement
or introduce a replacement/recovery shortcut.

A callback holding the canonical guard must use the supplied held transaction
authorizer. Calling a persistent authorizer that locks Core.access again would
reenter the same mutex. Do not use that as a fallback for an actual Store read.
Original provenance/version and entry/pre-release fence checks stay required.

`shared_healthy.rs` issues the genuine session, principal, partition/entity and
explicitly approved lifecycle grants through the original Core-shaped handle
before wrapping it. Both cloned bridges retain the identical Arc and boundary;
they check those exact original handles, use the exact principal in a held read
fence and read the original session. A compile-time check verifies automatic
Clone/Send/Sync. No reset, replacement, contention, poison, concurrency or
rejection control is exercised. Actual Core/Network/Store composition remains
owner integration work.

## Network link and observation disclosure

For cached stock reads, retain the already authenticated original principal,
its exact `PartitionGrant`, and the `SourceGrant` for each trusted configured
typed member before the request's capture seal. Existing
`authorize_source_partition` and `authorize_source` issue these grants from the
canonical Access boundary. Qualified partition identity includes workspace,
home, source instance and collection; an external ID alone is insufficient.
The owning runtime supplies the trusted typed members: a registry allowlist of
untyped IDs does not establish source kinds or complete generation membership.

```rust
TransactionAuthorization::revalidate_source_read(
    &self, original_partition: &PartitionGrant, original_members: &[SourceGrant],
) -> AccessResult<()>;
AccessBoundary::with_source_read_authorization<E: From<AccessError>>(
    &mut self, original: &Principal, partition: &PartitionGrant,
    members: &[SourceGrant],
    operation: impl FnOnce(&TransactionAuthorization<'_>) -> Result<(), E>,
) -> Result<(), E>;
```

The guard checks current read permission, the original partition version and
full principal provenance, every member's exact partition, and every original
member version and provenance. The convenience fence checks that same borrowed
set before and after successful synchronous work. It issues no replacement
principal or grant. An empty member set still requires the original partition
grant and supplies metadata authority only. This set is not proof of configured
completeness, Store ownership, retained generation membership, or source-presence
admission. Consumers release captured output only after the fence returns `Ok`.

The current Network host already accepts this principal/partition/member tuple
in `HostNetworkRuntime::read` and retains its own `OriginalNetworkDisclosure`.
Root constructs `NetworkAccess` from `SharedAccess::from_existing` with the
canonical `Core.access`; the host checks the same owning Core, Store and Access
allocation. Root calls `read` outside the Core mutex, then uses `disclose` and
`SavedNetworkQueries` with the retained original authority through final release.
The new helper does not replace that Network-owned handle or its membership and
native baseline checks. The host currently uses `with_read_authorization` and
checks its retained grants directly; adopting this convenience helper remains
the Network owner's choice. `NetworkAccess::retain_original` additionally captures
publication lifecycle authority and is not the cached-read binding path.

`NetworkLinkRef` and `NetworkObservationRef` are distinct server-only selectors;
the frozen `SourceKind` enum and wire contracts stay unchanged. A link selector
names the exact partition, raw link ID and BOTH raw endpoint `SourceRef`s.
Endpoint kinds are device, interface or segment. Retain original raw endpoints
when projection reorders them or represents a reviewed endpoint as unresolved.
An observation selector names its partition, observation ID, collector ID and
every declared device/interface member. Observation IDs may share spelling with
inventory/link IDs; the typed link and observation selectors remain distinct.

| Operation | Access-owned method |
| --- | --- |
| Capture link read permission | `access.authorize_network_link(principal, reference, original_from, original_to)` |
| Capture observation read permission | `access.authorize_network_observation(principal, reference, original_device, original_interface)` |
| Check original link permission | `access.revalidate_network_link(grant)` or `guard.revalidate_network_link(grant)` |
| Check original observation permission | `access.revalidate_network_observation(grant)` or `guard.revalidate_network_observation(grant)` |
| Hold current read authority | `access.with_read_authorization(principal, operation)` |

Capture requires a genuine current principal, an enabled Network-owned source
and its existing read policy. Reviewed partitions require an approved row ID
and at least one observation member; every declared member must have the exact
supplied original `SourceGrant`. Exclusive-home partitions also permit
collection-only observations. Each opaque grant privately retains its genuine
partition version and original member grants. Guard checks bind it to the
guard's complete original principal provenance and return the original handle;
revalidation never captures replacement permission. None of these methods
creates lifecycle/publication authority, accepted-generation membership or a
source-presence admission witness.

The collector ID is partition-qualified matching/provenance data. It is neither
an issuer nor an independently approved collector capability. These checks use
the pinned Network projection's existing row-ID/member read policy. An additional
collector-specific authorization policy requires an explicit owner contract;
none is invented here. The Network owner must validate the retained generation
and match each selector, collector and raw member declaration to that generation
before disclosure; caller-created selectors alone supply no membership proof.

`with_read_authorization` holds an immediate access transaction around a bounded
synchronous callback. It checks the exact borrowed principal at entry and after
the callback and exposes no raw connection. The consumer must check its original
partition/entity/link/observation handles through the guard before reading and
immediately before releasing owned output. A callback may capture an owned
result, but the caller must release it only after the fence returns `Ok(())`.
The root runtime must put its actual same-Store authorized snapshot read inside
this callback. Supplied metadata or a separate synthetic reader cannot establish
that binding. Release the access fence before provider I/O or async work.

PR #48's Network runtime can consume these grants directly in its original
lease. Its generation validation and relation/observation disclosure callbacks
remain Network-owned. AT07/AT51 must fix the existing reader's link selector:
it currently relabels relation link IDs as `network-segment`. A genuine segment
grant cannot authorize a link row. No storage/router/provider files are changed
by this access lane.

`network_healthy.rs` exercises a genuine viewer session, reviewed source, raw
link endpoints, both observation members, same-spelled link/observation IDs,
original-handle checks, the exact partition/member binding (including a
partition-only authority check), and a disposable SQLite read inside the access
fence.
The reader is an explicit synthetic peer. This checkpoint does not qualify the
actual Network generation, same-Store read composition or release pipeline.

## Persisted source authority metadata

```rust
TransactionAuthorization::persisted_source_metadata(
    &self, original: &PartitionGrant,
) -> AccessResult<SourceAuthorityMetadata>;
```

This read-only export first revalidates the original partition grant against the
held guard's exact original principal and source version. It reads the genuine
`access_meta.epoch` and enabled `access_sources` row through that same Access
transaction. The owned, getter-only result exposes `access_epoch()`,
`source_registration_version()`, `source_registration_sha256()` and
`registration()`. It has no public constructor or deserializer and exposes no
connection, session material or administrative method. Export creates no grant,
principal, epoch, source version, registration or database write.

The epoch is the persisted opaque 64-character value, separate from the
boundary's process instance and session binding. Source version comes from the
actual enabled row and must be within `1..=9_007_199_254_740_991` for the frozen
presence contract's safe integer representation. The full persisted typed
registration is hashed with the existing
`contracts::semantics::canonical_digest` representation (RFC 8785 JSON,
SHA-256, lowercase hexadecimal). This digest is computed from durable state;
there is no persisted digest column or new schema. Array order and exact Unicode
spelling remain part of the registration preimage.

Metadata equality grants no authority and does not establish a Native Store
binding. The consumer must retain the same original principal/grants, compare
the returned full registration with its exact owning Store's registration,
and obtain/check metadata through the held guard at each required phase. Access
has a separate database: this export does not create a cross-database transaction
or implement `AtomicPresenceTransaction`, witness persistence or presence
admission. The actual mutation context ID/version and accepted Access package
version remain their existing owners' inputs; none is inferred from an actor,
candidate, partition ID, database schema version or Rust package version.

`metadata_healthy.rs` checks a genuine CSRF-authorized editor and its original
partition grant, persisted epoch, independently configured source row version
two, a golden canonical registration digest and zero export writes. A separate
genuine request after strict reopen verifies metadata persistence. It supplies
no original Native Store, atomic presence transaction or witness lifecycle
qualification and runs no revocation or other held controls.

## Native producer version declaration

`NATIVE_ACCESS_PACKAGE_VERSION` is the explicit Access-owned literal
`"0.1.0-native.1"` for this Rust authority/metadata producer contract. It is a
source proposal awaiting trusted integrator acceptance, not an accepted presence
producer or permission to enable admission. The declaration is independent of
Cargo/workspace versions, database schema versions, the JavaScript Access
package and synthetic contract examples; none supplies or authenticates it.

The declared compatibility policy is exact equality with this string, with no
version ranges or inferred compatibility with other values. Root can use
`access::NATIVE_ACCESS_PACKAGE_VERSION` as its fixed trusted
`accepted_access_package_version` input after accepting this native producer
seam. Storage's existing wire-pattern check validates spelling only; accepting
an arbitrary caller-selected string would not implement this owner policy.

A semantically incompatible change to native principal/grant provenance or the
persisted epoch/source-version/full-registration digest contract requires an
explicit owner version change and reconciliation. This string is not an epoch,
session key, schema migration, current authority check or Store binding. It
creates no grant and changes neither the held guard nor original principal.
Historical witness version strings stay preserved; accepting or reading other
producer versions, profile/recovery compatibility and engine composition remain
their actual owners' separate work. No compatibility with the JS package or
fixture producer is declared here, and presence admission remains held.

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
Offline recovery additionally uses the existing `crate::jobs` queue types,
`crate::domain::queue_recovery` trait/registry and `crate::storage` error type;
the embedding monolith supplies those accepted modules. No new dependency or
duplicate queue model is introduced.
The small serde types mirror frozen `scope`, `sourceKey`,
`sourceRef`, `sourceRegistration` spellings and reject unknown fields.
Canonical IDs preserve lowercase UUID spelling, and opaque collection/external
IDs preserve Unicode with a 4096-code-point ceiling. These bridge types must
be reconciled with the AT51 generated contract types rather than duplicated
throughout the application. `PrincipalView` is the existing four-field safe DTO,
not a new authority wire contract. Errors map to existing frozen apiError codes;
the router supplies requestId and null currentRevision.

## Healthy checkpoints

`healthy.rs` contains five positive synthetic checkpoints: viewer
login/read/history/manifest and session-info/rotation/logout; editor
CSRF-issued principal and current source/empty-partition checks around a real
disposable SQLite commit; file-backed session persistence/strict reopen/mode;
explicitly configured lifecycle registration/publication with retained grants;
and authenticated session binding across repeated Read/History issuance,
synthetic scopes, unrelated cookie entries/reordering and two simultaneously
valid independent sessions, with original borrowed handles preserved.
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
