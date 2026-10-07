# Durable provider dispatcher hosts

This namespace composes the actual native Jobs queue and the published AT07
async stock activity leaf. It adds no scheduler, recovery scan, policy engine,
substitute database or grant reconstruction. Root mounts, manifests, router,
shared schemas and host service registration remain integrator-owned.

## Native Jobs host

`ProviderDispatcher::new(store, transport, trusted_config)` owns an accepted
`AtlasStore`, synchronous `PreparedTransport` and Jobs registration.
`bind(original_binding, authority, |journal| owner)` constructs the actual SQL
`QueueSession`, `WriteQueue` and `NativeHomeBoxWriter` with shared native store
and journal handles. The binding borrows the original `ValidatedRequest`,
principal and witness. The owner must journal exact bytes, run final
`authorize_dispatch` and correlate response/readback evidence through the
provided handle. `enqueue`, `snapshot` and explicit `dispatch_next` delegate
to the accepted Jobs semantics. `into_parts` returns ownership for shutdown;
it does not release a physical slot or liability.

Every configured provider-writing alias must enter the deployment's one
canonical physical queue. Supply the canonical Atlas connection and complete
registration. SQL transactions and RefCell borrows end before synchronous I/O.
Do not hold an outer application database mutex during that invocation.

## Concrete durable async stock host

`DurableStockHost::new(store_arc, access_arc, trusted_queue_config)` takes the
actual `Arc<Mutex<AtlasStore<C,A,R>>>` and original
`Arc<Mutex<AccessBoundary>>`. It requires the storage owner's already-open,
fresh, opt-in profile 6. It never opens, upgrades or migrates a database.
Default profile 5 remains unchanged. Profile-6 recovery is unavailable.

Call its mutable `bind(original_binding, original_io, stock_http_config)`:

- `OriginalStockBinding` retains `Arc<P>` implementing the actual
  `StockActivityPrincipal`, its original opaque AT11 principal/source/partition
  handles, `Arc<G>` implementing mandatory `StockActivityAuthorization<P>`,
  shared actual contracts, the original validated `StockCommand` and captured
  `StockAuthority`.
- `OriginalStockIo` supplies the actual access, preparation, transport resource
  and readback peers. These must retain the same original binding and trusted
  server-held route/graph/observation/approval/staging/evidence inputs.
- `TrustedStockHttpConfig::new(&queue, https_origin, DispatchBinding, Limits)`
  checks the complete source partition, physical deployment/database/digest
  and owner against the queue. The real `SourceEndpoint::https` checks endpoint
  and qualified registry facts. Explicit source/dispatcher epochs pass directly
  to `StockActivityRegistration`; no Jobs lease fence conversion exists.

The returned `BoundStockHttp` contains the real
`StockWriter<SharedContracts<S>,X,F,StockActivitySession<C,A,R,P,G,S>,HttpDispatcher<H>,B>`.
The contracts forwarding wrapper preserves the same shared schema peer used
by the durable session. Construction performs no request or credential lookup.
An exclusive host borrow lasts through the bound workflow. Database and access
guards end within the accepted synchronous session operations before network
awaits. Own one host per deployment; bypass paths are not mounted by this leaf.
The storage leaf also enforces reciprocal Jobs/stock interlocks in the physical
database. Its conservative cross-lane logical/liability holds are preserved.

`execute(&mut self)` uses only the original command's exact JSON value.
`snapshot(operation_id)` performs the original-authority journal lookup.
`queued_handoff(operation_id)` returns the storage owner's actual sealed,
in-memory, never-invoked carrier; `run_queued(&carrier)` revalidates that same
session's handoff before calling the existing writer. No raw `StoredOperation`
is accepted by this concrete host, and no database scan reconstructs authority.
Handoff/recovered dispatch qualification remains held and was not exercised.
The earlier generic `stock_http::StockHttpDispatcher` remains a peer-supplied
constructor; use `durable_stock::DurableStockHost` for this concrete composition.

Admission, deduplication, FIFO, permit journaling, exact plan/evidence/approval,
byte accounting and durable evidence retention use AT07's implementation.
The mandatory authorization peer must qualify authentic server-held I/O evidence
independently of current disclosure authority. There is no permissive fallback.
Remote-end, logical outcome and retained liability remain distinct. The concrete
HTTP driver returns `EndUnproven` for invoked requests; the activity leaf has no
later termination-proof API. Observation success cannot free the physical slot.

