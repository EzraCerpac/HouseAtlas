# HouseAtlas MCP adapter — AT38 native successor

Only `backend/src/transports/mcp/**` is owned here. This successor preserves
accepted head `55f06176af789077720fd291dd2427466c7e3ae3` and the sole publication
root `9f7561d99e09a680ec5282ca0c8aed4e10c6cbc9`. It opens no listener and supplies
no HTTP/OAuth mount, bearer authentication, provider client or domain framework.

## Native bindings

`NativeContext::from_principal(access::Principal)` accepts an already issued,
opaque AT11 principal. `NativePrincipalPort::new(Arc<Mutex<AccessBoundary>>)`
revalidates that original authority, checks the catalog's exact scope/capability,
and preserves the same handle. Context identity is retained through Arc handles;
read issuance is never promoted into mutation issuance. All mutex guards finish
before futures are returned. The host must supply an access-owned authenticated
principal seam: current AT11 read issuance accepts actual GET/HEAD evidence and
rejects bearer headers. Relabeling an MCP POST as GET is not such a seam.

`NativeSchemas::from_bytes(agent, atlas)` admits the exact published schema
resources by SHA-256, canonical IDs and draft2020-12 dialect. `schema(family_ref)`
produces object-root MCP descriptors with only their transitive local `$defs`.
Schema-valued keywords are traversed; const/default/enum/example payloads are
preserved. No schema URLs or files are fetched by production code. AT51 supplies:

- `contracts/stock-wire3/agent/agent.schema.json`: SHA-256
  `314ee5f5effca941b3be92cb5cc37150aa17a3ab5dd8646255cebc74767b602d`
- `packages/contracts/schemas/atlas.schema.json`: SHA-256
  `ef00707b251051da4157598833d4c91d15d01b73eebfa049daf8c52a2ff23806`

`NativeCatalog::with_admitted_operations(&schemas, &principal, ids)` selects
published stock families containing host-admitted operations. The host's qualified
owner composition supplies this admission scoped to the given principal; published capability disposition alone
never enables a route. The family descriptor retains its exact published union,
while `prepare` separately checks the selected family and the root plus every
ordered child command against host admission. The full stock envelope is passed as tools/call arguments without an
extra request wrapper. All ten family schemas are supported. Listing returns one
page; no cursor is issued. Hosts must keep selected descriptors within their
configured response bound. Read hints describe only admitted commands. The catalog retains the opaque
context handle and rejects use with another context; AT11 revalidates its current
authority before discovery and release. It cannot infer admission from roles.

Requests use the real shared `StockRequest` validator and domain
`ValidatedRequest`, preserving exact intent, omissions, explicit nulls, numeric
values and ordered children. Scope/capability requirements are typed native
values. `NativeOperation` and `NativeOutput` have private fields; callers cannot
construct an unchecked request or unreleased output. Rendering calls the shared
`StockResponse` validator, retains the exact envelope and correlated children,
and maps the owner's Error kind to MCP isError. Domain dispatch must already
have discharged authority and disclosure obligations before rendering.

`NativeStockService::new(authority, preparer, queries, commands)` calls the real
domain stock `prepare` and `dispatch` functions. Required peers are the published
`StockAuthorityPort<access::Principal>`, `StockPreparerPort`, `StockQueryPort` and
`StockCommandPort`. Witnesses/graphs remain the owner's types; the original
principal and unmodified wire reach them. The synchronous owner mutex introduces
no async runtime or second service architecture. `UnavailableCommands` explicitly
returns the domain OwnerUnavailable category. It cannot make a mock stock commit.
The host must supply mutation fencing inside its actual command owner and avoid
reentering a held access fence.

Remaining owner inputs: complete original stock authority witnesses and
resolved/prepared graphs, current full result disclosure, durable root/child
stock intent metadata and atomic receipt/admission composition, provider queue
qualification, nonempty stock-history metadata and opaque history paging. Native
frozen-command execution does not provide these stock write guarantees. They
remain unavailable until their owners supply them.

## Protocol and dependency reconciliation

