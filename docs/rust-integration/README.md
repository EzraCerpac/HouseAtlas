# Rust React first slice

This development composition starts from published base
9f7561d99e09a680ec5282ca0c8aed4e10c6cbc9. It runs the actual Rust HTTP
binary, bundled SQLite, access sessions, authorized domain room/item queries
and compiled React UI. Local composition supplies no module acceptance or
main merge.

Pinned module inputs:

| Module | Exact head |
| --- | --- |
| Baseline contracts correction | dac410e22f63a231118f513a0a565093e0836213 |
| Access | 3f83d8f35f2cc1948b5d361badfc77948745676d |
| Domain and jobs | b4ead12aa65fe97772131eba698603a3323282a8 |
| Storage | d4a94d230da3f098eefaa846bf73f389f9d9965e |
| Corrected React | f491bf1bc2c8ac2af2f004f9aac99b9368dda7d6 |

Feature namespaces retain their owner bytes. Integration owns manifests,
locks, module declarations, app/config/http/lifecycle/main, source checks
and publication integrity reconciliation. Existing JS sources remain references
and keep their existing ordinary verification lane; the Rust application invokes
no JS contract oracle, synthetic principal or fake read facade.

## Runtime

The binary accepts explicit disposable settings only. It binds IPv4 loopback
with actual TLS, verifies request Host against the bound origin, and passes the
actual method, URL and headers to access. No forwarded scheme is trusted.
The frontend HTML receives the route attributes already defined by the UI
host contract; the UI-owned source and index remain unchanged. Vite builds
the actual application and bundles React.

Offline fixture setup creates a new directory under /tmp, provisions one
disposable viewer through the real access API, issues a real salted-scrypt
verified session and persists only its normal session digests. It supplies no
HTTP login/provisioning route or real account, grant, provider credential or
deployment configuration. A private mode-0600 smoke receipt transfers the
issued Secure/HttpOnly/Strict cookie to the disposable browser. Both access
and record databases reopen before the first HTTP read.

The fixture is a copy of the published plan-free example narrowed to one
HomeBox partition, six records, two projections and one cache. Its copied
accepted location annotation explicitly becomes room; no name or tree-depth
inference is used. The item stays unplaced. Original fixtures are unchanged.
Original source/retrieval dates remain intact and the actual clock makes old
cache information stale.

Read requests use the actual opaque access principal. Storage checks the home,
source partition and each entity. The request retains branded partition/entity
grants and domain release revalidates those same handles with the session and
membership. Reads execute synchronously inside blocking tasks and storage
transactions. They perform no source refresh, collector demand or provider call.

Native contract validation supports the restricted HomeBox identity/evidence/
binding/location-semantics graph, including scoped references, permanent IDs,
source partition disjointness, evidence supersession, accepted classifications,
binding reservations, explicit entity kinds, qualified parentage, cache generation
dates and native route scope. Frozen JSON Schema validation precedes decoding.
Unsupported graph families and every command/asset peer return unavailable;
no mutation or media route is mounted. RFC 8785 serialization uses pinned
serde_jcs 0.2.0.

The domain and frontend wire proposals differ. Integration maps the qualified
domain SourceRef to React's compact four-part source-key string. The corrected
React successor accepts site/other/archived and native view intent. Aliases and
Network lists are absent in this restricted graph, mobility stays unknown,
and media URLs remain null because no capability is issued. Home choices contain
only workspaceId, homeId and label after real authorization.

Actual GET routes are /api/atlas/view, /api/atlas/rooms, /api/atlas/items,
/api/atlas/homes, /api/atlas/auth/session and
/api/atlas/homes/{workspace_id}/{home_id}/view. Responses use no-store.
These extensions implement this development slice and do not rewrite the
published canonical OpenAPI/history contract.

## Ordinary verification

Inspect the named script bodies first. Use Rust 1.99.0 with rustfmt/clippy,
Node 26.10.0 and npm 11.19.1:

    npm ci --ignore-scripts --no-audit --no-fund
    npm ci --prefix packages/contracts --ignore-scripts --no-audit --no-fund
    npm ci --prefix frontend --ignore-scripts --no-audit --no-fund
    export CARGO_TARGET_DIR=/tmp/houseatlas-at52-target
    npm run verify:publication
    node tools/rust-integration/check-source.mjs
    HOUSEATLAS_BINARY="$CARGO_TARGET_DIR/debug/houseatlas" node tools/rust-integration/healthy-loopback.mjs

check-source compiles the actual library, binary, modules and strict TS React
source, runs rustfmt/Clippy with warnings denied, and runs only the two named
baseline examples. healthy-loopback creates disposable TLS files, uses a real
Chromium browser over a debugging pipe, injects the actual issued session cookie,
reads five authorized endpoints and the scoped view sequentially, displays room/
item details, inspects real SQLite row counts read-only, then gracefully stops
the server and deletes disposable state. Optional HOUSEATLAS_SCREENSHOT and
HOUSEATLAS_EVIDENCE outputs must stay outside the source checkout.

The strict publication verifier still checks the full file allowlist, modes,
digests, ownership and unchanged unconfigured deployment template. New CI
compiles exact PR-head source on Linux and macOS; Linux additionally runs the
same positive loopback smoke. macOS CI compilation is distinct from the
target NAS macOS build/runtime and operational qualification.

## Remaining work

Paired serde_json arbitrary_precision and jsonschema arbitrary-precision
features are selected, plus float_roundtrip required by the Network proposal.
Generated numeric tokens preserve backend input better; JavaScript numbers,
storage/domain fixed integer carriers, scientific exponent arithmetic and
ECMAScript canonicalization still have the disclosed limits in
../rust-baseline/numeric-semantics.md. Full unbounded-number fidelity is
unqualified. No large-number or negative-consumer probe is run here.
The consumed storage checkpoint also rejects some schema-valid integer JSON
spellings such as schemaVersion 1.0, revision 1e0 and byteSize 16.0; its owner's
correction is pending. This finite fixture uses ordinary integer spellings and
does not qualify that wider DTO/storage/Network compatibility.

The portable stock.2 wire3/catalog/provider-policy and source-presence
witness/qualification inputs were inspected with all supplied file hashes
verified; their Atlas schema is byte-identical to this repository. Wider
specifications are now available. Shared generation and feature adoption
remain with their owners; private transfer metadata is outside Git.

Missing product implementation includes native mutation/guard/result validation,
atomic presence witness admission and recovery, trusted cache publication,
HomeBox command preparation and durable exclusive dispatch, Network projection,
actual immutable media, aliases/mobility/navigation modules, agent/MCP/AI
transports, full auth/home generated DTOs, recovery/export tooling and complete
product routes. This slice supplies no JS database migration/adoption. Presence
admission remains held. The provided specifications do not enable provider,
AI, source credentials, real grants, paid usage or deployment.

Stopped guard reversal, omission/mutation controls, adversarial/rejection,
replay, expiry, revocation, failure injection, crash and concurrency checks
remain unrun. In particular the jobs SQLite checkpoint exercises replay and
is not executed, despite its healthy filename. No broad Cargo/npm test alias
is added. Source and positive-flow results do not establish security, provider,
power-loss, target, recovery, actual-user/pilot or production acceptance.
