# AT42 AI component

This is an embeddable component for the Rust modular monolith. AT51 supplies the
application crate, generated contracts and dependency locks. This namespace
supplies orchestration and narrow adapters; it creates no listener, second
command service, database queue or live credential/runtime configuration.

## Implemented behavior

`AiRunner::run/resume` accepts current opaque server authorization context.
Every round checks the active account, direct inference permission, eligibility,
independent paid-use admission and a qualified available runtime. Sign-in cannot
approve spending or start inference. Three runtime candidates remain distinct:
local sign-in helper, issued website client and local inference companion.
Actual runtime selection defaults unset/held. Companion availability and mobile
relay require a deliberate later choice and qualification.

`StockCatalog` projects the shared stock `0.3.0-at34.stock.2`, wire3, across ten
original families and 164 retained command metadata entries. Authorized tool
schemas come from the shared generated validator. Each call is prepared and its
exact command arm/effect resolved individually, including label render/print.
Reads and reviewed writes cannot be dispatched through each other's method.
Captured scope and outer result schema version, command/request IDs, resolved
scope and supplied intent digests are correlated before model disclosure.
Committed Atlas receipts also require `data.requestDigest` equality. Full schema,
resource graph authorization and canonical digest construction remain shared
service responsibilities, rather than a competing AI implementation.

Before any call in a mixed review round executes, the host retains ordered
history and opaque prepared handles. A separate trusted human UI owns approval;
`resume` accepts only request/continuation IDs and atomically claims the scoped
host checkpoint. Dispatch rechecks authority, epochs, immutable intent, impact
and receipt through the shared service and its existing durable dispatcher.
Prepared/queued/dispatching/partial/unknown work stays held. Each reviewed
observation must be retained by `UsagePort::domain_observed` before processing
continues; later typed failures carry earlier operation IDs.

`ResponsesRequest` uses the public endpoint, explicit complete history,
`store:false`, `stream:true`, namespaced functions and unchanged shared schemas.
`ResponsesAdapter` serializes bounded requests and incrementally decodes bounded
SSE with a supplied I/O deadline. Completion requires `response.completed` and
completed status. Ordered reasoning, function calls and assistant phase survive
continuation. Credentials stay in the injected transport; no token getter exists.
For a no-tool round, completion also requires nonblank accepted output-text or
refusal content. A completed stream containing no accepted answer is a typed
`InvalidProviderOutput` failure, retaining observed usage and earlier operation
IDs. Accepted text/refusal formatting and tool rounds remain unchanged.
Known HTTP/terminal failures retain sanitized structured diagnostics. Local
protocol/limit failures after submission remain unresolved inference. Connection
or catalog errors are typed failures, including `ProviderUnavailable` from those
stages; only unresolved inference produces `UnconfirmedRun`.

`OAuthLifecycle::begin/complete/refresh/disconnect` orchestrates documented local
OAuth through injected security, provider and encrypted storage boundaries. It
uses fresh state/nonce/PKCE-S256 material, exact loopback callback URI reuse,
callback-issued client retention, identity/audience/nonce validation and granted
direct scope. Website identity support remains distinct from plan-use access.
Per-registration leases, authority/cancellation binding, persisted refresh
invocation/rotation checkpoints and atomic encrypted writes prevent orchestration
from blindly replaying consumed refresh tokens. `RefreshCheckpoint::ExchangeReceived`
also retains the received token reply, original nonce, issued client and exact
binding before identity verification. It is non-active encrypted material, not
an inference credential. Temporary verification unavailability preserves this
checkpoint. `verify_received_exchange` and explicit `refresh` can verify it
using its original receipt time without exchanging a code or refreshing again;
activation revalidates the original binding and preserves identity matching.
A new authorization launch cannot overwrite an unresolved checkpoint.
Disconnect stops local use and distinguishes confirmed from unconfirmed
revocation. For a pending exchange it attempts revocation of both renewable
sessions when older credentials also exist. Each confirmed session is retired
independently and persisted before another revocation await. Only unconfirmed
material remains encrypted and non-active for a later explicit disconnect,
including an older-only remainder after the exchange session was retired.
New authorization cannot overwrite disconnected retained credentials. Material
without a renewable token stays explicitly unconfirmed; no local abandonment
or cleanup authority is invented. No renewable token is invented for direct-only
or website identity replies.
No cryptography, encryption, live exchange or server transfer route is fabricated.