## Exact source inputs

The continuation starts at the identity-remapped
`19310b10dcfc34424233496854c014000f44acbf`; the original integration input was
`7e742505fd360901a3976a993774a4bbdf7e2eaf`. Existing native writer bytes remain
the accepted `c784be5776b614f8f0bb225fcb5355ecb9e90e0d`. The earlier Jobs/store
path used storage `2643eced79c5a581f72cc53634659d93da323cfb`, domain
`d9e2b59ffef4b7ac2b11705df735b89d8371fdc5` and Jobs
`f35bcdc2d9c24646356bc080bfb1ef157120bcb3`.

The disposable verification now consumes these exact published peer trees:

| Namespace | Published source |
| --- | --- |
| Storage and migrations, including async activity | `29a37d8de35d5930a396fce3b06bdb901ba5421a` |
| Domain and Jobs, including staged consumption APIs | `8a568fb6ccef5b0fa575b18d6181dcc524d4db99` |
| Media | `f0d6b10f00bb93fc1c1dd4eb3ae66ee1fbe3f873` |
| Access | `4a0cd4da563a32d26677755a608180c960765353` |
| Concrete write transport | `72349292ec6c51a0e6a5d36985e094d05166bd53` |

The remapped transport namespace is byte-identical to the previously inspected
`c36bb0bc19bb631d815ab4bb44fa3514ebeac0b7`. Access is byte-identical to the
remapped base. Contracts and writer remain the base's accepted source. Peer
namespaces are copied by exact Git object into disposable external storage;
no peer changes or their commit ancestry enter this scoped checkout. The
verifier requires these objects already fetched read-only. This is explicit
source adoption for compilation, not live or integrator mounting acceptance.

## Local evidence

Inspect `verify-local.py`, activate the saved pinned Rust environment, then run
`python3 -B backend/src/lifecycle/provider_dispatch/verify-local.py`. It creates
an external source composition with temporary root declarations, preserving
the accepted manifest and lock. It adds one external check package. Every
locked version, checksum and package edge is compared before compilation; only
the backend's dev-only Tower edge is omitted when used as a dependency, while
the locked Tower package remains in the check package. Cargo uses
`--offline --locked`. The checkout's root declarations/manifests are untouched.

Rustfmt and Clippy (`-D warnings`) check these namespaces. The helper selects
exactly two inspected fresh fixtures:

- `healthy_fresh_native_dispatch` uses a fresh profile-5 SQLite database,
  genuine Jobs/store/native writer composition, synthetic original authority,
  the real stock quantity mapper, one enqueue, one transport invocation and
  one durable receipt. SQL inspection verifies original JSON and exactly one
  attempt/journal/evidence/outcome with the physical slot retained.
- `healthy_fresh_stock_activity` adapts the published storage leaf's ordinary
  helpers. A fresh disposable AT11 boundary supplies real typed original
  handles. A fresh profile-6 database runs this host's actual SQL activity
  session, native writer, mapper and synthetic dispatch/readback peers. SQL
  inspection verifies exact original wire/intent, one operation, four journal
  events and `ConfirmedObserved` while `EndUnproven` keeps the physical slot.

The production HTTP specialization is compiled, not invoked. Both fixtures
use explicit synthetic policy/qualification facts. Peer test runners are not
mounted or run. There is no HTTP request, socket, real account/provider,
credential creation, deployment or inference. Replay, recovered dispatch,
rejection, faults, crashes, concurrency, corruption, expiry, revocation and
adversarial controls remain held. No later positive termination proof is
manufactured, and these checks do not establish production qualification.

## Remaining trusted host inputs

The integrator must supply the canonical fresh-profile store/access handles,
complete physical alias/owner registration and Jobs admission/retry/lease
settings; genuine captured principals/grants/witnesses and original commands;
qualified build/routes/epochs and HTTPS origin; explicit body/response/time
limits; original-authority access/preparation/readback peers; server-qualified
activity policy with human approval, graph/observation/byte reservation and
evidence verification; resource callbacks providing only existing authorized
credentials and admitted stage bytes; and trusted clocks/native owner for the
synchronous Jobs path. Compile success supplies none of these live facts.
