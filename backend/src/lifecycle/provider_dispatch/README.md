# Durable provider dispatcher hosts

These namespaces compose actual native Jobs/SQL and profile-6 stock activity.
Root module declarations, manifests, router, shared schemas and application
store ownership remain integrator-owned. There is no scheduler, startup scan,
recovered dispatch, policy engine or Jobs-to-native lease/epoch conversion.

## Native Jobs path

`ProviderDispatcher::new(store, transport, trusted_config)` owns an accepted
`AtlasStore`, synchronous `PreparedTransport` and Jobs registration.
`bind(original_binding, authority, |journal| owner)` builds the actual SQL
`QueueSession`, `WriteQueue` and `NativeHomeBoxWriter`. It retains original
request/principal/witness references and shares genuine store/journal handles.
The owner journals exact prepared bytes, performs final `authorize_dispatch`
and correlates response/readback evidence through the supplied handle.
`enqueue`, `snapshot` and explicit `dispatch_next` use the existing semantics.
Transactions and RefCell borrows end before transport invocation. `into_parts`
returns ownership for shutdown without freeing remote activity or liability.
Every provider-writing alias must use the deployment's same physical queue.

## Durable async host and archive

Provision an independent private archive directory outside the recoverable SQL
image. Pass its absolute canonical path and an explicit frame-byte limit to
`TrustedStockArchiveConfig::new`, then `PrivateStockArchive::open`. The existing
directory must be owned by the current effective user with mode 0700. Opening
creates no path. The original retention policy must qualify this exact trusted
server destination; a path or checksum is not authentication or disclosure
permission. No credentials or opaque principal/grant handles enter its files.

`DurableStockHost::new(store_arc, access_arc, trusted_queue_config, archive_arc)`
requires the canonical original `Arc<Mutex<AtlasStore<C,A,R>>>`, original access
boundary and already-open fresh opt-in profile 6. It never opens, upgrades,
replaces or migrates a database. Default profile 5 remains unchanged. Root must
coordinate these same original store handles; a second database connection is
not an equivalent live activity composition.

Its mutable `bind(original_binding, original_io, stock_http_config)` retains:

- `OriginalStockBinding`: original `Arc<P>` with actual opaque AT11 principal,
  source and partition handles; original validated command/captured authority;
  shared contracts; and mandatory `Arc<G>`.
- `G: NativeArchiveAuthorization<P>` extends the actual Storage71
  `StockActivityRetentionAuthorization<P>`/`StockActivityAuthorization<P>`.
  The storage callback qualifies the complete historical/preflight cut at
  entry/precommit/release. The additional mandatory
  native callback receives the actual opened archive directory's canonical
  path, device, inode and owner, the genuine producer and its native carrier.
  It qualifies every actual raw native field and that destination.
  There is no permissive default. Callbacks must avoid storage/state reentry
  and perform no provider I/O; server archive evidence and user disclosure are
  independent responsibilities.
- Actual access, preparation, HTTP resource and readback peers retaining that
  original binding, with genuine routes, graphs, observation, approval,
  staging/liability, credential and source-epoch evidence.
- `TrustedStockHttpConfig`: exact qualified HTTPS endpoint, explicit request/
  response/time limits and `DispatchBinding`. Complete partition, deployment,
  physical database/configuration digest and owner must match the queue. Stock
  source/dispatcher epochs pass unchanged to `StockActivityRegistration`.

The returned bound writer uses the actual AT07 `StockActivitySession`, actual
`StockWriter`, concrete `HttpDispatcher`, and actual codec78
`CapturingStockDispatch`/`CapturingStockReadback`. The exclusive host borrow
serializes the workflow. No SQL/access/codec/data mutex guard crosses a network
await. The published storage leaf retains reciprocal Jobs/native physical
interlocks and distinct logical/remote/liability state.

The activity decorator captures and durably archives each newly reserved cut.
After genuine admission it calls the same session's producer/successor method,
then actual codec `/3` `RetainedNativeStockActivity::bind_admitted`. Complete
admission/preflight/permit/approval/liability and original event prefix are
archived **before admission returns the permit to the writer**, hence before
provider I/O. A retention error stops the workflow; the host supplies no retry,
replacement grant, physical release or recovery authority.
The accepted writer's sanitized authentication/capability errors remain intact.
Other retention errors return `UnknownHeld` with no retry or operation ID; an
earlier retained cut is not a current disclosure authorization.

