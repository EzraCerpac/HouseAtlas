# Native house copy acquisition

Atlas tools exposes **Saved house copy** as an optional native Host control.
Opening the tools, expanding the control, observing its state and rendering the
home perform no acquisition, shell verification or local-store inspection.
The disclosure precedes **Prepare house copy**: retained data and permitted
originals are unencrypted in this browser profile and survive sign-out. The
saved viewer supports Atlas; general inventory, Documents/PDF navigation and
editing remain unavailable offline. Quota estimates are advisory; acquisition requests no quota estimate or
persistence permission, and browser persistence is not guaranteed.

Preparation captures the actual current native session, ReadyView, scope object,
workspace/home IDs and `ReadyView.homeLabel` before lazy imports or transport.
It explicitly inspects the existing local copy, verifies the public `/saved/`
app closure using `verifySavedShell()` and reads the bounded native manifest.
No service facet, synthetic native authority or selected building/floor/room is
used to narrow the house. Save remains a separate explicit action. A prior copy
shows its capture and revision and requires **Replace saved copy** with
that exact revision. The preview distinguishes **New capture** from **Currently
saved**, labels coverage separately and identifies any content not included in
the copy before confirmation. Cancel is available while preparing or reviewing;
**Stop saving** invokes the same cancellation owner during Save. A further exact prior-revision read immediately before
`begin` catches ordinary stale confirmation; the store has no compare-and-swap
contract, so this is not a cross-tab replacement guarantee.

Only the injected owned GET transport handles private pack data. It permits the
same-origin manifest route and exact snapshot/resource paths, with native
same-origin credentials, no redirects and no cache. The current parser admits
resource routes before any resource request. Responses retain exact status,
MIME, private/no-store, nosniff, declared length, range bounds and SHA-256 checks.
Limits remain 512 resources, 128 MiB total, 4 MiB ranges and effective 8 MiB
manifest/generic JSON. The model-v2 root resolves exact content references to
admit the raw companion separately at 12 MiB, GLB at 32 MiB and independent room
map at 1 MiB. Only section JSON roots use the generic lossless parser; originals
remain exact bytes. The model companion uses `admitSavedAtlasCompanion`, and
its independently supplied map uses `readSavedAtlasRoomLinks`.

Every listed resource must be verified and staged before activation, including
all resources in partial captures. Records-only/null model and overview-only
partial captures remain valid. Original dates, unknowns, exclusions, arbitrary
precision numeric tokens, independent mappings and exact raw bytes remain in
the inert local manifest/resources. Transport URLs are stripped by the current
manifest parser. No root worker, global fetch, native backend, Documents owner,
renderer, model schema or storage persistence permission is changed.

The native service synchronously aborts and retires acquisition on actual
session/view/scope replacement or real session expiry. Unchanged owner refresh
keeps the operation. Cancel only discards the exact pending stage handle after
its own work settles. The handle is captured before the post-`begin` guard.
The storage owner's required `discardStage({key,token,epoch})` must be available;
older stores fail closed before acquisition. No remove/clear fallback exists.
Cleanup errors preserve the original acquisition outcome and disclose pending
local download data. Stage discard must preserve prior committed copies and shared bytes, and be a
late no-op for a stage already activated. The service closes only its own store
after its operation settles; it never closes an in-flight store from Cancel.

The actual activation completion is the success boundary. A later Cancel or
owner replacement cannot turn that successful commit into a failed receipt.
The retained receipt records house, capture date, snapshot, local revision,
public shell build, complete/partial coverage and exclusions. **Open saved
Atlas** uses the normal `/saved/index.html` entry and does not fetch a new copy.
A saved receipt makes no claim that the capture is the current native home.
Shell readiness does not establish genuine offline/device/PWA acceptance.

## Focused verification

Read the complete runner and imports before the exact linked
[generated acquisition check](../contributing/verification.md#named-generated-native-house-acquisition-check).
Use Node 26.10.0 and the locked frontend dependencies. The argument is the
retained generated handoff directory containing `QUALIFICATION.json` and
`fixtures/{records,partial,unified,documents}`; no private fixture bytes are
copied into source:

```sh
node frontend/lantern-tests/offline-house-acquisition-healthy.mjs /absolute/retained-generated-handoff
```

It uses the production downloader, manifest/model admission and native lifecycle
service with injected finite GET responses, a valid shell status and a finite
staging store implementing the production interfaces. It checks all four exact
retained exporter variants (42 resources, 46 ranges), the raw 8,388,625-byte
companion, all listed partial bytes, exact local manifests, passive observation,
unchanged owner refresh, explicit Save/Replace, ordinary view replacement,
Cancel during range work and after `begin`, and late successful commit receipts (including Cancel while a committed
operation finishes its normal store close).
The same check statically renders the actual React control in seven valid idle,
prepared, replacement, partial, preparing, saving and receipt states. It checks
passive rendering, the separate Prepare/Save labels, new/current capture labels,
coverage/exclusions before confirmation, Cancel wording and exact receipt pins.
This is source/static-render evidence, not keyboard, layout or browser evidence.
It does not run denial, foreign-token, expiry, revocation, crash, fault,
guard-reversal or broad aliases. It opens no socket, browser, real IndexedDB,
service, native state or provider. The fake staging owner checks the acquisition
interface; it does not qualify real IndexedDB stage-discard semantics.

Existing ordinary compile commands are:

```sh
npm run typecheck --prefix frontend
npm run build --prefix frontend
```

Generated success and compilation do not establish actual authenticated native
HTTP, browser storage durability, offline mounting, device/iOS/PWA acceptance,
security or deployment qualification.
