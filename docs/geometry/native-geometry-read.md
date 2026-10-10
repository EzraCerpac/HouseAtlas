# Native geometry read client

`createNativeGeometryReadClient` consumes the private host's current
`{sessionIdentity, expiresAt, scope}` observation and synchronous `subscribeBinding`
notifications. The identity is an opaque object; expiry is an ISO date string;
scope supplies the actual workspace and home UUIDs. Supply the actual browser
origin explicitly. No cookie, CSRF value, storage key or grant is returned or
persisted. The native owner authorizes every GET afresh.

`loadBuilding(actualBuildingUUID, signal)` reads the native
`/api/atlas/geometry/v1/workspaces/{workspaceId}/homes/{homeId}/buildings/{buildingId}`
descriptor. It returns a frozen `NativeGeometryFrame` with `lease`, `viewKey`,
`descriptor`, `floors` and `readPort`. The descriptor retains the native serde
names `originalSha256` and `derivativeSha256`. `floors` explicitly adapts those
hashes into the existing viewer's `originalSHA256` and `derivativeSHA256` fields,
retaining the same four native record IDs/revisions and both source licences. Revisions
remain immutable `ExactDecimal` values with their complete native JSON number
spellings, including u64 values above the JavaScript safe integer boundary.

Use the frame's floor objects with the existing
`readScanMesh(frame.readPort, frame.viewKey, floor, signal)` reader. The port
follows only the exact offered `/frames/{viewKey}/meshes/{floorKey}` path and
checks the native `x-atlas-geometry-view` header. The existing reader checks the
derivative digest, complete authored mesh profile, original digest and raw
floor label before render preparation. The port alone returns bounded bytes;
it does not substitute for those profile and lineage checks.

`client.isCurrent(frame)` and `client.subscribeInvalidation(frame, callback)`
fence the local observation. Binding replacement/gaps, expiry, every replacement
load and disposal invalidate prior frames and abort in-flight exchanges.
Notifications are synchronous; late subscriptions to foreign or invalid frames
notify immediately. Failed loads leave previous frames invalid. A failed mesh
exchange invalidates its frame; caller cancellation stops that read and permits
another floor read in the same still-current frame. Request release rechecks
binding, expiry and generation. A transport completing after cancellation has
its body discarded and cannot release a frame or delivery. Subscriber exceptions
cannot prevent other notifications. `dispose()` unsubscribes the host observer,
clears expiry timers, invalidates the frame and aborts active exchanges.

Local currency does not certify that native records have remained unchanged
between GETs. The immutable server frame digest and fresh native authorization
check that boundary on every mesh read. These reads introduce no new import,
download capability, calibration, room mapping or physical placement. Declared
authored units remain separate from unknown physical scale and floor alignment.

Each exchange has one 15-second deadline spanning headers, streaming body and
descriptor decoding, checked explicitly at each chunk and request release in
addition to its abort timer. At most 8,192 chunks, including empty chunks, are
retained per body. The visible Fetch headers are bounded to 8 KiB; content
type and optional complete content length are validated. Descriptor bodies are
capped at 1 MiB, with at most 64 floors, depth 8, 4,096 value nodes, 4,096 code
units per decoded string and 20 ASCII bytes per numeric token. Duplicate fields
and additional or absent fields are rejected. The descriptor matches the exact
current scope, building and SHA64 frame header. Offered paths must match the
native relative route exactly, without query, fragment or encoded aliases.
Requests use `GET`, `credentials: 'same-origin'`, `cache: 'no-store'` and
`redirect: 'error'`. Mesh bodies use the existing 8 MiB profile bound and exact
native mesh MIME. At most two exchanges are active in this client.

Byte and structural caps do not guarantee a fixed JavaScript heap or cap a
transport's own buffering. Stream chunks are copied before being joined, so
both bounded chunks and the contiguous result can coexist. Abort cancels the
reader and settles the caller promptly; the injected transport must honor its
signal to release transport resources. HTTP wire headers already processed by
the browser are outside the visible-header accounting. No private mesh cache
is retained by the client after delivery; a consumer owns its returned bytes
and any still-referenced immutable frame.

`frontend/lantern-tests/native-geometry-read.mjs` is one synthetic healthy source
runner: a real `Response`/`ReadableStream` descriptor and tiny authored triangle
flow through the actual client and existing profile parser. Its fake transport
asserts exact offered paths and request options, retains all four large revision
spellings and checks custody hashes, licences and authored token metadata.
Runtime execution remains held until Root registers that exact command after
source review. Source compilation does not establish native service, browser,
GPU, real export, authorization-control or deployment acceptance. Host mounting
and scan presentation belong to separate owners.
