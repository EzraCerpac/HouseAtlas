# Native activity evidence version three

This leaf qualifies original profile6 stock activity evidence through accepted
Storage71 `StockActivityRecoveryEvidence`. Jobs codecs `/1` and `/2` remain
separate. No Jobs ID, lease, timestamp or fence becomes a native operation or
permit, and no image value selects a codec, registry or recovery authority.

The genuine original dispatcher creates stable handles before admission:

```rust
let capture = StockActivityNativeCapture::unbound();
let dispatch = capture.dispatch_port(actual_native_dispatch);
let readback = capture.readback_port(actual_native_readback);
```

These concrete ports implement the actual accepted writer's `StockDispatchPort`
and `StockReadbackPort`. They retain the actual `NativeDispatch` (including the
full `DispatchReceipt`) or `NativeObservation` before returning it to the writer,
with the exact prior native operation, plan, permit and captured authority. The
underlying original ports keep all credential/access/source/route/driver policy.
SQLite and mutex guards do not cross their awaits. An unbound, pending, closed or
in-flight capture cannot start another inner invocation. Cancellation, capture
failure and unavailable evidence never create termination or image proof.

After genuine admission, the original dispatcher owner must call the concrete
original session's retention method and bind that sealed producer:

```rust
let producer = session.retain_producer(operation_id)?;
let mut retained = RetainedNativeStockActivity::bind_admitted(
    &native_contracts, producer, &capture,
)?;
```

The original owner's mandatory `StockActivityRetentionAuthorization` must
qualify the complete cut and its archive destination. The dispatcher must
actually durably retain that complete owner cut **before native I/O**. The
factory qualifies retained data; it neither provides a persistence backend nor
asserts that a constructor call durably archived it. The caller must stop before
I/O if retention or destination authorization fails. The convenience
`from_admitted` returns `(retained, capture)` when ports can be bound afterward.
No producer is constructed from restored rows, public DTOs or arbitrary JSON.

After each fact commit, retain the exact same original session's successor
before further I/O:

```rust
let next = session.retain_producer_successor(retained.producer())?;
retained.retain_successor(&native_contracts, next)?;
// Durably retain the complete successor at the authorized original destination.
```

One successor adds exactly one original event and must match the corresponding
captured native result. The complete previous event prefix, original `P`
pointer, registration, operation and admitted permit must match. Actual response
facts and observation facts are recomputed through the accepted writer's
private evidence functions, exposed only by the existing integrator-owned
`retained_bridge` declaration. Shared schemas/digests/timestamp/outcome validation
use `NativeWriterContracts`; mapping uses the original `map_stock`. The resolved
GET plan uses the accepted effective target and generated-ID path rule.
Generated identity and member evidence, complete impact, decimal/date/set
semantics, activity, known effects, native races, causality/CAS limits and media
liability remain native-owner semantics. Response/readback agreement does not
prove remote termination or discharge an independent byte reservation.

Freeze the original carrier without any store, session or driver handle:

```rust
let record = retained.seal(&native_contracts)?;
let archive = RetainedNativeStockActivityArchive::new(vec![record])?;
let evidence = HomeboxStockActivityEvidence::new(
    &native_contracts, &archive, &original_provenance_and_media_evidence,
);
let activity_peers = storage::StockActivityRecoveryPeers {
    contracts: &native_contracts,
    registry: trusted_activity_registry,
    discovery: independent_offline_administrative_owner,
    evidence: &evidence,
};
```

`original_provenance_and_media_evidence` is a **mandatory** actual
`StockActivityRecoveryEvidence` peer. It independently qualifies original
preflight/approval/authenticity/media provenance and each own liability cut;
this module supplies no success default or production owner binding.
`StockActivityRecoveryDiscovery` and the complete trusted
`StockActivityPhysicalRegistration` registry are separately supplied by their
original owner. Keep separate base `RecoveryValidationPeers` for
native/stock/upload/Jobs. These callbacks perform neither SQL reentry, driver
I/O, grant refresh nor recovered dispatch. A reopened image cannot create a
producer brand, queued handoff, invocation permission or cleared physical hold.