The original codec wrappers capture actual `NativeDispatch`/`DispatchReceipt`
and `NativeObservation` before returning them for native fact reduction. After
SQL fact commit the decorator captures the same original successor and calls
`retain_successor`; the peer verifies exactly one new event and recomputes its
own native facts against the genuine prior cut. The complete successor and its
raw native events are then archived before further I/O. Later response/readback/
end/liability cannot qualify an earlier frame. The source driver's actual
`NativeResponse` carries decoded bounded value and original body digest; no
original source bytes are fabricated from a JSON reencoding.

Before admission, the genuine producer is encoded with actual codec88
`NativeActivityArchivePacket::encode_producer`. Admitted and successor carriers
use its `encode` without sealing capture. Both receive the exact configured
`max_frame_bytes`; the peer bounds borrowed source data before allocation and
streams output under that limit and its independent 16 MiB/256-event ceiling.
This archive contains the peer's explicit
`houseatlas-homebox-stock-activity-archive/4` format and `/3` native results.
The packet checks the genuine original principal's actor/scope and the complete
source record, native correlations and exact typed roundtrip. The dispatcher
performs the mandatory original destination/full-field authorization and the
actual durable write; encoding issues no storage or invocation permission.

The concrete file archive accepts exact codec-owner bytes and writes them to a
newly created 0600 file under an anchored directory descriptor, syncs the file, publishes an
immutable hard link, removes only its temporary name and syncs the directory.
Existing complete frames must match exact bytes; none are overwritten or
pruned. Filenames use original operation UUID and activity version. Complete
original wire/native number tokens, source clocks, registration/epochs,
preflight, plan, permit, every exact event sequence/prefix and typed raw native
fields are retained by the codec-owned encoder. Its native carrier selection is
the peer's explicit `houseatlas-homebox-stock-activity-native/3`. This leaf does
not define a second serializer or reconstruct raw source bytes. File digests
are archive integrity receipts, separate from original native request/response
digests. No file loader
here can recreate a producer, principal, source grant or invocation permission.
Crash/durability/containment controls remain unqualified; only ordinary healthy
filesystem operations were exercised.

`execute` uses only the bound original JSON. `snapshot` reads through the
original session. `queued_handoff`/`run_queued` retain the actual sealed
never-invoked owner handoff; they are compiled but not exercised. `retained_record`
and `archive_receipts` reauthorize complete retained output. Consuming
`into_retained_native` returns actual `ArchivedNativeStockActivity<P>` through
codec `seal`, preserving the genuine original pointer while closing capture;
it frees no physical hold and retains no SQL store. Root/recovery can pass it
to actual `RetainedNativeStockActivityArchive` and `HomeboxStockActivityEvidence`
with mandatory independent original/media provenance and offline discovery.
No image restore/reopen/recovered execution is mounted or run by this leaf.
The earlier generic `stock_http` constructor remains for peer-supplied callers;
this deployment path uses `DurableStockHost`.

## Exact source composition

This continuation is based on preserved dispatcher62
`5690f8d10569b2c7418ba3dc8fb314f9ad793588`, whose remapped base is
`19310b10dcfc34424233496854c014000f44acbf`. Original integration was
`7e742505fd360901a3976a993774a4bbdf7e2eaf`. Native writer bytes remain exact
accepted `c784be5776b614f8f0bb225fcb5355ecb9e90e0d`.

| External namespace | Exact tested input |
| --- | --- |
| Storage71 and migrations | `2befc971bd8b5590ab6b139b1163fbcd82256c66` |
| Actual native activity/archive codec88 | `1d202f4e61726db9fa49cadbb2f8bf6900551d5f` |
| Domain70 | `c25c1a0316ef5e12b61560f00371d839085aefb5` |
| Jobs | `8a568fb6ccef5b0fa575b18d6181dcc524d4db99` |
| Separate original-owner Domain queue recovery | `fd72542686112e594d9a6f63b4782a62b5d9e6ef` |
| Media63 | `ea8ef14e05795334b3d79ae9c95c0a456f8b0308` |
| Access | `5e87c6c9152228ac4ae72814c6e6fc8f0ea8d7a2` |
| Concrete write transport | `72349292ec6c51a0e6a5d36985e094d05166bd53` |

