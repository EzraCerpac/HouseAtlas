# MCP/WebMCP operation qualification matrix, version 5

References #288; broader acceptance remains open. Reviewed on 10 November 2026
against public main `d368ca246da9999e7fdba5140a0870500df8a316`.

The [versioned matrix](mcp-operation-qualification-v5.json) contains all 168
canonical operations, once each in shared catalog order. Every row separates
catalog metadata, genuine service ownership, reviewed host profiles, conditional
WebMCP binding, finite stdio bridge support, applicable limits, exact historical
test/CI references and remaining qualification. It is an offline source
inventory, never an input to admission or execution.

The [read-only inventory command](../../tools/mcp-qualification/inventory.py)
checks source fingerprints, canonical metadata, complete operation coverage,
references and historical-ledger parity. It prints either a summary or one
operation with resolved owner, profile, limits and evidence:

```sh
python3 -B tools/mcp-qualification/inventory.py
python3 -B tools/mcp-qualification/inventory.py --operation atlas.binding.remap
python3 -B tools/mcp-qualification/inventory.py --operation homebox.field.list
```

The command reads repository files only. It imports no HouseAtlas application
code, starts no process, opens no connection, invokes no service/test and writes
no file. It is not added to CI or any runner. A successful audit means the
reviewed inputs still match, with consistent catalog/evidence references. It
does not interpret Rust/TypeScript semantics, authenticate a host, inspect a
configured installation or revalidate historical CI logs. Every current
operation-execution row remains **NOT RUN**, installed/configured acceptance
remains **OPEN**, and real-browser/device acceptance remains **DEFERRED**.

## Admission and dispatch join

Profile maxima below include conditional operations and describe the reviewed
source composition. They are not the result of a current admission query.

| Profile | Reviewed operation set | Genuine execution owner / condition |
| --- | --- | --- |
| R: borrowed MCP | 34 baseline reads; up to 36 with history | `bind_read` / `StockService` / `stock_dispatch`: 30 Atlas reads, four cached HomeBox reads; two mediated-history reads only with profile-6 Store |
| L: local Atlas | 67 | `bind_local_atlas` obtains actual Editor POST issuance and filters the existing host map to Atlas authority, excluding download: 30 reads, 31 direct writes, five derived writes and ordered batch |
| M: default mounted MCP | 35 baseline reads; up to 45 | `OwnedStockService` adds actual download issuer/redemption, two conditional histories, three matching-bound saved Network reads and five matching-bound native HomeBox reads |
| E: explicit mounted Editor | 72 baseline operations; up to 82 | Trusted `ExistingEditorCommands` Host startup setting plus genuine Editor issuance adds the same 31 direct/five derived writes and batch; clients cannot select this profile |
| HTTP: stock admission/invocation | Editor maximum 82; Viewer receives the read subset | Same native admission and domain owners; actual current source/partition authorization and HTTP read/write checks remain independent |
| D: dedicated native HTTP | Two Editor metadata IDs, separate from generic sets | `nativeCommandIds` names staged `atlas.asset.create` and qualified `atlas.scene-association.create`; actual Media custody and original-principal mutation checks still apply |
| W: stock WebMCP | Seven helper families, no automatic per-operation qualification | `StockApplication` / `bindAtlasService` / `bindCommandFamilies` intersects current scoped admission with supplied executable service IDs; `mountStockWebMcp` preserves canonical envelopes and visible commit ordering |
| G: gateway WebMCP | No canonical operation binding supplied by the component | Injected actual catalog/service/download owners intersect current admitted tool names; the generic gateway does not provide missing owners for the other three stock helper families |
| B: stdio bridge | Fresh native-admitted read effect, or finite Atlas writes/batch | Existing HTTP read/command owner; narrower page/envelope/result budgets, exact approval requirement for remap, and durable unknown-outcome write hold |

The JSON `hostProfiles.HTTP` column describes the Editor source ceiling; its
profile condition preserves the Viewer read subset. `source-admitted` means an
ID occurs in the reviewed profile, conditional on that profile's genuine current
role/scope/authorization. It never means an operation is currently usable.
`conditional:profile-6`, `conditional:network-binding` and
`conditional:native-homebox-binding` explicitly identify additional dependencies.

Admission sources are `http/agents/capabilities.rs`, `http/agents/mod.rs`,
`http/agents/mcp.rs` and `transports/mcp/local_atlas.rs`. The actual shared
dispatch is `http/agents/stock_dispatch.rs`, native stock read/mutation owners,
configured `homebox_native` and saved `stock_network_reads`. `NativeCatalog`
filters input arms and recursively checks every batch child; `OperationMapping`
joins the published/domain catalogs without enabling an operation. The matrix
pins its 64 reviewed inputs by SHA-256. Exact source
links can be formed from its baseline commit and source paths.

## Concrete findings and disposition