The adapter compares the complete image record to independently retained
original producer evidence. Each `validate_event` matches only that event's
exact original prefix/previous event, admission permit, `body_accepted` and
physical hold. Raw native results correlate to the event's sequence and prior
operation. Later dispatch/observation/end/liability cannot qualify an earlier
frame; the original evidence callback receives only the historical cut.
Archives reject duplicate operation identities and global event sequences.

| Original carrier role | Exact version selection |
| --- | --- |
| Complete native activity | `houseatlas-homebox-stock-activity-native/3` |
| Actual dispatch or positive driver noninvocation | `houseatlas-homebox-stock-activity-dispatch/3` |
| Actual qualified observation | `houseatlas-homebox-stock-activity-observation/3` |

These are explicit original-owner carrier versions, not extra Storage71 columns
or a wire payload accepted from an image. The typed carrier has no serializer,
JSON constructor, recovered factory or clone of the producer. Read-only native
getters expose exact prior operation, permit, dispatch/readback plan, authority,
dispatch, receipt and observation for the original authorized archive owner.
Unsupported rejection and missing raw/unavailable-observation qualification
remain unavailable. Historical stopped controls stay unrun.

## Exact source and selected validation

* Storage71: `8a171a18d7d035d4fce5818442c1f654a340683e` (including its exact migrations).
* Actual accepted writer: `c784be5776b614f8f0bb225fcb5355ecb9e90e0d`.
* Current-main dependencies/media/schema/manifest: `87ad201140edb7b3afdb4396095a320c2926eafe`.
* Original-owner corrected Jobs domain adapter: `fd72542686112e594d9a6f63b4782a62b5d9e6ef`.
* Dispatcher62 inspected interface: `5690f8d10569b2c7418ba3dc8fb314f9ad793588`.
* Preserved predecessor: codec `/2` commit `5ca8f0c76b7505c75e70109d8c4546defbddc40b`.

All original source bytes and earlier inputs are separately retained outside
Git. The external compiler harness mounts these inputs and adds only the
integrator-owned recovery/bridge/domain module declarations. Source manifests,
private validation logs and actual retained evidence are excluded from Git.
Repository root manifests/lock/router/schema/module declarations and peer
namespaces are untouched. Initial missing harness inputs/dependency cache and
Clippy's large-variant finding are retained in external logs; the native plan
is boxed without weakening exact comparison or suppressing the lint.

Scoped formatting, locked compilation and strict Clippy (`--lib --tests --
-D warnings`) passed. The sole selected new healthy test is
`providers::homebox::recovery::healthy_activity_v3::healthy_profile6_native_capture_and_event_cuts`.
It uses actual AT11/AT51, the accepted mapper/evidence functions and a fresh
actual SQLite profile6 session with inspected **synthetic** original-authority,
zero-media and administrative peers. One healthy synthetic quantity update
returns one actual typed synthetic `NativeDispatch` and `NativeObservation`
through the concrete wrappers, retaining genuine original session producer cuts
before and after fact commits. Four own-prefix events qualify in captured and
closed-image validation with unchanged image bytes. The confirmed observation
preserves unproven physical activity and false causal/provider-CAS claims.

No production durable archive or real native driver is qualified by this test.
No restore/reopen, recovered execution, held control, actual provider/account
call, real credential/grant, deployment or money action runs. Nineteen other
tests, including earlier codecs' examples, remain filtered and unrun. The
selected healthy case passed before and after the final boxed-plan correction;
a compile-only field correction between those runs is preserved in the logs. No optional
hosted CI repetition or manual reviewer duplication is requested.

```sh
cargo test --locked --offline --manifest-path /workspace/activity-codec-check/Cargo.toml --lib providers::homebox::recovery::healthy_activity_v3::healthy_profile6_native_capture_and_event_cuts -- --exact --nocapture
```

The original dispatcher owner must install these wrappers and retain the
producer/successor cuts at an authenticated durable destination. The original
recovery owner must bind the mandatory provenance/media evidence and offline
administrative discovery peers. Those are concrete integration dependencies;
this leaf implements their native evidence adapter but edits neither namespace.