MCP revision is `2025-11-25`; tools-only initialize/initialized, ping, list and
call use a host-framed serialized session. The host closes the session on IO
shutdown. Notifications emit no response. Oversized messages close/drop before
parsing or peer dispatch, preserving the accepted P2 correction. Defaults are
64 KiB input, 1 MiB output, 4,096 requests and 1 MiB retained request-ID text.
Request IDs, request shape, duplicate keys and nesting are bounded syntactically.
The RawValue decoder preserves arbitrary-precision number tokens separately from
literal object keys, including serde's similarly named internal number key.
Parameter extraction copies already decoded argument/capability maps directly
instead of re-deserializing arbitrary application values.

Public errors use static categories; raw database/access/provider errors never
become public messages. Generic failures without an owner DTO are text-only
`isError: true` results and omit structuredContent. Structured errors require an
owner-validated public DTO matching the advertised output schema, complete request/
scope and ordered child correlation, with disclosure authorized. Success and
public tool errors receive current principal release checks. Annotations never
establish authority. No negative/error branch qualification is claimed.

AT51 owns module mounting, manifests and lockfiles. Exact shared pins used here:
`serde = 1.0.229`, `serde_json = 1.0.151` with `arbitrary_precision`,
`float_roundtrip`, `raw_value`, and `sha2 = 0.10.9`. Existing peer compilation also
requires `jsonschema = 0.58.6` without network/default features and with
`arbitrary-precision`, `regex = 1.13.1`, `ryu-js = 0.2.2`, and
`rusqlite = 0.40.2` with `bundled` and `backup`. Other access/storage dependencies
are the peers' existing pins. No root manifest or lockfile changes are included.

## Exact healthy verification

External harness `/tmp/houseatlas-at38-native-harness` imports actual repository
MCP source plus untouched published source exports:

| Peer | Commit |
| --- | --- |
| Shared contracts | `49d4a0a84baf05b3e16b5bd31833ebd0786c6d4c` |
| Domain/native bridge | `f51bc7962b491faa1cc563f2ec0f737c471e4e26` |
| Access | `4967dd2d38c5749be35aa7e44728c4d691246730` |
| Storage | `9425ffc54e45d4ee779f3282e8dc29414676c7ad` |
| Core read composition | `915d9baae6710d23e29f34da488df1de493a2c0c` |

All peer ancestry roots were checked against the sole public base. No peers were
merged into this scoped branch. Rust/Cargo 1.99.0 compile source directly. The
harness's Clippy allowances cover imported peer modules only; warnings are denied
for MCP. Task cache and lockfile stay outside the repository.

Inspected scoped commands:

```sh
source /workspace/.houseatlas-setup/rust-react-sqlite/activate.sh
rustfmt --edition 2024 --check backend/src/transports/mcp/mod.rs
CARGO_HOME=/tmp/houseatlas-at38-cargo cargo check --manifest-path /tmp/houseatlas-at38-native-harness/Cargo.toml --locked --offline
CARGO_HOME=/tmp/houseatlas-at38-cargo cargo clippy --manifest-path /tmp/houseatlas-at38-native-harness/Cargo.toml --locked --offline --lib -- -D warnings
CARGO_HOME=/tmp/houseatlas-at38-cargo HOUSEATLAS_AT38_SHARED_SOURCE=/tmp/houseatlas-at38-native-peers/shared cargo test --manifest-path /tmp/houseatlas-at38-native-harness/Cargo.toml --locked --offline --lib mcp::healthy_ -- --test-threads=1
```

Five `healthy_examples` groups cover existing lifecycle/discovery/fixture calls/
ordered fixture history plus genuine number-token and literal-key preservation.
Their application peers remain explicitly stubbed; their mutation response is a
published fixture, not executed persistence.

`healthy_native_catalog_context_and_core_reads` builds all 20 family descriptors
entirely offline, checks descriptor byte bounds, validates native stock read/
history envelopes and current original-principal handling, and exercises actual
SQLite bootstrap → NativeStorage → domain Queries → native core access for a
published source-free evidence record and its actual empty audits. Private
synthetic session material stays in disposable memory and is not emitted in
source evidence. Exact payload/DTO preservation and correlated stock
representations are checked against native schemas. No fake stock authority,
preparer or NativeOutput release is constructed. Thus native read/core behavior
is exercised, while complete MCP stock execution awaits the owner seams above.

No listeners, endpoints, live OAuth grants, provider calls, private data,
deployment, merge, stopped rejection/guard-reversal/mutation-omission/adversarial/
fault/crash/concurrency/denial/negative-consumer controls or legacy broad test
aggregates are run. Healthy success does not qualify those deferred controls.
