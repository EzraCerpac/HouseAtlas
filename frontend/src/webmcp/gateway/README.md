# Gateway browser tools

This component delegates task completion to injected application services. It
contains no operation names, gateway endpoint, authentication store or provider
implementation. It preserves the existing stock coverage and AI namespaces.

`mountGatewayWebMcp` registers only the intersection of actual bindings and
current host admission. Each `GatewayToolBinding` supplies the shared catalog's
`CatalogTool`, a `GatewayServicePort.execute(input, context)` and the owner's
`validateResult(result, input)`. Input parsing, output schema validation,
correlation, confirmation and business authorization remain with their owners.
The transport preserves the complete canonical result, including pending/error
states, instead of manufacturing a task success or receipt.

`GatewaySessionPort.getContext(snapshot)` supplies the existing
`AtlasSessionInfo`, generated `Scope` and admitted `toolNames`. These reach only
host execution/download ports. Update the snapshot revision and notify its
subscribers on login, rotation, scope or capability changes. Replacing bindings
requires a remount; keep all port objects stable between those changes.

`GatewayDownloadPort.resolve(name, input, result, context)` returns either null
or `GatewayDownload {href, filename: string | null, mediaType, label}` from actual host-issued
availability. The adapter accepts a same-origin absolute path; it constructs
no download URL and retrieves no bytes. The resolver owns current authorization,
expiry and the association with the confirmed result. Rendering the link is an
available user action, not a completed byte transfer. The canonical tool output
is unchanged; download metadata is separate presentation state.
AT38's codec at `ef09ee02cadd711c8f69603095ecfddd8645abf1` retains canonical
`atlas.asset.download` metadata (`downloadToken`, `sha256`, `byteSize`,
`contentType`, `disposition`). It contains no redemption path or filename.
The browser port preserves that complete wire result; its resolver must supply
the actual authorized path and may report a null filename. Null uses an empty
HTML download attribute, leaving naming to the owner's response/browser.
These codec mappings alone do not admit or activate download execution.

```tsx
import { GatewayWebMcpBoundary } from "./GatewayWebMcpBoundary.js";

<GatewayWebMcpBoundary sessions={gatewaySessions} bindings={gatewayBindings}
  downloads={gatewayDownloads}>
  {existingApplication}
</GatewayWebMcpBoundary>
```

This boundary renders the complete result and download action inside its own
acknowledged React subtree. Execution resolves after the layout commit. Stock
and gateway use `useCommittedResult` for the same acknowledgement lifecycle.
Each effect activation receives its own commit lease; a service call started
under an earlier mount cannot commit after the boundary reactivates. This is
coded and compiled; its delayed-call race qualification remains held and unrun.
Result state is keyed to the actual session/service/catalog/model-context inputs.
A replacement render omits the prior result and link before descendant layout
effects observe the new view, rather than waiting for passive effect cleanup.
Registration status uses the same input identity; a replacement view reports
inactive until its own handle publishes availability instead of inheriting the
previous catalog's registered status.
Registration lifecycle uses layout effects. Cleanup retires the prior handle
and registration signal before replacement child layouts or paint; setup keeps
the adapter's queued registration and independent execution lifetime. This
addresses PR100 discussion4210160105 as well as displayed availability.
The healthy sequential example observes an empty synthetic registry in that
first child layout. Invocation races/negative consumers remain held and unrun.
Both boundaries subscribe to the existing session state/revision through
`useSyncExternalStore`; changing a revision on a stable port also changes the
view identity. A host that publishes its facade in a parent layout effect must
add `renderIdentity` known before rendering changed session/scope/admission.
This opaque non-secret value flows through `CommandCoverageBoundary` as well.
For `StockApplication`, the app owner must supply a memoized render-context key
including session, selected scope and admission/revision before `facade.publish`.
If selected scope is discovered only by a child's layout callback, the owner
must invalidate admission or supply the future scope key before that child's
changed view commits. A subscription cannot infer a future parent publication.
AT39 does not edit the app leaf; this exact input remains a root/app integration
dependency, separate from the compiled browser component.
Registration-only failure keeps already-running calls' result presentation;
an explicit view clear settles discarded acknowledgement tickets with a view
error. Neither action reverses domain work. Partial-registration failure/race
qualification remains held and unrun.
The host must unmount the boundary if its enclosing view fails to render. One
document owner coordinates disjoint tool names across stock, gateway and AI;
this component does not take over those other registrations.

The published base `a16f9a55e5beab5348aa00a2675a0e03c9aef98b` provides no exact
gateway catalog/DTO/schema, admitted gateway service list or download resolver.
Those are explicit integration inputs. The native stock host already mounts
its own genuine admission/schema/dispatch ports; this gateway component neither
replaces that host nor broadens Atlas family support to HomeBox or Network.

Healthy `healthy.tsx` uses the unchanged first native stock request/result
fixture and shared offline schema through injected synthetic gateway peers.
The `fixture_gateway_*` names exist only in the example. Six check groups
verify admitted/bound registration, canonical DOM completion, an issued
synthetic download link visible before return, normal sequential reactivation
after earlier executions finish, stable-port revision changes and explicit
render identity before parent-layout publication, and unmount cleanup. No export
job, byte transfer, provider call, listener or live browser registration runs.
Strict source compilation passes. The original four stock DOM groups and six
adapter/history checks also pass after acknowledgement extraction.

Tests use the existing frontend dependency lock and an external pinned harness:
React/react-dom 19.3.0, TypeScript 7.0.2, Ajv 8.20.0/ajv-formats 3.0.1,
jsdom 30.1.2 and esbuild 0.28.2 under Node 26.10.0/npm 11.19.1. Held denial,
revocation, rejection, mutation/omission, adversarial, fault/crash and concurrency
controls remain unrun. Healthy compilation and synthetic examples do not
qualify a deployed gateway, provider or real browser lifecycle.

The current [WebMCP draft](https://webmachinelearning.github.io/webmcp/)
and [Chrome imperative guidance](https://developer.chrome.com/docs/ai/webmcp/imperative-api)
were read for this component. Registration cleanup remains separate from
execution cancellation; cancellation does not reverse committed service work.
