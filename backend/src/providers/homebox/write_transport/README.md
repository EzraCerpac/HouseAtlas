# Stock writer HTTP transport

This namespace implements `StockDispatchPort` using asynchronous reqwest HTTP/1.
It consumes the actual accepted stock writer's `InvocationPermit`, `NativePlan`,
`StockAuthority`, `NativeDispatch`, `NativeResponse` and `DispatchReceipt` types.
It supplies real socket execution, not a second writer/queue or synthetic-only
dispatch implementation. No service route is mounted here.

The development base is accepted integration
`7e742505fd360901a3976a993774a4bbdf7e2eaf`. Writer input is immutable
`c784be5776b614f8f0bb225fcb5355ecb9e90e0d`; all twelve stock namespace blobs,
including its README, match that input exactly. The native mapping remains
pinned by that owner to HomeBox source
`e01dd737238a3fa7e1a6454b37de6c6fc88c86e4`. No upstream pin qualifies a deployed
build. Root manifests, lock, module declarations, routers, shared schemas and
accepted peer source remain integrator-owned and unchanged. PR44 public head
`72349292ec6c51a0e6a5d36985e094d05166bd53` has the same complete Git tree
`6f91afef01c6a188bd1d19262744cd92015d3105` as the original transport input.
The later dispatcher input explicitly still consumes that byte-identical head;
it does not resolve PR44 findings by itself. This successor closes findings
4205632955 (actual print confirmation), 4205632971 (fixture constructor visibility),
and 4205632986 (checked sensitive authorization header construction).

Writer successor PR103, immutable input
`5281eb1857a90c2279fb2998b3c7d0e2e41ec9b6`, adds `NativeDispatch::Unavailable`.
This transport compiles against its actual extracted stock module; that is
consumer compatibility evidence, not acceptance of the review-pending writer.
The HTTP driver constructs results at its own known invocation boundary and
does not translate another driver's results. Its before-execution proof remains
`NeverInvoked`; its invoked receipts remain `EndUnproven`. An outer capture gate
without invocation/noninvocation proof must preserve `Unavailable`, without
fabricating a receipt or archive, persisting a dispatch fact, releasing a hold,
performing readback or dispatching again. Those gate and durable decisions remain
with the codec and writer owners.

## Binding

The integrator declares `pub mod write_transport` alongside `read` and `write`
in the existing HomeBox module. No new dependency is required: the accepted root
already supplies reqwest 0.13.5/Rustls, Tokio, tokio-util, serde/serde_json, SHA256,
URL/URI and UUID. The direct binding is:

```rust,ignore
let dispatch = HttpDispatcher::new(
    SourceEndpoint::https(registered_origin, registered_binding)?,
    host_resources,
    explicit_limits,
)?;
let writer = StockWriter {
    contracts, access, preparation, activity, dispatch, readback,
};
// Existing StockWriter::run_reserved calls dispatch only after durable
// exclusive admission and its original-authority refresh.
```

`DispatchBinding` holds the host's exact context, UUID source/collection, physical
database/configuration, fenced owner, source/dispatcher epochs and qualified
catalogue/build/route digests. The HTTPS constructor refuses `SyntheticFixture`.
Before preparing and before sending, the driver compares the actual permit and
authority against that configured binding and recomputes the plan digest through
the accepted shared `contracts::semantics::canonical_digest` implementation.
The fixed mapper route/method/body-kind/query/response/status envelope is also
checked independently. No browser URL, source override, arbitrary header or
arbitrary native route can be supplied through the prepared request API. Endpoint
fields are accessible only inside this transport namespace; production callers
must use `SourceEndpoint::https`, while the literal loopback fixture constructor
exists only in test builds. The authorization header tuple field is private to
the transport module and descendants, so host resources must call `from_bytes`,
which checks nonempty bytes and marks the header sensitive.

`DispatchResources` is the necessary private host bridge. `authorization` receives
the configured endpoint and exact admitted permit/plan/captured authority and
deadline. The host must revalidate the original authority and active registry
evidence immediately before supplying an opaque sensitive Authorization header.
Production requires a header. There is no environment token lookup, login,
refresh, credential/grant creation, renewed-grant substitution or tenant discovery.
`staged_bytes` retrieves already admitted private staged bytes within the supplied
bound; the driver verifies their exact size and SHA256. Waiting intents never
fetch stage bytes. The durable owner keeps admission, approval, liability,
deduplication, ownership renewal and evidence persistence; this transport makes
none of those decisions. Each call performs at most one HTTP invocation and has
no retry. Calling the port twice with the same permit is prevented by the durable
owner, not by a second process-local queue.

