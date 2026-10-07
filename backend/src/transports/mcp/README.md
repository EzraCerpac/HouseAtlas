# HouseAtlas MCP adapter — AT38

AT38 owns `backend/src/transports/mcp/**` except the separately owned `lifecycle/`
carve. This successor is based on published main
`a16f9a55e5beab5348aa00a2675a0e03c9aef98b`, with sole publication root
`9f7561d99e09a680ec5282ca0c8aed4e10c6cbc9`. Lifecycle, HTTP routes, capability
admission, root manifests and generated contracts are unchanged.

## Native bindings and finite mappings

`NativeContext::from_principal(access::Principal)` retains an already issued,
opaque access principal. `NativePrincipalPort::new(Arc<Mutex<AccessBoundary>>)`
revalidates that original authority and checks the catalog's scoped capability.
Context identity is retained through Arc handles; no authority is minted here.
The access and lifecycle owners supply the authenticated principal seam.

`NativeSchemas::from_bytes(agent, atlas)` admits exact published resources by
SHA-256, canonical IDs and draft2020-12 dialect. Family descriptors retain their
transitive local `$defs`; const/default/enum/example payloads remain unchanged.
No schema URLs or files are fetched by production code.

- `contracts/stock-wire3/agent/agent.schema.json`: SHA-256
  `314ee5f5effca941b3be92cb5cc37150aa17a3ab5dd8646255cebc74767b602d`
- `packages/contracts/schemas/atlas.schema.json`: SHA-256
  `ba73d972c87391fe06cd41d68e73bc2d73fc3fcac322889cfb3b8d909c3f3f72`

`OperationMapping::for_operation(wire::OperationId)` joins the existing closed
shared and domain catalogs. It verifies family, input/output schema references,
effect and authority, and exposes the domain ID and output kind. `all()` covers
all 164 published IDs, including held and unsupported metadata. `ToolName` wraps
the existing ten-family enum. There is no copied operation table.
`NativeOperation::request()` and `mapping()` expose immutable typed views.

`NativeCatalog::with_admitted_operations(&schemas, &principal, ids)` checks these
mappings for explicitly admitted IDs, then selects their families. Each family
descriptor retains its published schema union. Request preparation separately
checks the family and the root plus every ordered child against host admission.
Mapping and schema coverage establish no runtime admission. The current host
still admits exactly 20 Atlas get/history operations.

The full stock envelope is passed as tools/call arguments. Shared `StockRequest`
and domain `ValidatedRequest` preserve intent, omissions, explicit nulls, numeric
tokens and ordered children. Requirements are native values; `atlas.asset.download`
uses the existing access-owned `ReadAssetManifest` capability. The actual owner
remains responsible for its complete captured authority and disclosure graph.

`NativeStockService::new(authority, preparer, queries, commands)` calls real
stock preparation and dispatch through existing domain ports. Witnesses and
graphs remain owner types. No mutex guard crosses await. The actual command owner
supplies mutation fencing. `UnavailableCommands` returns `OwnerUnavailable`.
Rendering validates the released result using shared `StockResponse`, preserving
the envelope and children and mapping its Error arm to MCP `isError`.

## Independent asset download codec

`AssetDownloadRequest::parse(validation, raw)` accepts only the canonical closed
`atlas.asset.download` request. `AssetDownloadResult::parse(validation, request,
raw)` accepts its correlated completed read and retains output obligations.
Borrowed `AssetDownloadMetadata` exposes `downloadToken`, nullable `sha256`, the
original `byteSize` Number, `contentType` and `disposition`. The wire is unchanged;
numeric tokens are not converted through an integer DTO. Parsing releases nothing.

The canonical result supplies a UUID download token and metadata. This codec
adds no URL, URI, bytes, expiry, filename, storage key or new download alias.
An owner-issued token is not a redemption grant.

