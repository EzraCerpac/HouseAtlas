# Atomic presence source adapter

These new files provide the Storage implementation of
`domain::qualified::AtomicPresenceTransaction` and append-only witness persistence.
They are **source only**. The private modules compile in the actual library.
The explicit configured Stock path retains genuine native publications, the
original command preparation and a unique Store-issued invocation. It qualifies
actual Candidate and Precommit frames before typed native and Stock authorization,
then stamps the ordered witnesses before the sole SQL commit. Ordinary commands
retain their existing authorization order and staging hold. The explicit fresh
Presence constructor installs schema 7 only in an empty database. Profiles 5/6
migration catalogs and their checksum validation are unchanged.

`StoreOptions::presence_profile` defaults to `PresenceProfileSelection::Disabled`.
Ordinary open/reopen still reject `FreshV7` before opening a database. Separate
`AtlasStore::open_presence` and `open_existing_presence` constructors require
the explicit selector, the activity profile and a disabled queue-original
profile. The fresh constructor requires an empty history catalog and installs
the exact schema 1–7 lineage only in a database with no existing schema or objects.
It performs no upgrade or backfill. The existing-file constructor validates the
complete native, Stock, activity, queue and Presence closure in one read
transaction before enabling WAL and normal operation.

`PresenceHistoryCatalog` accepts only opaque Root `RecordedPresenceHistory`
entries. Root issues those entries by consuming an actual accepted command cut
following Store Release and the complete Access commit. The current archive
supports original first-generation publications with no predecessor, missing-ID
or quarantine facts. Predecessor custody and independent cold-start intake
remain separate code dependencies. Neither a current cache nor witness JSON
can issue an archive entry.

## Exact dependencies and scope

The source preimage is published dev
`2b543304d5fe14af40234e44324a97d4f7154d5a`. Access prerequisite
`b481175412310e8e9627aa20edcffdd62ae1032a` exports
`TransactionAuthorization::persisted_source_metadata(&original_partition_grant)`.
It revalidates that original grant and reads the persisted enabled full
registration, bounded row version, opaque epoch and canonical digest under the
original held Access transaction. This adapter neither constructs that metadata
nor issues a principal or grant. Its original Principal must be pointer-identical
to the held guard's principal and the original captured access closure.

`presence_transaction.rs` is intended to be a private child of the existing
Storage `store` module; `presence_witness_repository.rs` is a private child of
Storage. No public connection or adapter constructor is added. Mac's retained
intent/event/history/review paths, Network owners and shared declarations remain
outside this patch.

## Root engine composition

Root private declarations now mount these source seams:

```rust
// storage/store.rs
#[path = "presence_transaction.rs"]
pub(super) mod presence_transaction;

// storage/mod.rs
mod presence_witness_repository;
```

The adapter checks the following real inputs:

```text
PresenceStoreAllocation::capture(&original_store)
PresenceMutationTransaction::from_active(
    &original_sql_transaction, &captured_allocation, &original_store_instance,
    &actual_contract, PresenceMutationInputs {
        context: &actual_phase_context,
        principal: &original_access_principal,
        guard: &original_held_access_guard,
        access: &original_captured_source_and_partition_handles,
        accepted_access_package_version: trusted_owner_version,
        network: configured_original_native_sidecar_and_review_borrow,
    },
)
```

Capture the private Store allocation inside the owning Store invocation before
mutably borrowing its connection; keep the Store in place until the transaction
ends. Propagate the actual private `Arc<()>` instance and this marker to the
existing `CommandTransaction` engine. The marker compares the original connection
address and instance allocation; it never dereferences a raw pointer. An active
transaction on another connection or Store is rejected. The adapter opens no
connection and begins or commits no transaction.

Use the existing engine `TransactionBehavior::Immediate`. Do not adapt the
public detached read API. Private `CommandExtension<C>` hooks now carry the
actual transaction, graph, context and final result inputs together, preserving
object safety, original authorization ordering and one commit.

1. Retain the existing original snapshot, ordered entries, Runtime-generated
   context ID, original actor/grants and actual candidate graph. Supply the exact
   context built by `context::build`; do not reconstruct it from caller DTOs.
2. On the explicitly configured path, construct the Candidate adapter from the
   same transaction after domain validation. Run the genuine
   `NativePresenceQualifier` using the original ordered presence assertions,
   trusted current clock and existing configured cache age. Retain its captures
   through the operation. The borrowed phase proof is then consumed by the
   concrete native and Stock authorizers, with full original scope, actor,
   grants, preparation and invocation correlation.
3. Keep normal record, audit, command receipt and batch receipt writes in that
   transaction. Construct the Precommit
   adapter from the same engine invocation/context ID and actual final graph.
   Run the same qualifier's genuine precommit revalidation, then typed native
   and Stock authorization. Drop the borrowed proof before witness retention.
4. Immediately before the engine's sole commit, call
   `retain_witnesses(&qualifier, &actual_results, &original_command_hashes,
   original_batch_hash.as_deref(), (&current_clock, &configured_cache_age))`.
   Propagate any error out of the engine; do not catch it and commit. After the
   sole commit, move the prebuilt committed DATA into its observation before any
   fallible Release work. Revalidate the same captures and complete accepted
   Precommit context in a fresh same-Store read transaction. Check the durable
   commit, projection, receipts and ordered witnesses, using native Release
   authorization without advancing the Stock phase state again. The result
   remains pending until the outer Access transaction commits and the original
   invocation, principal and preparation are matched for promotion.

Replay/admit-return branches must keep their existing behavior and never call
capture or retention. No witness is minted, replaced or repaired on replay. The
retained witnesses are the exact ordered stamped vector, not a durable receipt
or proof of commit. Final API success follows Store Release and the complete
outer Access commit.