| Finding | Disposition / next action |
| --- | --- |
| The v4 header still says binding create is unresolved, while its M27/M28 rows record qualified unresolved-source creation | The matrix retains the actual row disposition and limits. Read-only inspection of #562 head `5f814c2cb97431386876b5fe2679528d443e81ea` confirms its sole integrator already corrected that paragraph. No competing v4 edit or qualification increment is made here |
| v4 owner/admission source links retain the older `8d492661…` baseline despite later M20–M36 increments and the remap hold | The v5 matrix separately pins the current reviewed main source and each historical test's exact executed source/job. Historical v4 evidence remains intact |
| 154 catalog entries say supported-pending-qualification, while the largest reviewed generic profile reaches only 82 | No missing binding can be inferred from a schema or catalog status. Eighty rows are explicitly unsupported in these generic profiles, one remap row is blocked, two held and three forbidden; dedicated application paths remain separate |
| Remap has a lower-level mapping but no trusted human issuer/atomic consumption owner in generic composition | Retain `generic_mutation_supported` exclusion and M33 hold-only evidence. No admission change, receipt, issuer or successful remap claim |
| M36 native-reader positives use injected GETs and an unmounted MCP delegation | Configured `NativeHomeBoxReadBinding`/credential custody, actual native continuation/domain dispatch and mounted result qualification remain NOT RUN. #571's retained-list test, composed separately in #562, is not copied or promoted |
| Asset/scene creation has dedicated Media custody, absent from generic MCP | Keep D separate; do not add a generic upload/scene binding. M34's actual same-Host text-byte redemption is distinct from a rendered link or another media/authority/lifetime variant |
| Generic WebMCP helpers can describe families without supplying an executable operation owner | Each row records helper-family bindability separately from current admission/service intersection. All per-operation WebMCP execution remains NOT RUN; gateway and stock/AI document ownership remain separate integration requirements |

No additional generic service binding or behavioral source repair is justified
by this inventory. The executable increment is the reusable offline audit and
machine-readable join that exposes these distinctions without invoking an
operation. Future binding work needs its actual existing service owner and
scope; this document supplies no fallback dispatcher or endpoint.

## Limits and evidence

Each operation references the applicable source-pinned `limits` entries in the
JSON. Native MCP has 64 KiB input / 1 MiB response limits; mounted sessions lower
the embedded 4,096-request / 1 MiB request-ID budgets to 256 / 64 KiB. HTTP
session limits are separate. Canonical list page sizes are 1–100; bridge reads
restrict pages to eight, envelopes to 16 KiB, encoded queries to 32 KiB and
responses to 2 MiB, with JSON depth/node bounds. Native write reasons are at
most 1,024 code points and batches contain 1–100 independently supported
children. These bounds do not qualify every oversized record or unknown outcome.

Media's 10 MiB original bound, actual content/type/size/hash validation, current
authorization, five-minute opaque handles and ten-second work budget remain
with their owners. WebMCP accepts only owner-issued same-origin download paths
with a fresh remaining budget of at most 300,000 ms, consumed during resolution
and visible commit. Link presentation establishes no byte transfer. Native
HomeBox retained-list and saved Network result limits are recorded separately;
neither pagination nor cached observations establish new provider authority.

The matrix indexes the 39 exact historical entries M01–M36/B01–B03 from the
[v4 evidence ledger](mcp-operation-qualification-v4.md#evidence-identity-and-method).
Every reference resolves to a named case, source path, exact historical source
commit, CI job URL, reported result, method and evidence boundary. Descriptor,
fake-peer, injected-reader, hold-only and actual shared-service results retain
their original distinctions. Historical dispositions remain 82
QUALIFIED-SYNTHETIC / 80 UNSUPPORTED-GENERIC / one BLOCKED / two HELD / three
FORBIDDEN. This extraction creates no new execution PASS and does not silently
reclassify a historical result as a test of current main.

This increment adds no test, workflow, runner selection or held control. Local
builds, compilation, Clippy, tests, browser/device sessions and provider
operations are not used as publication prerequisites. Existing automatically
triggered PR CI supplies its own separate execution outcome. The source auditor
can subsequently report only its source/metadata audit, never operation success.

## Maintaining the snapshot and advancing #288

On a changed pinned input the auditor refuses, including when a composed donor
only extends a test or edits the historical ledger. Inspect the exact new source
and operation/evidence implications before refreshing that pin. Do not replace
hashes mechanically to suppress staleness, rewrite historical executed commits,
or import a candidate test into the PASS registry. Unrelated source outside the
explicit pins is not covered by this audit.

The sole #562 integration writer must reconcile the v4 editorial correction and
any changed pinned inputs additively; this branch edits none of its files except
the unavoidable new-file publication-manifest rows. No #562 ancestry or private
input is required by this main-based deliverable. The continuation and
credentials/suggestion writers retain their scopes.

Remaining acceptance is still substantive: exact configured mounted native
reads; intended operation/actor/scope variants and canonical correlation;
pagination/history beyond the recorded fixtures; write/batch partial or unknown
outcomes; genuine remap approval/consumption; original media and remap lifetime,
large-input and transfer variants; one-document current WebMCP lifecycle with
visible canonical completion and honest unsupported behavior; and exact
installed provider/build observations. Existing live/configured rows stay open.
Interactive browser/device acceptance stays deferred. #285, #287, #286 and #289
gate their respective stages without blocking independent source inventory.
