# Native jobs dispatcher host

This namespace contains two explicitly distinct host paths. The native jobs
path executes real AT07 SQL queue sessions. The async stock HTTP path constructs
the actual `StockWriter` with the sibling concrete driver and requires the
storage owner's distinct `StockActivityPort` implementation. Compilation of that
constructor does not establish durable stock coverage.

`ProviderDispatcher::new(store, transport, trusted_config)` owns one accepted
`AtlasStore`, one synchronous `PreparedTransport` and one jobs registration for
the deployment. `bind(binding, authority, |journal| owner)` constructs the actual
`QueueSession` and shares its SQL store/journal handles with the accepted
`WriteQueue` and `NativeHomeBoxWriter`. The binding borrows the original
`ValidatedRequest`, principal and witness. Nothing reconstructs authority from
queue rows. Every configured provider-writing alias must join this same queue.
Supply a dedicated accepted connection to the canonical Atlas database; do not
move an application database mutex guard into the transport call. The host owns
this connection for its lifetime, while other root service composition remains
integrator-owned.

The bound API exposes `enqueue`, `snapshot` and explicit `dispatch_next` with
trusted admission and completion clocks. Enqueue accepts metadata only. Jobs
owns admission, FIFO, retry classification and lease semantics; AT07 owns
durability, original-intent/lease checks, evidence and liability transactions.
The native owner must journal exact prepared bytes through the supplied handle,
perform the final `authorize_dispatch`, and submit correlated response/readback
evidence to that handle's inbox. No SQL transaction or RefCell borrow is held
during transport invocation. These APIs are synchronous; a future async driver
must not await while holding an application database mutex guard.

The native owner and transport retain their actual accepted
`NativeOperationOwner` / `PreparedTransport` associated payload and response
types. The host creates no replacement owner, route rules, policy engine,
database or qualification evidence. `into_parts` consumes the host for shutdown;
it does not release durable remote activity or byte liability.

Integrator mounting consists of declaring `config::provider_dispatch` and
`lifecycle::provider_dispatch`. No root manifest, module declaration, router,
shared schema or publication manifest is changed here. There is no automatic
startup pump, recovered dispatch or mounted provider capability.

## Source inputs

The base is `7e742505fd360901a3976a993774a4bbdf7e2eaf`. Runtime files in
`backend/src/storage` match accepted
`2643eced79c5a581f72cc53634659d93da323cfb`; the README alone differs.
`backend/src/providers/homebox/write` matches
`c784be5776b614f8f0bb225fcb5355ecb9e90e0d` exactly. Domain runtime matches
`d9e2b59ffef4b7ac2b11705df735b89d8371fdc5`; its README alone differs.
The jobs source is the base's unchanged accepted input
`f35bcdc2d9c24646356bc080bfb1ef157120bcb3`. Original peer files remain unchanged.

The additional transport counterpart is
`c36bb0bc19bb631d815ab4bb44fa3514ebeac0b7` (PR44), whose parent is the exact
`7e742505` base and whose original writer files remain unchanged. The external
verifier reads its six Rust files by exact Git object into disposable storage,
without changing the peer namespace in this checkout or merging its history.
The actual async driver and both new stock HTTP constructors compile against
those bytes and the accepted writer types. This accepts no deployed build or
durable activity implementation. Fetch the exact object read-only if it is not
already available before invoking the offline verifier.

`healthy.rs` adapts only the fresh synthetic authority/native owner helpers
from the accepted AT07 `checks/queue-check.rs`; it does not include or run that
runner. Its native payload comes from the actual accepted `map_stock` quantity
mapping. It validates original wire3 with the real native contract and computes
real digests. Provider authority, source observation and readback/effect checks
remain explicit synthetic fixture facts.

## Async stock HTTP constructor

`TrustedStockHttpConfig::new(&queue_config, origin, DispatchBinding, Limits)`
checks the complete source partition, physical deployment/database/configuration
digest and UUID owner against the jobs registration. It constructs the actual
`SourceEndpoint::https`; the sibling owns endpoint/qualification validation.
Matching configuration identifies a common queue but supplies no protocol or
permit mapping. Source and dispatcher epochs must come from the activity owner,
never by coercing a jobs lease fence or guessing a successor.

`StockHttpDispatcher::new(StockHttpPeers { contracts, access, preparation,
activity, resources, readback }, config)` constructs the actual async
`StockWriter<C,A,P,S,HttpDispatcher<H>,R>`. Its mutable `execute` entry serializes
local workflows without holding a database mutex during network awaits.
`run_reserved` is an explicit storage-owner handoff of an authorized
never-invoked prepared/queued operation; there is no startup scan or grant
reconstruction. Immutable wire, authority/preflight checks, durable admission,
single dispatch, readback and sanitized disclosure remain the existing writer
algorithm. No async stock workflow has been executed by this leaf.

The resources peer is the sibling's actual `DispatchResources`: it revalidates
original authority/registry epochs immediately before injecting its private
header, and provides only already-admitted staged bytes. Async
`StockDispatchPort` is not used as synchronous jobs `PreparedTransport`.
The activity owner must define the authoritative epoch and permit lifecycle;
the endpoint binding is immutable, so its configured epoch must match each
permit it will consume. The root host controls any per-admission construction.

## Local evidence and open peers

Inspect `verify-local.py`, activate the saved pinned Rust environment, then run
`python3 -B backend/src/lifecycle/provider_dispatch/verify-local.py`. It creates
only an external harness, preserves every accepted lock package/version/checksum,
and adds one harness package. Cargo omits the backend's dev-only `tower` dependency
edge when using it as a dependency; the exact locked Tower package is retained
by the harness. All other package facts and edges are compared before compiling.
It checks the actual namespace source with rustfmt
and Clippy (`-D warnings`), then selects exactly the single named healthy fixture.
Dependencies must already be available; Cargo runs `--offline --locked`.

The named `healthy_fresh_native_dispatch` fixture uses a fresh SQLite database,
one fresh enqueue, one dispatch and authorized snapshot readback. Read-only SQL
inspection checks original JSON, one attempt/journal/evidence/outcome and retained
physical slot. Observed success stays `EndUnproven`; no termination proof is
fabricated. It executes no replay, recovered dispatch, rejection, fault, crash,
concurrency, corruption, expiry, revocation or adversarial control. There is no
HTTP client, socket, credential, real provider/account, deployment or inference.
The sibling's three healthy test functions are compiled in the external harness
but filtered out by the exact selector; their socket exchanges are not rerun.

The async stock.2 `StockWriter` requires the distinct `StockActivityPort` protocol.
This jobs host does **not** supply that durable activity implementation. A coherent
async stock host needs an accepted storage leaf implementing `reserve`, `admit`,
`reject`, `record_never_invoked`, `record_dispatch`, `save_observation`, and `load`,
with original authority and the same exclusive physical queue. Its UUID
operation/owner, source epoch, dispatcher epoch, plan digest and qualification
must have an owner-reviewed mapping to jobs leases/journals. Neither protocol
may be relabeled as the other. The sibling concrete transport's actual constructor,
types and source pin are now verified by compilation; composition with the
still-missing durable activity leaf remains open.

Trusted remaining inputs are the canonical Atlas store, complete physical
registration/aliases/configuration digest and owner, explicit jobs admission and
retry/lease profile, original request/principal/witness, actual queue authority,
native operation owner, concrete prepared transport and clocks. Code compilation
and fresh local fixture success supply none of the live qualification inputs.
