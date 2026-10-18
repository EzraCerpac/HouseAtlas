# Established-session native read transport

`houseatlas_updater_runtime.established_native_http` implements actual
nonblocking HTTPS socket operations for a closed set of native GET routes. It
borrows an **already established** bridge/HTTPS owner and performs no login,
reissue, renewal, rotation, logout, native session-binding creation, journal
operation, grant, service installation or target discovery. Imports and
construction open no connection. This separate future leaf does not change the
existing bridge, runtime exports, controller, packaging, shared guide or frozen
candidate and installs no runtime binding.

## Owner inputs and call boundary

```python
transport = EstablishedNativeReadTransport(
    established_bridge, numeric_peer_address, qualified_tls_context)
with transport.attempt(deadline=absolute_monotonic_deadline) as attempt:
    with attempt.open(FixedRead("overview")) as response:
        chunk = response.read(65536)
```

The trusted owner supplies the existing bridge object, a single numeric IPv4 or
IPv6 peer address, and an already qualified `ssl.SSLContext`. There is no default
network binding, trust setup, environment selection, caller URL, path, provider,
HTTP method or header map. The peer address/trust policy must be prepared and
qualified independently before an attempt. The context must enforce certificate
and hostname verification with TLS 1.2 or newer; its policy and trust store must
remain owned and unchanged. The source checks critical context flags and never
modifies them. It cannot prove that another holder did not mutate the CA store.

Construction snapshots the exact existing bridge owner/origin, actor, scope,
cookie, CSRF and absolute expiry. It requires the actual existing credential
shape and coherent bridge/owner CSRF state. It compares those same facts before
and after every I/O operation; it never writes those fields, adopts a response
cookie, calls the old unbounded `exchange`, prepares a session or binds a journal.
Existing expiry must cover the entire remaining attempt budget. Missing,
changed or insufficient custody is refused with the fixed updater `health-failed`
code. Credential values, endpoint details and exception messages are not emitted.

This is reuse of existing native Read/Media authority, **not** maintenance
authorization. Each server route must still authenticate and revalidate its
actual current grant. GET/session reads can update Access `last_seen`; they are
not the separate compiled SELECT-only native validation operation. Permission
for actual application reads and their activity writes remains an action-time
owner decision. No target/session request is released by this source.

## Fixed routes and limits

Scope always comes from the snapshotted bridge. Dynamic fields are canonical
UUIDs or lowercase 64-character SHA256 identities. `selection_revision` follows
the actual current Atlas source's SHA256 token shape; it is not a generic URL
escape mechanism. Fields that do not belong to a route must be absent.

| `FixedRead.route` | Fixed path family | Body limit |
| --- | --- | --- |
| `session` | `/api/atlas/auth/session` | 16 KiB |
| `view` | `/api/atlas/v1/workspaces/{w}/homes/{h}/view` | 2 MiB |
| `overview` | `/api/atlas/models/v1/workspaces/{w}/homes/{h}/overview` | 128 KiB |
| `scene` | `/atlas?expectedManifestSha256={sha256}` under the same models scope | 12 MiB + 256 KiB |
| `overview-model` | `/overview/{publication_id}/original?expectedSha256={sha256}` | 32 MiB |
| `scene-model` | `/atlas/{publication_id}/artifacts/model?expectedSha256={sha256}&expectedSelectionRevision={revision}` | 32 MiB |
| `room-links` | `/atlas/{publication_id}/room-links?expectedSemanticsSha256={sha256}&expectedSelectionRevision={revision}` | 1 MiB |
| `index` | `/index.html` | Existing runtime's served-index limit |
| `saved-index` | `/saved/index.html` | 4,000,000 bytes |

An attempt has one absolute monotonic deadline, at most 120 seconds, 12 GETs and
72 MiB of actual returned body bytes. Every response also has its own fixed route
bound. Model/map routes require Content-Length; all declared lengths must fit.
Only one attempt and one response per attempt can be open at once. Nonblocking
in-process locks refuse overlap; no thread or worker is spawned. This adds no
permission to execute concurrency or refusal controls.