Earlier inputs remain in Git: storage2643/default jobs, stock activity29a37d8,
mutex-cycle successoref3117c, domain d9 and staged8a, media f0, access4a, and
transport c36 (byte-identical to remapped72349292). No peer ancestry is merged
into this branch. Peer runtime bytes are extracted from exact published Git
objects into disposable external storage, with current owned namespace bytes.
Source adoption for compilation is separate from shared integration acceptance.
Codec88 is the exact direct successor chain of preserved codec78
`12e8482af75ecd49531832dee81b87a5298baffb`, via
`ea510dbc0f796d79122c48edbf8ddab4cc679d0e`. Its two published byte methods
support genuine waiting producers and explicit caller limits. It also carries
the original owner's source fixes for ambiguous capture never claiming positive
never-invoked evidence and retaining compatible refreshed readback authority.
Those stopped controls are not executed here.
The requested Storage71 `8a171a18d7d035d4fce5818442c1f654a340683e` remains
preserved. The inspected `6e54c2dbf29485ac7d44fac418430652d39f46bc` and then
`2befc971bd8b5590ab6b139b1163fbcd82256c66` carry queue guard/order and fresh
metadata/replay occupancy corrections. The producer/data-codec API bytes and
all SQL migration bytes are unchanged across those successors.

## Inspected ordinary verification

Activate the saved pinned Rust environment, inspect `verify-local.py`, then run
`python3 -B backend/src/lifecycle/provider_dispatch/verify-local.py`.
The disposable source composition mounts only the needed modules and the exact
codec-owner stock evidence bridge and original storage data-codec bridge;
checkout declarations and peer bodies stay
unchanged. It retains the accepted root manifest/lock. Media63's required
`png=0.18.1` dependency is added only to the external backend manifest. The
external lock admits only the check package, exact PNG0.18.1 and fdeflate0.3.7
with pinned checksums/dependencies; every original locked package/version/
checksum/edge is checked, except backend's dev-only Tower edge and the explicit
PNG edge. Required dependencies must be cached; compilation is offline/locked.
Root must separately reconcile the production manifest dependency.
It must mount `activity_storage_bridge.rs` inside `storage::stock_activity` as
`retained_native_codec_bridge` and reexport that module at storage root. The
bridge wraps only original private data codecs and pure baseline checking;
no private producer factory or live store is exposed. These declarations are
added solely to scratch by this verifier.

Rustfmt and strict Clippy check the namespaces; exactly two healthy tests run:

- `healthy_fresh_native_dispatch`: one fresh Jobs/SQL/native mapper/synthetic
  transport invocation and durable receipt in profile 5; exact original JSON
  and one attempt/journal/evidence/outcome are inspected. Physical hold remains.
- `healthy_fresh_stock_activity`: actual fresh AT11 handles, SQLite profile 6,
  native mapper/writer, this host decorator and actual codec88 capture/byte APIs,
  with synthetic policy/dispatch/readback. The dispatch seam checks the complete
  synced admission file first; the readback seam checks the synced dispatch
  successor first. Four immutable private archive frames are read back with
  exact hashes/JSON/prefixes/native objects. Actual sealed codec events use own
  sequences 3 and 4 and the same original `P` pointer. SQL retains one operation,
  four events and `ConfirmedObserved` while `EndUnproven` keeps the physical slot.

The production HTTP specialization is compiled, never invoked. Peer tests,
listeners, providers/accounts, production credentials/grants, deployment and
inference are not run. Recovery and handoff execution, rejection/replay/expiry/
revocation/guard reversal/mutation/omission/adversarial/denial/fault/crash/
concurrency controls and broad aggregates stay held. Ordinary success supplies
no security, crash recovery, deployment or live qualification.

## Explicit owner dependencies

The integrator supplies same-original canonical store/access ownership, complete
physical aliases/owner/epochs, Jobs policy/clocks/native owner, qualified build/
routes/origin and explicit limits, original handles/commands, real preparation/
resource/readback peers, and complete archive/native/provenance/media policies.
The archive's lifetime, capacity, backup/protection and original destination
qualification are trusted host settings. No production settings are inferred.

Storage71 may commit reserve then refuse release and return only StockPortFault,
without its committed operation ID. The dispatcher cannot capture that unknown
cut by a scan or reconstructed authority. For known IDs it attempts successor
capture even when a fact method returns an error, but live original retention
can itself refuse after an original-fence/revocation/disclosure change. A
storage-owned committed-result/archive callback or independent genuine evidence
retention seam is required to complete those error paths. This source limitation
was reported immediately on PR71; no held campaign was executed. SQL facts and
physical holds are retained, further I/O stops, and no full postcommit/error-path
archive qualification is claimed. Codec unsupported rejection/missing raw or
unavailable-observation evidence remains unavailable; no substitute proof is
introduced. Independent offline native/media provenance and administrative
registry/discovery remain with their original owners.
