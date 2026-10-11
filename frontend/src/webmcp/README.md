# Browser tools

AT39 owns only `frontend/src/webmcp/**`. The original generic checkpoint
`3429a7c008a8e98dcaa4fdddffb15717e8e9a6f0` and its branch/PR remain preserved.
The current gateway successor starts from published main
`a16f9a55e5beab5348aa00a2675a0e03c9aef98b`, preserving its accepted stock
coverage and separate AI islands. No root, UI-owned, generated-contract or
dependency file is edited by this lane. See [gateway/README.md](gateway/README.md)
for its injected service, catalog, capability and download handoff.

`mountStockWebMcp` binds the stock wire3 catalog to `startWebMcp`.
`StockWebMcpBoundary` mounts it in React and returns browser results after a
layout effect acknowledges the rendered result subtree. Imports register
nothing. Use one host owner per document and keep injected ports stable.

## Shared contracts

`stock-schema.ts` imports the unchanged shared operation catalog, tool families
and agent schema from `contracts/stock-wire3/agent/`, plus
`packages/contracts/schemas/atlas.schema.json`. These are stock
`0.3.0-at34.stock.2` and `urn:houseatlas:agent:stock:3`.
Canonical family names are used verbatim. Host-admitted command IDs select
exact input arms. Reachable definitions are materialized into a self-contained
browser schema, with frozen Atlas references resolved locally. No schema fetch,
second domain schema or generated operation list is added. Annotation hints
reflect the selected metadata and grant no authority. Catalog dispositions
alone enable no operation.

`stock.ts` reuses generated `Scope` from `../api/generated/contracts.ts` and
existing `AtlasSessionInfo` from `../app/session.ts`. Its wire3 request/result
types are outer transport views, not generated 164-arm domain DTOs. Shared
validation owns full arm acceptance. Request IDs, command IDs, context, target,
payload, optional fields, nulls, receipts, outcomes and order remain intact.
Correlation compares request ID, command ID and resolved scope; it supplies no
business authorization.

## Precise host mount

```tsx
<StockWebMcpBoundary sessions={stockSessions} schemas={stockSchemas}
  service={stockDispatch}>
  {({ registration, completion }) => renderStockResult(registration, completion)}
</StockWebMcpBoundary>
```

Non-React hosts call `mountStockWebMcp` with `StockVisiblePort.commit`.
The boundary supplies that port itself, renders completion through its children
and acknowledges it after the subtree commits. The UI owner must consume
completion in that subtree; scheduling an unrelated asynchronous refresh does
not acknowledge its completion. An error boundary must unmount this boundary
if rendering fails. Signals/cleanup are coded, but held failure/concurrency
qualification remains unrun.

The stock host bindings are specific:

1. `StockSessionPort` exposes the existing current application-session DTO,
   selected generated Scope, host-admitted command IDs and non-secret revision
   subscription. Revise it on login/logout/rotation/scope or availability change.
   Current `StockApplication` supplies this context under `SessionApp`.
   No second browser authentication store is added.
2. `StockDispatchPort.dispatch(request, context)` preserves the entire caller
   envelope/request ID and verifies actual cookie authority, Origin/CSRF and
   application rules. Session data reaches only this host port, never browser
   tool metadata or result output.
3. `StockSchemaPort.validate(ref, value)` supplies the shared offline stock+Atlas
   validator for the exact fragments. The host now supplies the shared offline
   browser validator from `frontend/integration/stock-schemas.ts`.
   The adapter does not recreate its business semantics.
4. UI mounts the boundary and renders its canonical completion/status. Existing
   app/navigation source is unchanged.

The stock root now supplies envelope-preserving dispatch through
`frontend/integration/stock-dispatch.ts`, with genuine admission/schema ports
mounted by `frontend/integration/main.tsx`. `coverage/bindAtlasService` still
supports exactly three native Atlas families. Catalog IDs alone do not bind
HomeBox or Network services. Gateway bindings require their own actual catalog,
service, admission and download owners before root activation.

## Healthy checks

`npm run typecheck` in `frontend/` checks actual source and UI using the existing
lock: TypeScript 7.0.2, React 19.3.0, Node 26.10.0/npm 11.19.1, strict settings,
exact optional properties and unchecked index access. Inspect scripts and
exact examples before execution.

An externally supplied successor harness locks React/react-dom
19.3.0, jsdom 30.1.2 and esbuild 0.28.2. It bundles actual lane TS/TSX and `App`,
then runs `stock.healthy.tsx` in jsdom. Validation uses unchanged shared schemas
through published Ajv 8.20.0/ajv-formats 3.0.1. Four healthy groups check canonical
family/schema registration, exact `atlas.identity.get`, exact
`atlas.circuit.create` receipt, and React unmount. The first two native AT51
healthy fixture envelopes are unchanged. Dispatch returns those fixtures and
performs no mutation. Only the normal published UI fixture is prepared.

The checks prove actual DOM/layout-commit-before-return ordering, full envelope
preservation, existing-session handoff and offline schema compilation. The six
original adapter/history examples also pass against compiled successor code.
No old aggregate is invoked. Original harness/evidence remain unchanged;
successor source digests, source pins, locks/config and actual outputs are external.

Healthy frontend results do not qualify real browser or Rust/HTTP integration.
No browser account changes, grants, provider calls, listener, private data or
deployment occur. Rejection, denial/revocation, guard reversal, mutation/omission,
adversarial, crash/fault and concurrency controls remain deferred and unrun.

Guidance follows the [WebMCP draft](https://webmachinelearning.github.io/webmcp/)
and [Chrome imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api).
Registration cleanup and execution cancellation have separate signals;
cancellation is not a service rollback.