## Request and response contract

`prepare` creates an opaque consumable `PreparedRequest`. Its `body()` and
`body_digest()` expose the actual bytes for private inspection, without a mutable
URL/header/body accessor. JSON is bounded during serialization and serialized
once. Existing dates, strings, values, array order and omission/null distinctions
remain those in `NativeBody`; this does not promise recovery of lexical spelling
already normalized by a peer's JSON parser. Multipart uses fixed fields from the
accepted plan, exact admitted file bytes and a checked deterministic boundary;
no multipart library reserializes the prepared bytes. UTF-8 filenames/field values
are preserved; quoted filenames use MIME quoted-string escaping. Filenames with
path separators, `..`, CR/LF/NUL, empty names or more than 4096 UTF-8 bytes, and
non-token MIME types are explicit before-dispatch limitations. The request bound
includes all multipart overhead, not only the staged file.

`send` consumes that request, injects the private header and sends the same bytes.
`dispatch_until` takes a caller absolute deadline and cancellation token and
returns `DispatchReport`. `StockDispatchPort::dispatch` uses the explicit timeout
as one absolute deadline and returns the existing `NativeDispatch` only. The
deadline covers stage retrieval, credentials, native request and all response
chunks; preparing early cannot renew it at send time. Cooperative cancellation
or timeout drops local futures without starting a detached retry/drain task.
Synchronous serialization/hash/JSON work is checked at its boundaries, not
qualified as preemptible CPU execution.

The client uses normal Rustls platform certificate/hostname verification, HTTPS
only in production, no proxies, redirects, retry policy or automatic content
decompression, identity encoding, no idle pooled connections, HTTP/1 only and
at most 64 response headers. Explicit limits must be nonzero and fit the local
64 MiB body/300 second timeout ceilings; these ceilings are an engineering
envelope, not a qualified provider profile. Response accumulation checks both
Content-Length and every actual chunk against the lower of the host bound and
the plan's max_response_bytes. Library/OS buffering and total allocator overhead
are not certified by the accumulated-body bound.

JSON decoding preserves literal keys and number values and rejects duplicate
keys/depth over 64. It checks transport syntax and an object root for successful
JSON forms; this is not a new native resource schema. Stock evidence/preparation
peers retain native identity/schema/effect/readback decisions. A genuine bounded
JSON error can be returned with its actual non-success status. Successful
no-content replies require empty bytes. Successful print replies require the
exact `Printed!` confirmation emitted by the pinned `print=true` native handler
and yield null plus SHA256 of those actual text bytes. The handler does not
explicitly set a media type, so acceptance does not depend on one. This confirms
only the received HTTP response; physical printer acknowledgement and remote
termination remain unproven. PNG generation with `print=false` belongs to the
read/artifact owner and is not accepted by this mutating transport. No JSON null
is hashed in place of an empty response or print confirmation.
`NativeResponse.body_digest` is SHA256 of complete identity-encoded response bytes,
including original whitespace, not native JCS.

## Evidence and physical activity

| Observed local boundary | Existing writer result | Remote end |
| --- | --- | --- |
| Binding/route/stage/credentials/deadline/cancellation prevents polling HTTP execution | `NeverInvoked` | No native invocation started by this call |
| HTTP execution is polled; connection/TLS/send/response becomes unavailable | `Invoked`, response absent | `EndUnproven`, no termination digest |
| Actual headers arrive but redirect/encoding/body bound/format fails | `Invoked`, response absent, observed status retained in report | `EndUnproven` |
| Complete bounded valid response arrives | `Invoked`, actual status/value/raw-body digest | `EndUnproven` |
| Dispatch future is dropped or process stops | No returned report; durable admitted intent already exists | Durable owner must retain the physical hold |

`TransportEvidence` carries operation ID, immutable plan digest, conservative
`NotStarted`/`MayHaveStarted`/`ResponseReceived` activity, prepared body digest and
length, actual optional response status, actual observed byte count, optional
complete raw response digest and a fixed sanitized fault category. An oversized
chunk contributes to observed count but is not appended or assigned a complete
digest. Content-Length refusal has zero observed body bytes. Complete malformed
bodies retain the raw digest in the report even when no NativeResponse is returned.
Evidence contains no credentials, raw bodies, URLs, errors or response headers.
The richer report is transient; the host must persist it privately if wanted.
The existing writer persists only the facts supported by its unchanged port.

