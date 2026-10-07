# AT10 React integration

Base: published `EzraCerpac/HouseAtlas` commit
`9f7561d99e09a680ec5282ca0c8aed4e10c6cbc9`; local branch `codex/rust-at10`.
This lane changes only `frontend/src/app/**`, `frontend/src/styles/**`,
`frontend/src/api/client.ts`, `frontend/src/main.tsx` and `frontend/index.html`.

## Component and API proposal

`App` is a real React component. `AtlasClient` exposes only:

```ts
load(signal: AbortSignal): Promise<AtlasView>;
loadHome(scope: Scope, signal: AbortSignal): Promise<AtlasView>;
```

`types.ts` describes the proposed browser projection of the published schema.
`decode.ts` structurally decodes that projection and drops unrelated wire
fields. These are handwritten proposed frontend interfaces, not generated
contracts. AT51 should reconcile them with the canonical generated types.
The published OpenAPI does not define this authorized-view envelope.
No new history schema or history endpoint is introduced.

The Rust preparation seam must authorize the session/home before assembling
this envelope, emit only authorized home choices and entries, suppress source
quarantine evidence, and issue independently scoped native/media capabilities.
`ready` carries `scope`, `homeLabel`, `now`, `canEdit`, `homes`, `entries`, and
`caches`. Other statuses are `loading`, `unavailable`, `expired`, `revoked`, or
`denied`; their browser rendering contains no house names or choices.
The type declaration contains the complete field proposal.

`createAtlasClient({ bootstrap, home }, transport?)` accepts same-origin saved
view read routes supplied by the integration owner. It uses GET, same-origin
cookies, `cache: no-store`, abort signals and `redirect: error`. It sends no
source-refresh, mutation or collector request. HTTP 401/403 become session
states. Other unsuccessful responses retain the current view during reload,
or show an unavailable state during bootstrap/house switching.

`App` also accepts an already authorized `initialView`, a host `signIn`
callback, and an optional `accessEvents: EventTarget`. The host may dispatch
`CustomEvent('atlas-access-invalidated', { detail: 'expired' | 'revoked' })`
to cancel pending reads and remove the current private view. Other event
details produce the generic denied state. The browser never grants roles.
House changes use only the current server-supplied home list and remove the
old house while loading the destination.

`main.tsx` reads host configuration from `#root`:

- `data-bootstrap-url`: authorized current-house saved-view GET route.
- `data-home-url-template`: authorized saved-view GET route containing both
  `{workspaceId}` and `{homeId}`; substituted values are encoded.
- `data-sign-in-url`: optional same-origin sign-in handoff.

`index.html` intentionally supplies none of these unresolved routes. Missing
configuration displays the unavailable state. It never substitutes fixtures.
Actual Rust route names, envelope generation, session cookie lifecycle and
sign-in are peer integration work, not implemented or certified by AT10.

## Behavior and design

Rooms, arbitrary HomeBox place/container types, item details, document and
maintenance indices, model/document/alias search, archive display, and Settings
house selection are implemented. Place ancestry uses the qualified source
partition and recorded parent identity; it does not infer geometry. Unknown
types, absent parents, mobile placement, retained/deleted records, source
dates, stale caches, evidence qualifiers and missing file access are explicit.
Inventory fields are read-only. Editing uses verified native HomeBox links.

The enamel plate, limewash, cobalt, item-row, rating-plate and responsive
design is preserved. `styles/atlas.css` is an exact copy of the published
`web/src/styles.css`; React renders native JSX rather than importing the
legacy renderer/controller. English copy follows `web/AGENTS.md`. The reload
control explicitly reads saved information and does not claim a provider
refresh. Skip links, heading/document focus, labels, archive state, current
navigation and file fallbacks are implemented.

## Manifest proposal for AT51

AT10 did not edit any root/frontend manifest, lockfile, compiler configuration,
generated contract, backend or legacy file. The task-owned external harness
locks these exact packages:

| Package                         | Version | Use                                  |
| ------------------------------- | ------- | ------------------------------------ |
| react / react-dom               | 19.3.0  | App runtime                          |
| @types/react / @types/react-dom | 19.3.0  | Strict declarations                  |
| typescript                      | 7.0.2   | Compiler                             |
| esbuild                         | 0.28.2  | External browser/example compilation |
| jsdom                           | 30.1.2  | External healthy DOM examples        |
| playwright-core                 | 1.63.0  | External loopback browser QA only    |
| prettier                        | 3.9.9   | Source formatting only               |

Proposed compiler settings: `strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noUnusedLocals`, `noUnusedParameters`, ES2022,
DOM/DOM.Iterable, ESNext modules, Bundler resolution, `jsx: react-jsx`,
`noEmit`, and `skipLibCheck: false`. `assets.d.ts` declares bundled CSS imports.
AT51 owns the build scripts/bundler, committed lock and final version
reconciliation; these are external harness pins, not an application lock.

## Scoped healthy verification

Run from the external harness `/tmp/houseatlas-at10` after copying the exact
owned frontend files into `source/`, with Node 26.10.0 and npm 11.19.1:

```sh
./node_modules/.bin/tsc --project tsconfig.json
./node_modules/.bin/esbuild source/src/main.tsx --bundle --format=esm --platform=browser --target=es2022 --outdir=dist --metafile=build-meta.json
./node_modules/.bin/esbuild source/src/app/healthy.examples.tsx --bundle --format=esm --platform=node --packages=external --target=node26 --outfile=healthy-examples.mjs
node run-healthy.mjs
node run-published.mjs
```

`run-healthy.mjs` creates a jsdom document with an example.invalid origin;
it opens no HTTP listener and calls no provider. It supplies the published
`web/demo/fixtures.mjs` normal snapshot and editor options, prepared through
`web/src/prepare.mjs`, with one additional authorized synthetic home choice.
No fault scenario is invoked. The shipped `healthy.examples.tsx` exports
`runHealthyExamples(container, suppliedView)` and checks nine healthy groups:
bootstrap/plates; room descendants/focus; item specifications/mobile placement/
maintenance/downloads; document search/focus; archive visibility; Settings
house switch/title; returning home/passive reload; verified native links;
and typed bootstrap/scoped GET decoding with a fake transport.

`runPublishedVariantExamples(container, suppliedViews)` adds five healthy
groups using schema-validated published synthetic snapshots: `site`/`other`
semantics with generic Place presentation and native `view` links; `archived`
source state; unresolved/confirmed-deleted tree qualifiers; and GIF/AVIF photo
references alongside an issued PNG preview. `PublishedVariantViews` contains
the prepared `site`, `other`, `retained` and `photos` view inputs. The ordinary
archive example also verifies destination focus and the empty `#notice` hook.

Compilation validates actual lane source copies, not declarations alone.
The external evidence manifest compares every copied source digest with the
checkout. Application-wide AT51 build, real Rust DTO interoperability and
live session/provider behavior remain integration work. Stopped rejection,
guard-reversal, mutation/omission, adversarial, failure, crash, concurrency and
negative-consumer controls, plus legacy broad aggregates, remain unrun.
These healthy examples do not establish security or deployment qualification.

Healthy loopback browser QA succeeded with Chromium
151.0.7922.173 and Playwright Core 1.63.0. It verifies actual Space toggling of
the archive checkbox in both directions while retaining focus, the published
desktop empty-notice float layout, and desktop Home/item/Settings plus 390px
mobile captures. The temporary synthetic fixture server binds only loopback;
the recorded page requests are its HTML and issued synthetic PNG capability.
No page errors or provider calls were observed. Browser transport setup and
screenshots remain external harness evidence, not application server scaffolding.