Candidate reads compare actual SQL with the original snapshot; Precommit reads
compare it with the final candidate snapshot. Context format/schema, unique
ordered targets/mutation IDs, exact batch membership and recomputed reference
closure are checked. Each command's original guards and final graph semantics
are checked through the existing Contract. The original captured Access closure
is revalidated in full, including every referenced source and partition.

Current registration, cache status/epoch/pointer and complete saved projection
rows come from that active transaction. Network membership additionally reopens
its actual immutable Native raw capture and saved exact-generation SidecarRow:
full registration, projected receipt digest and original configured LinkReview
must corroborate. The genuine domain qualifier checks membership, freshness and
full row digests. Root must hold the actual configured Native owner and original
review for the whole invocation and preserve its existing residency/custody
protection; a second Store acquisition or projection-only peer is unsuitable.

Stamped content uses the actual final Binding record and Audit. Before appending,
Storage checks their saved rows and canonical command receipt body against the
actual final result plus its original hash; batches also require the original
batch hash and exact canonical ordered-results receipt. All witnesses are built
and verified before the first INSERT. Any INSERT failure escapes the original
transaction. There is no upsert, update, delete or independent commit.

## Required accepted owner input

AT11's persisted metadata intentionally supplies no package version. The private
engine takes the explicitly accepted **native Access owner package version** from
`access::NATIVE_ACCESS_PACKAGE_VERSION`, independently of Cargo/schema/JavaScript. The adapter
checks the frozen wire version-string pattern (not a strict SemVer parser) but cannot authenticate that caller input.
Do not infer it from Cargo, schema versions, a Principal, the unrelated JS package
version, an epoch/version row, or healthy fixture authority. No production version
default is included. The actual engine context ID is correlation, not authority.

## Explicit fresh profile and retained history

`0007_presence_witnesses.sql` contains the table, index, immutable triggers and
distinct fresh lineage. The selector identifies version, lineage, filename and
checksum. Explicit constructors implement fresh installation and strict
same-file reopen using the retained history catalog. Profiles 5/6 and their
migration ledgers remain unchanged. No default configuration or HTTP route
selects schema 7. There is no live migration or legacy backfill.

The witness key is `(workspace_id, binding_record_id, binding_revision)`, with
unique audit ID and scoped actor/mutation ID. Foreign keys link the existing
record, immutable audit and command receipt. The revision is a positive published
safe integer. JSON contains the full frozen v1 witness, including required
nullable Native source dates. Later record revisions remain possible; historical
witnesses are linked to their original receipt and audit rather than assuming
that the current record still has the historical revision. Rows are append-only.

The explicit existing-file validator enumerates every witness, including empty
collections, and checks canonical bodies against all denormalized keys and
linked rows. It checks schema, binding type, operation, revision, actor,
mutation, time, digests, original final record and source scope. The catalog
requires exact witness coverage by its retained accepted frames, bounds SQL
bodies before decoding, and rejects unused or duplicate entries. Missing
historical witnesses cannot be reconstructed from a current cache or metadata.

Each Root archive entry retains the same opaque Native allocation, original
complete generation, normalized rows, registration and historical metadata
facts. Source replays the response sequence through the actual decoder and
projection using the issuer's retained limits and navigation. This validates
retained content and issues no current grant. Entries retain no live principal,
Access/Store handle, guard, reader or credential. Copying witness JSON supplies
neither this custody nor authority. An empty catalog admits only a database whose
exhaustive scan needs no qualifying history.

Detached backup or restore with an expected recovery image, predecessor-bearing
history and independent administrative cold-start intake remain code dependencies.
Access's separate database remains outside the Store SQL transaction.

## Actual validation and limits

The mounted actual library/binaries/examples pass locked offline compilation and
warnings-denied Clippy. The named positive representation target passes through
the actual library. These checks execute no phase adapter, qualifier, witness
retention, schema installer, profile admission or historical validator.

Earlier owner validation used a task-owned external compiler with temporary
mounts and a dead-code allowance. That historical check does not describe the
current mounted composition: the genuine Source, Root and Storage consumers now
compile together under warnings-denied production Clippy without a suppression.
Production Cargo dependencies and lockfile remain unchanged.

The test-only configured HTTPS loopback constructor and original publication
preparation helper compile with the unit sources. They retain the actual TLS,
Access and Store fences. The named single ordinary configured
publication/Binding/history case has run against a fresh synthetic database and real numeric loopback TLS provider. Its
configured native capture and publication completed. The Binding command then
first rejected the ordinary derived validation. The closed Presence correction
now permits Present only with the original live engine frame or an exact opaque
accepted-history match for explicit schema-7 reopen; ordinary validators stay
strict. The next same-case attempt rejected an Intake/Validate mutation context
before SQL commit. Committed data and accepted history remained empty. No
successful Binding or same-file reopen is claimed; that native context failure
is being diagnosed independently.

`checks/presence-metadata-healthy.rs` inspects three published positive wire
witness/qualification representation pairs, accepted integral numeric spellings,
required nullable Native dates and a full synthetic registration canonical digest.
Those fixture authority values are synthetic metadata, never production authority.
It calls only schema/representation functions: no Access issuance, active adapter,
qualifier admission/revalidation, witness stamping/appending, database/migration
execution, service, provider or listener runs. It does not certify the atomic
engine composition, lifecycle/revocation/replay controls or strict recovery.

Root declares this existing isolated positive representation target:

```toml
[[example]]
name = "presence-metadata-healthy"
path = "src/storage/checks/presence-metadata-healthy.rs"
```

Fresh schema installation and configured native capture/publication were exercised
by that single ordinary case. The configured Binding phase and history reopen
still have no passing runtime receipt. Lifecycle, revocation, replay and other
held controls remain unrun; the representation positive does not certify those
behaviors.
