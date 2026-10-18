# Root offline entry

An existing installation whose manifest starts at `/` can reach the retained
Saved Atlas after opening the normal Saved entry online, or using the existing
explicit Prepare house copy action. Both verify the public Saved shell before
preparing the root entry worker. No new capture or Save/Replace is needed to
enable root launch for an existing retained copy. The manifest start URL
and the normal native application flow stay unchanged. An already installed
older worker does not gain this behavior until the user has visited the updated
online Saved entry or completed that preparation. A page still running older
cached Saved HTML/JavaScript may first activate the updated Saved worker, then
need a reopen or reload to load the new root-registration code. Existing page
code is not automatically replaced; no new native capture is needed.

The build plugin emits `/offline-entry-worker.js` for scope `/` alongside the
existing `/saved/service-worker.js` for scope `/saved/`. The root script imports
that fixed public Saved worker script and requires its build to equal the root
wrapper's generated build pin. The build identity binds the unmarked public
asset table, Saved worker implementation and root wrapper source. The marked
Saved HTML also receives its own exact byte count and SHA-256 in the public
closure. Both workers verify every public byte before activation and status.
There is no authenticated root document in that closure.

The root wrapper owns only same-origin GET navigations to `/` or `/index.html`
without a query or fragment. It attempts the original request with
`cache: no-store` first, bypassing an HTTP-cached native root document while
preserving the request's credentials and authentication behavior.
Every resolved response passes through unchanged, including HTTP authentication
and server errors. A rejected network read can redirect to the exact
`/saved/index.html` only while the complete public Saved closure still verifies.
This is a local network-read outcome, not a WAN availability detector. The
narrower Saved registration serves its verified public entry and does not
redirect back to root. Both workers admit only the existing public asset table;
root/API/model/session responses are never cached. No native current data is
manufactured, and no global fetch function is replaced.

The handoff opens the existing Saved Atlas host. Its existing retained store
lists copies, preserves their capture times and opens a copy only through its
existing viewer action. The host labels historical records as lacking current
native authorization. The root worker never owns private retained bytes,
changes a receipt, refreshes native authorization, or expands Saved coverage.

Root registration follows the existing verified Saved path for both intentional
Saved navigation/open and the explicit Prepare caller. The latter reads the
public Saved entry marker; the normal Saved entry already has it. This helper
is not called by native startup or login. Opening the Saved entry prepares only
public workers and bytes; it does not acquire, replace or modify a private copy.
Both registration paths preserve an existing exact-scope registration whose
script URL is foreign. The two owned script URLs remain fixed across updates;
normal worker installation, skipWaiting and clients.claim move them to a new
verified build. This can change the controller of an open page; the root
navigation policy still passes online host responses through. Root installation
is best effort: `ready` and `buildId` continue to describe only the verified
Saved shell and do not certify a device's offline launch capability. A foreign
root registration or an unavailable root update does not invalidate a verified
Saved receipt.

Activation retains other build caches because either registration may still
serve an older build during an ordinary update. Explicit Remove saved public
shell checks both exact scopes, fixed script ownership and the displayed build
reported over MessageChannel before unregistering. It preserves registrations
for foreign scripts, newer builds and workers still installing. It deletes only
`houseatlas-saved-public-<displayed build>`. Retained older caches are not silently
purged. As with all service-worker unregister operations, already controlled
pages can remain controlled until navigation or close; removal deletes their
selected public cache and does not delete private Saved house copies.

The one named generated check uses Node 26.10.0 and only its standard library.
Inspect the complete runner, build plugin, two worker sources, `shell.ts`, and
the existing Saved capture-label components before this exact command:

```sh
node frontend/lantern-tests/offline-root-entry-healthy.mjs
```

It emits two small synthetic public closures into a disposable temporary
folder through the actual plugin, executes the actual worker sources and
TypeScript shell helper in isolated VM contexts, and models CacheStorage and
ordinary registration/activation/message operations. It checks normal root
responses, the unavailable-network handoff, exact Saved public bytes and build
pins, private-route exclusion, the normal marked Saved entry, a foreign root
owner, ordinary updates and displayed-build cleanup. Capture labeling is checked
at the existing component source seams, not through fabricated private records
or a browser render. VM-local transports never replace process-global fetch.
No listener, browser, native service, credential, real private store, provider,
installation or deployment runs. Broader malformed/denial/crash/replay/control
suites are outside this command.

Genuine browser service-worker update/controller behavior, retained-store
persistence, installed root launch after process restart, supported-device/PWA
behavior, private Saved capture rendering and operational deployment remain
separate acceptance gates. The generated result establishes source lifecycle
behavior only. It does not qualify a native room-map artifact or change any
retained useful build/copy.