Each request sends only GET, the original fixed Host/Origin/Referer, route MIME,
same-origin/no-store/identity fields and the original Cookie. It sends no CSRF,
Authorization, proxy credential or gateway identity header. The separately
registered HTTPS gateway must supply its own actual WhoIs/channel proof. Socket
existence or service UID is not authority to fabricate that header or bypass the
HTTPS gateway through its Unix channel.

The numeric socket endpoint avoids `getaddrinfo`, DNS work and address retries.
TLS SNI and hostname verification still use the original HTTPS hostname, with
the original origin port. Connect, TLS handshake, partial sends, raw headers,
chunk framing and partial body reads all share the same attempt deadline.
SSLWantRead/WantWrite and ordinary read/write EAGAIN wait in their actual required
direction, using only the remaining budget. Reads and attempt completion reject
a success observed after the deadline. No per-response timeout renews the budget.

Raw application headers are admitted one byte at a time before append, capped
at 16 KiB including status/CRLF, and at most 100 unique lowercase fields. Only
200, the expected MIME, `private, no-store`, `nosniff` and identity encoding are
accepted; redirects, Location and Set-Cookie are refused. The small HTTP/1.0 or
HTTP/1.1 profile supports Content-Length, EOF and plain chunked framing with an
aggregate 16 KiB framing bound. Chunk extensions, trailers, interim responses,
duplicate fields, decompression and automatic retries are unsupported.

Application body reads allocate at most the requested bytes, capped at 64 KiB,
and never prefetch application body before its read bound. Header structures add
bounded representation overhead. OpenSSL and kernel buffers can hold TLS records
larger than an application read; no matching internal allocation cap is claimed.
Context exit closes the socket without a TLS shutdown wait. Local deadline
checks cannot guarantee hard real-time OS scheduling, preempt arbitrary Python
property code, or prove that already-dispatched native server work stopped when
the client disconnected. No background timeout thread leaves DNS or reads alive.

This transport checks HTTP framing/type/byte budgets, not application JSON,
body digests, descriptor/source scope, scene references, model content, process
birth or frontend correctness. The separately scoped typed reader must validate
those actual responses and produce `NativeReadiness`; `PlatformOperations`
composition supplies actual served index bytes to the existing `HealthProbe`.
An HTTP 200 alone is never declared native health.

## Source checkpoint and proposed generated check

Before execution, the integration owner must inspect this module, the complete
test body, its imported runtime/core sources and this command, then release only
the named generated positive. This leaf does not register or run it itself.
From the repository root:

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=tools/houseatlas-updater:tools/houseatlas-updater-runtime python3 tools/houseatlas-updater-runtime/tests/test_established_native_http_happy.py EstablishedNativeHttpHappyPaths.test_existing_session_fixed_get_partial_io_and_deadline -v
```

The single case supplies finite generated HTTP bodies for all nine route codes,
an already-established synthetic owner, injected sockets/clock/readiness and a
TLS wrapping fixture. It constructs a TLS policy object but opens no TLS socket,
loads no certificate/trust material and performs no certificate query. Assertions
cover exact wire requests, unchanged owner/bridge fields, one decreasing budget,
ordinary partial sends/reads and TLS/EAGAIN progression, chunked bodies, numeric
IPv6 endpoint, original hostname and stream closure. The placeholder JSON/model
bodies are transport specimens, not application-admission or native readiness
evidence. No login, exchange, journal method or installed state is invoked.

No malformed, expiry, mutation, denial, failure, concurrency, retry, replay,
crash, rollback, network, socket, real TLS, native/session/MCP/server/target call,
build or broad suite is part of this proposed generated check. Actual numeric
peer/trust preparation, route-to-process custody, existing session/grants,
source expectations, whole-profile/native validators, safe WAL/socket cuts,
maintenance permission and runtime installation remain unqualified owner facts.