Every invoked receipt has `RemoteActivity::EndUnproven`. HTTP success, complete
response EOF, cancellation, matching readback or a local socket close supplies
no independent correlated provider termination evidence. This driver never
returns `EndedProven`, releases a durable physical hold, resolves generated
identity, proves causality or claims native CAS. The accepted outcome reducer
continues to retain its native-editor-race and held-activity distinctions.

## Supported code and qualification

| Form | Implemented transport | Demonstrated healthy scope |
| --- | --- | --- |
| JSON POST/PUT/PATCH on the accepted entity/tag/maintenance/type/template/link/duplicate routes | Exact bounded prepared JSON | Loopback POST, PUT, PATCH; stock-mapped tag create and exact date/string preservation |
| Bodyless DELETE and five bodyless bulk actions; JSON wipe action | Fixed routes and methods, bounded reply | Loopback DELETE with genuine empty 204; bulk forms compiled only |
| Attachment file upload | Exact file/name/type/primary multipart with admitted stage size/hash | Stock-mapped UTF-8 filename, exact synthetic bytes, chunked entity reply and explicit synthetic header |
| CSV import | Exact csv multipart; maxRows/impact remain local admission constraints | Stock-mapped CSV and genuine empty 204 |
| Label print asset/item/location GET | Exact print=true query and bounded `Printed!` confirmation digest | Stock-mapped item print through `StockDispatchPort`; no physical printer |

HTTPS execution is coded with normal verification but has not been exercised
against a live HomeBox build or user's NAS. No real provider/account call,
credentials/grants, deployment or paid inference occurred. Actual registered
build/route/schema/tenant enforcement, captured authority bridge, durable queue
composition, staged-upload liability/recovery, readback completeness, complete
bulk/import impact, printer acknowledgement and remote termination remain
unqualified. Existing native mapper limitations and unsupported catalog forms
are unchanged; transport availability does not promote them to supported forms.

## Scoped verification

Inspect `verify-healthy.sh` and the three functions in `healthy.rs` before running.
With the accepted pinned Rust 1.99.0 toolchain and application dependencies cached:

```sh
export CARGO_TARGET_DIR=/tmp/houseatlas-write-transport-target
bash backend/src/providers/homebox/write_transport/verify-healthy.sh
# Compatibility check using an already locally available immutable writer input:
HOUSEATLAS_WRITER_COMMIT=5281eb1857a90c2279fb2998b3c7d0e2e41ec9b6 \
  bash backend/src/providers/homebox/write_transport/verify-healthy.sh
```

The script creates and removes a disposable external Cargo harness. It imports
the actual application library and this namespace's actual module, preserves
application dependency versions/checksums, checks formatting and compilation,
runs Clippy with warnings denied, then runs only these exact names separately:

- `write_transport::healthy::healthy_stock_json_methods_and_prepared_bytes`
- `write_transport::healthy::healthy_stock_multipart_and_print_dispatch_port`
- `write_transport::healthy::healthy_stock_file_fields_and_explicit_header`

With `HOUSEATLAS_WRITER_COMMIT`, it reads the exact local Git blobs for the whole
stock namespace into that disposable harness and logs their identities. It uses
the application's actual shared contracts and pins, makes no fetch, changes no
peer checkout files and imports no peer ancestry into publication history.
Compilation includes the writer's new three-variant API; only the same three
positive transport groups execute. The unavailable gate/refusal behavior has
been inspected in source and remains unexecuted under the held-control policy.

These are seven fresh sequential socket exchanges across three healthy groups,
with real loopback HTTP/1, fixed-length/chunked replies and exact inspected request
bytes/headers. Test-only HTTP endpoint construction is restricted to literal IP
loopback and `SyntheticFixture`; no fixture escape exists in non-test builds.
The authorization/admission/resources are synthetic host stand-ins, not actual
AT07/AT11 composition or a deployed HomeBox service. No broad application tests,
rejection/replay/fault/crash/concurrency/corruption/expiry/revocation/adversarial
controls or substitutes run. Root publication allowlist and module mounting
still require the integrator's separate update before normal hosted source CI
can include this namespace. Code review readiness is separate from live or
integration qualification.
