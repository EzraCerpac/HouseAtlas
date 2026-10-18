# Bounded HTTPS and maintenance dispatch

`tools/houseatlas-updater-adapters/bounded_http.py` implements the acquisition
owner's `Http.open`/`Response.read` protocol for the two fixed HTTPS origins
`api.github.com` and `release-assets.githubusercontent.com`. It performs a single
nonblocking TCP connection and verified TLS handshake per request, using the
original hostname for SNI and certificate matching. TLS requires at least 1.2.
The explicit OpenSSL default CA file is loaded at owner construction time, before
the acquisition deadline starts; ambient SSL certificate override variables are
not consulted. If that file is unavailable, construction fails closed. This
trust-store choice still needs actual NAS owner qualification.

## DNS and deadline boundary

Python's standard `socket.getaddrinfo` has no enforceable total deadline. This
implementation never calls it. Owner construction supplies a mapping from fixed
origin hostname to one numeric IPv4/IPv6 address. Missing origins are refused;
there is no DNS fallback, address retry or address discovery. These bindings are
private owner configuration, independent of the caller protocol. Address refresh
and qualification remain an explicit installation seam. No live address is
included here. Calling a blocking resolver before each request would defeat the
acquisition contract and is not a supported integration.

Every socket is nonblocking. Connect readiness, TLS readiness, request sends,
header reads, chunk framing and body reads share the supplied absolute monotonic
deadline. Each operation is checked before and after, and `select` receives only
the remaining budget. Reads can shorten that deadline, never extend it. This
bounds network waiting and refuses a success observed after budget exhaustion;
it is not a hard real-time scheduling guarantee for Python, OpenSSL or the OS.
The acquisition owner still owns its shared 60-second/32-request budget across
all calls. Constructor trust loading and owner address preparation must occur
before that acquisition, not during it.

## Wire and allocation bounds

The request uses GET, a mandatory Host field derived from the fixed TLS origin,
and exactly the supplied allowed fields: accept, accept-encoding, user-agent,
and the API version field on the API origin. The Host field is the necessary
HTTP routing exception to the acquisition protocol's “exactly supplied headers”
wording; the current acquisition adapter does not supply it. The integration
owner has acknowledged this HTTP routing interpretation; no authentication
fields or other ambient headers are added.
No proxy, cookies, authentication, ambient credentials, decompression, redirects,
retries or background reads are added. HTTPS userinfo, ports, fragments and
other origins are refused. Redirect status/location is exposed to acquisition,
which alone decides whether to make the next bounded request.

Raw application header input is read one byte at a time with the caller's
budget, capped at 16 KiB including status line and CRLF framing, before
appending. Header names are unique/lowercase and at most 100. Header strings and
the parsed mapping necessarily add bounded representation overhead. The bound
is on admitted raw HTTP header bytes, not all Python, TLS or kernel allocation:
OpenSSL/socket buffers are managed by their implementations and can contain a
TLS record larger than a requested application read. No stronger internal TLS
allocation guarantee is claimed. Body reads allocate at most the requested
application bytes, capped at 64 KiB, and prefetch no application body. HTTP/1.0
and HTTP/1.1 Content-Length, EOF and simple chunked bodies are supported; chunk
framing has a separate aggregate 16 KiB bound. Chunk extensions, trailers,
duplicate fields, interim responses and encoded bodies are outside this narrow
profile. The acquisition owner enforces total body size and Content-Length
agreement. Ragged TLS EOF is not suppressed. Response context exit closes the
stream without TLS shutdown waits.

## Integration seam

The owner constructs `BoundedHttps(address_bindings)` once and supplies it as
`GitHubReleaseAcquisition(http, verifier)`'s first argument. Production code must
never expose the underscored socket/clock/wait/TLS fixture ports as caller
options. The dispatcher is
`maintenance_dispatch.dispatch(controller, command, raw_request) -> dict`.
The owner-bound bridge supplies its existing controller, one of the three fixed
commands `check`, `apply`, `status`, and one protocol JSON request of at most
4096 bytes. The format must match the command. Dispatch uses the existing
`houseatlas_updater.cli.run` and its strict parser, result sanitization and
controller routing; it creates no alternate transaction or journal.

