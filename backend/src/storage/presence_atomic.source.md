# Atomic presence source adapter

These new files provide the Storage implementation of
`domain::qualified::AtomicPresenceTransaction` and append-only witness persistence.
They are **source only**. The private modules now compile in the actual library.
The existing command engine supplies actual Candidate and Precommit frames after
ordinary phase authorization. Stock constructs no original presence peer and
preserves its staging hold. No table is installed by this component. Profiles 5/6
migration catalogs and their checksum validation are unchanged.

`StoreOptions::presence_profile` defaults to `PresenceProfileSelection::Disabled`.
Explicit `FreshV7` returns `upstream-unavailable` before database open/reopen,
including when the legacy activity selector is also set. The source-only
`0007_presence_witnesses.sql` has a distinct lineage and checksum, but no installer
routes to it. Required independent `OriginalPresenceHistoryEvidence` has no
implementation or success default. Its historical validator compiles, with the
unavailable mount documented by a narrow dead-code expectation, and is not
invoked for current profiles.

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
2. After normal Candidate authorization and domain validation, construct the
   Candidate adapter from that same transaction. Run the genuine
   `NativePresenceQualifier` using the original ordered presence assertions,
   trusted current clock and existing configured cache age. Retain its captures
   through the operation.
3. Keep normal record, audit, command receipt and batch receipt writes in that
   transaction. After normal Precommit authorization, construct the Precommit
   adapter from the same engine invocation/context ID and actual final graph.
   Run the same qualifier's genuine precommit revalidation.
4. Immediately before the engine's sole commit, call
   `retain_witnesses(&qualifier, &actual_results, &original_command_hashes,
   original_batch_hash.as_deref(), (&current_clock, &configured_cache_age))`.
   Propagate any error out of the engine; do not catch it and commit. Only after
   success may the original engine commit and return normal results.

Replay/admit-return branches must keep their existing behavior and never call
capture or retention. No witness is minted, replaced or repaired on replay. The
retention return value is a count of attempted same-transaction rows, not a durable
receipt or proof of commit. Final API success must follow the engine commit.

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

## Fresh profile and recovery proposal

`0007_presence_witnesses.sql` contains the precise proposed table, index,
immutable triggers and distinct fresh lineage. The explicit source selector and
definition identify version, lineage, filename and checksum. Complete compatible
profile/catalog admission and independent recovery policy remain required before
mounting retention. Current profiles 5/6 validate their entire migration ledger
and `sqlite_schema`; adding this table to either existing profile silently would
make the database incompatible. This patch does not modify those profiles or
install/execute a migration. There is no live migration or legacy backfill.

The proposed key is `(workspace_id, binding_record_id, binding_revision)`, with
unique audit ID and scoped actor/mutation ID. Foreign keys link the existing
record, immutable audit and command receipt. The revision is a positive published
safe integer. JSON body contains the full frozen v1 witness, including required
nullable Native source dates. Later record revisions must remain possible; do
not add a foreign key tying historical witness revision to the current record
revision. Witness rows remain append-only.

Before admitting this new profile, Root's complete open/image/recovery validators
must enumerate and validate **every** witness, including empty collections, and
check the exact canonical body against every denormalized key and scoped linked
row. Validate schema/amendment, binding type, audit operation/revision/actor/
mutation/time/digests, actual command receipt's historical final record, its
scope/binding/source, and required historical qualifying-witness coverage.
A current record may be newer than a historical witness; its immutable original
receipt/audit outcome supplies the historical final row. SQL foreign keys alone
do not enforce home/type/JSON correlations. Reject missing/mismatched/duplicate
or unsupported persisted evidence according to the accepted fresh-profile
policy. No missing historical witness may be fabricated from a current cache or
metadata. Root owns these exhaustive validators and corresponding lineage rules.

Native cache generation/epoch/digest references also need inclusion in the
accepted original-owner residency, export and recovery catalogs. Copying a JSON
witness supplies neither retained raw Native bytes nor an active authority token.
Do not claim restore, historical admission or cross-owner atomic commit from this
source component. Access's separate held database supplies original authority;
this is not a distributed SQL transaction.

## Actual validation and limits

The mounted actual library/binaries/examples pass locked offline compilation and
warnings-denied Clippy. The named positive representation target passes through
the actual library. These checks execute no phase adapter, qualifier, witness
retention, schema installer, profile admission or historical validator.

Earlier owner validation used a task-owned external compiler composing dev with AT11's exact
`metadata.rs`/module export and these two files. It adds the proposed private
mounts with `allow(dead_code)` **only in that external compiler copy**, because
production presence-peer construction deliberately remains unwired. All method bodies are type
checked; no stub replaces a Store, Access or Network implementation. Production
Cargo lock/dependencies remain unchanged. The root Cargo manifest now names the
existing positive representation example.

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

Actual presence admission and all lifecycle/revocation/replay/held controls remain
unrun pending the explicitly accepted engine/profile/recovery composition and
separate qualification authority.
