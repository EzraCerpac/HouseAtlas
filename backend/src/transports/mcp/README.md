# HouseAtlas MCP adapter — AT38

This component implements an embeddable tools-only MCP protocol boundary. It is
source for the Rust modular monolith, not a separate crate, service framework or
mounted transport. The only source namespace changed is
`backend/src/transports/mcp/`. The checkout/branch is `codex/rust-at38`, based on
published `EzraCerpac/HouseAtlas` commit
`9f7561d99e09a680ec5282ca0c8aed4e10c6cbc9`.

## Implemented protocol behavior

`McpAdapter::open(trusted_context)` creates a serialized session.
`handle(&mut session, complete_json_bytes).await` returns optional response bytes;
notifications return no response. The host owns actual framing and IO.

The implemented protocol revision is explicitly `2025-11-25`. Initialization
selects that supported revision, records client implementation/capabilities as
untrusted descriptive data, and advertises only `tools: {}`. A subsequent
`notifications/initialized` transitions to ready. Ping returns an empty result.
Ready sessions map `tools/list` and `tools/call` through the ports below. The host
calls `Session::close()` on transport shutdown. MCP defines no shutdown method.
See the primary [lifecycle specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)
and [tool messages](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).

The adapter parses one message object, accepts string/integer request IDs,
tracks used IDs for the session, and bounds message bytes, response bytes,
request count and retained ID bytes. Duplicate JSON keys are detected recursively
before constructing a JSON map; canonical peers therefore never receive a
silently overwritten command. Default serde_json nesting bounds apply. Defaults
are 64 KiB input, 1 MiB output, 4,096 requests and 1 MiB retained ID text. The host
reconnects when the request/ID bound is reached. `AdapterConfig` validates enough
response capacity for a maximum-size request ID and server information.

Request/call shape failures map to JSON-RPC errors. Canonical public tool failures
map to `isError: true`; peer failures use static public messages. An optional
owner-sanitized error object preserves canonical public metadata unchanged.
Raw provider/database/authentication error text is never accepted from a peer
error conversion. Revalidation happens after awaited execution and before
returning protected success or public tool failure content. None of the coded
rejection or error paths has been qualified by negative controls in this lane.

Text results and structured results contain the same serialized object.
Object application DTOs remain intact. A bare history array is kept unchanged
inside an MCP-only `{"data": [...]}` object because `structuredContent` requires
an object. This does not change the canonical service result or the HTTP history
sidecar. The catalog output schema must describe this MCP wrapper; array order,
nulls, unknowns, provenance, revisions and receipts are preserved.

## Typed integration proposal

`ports.rs` supplies three narrow generic ports. Their concrete types and all
domain/access rules belong to the canonical Rust peers:

| Port | Responsibilities |
| --- | --- |
| `PrincipalPort` | `Context`, opaque nonserializable `Principal`, and typed `Requirement`; resolve a catalog principal, authorize the requirement from the trusted context, and revalidate current authority. |
| `CatalogPort<Principal>` | List currently authorized descriptors/pages; map a declared tool name plus argument object to `PreparedOperation<Operation, Requirement>`; render the canonical `Output` DTO. |
| `ServicePort<Principal, Operation>` | Execute the typed operation under its freshly authorized action-bound principal, returning the catalog's exact `Output` type. |

Every call resolves a fresh catalog principal, prepares an operation, asks the
access peer to authorize its typed scope/action requirement, executes under the
new action-bound principal, renders the result, and revalidates before release.
The adapter does not promote the catalog/read principal into mutation authority.
The catalog must resolve calls against its authorized surface even if the client
has never listed tools. Discovery cursor creation, validation and principal/scope
binding belong to the catalog peer.

`Context` is fixed when a host opens the session. No principal, actor, session,
grant or authentication authority comes from clientInfo, capabilities, `_meta`,
tool arguments or annotations. Canonical service/access/storage peers enforce
current scope/action/source authority, domain validation, record existence,
transaction fencing, guards, revisions, receipts, audits and source-presence
holds. Principals have no Clone/Serialize bound and are never cached by the
adapter. Annotations are descriptive hints only.

These boundaries follow the published
[future agent command constraints](../../../../docs/coordination/agent-write-amendment-proposal.md),
[opaque principal rules](../../../../packages/access/README.md), and
[history contract](../../../../docs/contracts/history/http-history.v1.1.0.md).
The legacy JS implementation is behavior reference; the adapter does not invoke
or copy its service/storage framework.

