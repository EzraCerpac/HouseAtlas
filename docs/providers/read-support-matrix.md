# Provider read support

Source reconciliation for #285, inspected 25 October 2026 at public main
`a9c9fd340e09f5866f31b528a09d270aa1860ff4`. The accompanying PR adds only
synthetic test coverage and documentation. Source support, CI results, installed
identity and live acceptance are separate evidence. No live read or installed
qualification was performed. Current actual provider builds, origins, account,
home/workspace/source/collection mapping and credential custody remain **BLOCKED**
on the existing provider owner's bounded live plan; none is inferred here.

| Surface | Implemented source contract | Public fixture / coverage | Actual source outcome |
| --- | --- | --- | --- |
| Normalized HomeBox reader | `HomeBoxReader::new`; `atlas-normalized-synthetic-v1`, reference `v0.26.2` | `adapters/homebox/fixtures/metadata.normalized-synthetic-v1.json`, `read/healthy.rs` | Synthetic peer only; no native compatibility claim |
| Stock HomeBox list | `new_stock`; `homebox-stock-v0.26.2`; `GET /api/v1/entities`, explicit `isLocation`, `includeArchived=true`, bounded `page` / `pageSize` | `wire/fixtures/{locations,items,items-second,empty}.page.json`, `wire/healthy.rs` | Source-derived support; installed build **BLOCKED** |
| Stock HomeBox detail / attachment metadata | Fixed `GET /api/v1/entities/{id}`; list summary is checked against detail; null type/parent and nil slices preserved | `wire/fixtures/{location,item,unknown}.detail.json`; existing native capture tests | Source-derived support; no attachment-body qualification or inferred file permission |
| Stock HomeBox maintenance | Fixed `GET /api/v1/entities/{id}/maintenance?status=both`; matching entity required; calendar dates stay dates | `wire/fixtures/maintenance.json`, `empty-maintenance.json`; wire/calendar tests | Source-derived scheduled/completed coverage; actual status completeness **BLOCKED** |
| HomeBox cached HTTP read | `GET /api/atlas/providers/homebox/workspaces/{workspace}/homes/{home}/sources/{source}/cached?collection=…`; exact opaque collection and current authorization; retained rows/cache | `http/providers/homebox_reads.rs::cached_partition`; existing synthetic cache query integration | No transport/refresh call; response preserves stored cache status/times rather than claiming a fresh GET |
| HomeBox filtered view | Separate authorized `filtered_view` / `fetch_view`, repeated `parentIds`; no Store or publication argument | Existing `filtered_view_preserves_complete_cache_and_uses_repeated_parents` | Bounded provider operation, **not** an ordinary cache browse; cannot replace/freshen complete cache |
| Passive Network refresh | `InventoryGet` permits only `GET /api/inventory`; current registered partition and reviewed links; no scan/demand/diagnostic/write capability | `adapters/network/fixtures/inventory.wire.json`, `link-review.json`; existing injected transport / sidecar tests | Source-derived snapshot contract; actual build/allowlist/relation read **BLOCKED** |
| Network cached HTTP read | `GET /api/atlas/providers/network/workspaces/{workspace}/homes/{home}/sources/{source}/cached?collection=…`; native retained disclosure; no refresh command | `http/providers/network.rs::cached`; existing native root-router loopback example | Cached only; ordinary browsing never starts collection |
| Network retained facet | Pure `build_facet`; unavailable without a generation, fresh/stale by last successful retrieval; per-observation fact age remains separate | Extended `healthy_transport_complete_proposal_and_sidecar_reopen` | No transport input; test asserts zero GETs before explicit fixture refresh and one afterward despite repeated cached reads |

HomeBox reference evidence is already pinned in
[`wire/source-pins.json`](../../backend/src/providers/homebox/wire/source-pins.json):
release `v0.26.2`, source `e01dd737238a3fa7e1a6454b37de6c6fc88c86e4`,
Swagger SHA-256 `5da7752182cb6172db0550cbd799ee340836d3dba8ceaff7c6ed12976f9e3493`.
The [stock fixture manifest](../../backend/src/providers/homebox/wire/fixtures/manifest.json)
explicitly says `source-derived-synthetic`, `capturedTarget=false` and
`observedTargetVersion=null`. The original normalized catalog is not evidence
that the stock bridge is absent. Neither catalog establishes the installed build.

No version negotiation or automatic fallback is promised. Other HomeBox builds
and dialects are unqualified. An incompatible body is rejected by the pinned
decoder; a compatible shape alone cannot identify the remote build. Network's
adapter version (`0.1.0`) identifies HouseAtlas code, not the remote source.

## Completeness and freshness contracts

`read/pagination_contract.rs` uses existing stock JSON plus bounded in-memory
variants. It requests no socket, credential, filesystem evidence or provider.
New assertions cover exactly:

- A short first item page, a missing final row, cross-page total drift and the
  aggregate location/item page budget returning `pagination` before any
  detail/maintenance request or complete-generation proposal.
- A failed refresh retaining the prior generation ID, successful retrieval time
  and records, updating only its proposed attempt/error metadata. A failed first
  generation has no generation ID or successful time; it is not an empty success.
- Failure DTOs exposing no partial entity list or candidate generation ID.
- Pure HomeBox and Network freshness staying fresh at the configured age limit
  and becoming stale one millisecond later, while generation/success/attempt
  metadata stays unchanged. Failure state stays error when aged.
- Repeated Network cached reads and facet construction leaving the injected
  transport count unchanged and demand/diagnostic/write capabilities false.

These tests use the existing library-test CI discovery; no workflow, runner,
dependency or broader test lane is added. Compilation, Clippy and test results
for the PR are **NOT RUN locally** under the git-first handoff. Their assertions
are coverage source until existing CI reports results on the exact PR head.
They do not exercise durable failure publication, races, revocation, transport
faults, version negotiation, browser/device behavior or recovery.

Offset pages remain nontransactional even when complete. `retrievedAt`, original
source update/fact dates, source snapshot time, last attempt and last success
have distinct meanings. Neither browsing nor a filtered view supplies a new
complete generation. A cache can be recent while a source observation is old;
Network does not infer that a device is online from a fresh cache.

## Unavailable behavior and remaining handoff

HomeBox's fixed `pagination` / `invalid-schema` failures retain a prior successful
generation and propose an error state; they do not infer upstream deletion or
an empty collection. Auth/scope failures instead require scope revalidation and
quarantine through the existing owner. Failure publication remains a separate
consuming fenced operation, never an automatic effect of browsing. Network
without a retained generation is unavailable; a stale retained generation stays
labeled cached, with device state unknown. HTTP admission/configuration failures
return the existing fixed errors; they do not supply an empty successful source.

The provider owner still needs the exact intended build/profile and source
mapping, reviewed endpoint/page/byte/time budget, existing credential custodian,
generation baseline and stop conditions before any bounded live read. Record
actual list/detail/attachment/maintenance coverage and passive Network relations
separately from these synthetic contracts. No live plan is released here.
Recovery #286, mutations/seed reconciliation #287, updater #284, capture #296,
workflow infrastructure and deferred UI/device acceptance remain with their
existing owners. #285 and #277 remain open.
