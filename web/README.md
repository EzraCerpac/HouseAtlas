# Room-first UI

Web `0.1.1` consumes contract `1.0.0`, record schema 1, synthetic fixtures and
operations policy `1.0.0`. It adds no dependency. Node/npm pins and the exact
ordinary lane are documented in the root README.

The UI provides home-scoped rooms/containers and item cards, breadcrumbs,
separate direct/nested counts, name/model/reviewed-alias/document search,
archive opt-in, photo/file availability, external links, and scheduled/completed
maintenance. The current interface is English only; home selection lives in Settings.
Source names/types stay unchanged. Dutch copy is retained for a later locale
extension, without a current language control. Floor or room semantics require accepted Atlas
classification; source type/depth/name alone never supplies them.

## UI copy rule

[web/AGENTS.md](AGENTS.md) applies to every UI change and external design brief.
UI text must identify data, an action, a state or a specific limitation.
Do not add slogans, welcome promises, obvious navigation instructions or repeated
guidance. Use a short functional page heading; put useful search types in its
field label. Keep necessary guidance once at the relevant control or failure.
Preserve accessibility names and factual qualifiers about scope, uncertainty,
freshness, access and file availability. Source-owned descriptions remain data.
Review every added sentence against this rule before delivery.

## Exports and host integration

`src/prepare.mjs` is **server-only**:

```js
prepareAtlasView(snapshot, {
  authorization, homeLabel, homes, now, media, hints, navigation
})
```

`snapshot` is the exact frozen snapshot shape and passes `validateSnapshot`.
Call after the access boundary verifies the principal and requested workspace/home. Internal
`authorization` is `{ allowed, workspaceId, homeId, allowedHomeIds,
canEditHomebox, reason }`. `reason: 'expired'` or `'revoked'` selects the
corresponding full home/session denial state; other denials return no labels, source IDs, entries, caches or choices. Never
accept this decision or capability arrays from browser parameters. Production
authorization remains a server responsibility, not this presentation seam.

`homes` contains already authorized `{workspaceId, homeId, label}` choices.
The current authorized home is always explicit. `now` defaults to the server
clock; dates use the interface locale with an explicit UTC timezone. Settings choices never create authorization or a stored user preference.

Optional server-issued capabilities:

- `hints`: `{entity: sourceRef, reviewed: true, aliases: string[],
  mobility: 'mobile'}`. Require reviewed scoped evidence before issuing. Missing
  hints do not infer mobility from a name, Network relation or source note.
- `navigation`: frozen `homebox-native` links with exact scoped `entity`,
  `intent`, `href`, `verifiedRoute`. A working route must be qualified by HomeBox adapter
  for the actual registered instance/collection; fixture URLs do not qualify it.
- `media`: `{entity: sourceRef, attachmentId, authorized: true, downloadHref,
  previewHref, previewValidated: true}`. Links must be session-authorized paths
  under the **proposed** `/api/atlas/media/` mount, without queries or source
  credentials. Paths are references, not standalone bearer authority. media/core owners
  must accept this mount or coordinate a different safe path policy.

Native edit/maintenance actions additionally require the server editor
capability, an accepted present source binding, fresh cache and verified
credential-free route. Unresolved/stale/unverified records retain lookup and
withhold native actions. Browser data omits stored-file `proxyRef`, internal
error messages, unrelated home data, reader edit links and collection telemetry.
Source `access-revoked` hides only its exact registered partition before
projection. Its cache emits a generic owner/status marker without IDs, dates,
generation, error details or capabilities. Other authorized partitions retain
lookup and exact successful-update dates. Network relation data and association
flags require a permitted binding; an unrelated source quarantine notice never
identifies a particular item association. Per-entry `networkStates` describes
only permitted bound partitions, so one source cannot set another source’s
freshness. Full home/session denial still returns no protected data.

External-link attachments in the browser view are explicit DTOs:
`{attachmentId, kind: 'external-link', title, url, archived}`. The server validates
the unchanged frozen snapshot first. Preparation preserves the original URL
bytes only if the shared `safeWebUrl` policy permits the URL; otherwise `url` is
`null` and the reference remains visibly unavailable. This browser DTO is not a
replacement attachment in the frozen snapshot. No source URL is fetched,
rewritten or repaired by removing query parameters. The renderer retains its
own safety check. The predicate permits HTTP(S), rejects URL userinfo and query
parameter names matching token/key/secret/password/authorization/credential,
and is a conservative name heuristic, not proof that arbitrary path, fragment,
parameter values or unnamed capabilities are credential-free. Such wider
qualification remains downstream; the named-parameter correction must not be
presented as comprehensive secret detection.