Proposed application catalog names mirror the seven published HTTP operations:
`atlas_get_record`, `atlas_list_records`, `atlas_list_homebox_entities`,
`atlas_list_network_relations`, `atlas_record_history`, `atlas_mutate_record`,
`atlas_mutate_batch`. Production names/schema definitions are supplied by the
catalog owner. The adapter is generic over operations and does not hardcode this
domain list. Three names appear only in synthetic peer examples.

AT51 can mount the module with `pub mod mcp;` in its owned transports module and
provide these dependencies in its owned manifest:

```toml
serde = { version = "=1.0.228", features = ["derive"] }
serde_json = "=1.0.145"
```

No async runtime dependency is needed by this component. `PortFuture` uses
standard boxed Send futures; the host supplies its selected runtime. Any shared
pin changes need AT51 reconciliation. This lane does not edit manifests, locks,
generated contracts, router scaffolding or migrations.

## Exact verification scope

An external task-owned compiler harness resides at
`/tmp/houseatlas-at38-harness`. Its `lib.rs` imports the real repository module by
absolute path and forbids unsafe code; it does not substitute adapter source.
It has the exact dependencies above and an external lockfile. Compilation uses
Rust `1.99.0 (b940084d7 2026-09-28)` / Cargo `1.99.0 (5f94df478 2026-08-27)`.
The first dependency resolution downloaded public crates.io packages; all
subsequent verification uses the locked offline task cache. Runtime setup lives
outside the source checkout in `/workspace/.houseatlas-setup/rust-react-sqlite`.

The inspected, authorized scoped commands are:

```sh
source /workspace/.houseatlas-setup/rust-react-sqlite/activate.sh
rustfmt --edition 2024 --check backend/src/transports/mcp/mod.rs
CARGO_HOME=/tmp/houseatlas-at38-cargo cargo check --manifest-path /tmp/houseatlas-at38-harness/Cargo.toml --locked --offline
CARGO_HOME=/tmp/houseatlas-at38-cargo cargo clippy --manifest-path /tmp/houseatlas-at38-harness/Cargo.toml --locked --offline --lib -- -D warnings
CARGO_HOME=/tmp/houseatlas-at38-cargo cargo test --manifest-path /tmp/houseatlas-at38-harness/Cargo.toml --locked --offline --lib mcp::healthy_examples:: -- --test-threads=1
```

`healthy_examples.rs` contains exactly four healthy groups: lifecycle/ping/host
close, paginated discovery under a freshly resolved principal, record plus
mutation fixture mapping under distinct action requirements, and empty/recorded/
tombstone history forwarding in the supplied order. The peer types are explicitly
synthetic. The fixture service returns existing published JSON; it implements no
mutation or access evaluation and does not open a store. Canonical schemas are
read unchanged for the synthetic catalog descriptors, with a local history item
reference adapted to the MCP wrapper. No schema-validation execution is claimed.

Fixtures read directly from the published tree:

- `packages/contracts/schemas/atlas.schema.json`
- `packages/contracts/fixtures/create-circuit.mutation.json`
- `packages/contracts/fixtures/create-circuit.result.json`
- `packages/contracts/history/http-history.v1.1.0.schema.json`
- `packages/contracts/history/fixtures/empty.audit-array.json`
- `packages/contracts/history/fixtures/recorded.audit-array.json`
- `packages/contracts/history/fixtures/tombstone.audit-array.json`

Compilation, lint and these healthy examples establish only this component's
source compatibility and mapping behavior with stubbed peers. Guard reversal,
mutation/omission controls, adversarial, fault, crash, concurrency, denial and
negative-consumer checks remain deferred and unrun. No legacy broad aggregate
was executed.

## Integration inputs and remaining work

This public base has no generated Rust domain DTOs, accepted MCP catalog, trusted
transport context/principal implementation or shared backend scaffold. Those
exact inputs are required for integration and intentionally remain peers:

- AT51's canonical Rust operation/result and authorization-requirement types.
- AT11's opaque context/principal and current authorization/revalidation wiring.
- The catalog owner's approved tool names, self-contained schemas, current
  visibility rules, page bounds and discovery cursors.
- AT51's selected protocol revision, dependency pins and module mount.

The host also owns admission, audience/route/origin checks, transport deadlines,
framing and a safe service-owned policy for uncertain/cancelled mutations. This
adapter handles messages sequentially; await an in-flight write to completion.
It advertises no task execution, list-change notifications, resources, prompts,
subscriptions, sampling, progress or streaming capability. Host lifecycle and
deferred qualification are required before exposing a transport.

Implementation and scoped checks used no socket/listener, live OAuth grant,
credential, provider call, deployment or private data/history. Subsequent review
delivery is limited to the parent-authorized branch-only push and draft PR.
No merge, deployment or live acceptance is authorized by that review delivery.