Authentication, authorization, per-action approval, target binding and request
arrival deadlines remain the existing bridge owner's responsibilities. The
dispatcher adds no listener, service, subprocess, dynamic imports, provider,
path or URL selection. `ok=true` means the CLI handled the request; inspect
`status.phase`, `code`, `healthVerified` and `recoveryNeeded` for the outcome.
No NAS action is performed by this donor.

`maintenance_owner.MaintenanceOwner(controller, authorize=callback)` supplies the
optional MCP catalog/call seam. Its `catalog()` returns fresh definitions for
exactly `houseatlas_update_check`, `houseatlas_update_apply` and
`houseatlas_update_status`. Its `call(name, arguments)` returns the existing
updater result dict, ready for the bridge's MCP content envelope. Arguments are
closed to one `requestJson` string of at most 4096 UTF-8 bytes; its protocol
format must match the named command. No caller selects paths, URLs, shell,
provider, configuration or a controller. Check stages privately and is marked
as a mutation; only status has the read-only hint.

The required trusted callback receives `(command, exact_raw_request_bytes)`
immediately before dispatch and must return literal `True` for that one call.
It binds the separate NAS maintenance policy, target and current action-time
approval; native Editor/Atlas write grants do not imply maintenance authority.
There is no default allow, cached grant or authorization argument in MCP input.
Authorization refusal/errors use the fixed updater `boundary-failed` result;
unknown error messages, callback details and controller diagnostics never enter
the result. The external authorizer's actual policy remains an owner
qualification, not a permission fabricated by this adapter.

The existing bridge's composition owner alone supplies this optional object and
adds its catalog/routes. Without that explicit injection, no updater tools are
advertised. This source does not change deployed main configuration, install an
endpoint, or grant access. Actual advertisement/installation remains absent
until runtime binding and the relevant owner approvals are complete.

## Exact generated successful checks

Inspect `bounded_http.py`, `maintenance_dispatch.py`, `maintenance_owner.py`,
`tests/test_transport_dispatch_happy.py` and the imported updater CLI,
validation, model and journal modules before this exact command from
`tools/houseatlas-updater-adapters`:

```sh
PYTHONPATH=../houseatlas-updater PYTHONDONTWRITEBYTECODE=1 python3 -m unittest tests.test_transport_dispatch_happy.TransportDispatchHappyPaths.test_https_partial_reads_shared_deadline_and_closure tests.test_transport_dispatch_happy.TransportDispatchHappyPaths.test_explicit_asset_redirect_then_chunked_body tests.test_transport_dispatch_happy.TransportDispatchHappyPaths.test_fixed_dispatch_uses_existing_cli_once_per_request tests.test_transport_dispatch_happy.TransportDispatchHappyPaths.test_authorized_maintenance_catalog_and_exact_requests -v
```

The first two cases use finite generated HTTP bytes and injected socket, TLS,
clock and readiness fixtures. They exercise successful partial sends/reads,
ordinary nonblocking TLS and EAGAIN read/write readiness, explicit redirect
exposure, bounded chunked decoding, IPv4/IPv6 numeric endpoints, hostname/trust settings and response
closure. They never open a socket or perform DNS/TLS queries. The third calls
the real CLI and strict protocol parser with a recording controller port for
check/apply/status; it performs no transaction, staging or activation. The fourth
checks the exact three-tool catalog and uses a recording authorizer/controller
through the real dispatcher/CLI/parser, proving authorization sees the original
UTF-8 bytes before one dispatch and preserves handled/phase/health distinctions.
It makes no native or real MCP request. These
tests do not qualify actual TLS certificates, native execution or deployment.
No failure, denial, crash, replay, broad suite or CI scope is added or executed.
The transport's fail-closed branches remain source-reviewed, unexecuted here.