Home choices in the prepared browser view contain only
`{workspaceId, homeId, label}`. Alternate choices still require the authorized
workspace/home filter before that field whitelist. The core owns independent
configuration and `/homes` output filtering; this package does not edit it.
`prepareAtlasView` keeps its existing signature.

Resource empty/file-unavailable messages distinguish places from items. Empty
home guidance uses the actual `canEdit` capability: editors receive direct
HomeBox guidance, readers retain the household-editor hint. Neither hint creates
a verified navigation action or a duplicate editor.

Only an accepted physical item binding attaches Network evidence to that item;
confidence, basis, fact date, retrieval date and historical status stay separate.

`src/app.mjs` is browser-safe:

```js
const ui = mountAtlas(rootElement, {
  view, // prepared, authorized view, or omit while loading
  loadHome: async scope => authorizedView,
  refresh: async scope => authorizedView,
  signIn: () => hostSignInFlow()
});
ui.updateAuthorizedView(nextAuthorizedView);
ui.invalidateAccess('revoked'); // also accepts 'expired' / denial
ui.destroy();
```

Callbacks are host/service seams. The UI sends no HomeBox or Network requests
itself. Read failure with saved metadata retains the old successful date;
A host read-level 401/403 clears protected DOM/title/choices. Source adapter
quarantine must instead be represented in the assembled snapshot cache and
returned as a prepared authorized view, not thrown as a home-level HTTP denial. Home changes clear old content
before awaiting new authorization, reject an unexpected response scope, and
offer bounded retry on transport failure. Revocation/destroy prevents an older
pending read from restoring private DOM. This is not heap zeroization or a
replacement for server media/session enforcement.

`renderAtlas(view, route, options)` exports deterministic escaped markup;
`model.mjs` exports qualified-key, hierarchy/search/link and route helpers.
Hash routes: `home`, `places`, `place?key=…`, `item?key=…`, `documents`,
`maintenance`, `unplaced`, `search?q=…`, `settings`; `archived=1` is opt-in and
`document=<attachment UUID>` focuses the document heading on its owner.
Qualified keys remain stable across rename/move. Home changes reset the route;
HomeBox import/remap redirects can be added by the integrator using retained
Atlas identities/journals. This package does not fabricate remap history.

Mount the bundled CSS and four browser ES modules in the host; import prepare
only on the server. `build` copies browser assets into ignored `web/dist/` and
checks syntax; it does not bundle the Node/contract validator into the browser.
Use normal same-origin authenticated read endpoints supplied by core.
There is no standalone production HTML/auth/router here. The demo below must
never be mounted as the application's auth/provider/media implementation.

HomeBox adapter coordination confirms complete generations alone can replace/freshen
whole-cache metadata. Its filtered `fetchView` returns `cache:null` and
`replaceCache:false`; it cannot manufacture fresh cache timestamps. The host
must assemble persisted complete-generation projections/cache through storage,
preserve failed fetches and sticky auth/wrong-scope quarantine, and then prepare
this view. HomeBox adapter detail fixtures are `atlas-normalized-synthetic-v1`, not proof
of live v0.26.2 detail/attachment/maintenance decoding.

Later shared-service commands can update the authorized view through the host.
Full-write MCP/WebMCP and SIWC remain separate; this package contains no domain
mutation dispatcher, duplicate inventory editor, scheduler, offline write queue,
service worker or persisted private browser cache.

## Verification boundary

The ordinary lane builds this package and executes one healthy synthetic core
Request group. It uses the reviewed URL/home DTO correction and source-backed
`unresolved` binding. New explicit source-presence admission remains blocked.
The URL parameter-name predicate is a heuristic, not comprehensive credential
content detection. Real browser/assistive-technology, native-route, media/session,
actual-user, target and full security qualification remain open. Retained web
test/demo/failure-control aliases are unrun and excluded from ordinary CI.
Historical evidence and private design/approval metadata remain external.
