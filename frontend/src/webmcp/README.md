# Browser tools

AT39 owns only this directory. The public base is
`9f7561d99e09a680ec5282ca0c8aed4e10c6cbc9`; the isolated branch is
`codex/rust-at39`. No root manifests, locks, generated contracts or existing
JavaScript modules are changed.

`startWebMcp` binds an injected shared catalog to a structural
`ModelContextPort.registerTool`. `detectModelContext` feature-detects a supplied
Document. Importing any of these modules registers nothing. The host explicitly
starts the adapter or mounts `useHouseAtlasWebMcp` from `react.ts`. That hook
returns registration status and cleans up its subscription and registrations.
Use one host owner for a document and keep injected ports stable between renders.

The shared catalog supplies names, descriptions, schemas, annotations and input
parsing. It must distinguish reads, navigation/start, staging and completed
actions. This directory adds no production tools, schemas, access policy,
provider commands, HTTP client or domain mutations. Annotation hints are copied
as metadata; they grant no authority.

The application service receives the shared parsed JSON object and a non-secret
session revision plus execution signal. It must revalidate the current server
session and selected workspace/home, and retain Origin/CSRF, revision, audit and
receipt requirements. It must produce public JSON results/errors. Actor and
home authority never come from tool arguments or this adapter's revision.

Successful executions copy the service JSON result, await `VisibleResultPort`
and return the original JSON shape/order after that port confirms its UI commit.
The view receives a separate copy. History remains a bare array; no sorting,
envelope, generated prehistory or DTO field removal is introduced.

The host session port must change its revision on login, logout, rotation,
selected scope or catalog availability change. It must synchronously notify
subscribers when that context changes. Signed-out contexts expose no tools.
Same-revision notifications leave registration in place. Changes unregister the
previous catalog and separately abort the previous session's execution scope.
Caller execution signals are forwarded in that scope. Unmount unregisters tools
without cancelling an already-started execution, matching the current WebMCP
lifecycle distinction. Cancellation does not undo committed service work.

Unsupported contexts, session/catalog failures and synchronous or asynchronous
registration failures have explicit statuses. A partial failed registration
aborts its whole registration signal. These failure branches are coded but not
qualified by the healthy examples. Status observers must not throw.

## Shared interface proposal

`ports.ts` defines transport-only structural ports, pending reconciliation with
the shared catalog/service owners and AT51 generated types:

| Port | Required input from its owner |
| --- | --- |
| `ToolCatalogPort.toolsFor(session)` | Authorized catalog snapshot with canonical names, JSON object schemas, annotations and shared parsers |
| `ApplicationServicePort.execute(name, input, context)` | Typed application transport that verifies actual current authority and returns JSON |
| `SessionPort.getSnapshot/subscribe` | Current authenticated/signed-out state and non-secret context revision |
| `VisibleResultPort.apply(name, result, context)` | Matching React store/view update that resolves after visible commit |

The exact catalog export, operation-name/type map, generated DTO module paths,
authorized application transport export, session-store export and view commit
acknowledgement are absent from the pinned base. Replace or adapt these structural
ports when those owner inputs arrive. No production peer is stubbed in shipped
code; synthetic peers exist only in `healthy.examples.mjs`.

## Guidance reviewed

Reviewed on 2026-10-06:

- [WebMCP draft, 2026-10-02](https://webmachinelearning.github.io/webmcp/)
- [Chrome imperative API, updated 2026-09-21](https://developer.chrome.com/docs/ai/webmcp/imperative-api)
- [Chrome overview, updated 2026-10-01](https://developer.chrome.com/docs/ai/webmcp)

The implementation uses `registerTool(tool, { signal })`, optional execution
`options.signal`, shared annotations including `consequentialHint`, and feature
detection. It adds no cross-origin exposure, browser flags, origin-trial tokens,
declarative tools, extension calls or account changes. The structural subset
avoids conflicting global DOM declarations while the proposed standard evolves.

## Authorized healthy verification

The task-owned external harness is
`/workspace/.houseatlas-at39/harness`. Its exact registry pins are TypeScript
7.0.2, React 19.3.0 and `@types/react` 19.3.0. These are scoped compiler harness
pins, not edits to AT51's application dependency decisions. The harness lock,
compiler configuration, emitted source/declarations and logs stay outside Git.
Strict compilation also enables `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, unused checks and isolated modules.

From the harness directory, with its pinned dependencies installed:

```sh
source /workspace/.houseatlas-setup/rust-react-sqlite/activate.sh
npm ci --ignore-scripts --no-audit --no-fund
./node_modules/.bin/tsc --project tsconfig.json --noEmit
./node_modules/.bin/tsc --project tsconfig.json
HOUSEATLAS_AT39_BUILD=/workspace/.houseatlas-at39/harness/dist node --test --test-concurrency=1 /workspace/HouseAtlas/frontend/src/webmcp/healthy.examples.mjs
```

Inspect this example file before execution. It names exactly six healthy checks:
supported port registration, three published history examples, sequential
session selection and sign-in/sign-out availability. It uses unchanged
`packages/contracts/schemas/atlas.schema.json` recordRef definitions,
`packages/contracts/history/http-history.v1.1.0.schema.json`, all three valid
history fixtures and their contexts. Ajv 8.20.0 and ajv-formats 3.0.1 come from
the existing published contracts lock. No legacy test aggregate is invoked.

The examples run compiled adapter code and schema validation with synthetic
browser/service/session/view ports. The React hook is actually typechecked and
emitted; it is not mounted in a browser. Rust/SQLite service composition, real
React commit acknowledgement, HTTP/session integration, browser compatibility
and live registration remain later integration work. No provider, listener,
credentials, grants, private data or deployment is used.

Rejection, guard reversal, mutation/omission, adversarial, fault/crash,
concurrency and negative-consumer controls remain explicitly deferred and unrun.
Healthy results certify only these listed source and synthetic scopes.
