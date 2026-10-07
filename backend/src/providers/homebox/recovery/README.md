# Retained HomeBox stock evidence

For durable native cut bytes and evidence-only restoration, use the
[authorized archive `/4` codec and adapter](activity-archive-v4.md).

For actual asynchronous profile6 activity, use the independently retained
[native activity `/3` carrier and adapter](activity-v3.md). Jobs `/1` and `/2`
remain distinct and do not qualify activity by translating leases or epochs.

Version two joins the actual opaque storage job ID and the separately issued
writer operation UUID through `RetainedWriterJobBinding`. Select
`HomeboxRetainedEvidence::new_v2` explicitly in the trusted recovery host.
Version one's constructors, codec names and exact encoding remain supported
with their original UUID-equality requirement; version one does not interoperate
with AT07's actual `q` + SHA256 queue IDs and is not retroactively qualified.

## Version two producer and host interface

The original native producer must already possess the exact storage claim,
admitted `StoredOperation` and its matching `InvocationPermit`. Preserve those
objects and their provenance independently of the recoverable image:

```rust
let binding = RetainedWriterJobBinding::retain(
    &claimed_job, &admitted_writer_operation, &writer_permit,
)?;
let retained = RetainedWriterAttempt::from_prepared_v2(
    &writer_contracts,
    trusted_queue_config,
    binding,
    admitted_writer_operation,
    original_stock_preflight,
    writer_permit,
    unchanged_media_owner_evidence,
)?;
```

`binding.job()` returns the full original leased job; `writer_operation_id()`
returns its actual associated writer UUID. No queue ID is parsed as a UUID,
truncated, hashed into a UUID or replaced. No UUID is issued by this module.
Both identities, the complete lease/attempt and the original full envelope,
actor, captured authority and permit are retained in the versioned prepared
packet. All existing request/schema/plan/preflight/physical/scope/fence/expiry/
liability checks still apply. The archive checks that one job has one writer
operation per physical identity across retained attempts, and one writer operation
is not reassigned to a different job. The binding has private fields and no
image/JSON constructor; it compares complete actual admitted/permit objects,
not a caller-supplied ID pair. Its constructor remains producer-owned data
retention, not proof of driver authenticity or any access/invocation grant.

Submit the exact `retained.prepared()` bytes and qualified new `steps()` through
the original storage owner's existing journal/inbox APIs. Preserve the actual
finish and liability cut with `record_finish`, then freeze the independent owner
records with `RetainedWriterArchive::new`. The native producer must authenticate
and durably retain this association with its original provenance; image bytes
cannot recreate it. The existing `StoredOperation.operation_id` and
`InvocationPermit.operation_id` supply the genuine UUID fields: no new storage,
writer, schema or global field is required. This leaf supplies the retained
producer API, not an implementation of the still-unbound live activity owner.

The original PR53 recovery host owner changes only its codec selection:

```rust
let native = HomeboxRetainedEvidence::new_v2(
    bindings.writer_contracts, bindings.writer_archive,
);
let evidence = NativeQueueRecoveryEvidence::new(&discovery, &native);
```

No host source is edited by this leaf. `/1` selection stays `new`; `/2` selection
stays `new_v2`. There is no image-driven version selection, automatic upgrade or
permissive fallback, and one configured native evidence peer selects one version.
A mixed-version registration needs separately supported owner composition;
changing a retained packet's codec label does not upgrade its proof.

| Version two role | Selected codec |
| --- | --- |
| Prepared native intent | `houseatlas-homebox-stock-native/2` |
| Response/readback | `houseatlas-homebox-stock-readback/2` |
| Qualified physical end | `houseatlas-homebox-stock-remote-end/2` |
| Positive driver noninvocation | `houseatlas-homebox-stock-never-invoked/2` |
| Embedded producer association | `houseatlas-homebox-stock-job-binding/2` |

Reconciliation, admission/other and retry-after-invocation qualification remain
unavailable. Outcome-local prefixes, logical fences, physical activity, causal/
CAS limits and independent media/accounting semantics are unchanged.

### Version two source and healthy evidence

This successor is based directly on preserved `/1` commit
`c7a67af8ac5dc92e22b87142384eb1c4503532c0`, whose author and committer use the
verified public no-reply identity. It inspected actual storage2643's deterministic
opaque job-ID producer/validator and PR53 host
`2973fbcb5d55b2bc8eea828d2adad5b25c0466cc`. The external harness uses original
writer `c784be5776b614f8f0bb225fcb5355ecb9e90e0d`, storage
`2643eced79c5a581f72cc53634659d93da323cfb`, and original-owner corrected domain
recovery `fd72542686112e594d9a6f63b4782a62b5d9e6ef`. Both earlier291efa and corrected
fd725 inputs remain separately retained unchanged. Root manifests/lock/module
declarations remain external and integrator-owned; no peer source is patched.

