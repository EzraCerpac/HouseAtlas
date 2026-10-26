# Acceptance preparation for #300

This is non-browser preparation for [#300](https://github.com/EzraCerpac/HouseAtlas/issues/300),
tracked by [#277](https://github.com/EzraCerpac/HouseAtlas/issues/277).
**All actual acceptance rows are DEFERRED. Owner resumption has not been granted.**
Source inclusion, CI, screenshots and historical reports do not accept an
installed app, a real device, a family role or an operational recovery procedure.

The [machine-readable scenario matrix](acceptance-300.json) contains 24 rows,
each with a pinned source link, owning issues, required observation and explicit
DEFERRED/null evidence. It inventories existing source, not missing product
features. It is a reusable blank plan; owner labels and PR status must be checked
again before a handoff. No public installed identities or household data are
selected or collected here.

**Update — 26 October 2026:** Merged [PR #371](https://github.com/EzraCerpac/HouseAtlas/pull/371)
removed the unused in-repo updater and its optional MCP/app callers;
[issue #284](https://github.com/EzraCerpac/HouseAtlas/issues/284) is retired,
with its binding checklist superseded rather than completed. Existing updater
and caller references in this document and the scenario matrix describe the
pinned historical inventory, not current updater capabilities. This correction
changes no scenario, source pin or DEFERRED acceptance evidence.

## Source and version matrix

| Identity | Preparation value / required private observation |
| --- | --- |
| Inspected source | `4ef733dc5b01259e7555e20cc2493da515506df3`, saved checkout on 25 October 2026 |
| Observed remote main | `b7abc9d87b90d3a6eab9efb386edf252f72daf60`, GitHub read on 25 October; not the source of the pinned inventory |
| PR candidate | Record this preparation PR's exact head separately; it changes no product implementation |
| Served frontend | UNKNOWN: exact deployed source/build and asset closure, separately from current main |
| Native backend | UNKNOWN: executable/source/producer, native profile and storage compatibility |
| Model | UNKNOWN: publication, original GLB SHA/bytes, semantics/companion SHA and selection revision; room-links pin separately |
| Saved public shell | UNKNOWN: Saved build/asset closure, exact root/Saved worker versions and observed controller after reopen |
| Retained copy | UNKNOWN: exact manifest/snapshot SHA, capture date, local revision, selected scope, completeness, exclusions and resource closure |
| Source projections | UNKNOWN: provider version and last complete generation, original source/retrieval dates; not a freshness claim |
| Browser / OS / device | UNKNOWN: intended platform/version, browser versus standalone/icon, viewport/orientation, text scale and input method; keep identifiers private |
| Resumption / decision | NOT GRANTED / NONE: dated bounded owner instruction, required rows, limited-pilot exclusions and final decision stay separate |

Git transport could not refresh the saved checkout (proxy CONNECT 503). The
inventory therefore pins the checkout it actually inspected. Newer main and
owner PRs must be reconciled before any eventual installed run; no older source
pin is substituted for the selected installed versions.

## Content matrix

A complete download and complete coverage are separate properties. Use the
exporter's six sections and every unique manifest resource, including a partial
pack, as the required byte list. Record exact digest, byte length, MIME, section,
role and reference mapping privately. A section root or metadata row is not
proof of an original, preview, model or external attachment's availability.

| Content | Existing source seam | Required eventual observation / honest limit |
| --- | --- | --- |
| Public shell and lazy assets | [Root entry](../offline/root-offline-entry.md) | Verified public closure, then real cold icon launch after termination. A shell can open without a private saved copy. Root fallback is navigation-only; do not infer offline native auth. |
| Home selection and records | [Read-pack contract](../offline/home-read-pack-v1.md), [manifest reader](../../frontend/src/offline/manifest.ts) | Exact home/Atlas roots, captured identity/revisions, explicit selection and source times. Missing roots/bytes cannot be counted complete. |
| Model and 2D plans | [v2 consumer](../offline/saved-atlas-consumer-v2.md), [presentation](../offline/saved-atlas-presentation.md) | Full listed GLB, exact raw companion with inline plans, matching publication/selection and optional room-links. No model or missing map stays explicit; names never establish placement. |
| Inventory and Network | [Saved overlays](../offline/saved-atlas-overlays.md) | Retained projections/logical relations, supported facets, uncertainty and unplaced counts. No collector demand or provider fetch; source metadata is not retained attachment bytes. |
| Documents, originals and previews | [Saved mounting](../offline/saved-atlas-mounting.md) | Verify every claimed retained original and preview independently by size/MIME/SHA; deliberate original download. Model-free verified catalogs remain useful. External HomeBox URLs are references, not archived bytes. |
| Electrical/PDF associations | [Saved overlays](../offline/saved-atlas-overlays.md), #283/#299 | Exact evidence/asset/association closure and valid page reference. Missing joins/pages stay unavailable; no substitute page, invented wiring or physical placement. |
| Local identity/evidence drafts | [Local edit controller](../../frontend/src/local-edit-retention/controller.ts), [capture drafts](combined-capture-drafts.md) | Separate UNSENT local state from documentary reading and native effects. Existing #282/#297 owners qualify reconciliation/send; never infer automatic replay. |
| Unsupported, missing or evicted content | [Store](../../frontend/src/offline/store.ts), [media limits](media-and-offline.md) | Explicit partial/unavailable/not-configured/excluded state, quota/eviction explanation and no backup guarantee. A successful save of a partial pack remains partial. |

The live model cache is a different store from a deliberately retained home
copy. [Its source contract](../offline/live-atlas-cache.md) requires a live
session/home view; it is not evidence of cold no-network application launch.
Older generic media documents describe defaults; explicit read-pack/root-entry
amendments govern their narrow opt-in exceptions. Physical iPhone/PWA evidence
is still required for any claimed cold icon/offline support.

## Journey and owner handoffs

| Rows in JSON | Preparation coverage / input owner |
| --- | --- |
| entry, interruptions, roles, native-effects | Direct URLs, expiry/denial, login/close/back/forward, scope changes, repeat/lost receipt; #303/#289/#287/#282. Existing viewer/editor/operator roles only; Atlas rights do not confer provider rights. |
| navigation, interaction | Building/room, Plan/3D retention, overlays/source unknowns, keyboard, touch/pan/wheel, short landscape; #298/#312/#292/#207. |
| provider-outage | Last complete versus first unavailable generation, independent HomeBox/Network/media outages; #285. |
| shell, pack, model, records, documents, coverage, storage, versions | Cold icon, exact saved copy, every content class, reload/reopen, partial/missing pack, quota/eviction, stale versions, worker update and live return; source owners retain implementation. |
| local-edit, drafts | Separate retained-original/proposal/conflict and one-use evidence-send results; #282/#297/#296. No sync implementation here. |
| measurement | #279/#280/#281: entry, provenance/history, model change; qualify only supported dimensions. |
| updates | #284/#290/#291: update control/status, compatible rollback eligibility and delivery handoff. No deployment authority. |
| capture, ai-agent, electrical | #296/#283 photo/file/PDF original readback; #288/#289/#294/#295 supported account/runtime/agent operations; #299/#298 evidence-backed registration. Optional rows can be explicit pilot exclusions, never silently pass. |
| operations, decision | #286/#291/#284 private recoverability and named responsibility handoff; #300 owner-selected limited pilot versus full acceptance. |

Owner labels checked on 25 October: Claude retains #279/#280/#282/#284/#286/
#291/#292/#207/#298 and renderer/model lanes #312/#304. Current public PR inputs
include #314 (recorded PDF page), #317 (provider read contracts), #316 (compact
UI/control names), #318 (renderer), #315 (delivery) and #319 (backup). These are
moving handoffs, not accepted installations. #303 is closed; its existence here
requests current installed behavior evidence and does not reopen implementation.
The #296 writer remains separate. No shared product/router/workflow files change.

## Executable synthetic preparation

After inspecting [the complete generator](../../tools/acceptance/prepare-300.py),
this stdlib-only command prints a blank JSON run sheet to stdout:

```sh
python3 tools/acceptance/prepare-300.py
```

It reads only the checked-in synthetic matrix and always emits DEFERRED/null
evidence, unknown installed/device identity and no acceptance decision. It
accepts no private input, launches no process/browser/server, uses no transport,
changes no file and runs no product check. It does not execute any scenario or
validate a real pack. Keep an eventual populated run sheet outside Git and public
issues; this tool does not sanitize private evidence. Generator execution,
builds, Clippy, tests and publication verification are NOT RUN locally under the
approved git-first workflow. Existing automated PR CI is unchanged; Claude owns
CI failures/conflicts and merge.

## Deferred private execution and decision

After explicit resumption, the owner selects the audience, existing roles,
intended devices and exact installed/content identities. Expand each chosen row
per browser/OS/device, orientation, live versus Saved entry and selected pack;
keep every required content resource in its own observation record. Record date,
method, exact versions, result, limitation and private evidence reference. Results
use PASS / FAIL / BLOCKED / NOT RUN / DEFERRED. A PASS applies only to the stated
observation and exact candidate; a source/CI result never changes a device row.

The private operations handoff must name backup freshness and recoverability,
restore/rollback owner and compatible loss scope, startup/restart and login
behavior, TLS trust/renewal owner, update mechanism, outage contact and recovery
instructions. Consume the owners' current receipts; do not run services, restore,
change TLS/network/settings or publish hosts/receipts while preparing.

Missing resumption blocks execution. Missing identities/qualified owner inputs
block the dependent row; unrelated preparation may continue. New credentials,
grants, native changes, paid AI, private target choices and operations require
their separate owner authority. Unknown effects require inspection before replay.
When authorized network/device cases eventually run, restore ordinary mode after
each case. Family names, room layouts, host addresses, device IDs, private pack
identities, screenshots and operational receipts remain with the private owner.

A limited pilot explicitly lists required rows and exclusions. Full acceptance
requires every required current journey/device/content observation and accepted
operational handoff. This preparation neither closes #300 nor releases G1–G5.