Cancellation requests and terminal confirmation remain separate. Usage counts
stay optional; no cost, plan quota or reset is invented. `runtime.rs` supplies
matching connection action, trusted human review and request-status DTOs, plus
model discovery and scoped bridge admission interfaces. A bridge must enforce
approved Origin/Host, per-install capability and actor/home/registration/epoch.
No bridge or listener is installed by these interfaces. Human review returns an
object `{status}`. Connection actions carry a pre-submission `actionId` and
original command; their separate status lookup echoes that ID without replay.
Workflow completion establishes no grant or runtime readiness.

## Integration boundaries

The host must bind AT11's current authority and cancellation epochs, AT51's
exact offline schema resources/generated DTOs, scoped model settings, credential
runtime, maintained cryptography/encrypted storage, continuation/request status
and shared command service. It must validate all result resources before
returning them to this adapter and retain physical-operation uncertainty/fences.
These concrete peers are not implemented or qualified here. The exact contract
inputs are available; their shared application binding is integration work.
The credential adapter must atomically encode/decode the new private checkpoint
variant. The host action journal must observe explicit verification completion
and terminalize the original connection action; no journal, callback route or
automatic verification polling is added in this original-module correction.

Only existing `serde = =1.0.229` (`derive`) and `serde_json = =1.0.151` are needed.
Ports use standard futures; no runtime/service framework or SQLite API is added.
The local four-MiB JSON default can be configured within bounded ceilings for
resolved stock tool schemas; the host and transport must reconcile their limits.

## Scoped evidence and limitations

The earlier source compiled with Rust 1.99.0 and two healthy examples. The
follow-ups compiled the actual source and passed seven healthy examples: existing
published synthetic records/history, browser DTOs, exact wire3 read boundary,
successful local OAuth begin/callback with and without offline access, actual
Rust-serde lifecycle projections, and chunked completed tool-capable SSE. Direct
scope alone requires access credentials; renewable credentials are required for
offline access or refresh exchange. Empty repeated disconnects and issue receipts
preserve existing revocation status; revocation probes remain held.
An additional healthy received-exchange fixture verifies its persisted identity
with the original nonce/client and activates credentials without any provider
exchange or refresh call. Unavailable verification, revocation, scope-unmount
and terminal-domain-held probes remain source-reviewed deferred qualification.
An external healthy binding check consumed the Rust projections through the
production TypeScript lifecycle adapter and deserialized an actual TypeScript
hook action request using the Rust request DTO. Both directions passed.
The four-definition `fixtures/stock-read-tools.json` is an exact narrow input
projection for those examples, not the production catalog. Historical fixture
peers preserve published behavior; the production bridge uses wire3 families.
All security, credential, catalog, storage and transport peers in examples are
explicit stubs. Their synthetic success establishes neither live eligibility nor
schema/security/provider qualification. Execution logs remain outside source.

Stopped rejection, guard reversal, mutation/omission, denial, replay, expiry,
revocation, adversarial, fault, crash, concurrency and negative-consumer controls
remain unexecuted. Broad legacy aggregates were not run. Actual login, grant,
models/inference, credential placement, deployment and listener access remain
held. Ordinary compilation and healthy examples are not acceptance.

## Input attribution

Application semantics use the supplied **HouseAtlas portable language-neutral
stock.2/wire3 inputs**, **Language-neutral cloud supplement semantics**, and
**Cloud-transferable write and AI integration policy**. Schema identity is
`urn:houseatlas:agent:stock:3`; frozen Atlas resources resolve offline at
`https://houseatlas.invalid/contracts/1.0.0/atlas.schema.json`, never by network.
Archive delivery metadata and private origin mappings are excluded from source.

Official references reviewed on 2026-10-06:

- [Registration/sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
  and [website identity](https://developers.openai.com/siwc/website).
- [Models/inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference),
  [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations),
  [errors/recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery).
- [Accounts/sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions),
  [usage UX](https://developers.openai.com/siwc/ui-ux-guidelines),
  [self-hosted VMs](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms).
- [Public DevKit pin](https://github.com/openai/sign-in-with-chatgpt-devkit/tree/f723814abdccec135b519c451fb6e1992ee5e933/packages/local/src),
  [function calling](https://developers.openai.com/api/docs/guides/function-calling),
  [reasoning context](https://developers.openai.com/api/docs/guides/reasoning).