Exactly the inspected fresh `healthy_retained_writer_v2_storage_prepared` case
runs against actual native schemas/semantics and actual SQLite. One enqueue and
claim produce storage's genuine `q` + SHA256 ID, while the synthetic native owner
supplies its separately existing admitted writer UUID. The version-two packet
is journaled unchanged through actual storage; required original/media/native
peers validate a newly captured prepared image and the same closed image.
The actual journal envelope and retained storage attempt are exercised. This is
healthy synthetic capture/validation, not restore/reopen or recovered execution.
The later in-process native response/readback/finish/end records are synthetic
and qualify their own typed outcome cuts; no physical driver or queue finish is
executed. Source store and fixture files are disposable. Twelve other tests,
including the historical `/1` fixture, remain filtered and unrun.

```sh
cargo test --locked --offline --manifest-path /workspace/recovery-codec-check/Cargo.toml --lib providers::homebox::recovery::healthy::healthy_retained_writer_v2_storage_prepared -- --exact --nocapture
```

Scoped formatting, locked offline compilation and strict Clippy (`--lib --tests
-- -D warnings`) passed in the external harness. The selected healthy case
passed once on the completed implementation; twelve other tests were filtered.

The original snapshot-read omission and compiler fixture borrow correction logs
are retained outside Git. No stopped control, provider/account call, new real
credential/grant, deployment, paid inference, CI retry, billing change or root
merge runs. Hosted CI account limits remain outside this leaf's control.

## Preserved version one interface and evidence


`HomeboxRetainedEvidence::new(&NativeWriterContracts, &RetainedWriterArchive)`
implements the accepted `domain::queue_recovery::NativeRetainedEvidence<P>`.
Pass it to `NativeQueueRecoveryEvidence::new(&discovery, &native)` and pass that
storage evidence peer, with the same discovery peer and complete registry, to
the populated recovery host. The independent recovery grant, original enqueue
and admitted-attempt provenance, and queued media proofs remain mandatory.
This module qualifies retained facts; it supplies none of those authorities.

The concrete shared-contract adapter validates actual native stock schemas,
root-exclusion intent digests, output schemas and finite timestamps. Preparation
reuses `map_stock` for the exact original and independently retained preflight.
Response, generated identity, complete impact, native set/decimal/date semantics
and readback reuse the accepted writer's private evidence functions through the
small `stock_bridge.rs` module. Native outcome reducers retain false causality
and provider CAS, native editor races, logical fences and independent activity.
No fixture-only semantic codec or permissive contract checker is selected.

| Storage role | Selected codec |
| --- | --- |
| Prepared native intent | `houseatlas-homebox-stock-native/1` |
| Response/readback | `houseatlas-homebox-stock-readback/1` |
| Qualified physical end | `houseatlas-homebox-stock-remote-end/1` |
| Driver positively never invoked | `houseatlas-homebox-stock-never-invoked/1` |
| Reconciliation, admission/other markers | Unavailable |

The version-one producer is `RetainedWriterAttempt::from_prepared`, taking the
actual admitted `StoredOperation`, `StockPreflight`, `InvocationPermit`, exact
`LeasedJob` and media-owner evidence bytes. Retain its `prepared()` bytes in the
native journal unchanged. `record_response_readback` accepts actual bounded
`DispatchReceipt` and qualified `NativeObservation`; submit its new `steps()` to
the existing storage evidence inbox. Ended receipts produce a separate end step.
`record_remote_end` retains later qualified termination without replacing effects.
`record_never_invoked` accepts only the actual native driver's `NeverInvoked`
variant, before any observation. Generic errors and missing evidence do not
qualify noninvocation. None of these methods calls a driver or persists a queue.

After the actual finish transaction, `record_finish` retains its exact report,
time and complete liability prefix. Freeze the records with
`RetainedWriterArchive::new`. This archive must be supplied independently by the
trusted original native owner, with retained provenance, and must outlive the
source core. It has no image/JSON deserialization or from-image constructor.
Its typed records/constructors are data rather than sealed driver authority;
trusted host construction is essential. Supply original native records after
restart through the owner's independently authenticated retention mechanism;
this module does not create such a persistence/authentication mechanism.
Caller-authored packets, digest strings or source pins cannot build that proof.