`AssetDownloadPort<P, W, G>::download(&mut self, &P, &PreparedRequest<W, G>,
&AssetDownloadRequest)` is implemented by the actual download owner. It receives
the original borrowed principal and prepared witness/graph and returns the
complete unreleased `OwnerResult`. `AssetDownloadCodec<D>` implements the existing
query port for this operation, validating its response and preserving canonical
correlated stock errors. Domain dispatch still authorizes the result and exact
target and revalidates before release. `UnavailableAssetDownloads` explicitly
returns `OwnerUnavailable` without issuing a handle.

`NativeQueries::new(existing_queries, download_owner)` composes the codec with
the host's query owner. Only typed `AtlasAssetDownload` selects the download port;
every other query reaches the existing owner. The integrator can inject this
composition into `NativeStockService` or existing domain dispatch. Actual token
issuance/redemption, media lifecycle and qualified route admission remain owner
inputs. They are not implemented or mounted by this patch.

## Protocol and dependencies

MCP revision is `2025-11-25`. Tools-only initialize/initialized, ping, list and
call use a host-framed serialized session, closed on IO shutdown. Notifications
emit no response. Defaults are 64 KiB input, 1 MiB output, 4,096 requests and
1 MiB retained request-ID text. Oversized messages close/drop before parsing or
peer dispatch. Request IDs, duplicate keys and nesting are bounded. The RawValue
decoder retains arbitrary-precision Numbers and literal object keys.
Parameter extraction copies decoded application maps.

Public errors use static categories. Generic failures without an owner DTO are
text-only `isError: true` results and omit structuredContent. Structured errors
require the owner's validated DTO and complete correlation plus current authority.
Annotations establish no authority. Error branch qualification remains deferred.

No dependency, manifest or lockfile changes are needed. Compilation uses the
published workspace's pinned dependencies and Rust/Cargo 1.99.0, including
`serde_json = 1.0.151` with `arbitrary_precision`, `float_roundtrip`, `raw_value`.

## Scoped healthy verification

Production library, binary and example source is compiled directly from the
repository. With the verified toolchain and task-owned Cargo cache/target
directory, the inspected scoped commands are:

```sh
cargo fmt --all --check
cargo check --locked --offline -p houseatlas-backend --lib --bins --examples
cargo clippy --locked --offline -p houseatlas-backend --lib --bins --examples -- -D warnings
HOUSEATLAS_AT38_SHARED_SOURCE="$HOUSEATLAS_MCP_SHARED_SOURCE" cargo test --manifest-path "$HOUSEATLAS_MCP_HARNESS_MANIFEST" --locked --offline --lib transports::mcp::healthy_ -- --test-threads=1
```

The published root test manifest currently omits `tokio-rustls` and `rcgen`
required by a provider fixture. The external harness imports the actual backend
`src/lib.rs`, preserves production dependency pins/features and captured lock
versions, and adds only `tokio-rustls = 0.26.6` and `rcgen = 0.14.7` for that
fixture's compilation. The provider fixture is not executed. Harness manifest,
lock and exact logs remain outside Git; the integrator owns root reconciliation.
The caller supplies the harness manifest and published source directory variables
shown above; fixtures load schema resources from that explicit source directory.

The five existing protocol groups use explicit fixture application peers; their
mutation response is a published fixture, not executed persistence. The existing
native example exercises offline schemas, original principals, SQLite bootstrap,
native storage and core reads for published synthetic evidence and actual empty
history. It does not execute a stock write.

The finite mapping example verifies all 164 joins, ten families and unchanged
host admission. Two download examples preserve canonical metadata and `1.0`/`1e0`
tokens from constructed, schema-validated Values; these checks do not qualify
ingress spelling preservation. They demonstrate real domain preparation/dispatch
with explicitly fixture authority, preparer, read and download peers. They check borrowed principal/
prepared/witness/graph identity and post-owner disclosure and final revalidation
order. Fixture tokens are synthetic values; these examples do not qualify a
production issuer, redemption path or authority owner.

Lifecycle examples and stopped rejection/guard-reversal/mutation-omission/
adversarial/fault/crash/concurrency/denial/negative-consumer controls and legacy
broad aggregates are not executed. No listener, provider, OAuth grant, private
data, deployment or mounted download admission is involved. Exact source and
check results are captured in the external task handoff for the integrator.
