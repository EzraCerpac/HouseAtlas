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
- `data-session-url` and `data-login-url`: together enable `SessionApp` using
  explicitly mounted application-session GET and login POST routes.
- `data-logout-url`: optional logout POST route, enabling Sign out in Settings.

`index.html` intentionally supplies none of these unresolved routes. Missing
configuration displays the unavailable state. It never substitutes fixtures.
Rust envelope generation, route mounting and session cookie lifecycle remain
host integration work. The optional React session flow is implemented against
the published application-auth contract; no unmounted action is enabled.

### Application session port

`SessionApp({ client, sessions, accessEvents? })` loads the application session,
renders a focused username/password form when signed out, then mounts `App`
after successful sign-in. The existing `App` keeps responsibility for authorized
home reads and its explicit expired/revoked/denied states. Session UI state keeps
only expiry; it does not retain actor IDs or CSRF tokens. Password input is
cleared before awaiting login. Nothing persists credentials or private views.
Settings shows expiry with the browser's time zone and optional Sign out.
The non-ready access panel also exposes the configured Sign out action while
withholding house content and choices. `SessionApp` continues to own that action;
no additional client port or provider operation is introduced.

`session.ts` declares the published exact success DTO
`{schemaVersion:1, actorId:string, csrfToken:string, expiresAt:RFC3339}` and ports:

```ts
session(signal: AbortSignal): Promise<AtlasSessionInfo | null>;
signIn(credentials: {username: string; password: string}, signal: AbortSignal): Promise<AtlasSessionInfo>;
signOut?: (signal: AbortSignal) => Promise<void>;
```

`createAtlasSessionClient({session, login, logout?}, transport?)` uses only
configured same-origin routes. The published canonical routes are GET
`/api/atlas/auth/session`, POST `/api/atlas/auth/login` with exactly
`{username,password}`, and POST `/api/atlas/auth/logout`. Session GET 401 means
signed out. A configured logout obtains a current nonce through session GET,
then sends `X-Atlas-CSRF` and expects `{schemaVersion:1,signedOut:true}`.
This follows published `server/src/router.mjs` / `packages/access/src/index.mjs` and
`server/browser/host.mjs`; logout behavior is coded but unqualified here.
Login/logout failures remain generic and never expose response bodies.

AT52's host as inspected at `fde9586f41c32924543fe7066fb0481b02744b8c`
matches the published session GET DTO and mounts homes/view reads, but has not
mounted login/logout. AT10 requested exact action/response confirmation and
root configuration on integration PR #13; enabling these routes remains with
AT52. No shared host, contracts, manifests or other feature islands changed.

### Documented core coverage audit

| Published requirement                                                               | AT10 source                                                                  | Remaining host input                                                                               |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Application sign-in/session (`server/browser/host.mjs`)                             | `SessionApp`, typed session client, Settings expiry                          | Mounted login/logout, exact response confirmation, secure cookie transport, configured root routes |
| Authorized house selection (`web/README.md`)                                        | Settings selector, scoped load, old-house removal during switch              | Authorized `{workspaceId,homeId,label}` choices and prepared view                                  |
| Rooms, arbitrary places, items, documents, maintenance and search (`web/README.md`) | `pages.tsx`, qualified ancestry, source statuses, document focus and indexes | Authorized prepared entries and source metadata                                                    |
| Reviewed aliases, mobility and native navigation (`web/README.md`, `AGENTS.md`)     | Existing alias search, placement qualifiers and verified native links        | Reviewed hints and independently verified native capabilities                                      |
| Session-scoped media (`web/README.md`)                                              | Safe issued previews plus format/access fallbacks                            | Scoped media routes and issued `mediaHref`                                                         |

The public web contract excludes a duplicate inventory/domain mutation editor.
Account/source provisioning has no approved browser route in the core/access
contracts. Stock Wire3 tool catalogs define command authority and approvals,
not an Atlas bindings/placement editing screen or agreed browser endpoint.
AT10 requested the exact adopted screen requirement/action DTO if one is
intended. No speculative setup, binding, placement or grant controls were added.

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

`session.examples.tsx` exports `runHealthySessionExamples(container, view)`:
four additional healthy groups cover ordinary signed-out form/focus, successful
fake sign-in and password clearing, Settings expiry/house selection with an
uninvoked optional logout, and successful fake canonical session GET/login POST.
No actual account, cookie, grant, denial or logout action is exercised.

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

The session continuation also captures desktop/390px Sign in and Settings,
performs ordinary successful sign-in through a fake typed port, and selects and
returns between two authorized synthetic homes. This uses the same isolated
loopback browser harness and does not run the Rust host or any live auth route.