Packets are bounded at the accepted storage's one-MiB metadata limit. Decoding
requires closed outer envelopes and exact producer encoding, then full byte and
metadata equality with independent retained records. Exact original-envelope
comparison includes request ID, observation and approval reference, even though
immutable intent hashing excludes its specified renewable fields. Prepared bytes
are bound to method/path/body, command/target, snapshots/clear representations,
full lease/physical identity/configuration/dispatcher/fence/expiry/attempt,
actor/context/idempotency key, scoped queue and native permit. Source timestamp,
wire number and ordered array values are never rewritten. The media payload and
liability are kept unchanged; native observation never infers deletion, zero
bytes, reference closure or orphan cleanup. Media and storage peers still
validate accounting progression and the complete image/journal envelope.

Every retained attempt must match its independent complete step/outcome record.
Each finish is qualified from its own retained step/liability prefix. A later
physical end cannot release an earlier outcome's physical hold. Confirmed
readback qualifies observed effects without claiming causality or provider CAS.
Version one supports prepared/ongoing records, one finish and a later end tail.
The inspected writer provides no sufficient native retry-after-invocation,
explicit reconciliation or admission-marker producer proof. Those kinds return
unavailable rather than interpreting a storage marker or arbitrary JSON as
native proof. Previous generic fixture codecs are not accepted or upgraded.

## Integrator declarations

This PR owns only this directory. Add these declarations in owner-controlled
module files when composing the accepted inputs:

```rust
// providers::homebox module
pub mod recovery;

// inside providers::homebox::write::stock (not the recovery module)
#[path = "../../recovery/stock_bridge.rs"]
pub(crate) mod retained_bridge;
```

The accepted domain `queue_recovery` module must also be declared by its owner.
No declaration, root manifest/lock, router, shared schema or publication allowlist
is changed here. The known domain distinct-home source correction remains with
its original owner; no copy or workaround is introduced.

## Exact inputs and validation scope

Inspected, separately retained original source inputs:

- Writer `c784be5776b614f8f0bb225fcb5355ecb9e90e0d` (all stock writer files).
- Domain recovery `291efa1782d740795843b198f9f4ffc5fbcf694b` (all five files).
- Storage `2643eced79c5a581f72cc53634659d93da323cfb` (all storage files).
- Media `8eca84173bbbc089cbc20c5edf0c154cd13f6646` (required-peer native adapter inspected).
- Private development main base `501ccf6507d5924b7acf36675140294596e990a4`.

The external compiler copy uses the exact accepted writer/storage and recovery
source with temporary integrator declarations. The external library includes only required peer modules; its target declarations
omit unrelated host binaries/examples. Root dependencies/lock come from
that main base. Original inputs and per-file Git blob/SHA256 manifest remain
outside the PR. No accepted source input is overwritten. The evidence bridge's
only change to its owner in that copy is the declaration above.

Allowed commands are scoped formatting, locked compilation and warning-strict
Clippy, plus exactly this newly written and inspected healthy composition:

```sh
rustfmt --edition 2024 --check backend/src/providers/homebox/recovery/*.rs
cargo check --locked --offline --manifest-path /workspace/recovery-codec-check/Cargo.toml
cargo clippy --locked --offline --manifest-path /workspace/recovery-codec-check/Cargo.toml --lib --tests -- -D warnings
cargo test --locked --offline --manifest-path /workspace/recovery-codec-check/Cargo.toml --lib providers::homebox::recovery::healthy::healthy_retained_writer_composition -- --exact --nocapture
```

The healthy example produces one fresh quantity-zero native plan/packet and
synthetic driver evidence, using genuine shared schemas/digests and accepted
writer correlation/reducers. It calls the actual domain recovery-evidence adapter
with synthetic independently retained original/attempt/authority/zero-media
peers and typed storage frames. A response/readback finish at prefix one remains
end-unproven while a healthy later end exists at prefix two. The journal envelope
view is synthetic; no SQLite capture/restore, recovered execution, live authority,
real provider, account, new credentials/grants, deployment or paid inference
runs. This is compiler and healthy fixture evidence, not live qualification.
Rejection, replay, fault/crash, corruption, concurrency, expiry/revocation and
adversarial controls remain held and unrun. CI/publication allowlist integration
belongs to the integrator; no bypass or optional CI rerun is requested.

Final scoped Linux/Rust 1.99.0 formatting, locked/offline check and warning-strict
library/test Clippy passed. The final healthy run passed one selected test;
eleven peer tests were filtered and unrun. Initial compiler-copy missing fixture/
Network-only dev-dependency logs and the initial healthy fixture's missing
complete snapshot were preserved externally, then corrected without changing
accepted peer source or running controls. All 84 original input files remain
byte-identical to their pinned Git blobs. The harness lock is unchanged from the
private main base. No full-image recovery or live qualification is claimed.
