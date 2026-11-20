# MCP/WebMCP operation qualification matrix, version 5

References #288; broader acceptance remains open. Reviewed on 10 November 2026
against public main `d368ca246da9999e7fdba5140a0870500df8a316`.

The [versioned matrix](mcp-operation-qualification-v5.json) contains all 168
canonical operations, once each in shared catalog order. Every row separates
catalog metadata, genuine service ownership, native dispatch implementation,
reviewed host profiles, conditional
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
| M: default mounted MCP | 35 baseline reads; up to 45 | `read-only` requires Editor POST with current session, Origin and CSRF at initialization. `OwnedStockService` adds download issuance/redemption, two conditional histories, three matching-bound saved Network reads and five matching-bound native HomeBox reads |
| E: explicit mounted Editor | 72 baseline operations; up to 82 | Server `mcpCommands: "existing-editor-commands"` selects the profile at MCP initialization for an original authenticated Editor. Adds 31 direct writes, five derived writes and ordered batch. An initialized persistent server changes this receipt-bound setting through [offline `rebind-commands`](../operations/persistent-server.md#explicit-offline-mcp-command-policy-rebind) |
| HTTP: stock admission/invocation | Editor maximum 82; Viewer receives the read subset | Same native admission and domain owners; actual current source/partition authorization and HTTP read/write checks remain independent |
| D: dedicated native HTTP | Two Editor metadata IDs, separate from generic sets | `nativeCommandIds` names staged `atlas.asset.create` and qualified `atlas.scene-association.create`; actual Media custody and original-principal mutation checks still apply |
| W: stock WebMCP | Seven helper families, no automatic per-operation qualification | `StockApplication` / `bindAtlasService` / `bindCommandFamilies` intersects current scoped admission with supplied executable service IDs; `mountStockWebMcp` preserves canonical envelopes and visible commit ordering |
| G: gateway WebMCP | No canonical operation binding supplied by the component | Injected actual catalog/service/download owners intersect current admitted tool names; the generic gateway does not provide missing owners for the other three stock helper families |
| B: stdio bridge | Fresh native-admitted read effect, or finite Atlas writes/batch | Existing HTTP read/command owners with narrower budgets. Remap stays held pending an exact approval owner. After a held-session `401`, fresh issuance is available on the next independent operation under the same actor and scope fences. An `UNKNOWN` journal entry blocks further writes pending native reconciliation |

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
pins its 68 reviewed inputs by SHA-256.
The reinspection notes identify the commits for refreshed inputs.

## Concrete findings and disposition

| Finding | Disposition / next action |
| --- | --- |
| The v4 header still says binding create is unresolved, while its M27/M28 rows record qualified unresolved-source creation | The matrix retains the actual row disposition and limits. Read-only inspection of #562 head `5f814c2cb97431386876b5fe2679528d443e81ea` confirms its sole integrator already corrected that paragraph. No competing v4 edit or qualification increment is made here |
| v4 owner/admission source links retain the older `8d492661…` baseline despite later M20–M36 increments and the remap hold | The v5 matrix separately pins the current reviewed main source and each historical test's exact executed source/job. Historical v4 evidence remains intact |
| 154 catalog entries say supported-pending-qualification, while the largest advertised generic profile reaches only 82 | No missing binding can be inferred from a schema or catalog status. The historical eighty UNSUPPORTED-GENERIC labels remain recorded separately from current native implementation; one remap row is blocked, two held and three forbidden; dedicated application paths remain separate |
| Scene-association get/list/history have a native owner despite absent advertised admission | Correct all three current service-owner rows and mark `nativeDispatch: implemented-unadvertised`. `AtlasReads::read_arm`/`atlas_list_record_type`, native `stock_reads` and Store implement all three. Generic HTTP invoke reaches that shared read dispatcher without comparing advertised `capabilities::admitted`; current Read/ReadHistory, scope and source-closure authorization still apply. R/L/M/E and HTTP admission metadata omit these IDs. Keep historical v4 labels intact and current execution NOT RUN; do not widen admission or describe the actual native implementation as missing |
| Remap has a lower-level mapping but no trusted human issuer/atomic consumption owner in generic composition | Retain `generic_mutation_supported` exclusion and M33 hold-only evidence. No admission change, receipt, issuer or successful remap claim |
| M36 native-reader positives use injected GETs and an unmounted MCP delegation | Configured `NativeHomeBoxReadBinding`/credential custody, actual native continuation/domain dispatch and mounted result qualification remain NOT RUN. #571's retained-list test, composed separately in #562, is not copied or promoted |
| Asset/scene creation has dedicated Media custody, absent from generic MCP | Keep D separate; do not add a generic upload/scene binding. M34's actual same-Host text-byte redemption is distinct from a rendered link or another media/authority/lifetime variant |
| Generic WebMCP helpers can describe families without supplying an executable operation owner | Each row records helper-family bindability separately from current admission/service intersection. All per-operation WebMCP execution remains NOT RUN; gateway and stock/AI document ownership remain separate integration requirements |

The `hostProfiles.HTTP` column records advertised admission, while
`nativeDispatch` separately records reviewed implementation/reachability. The
three unadvertised scene reads demonstrate why these must remain separate. This
source finding supplies no executed response or new authority. Reconciliation
of the advertised set with the existing native owner needs its own reviewed
scope; it must not be accomplished by broadly enabling catalog entries here.

No additional generic service binding or behavioral source repair is justified
by this inventory. The concrete repair is the three-row native-owner/dispatch
correction. The executable increment is the reusable offline audit and
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

## Composed-input reinspection

The JSON retains its original main baseline above. Four pins were reinspected
after composing main `8a20f596cae36bb8922b16f54d9bfd11a6b2ff56` and exact
electrical projector donor `0138f373f167636f596c79163d74ef00724bd0dd`, at
composition parent `5aad47050919fc653a922864c7158f4c646144b6`. The publication
tree anchors the updated hashes; this is source review, not operation execution.

- `asset_download_healthy.rs` adds #547's separate contextual five-original
  teardown/reopen fixture: actual Core/Store/Access/Vault release, exact existing
  store reopening, fresh ordinary authentication and canonical/original readback.
  Retained home configuration is DATA. This is an in-process router fixture,
  without installed startup, process restart, socket/TLS or device qualification.
  M34 still indexes its unchanged same-Host mounted-MCP text case; M04 retains
  its fake-history method. No historical test is relabelled as this newer case.
- `native_list_pages.rs` adds only the existing private `cfg(test)` child
  registration. It enables no configured capture or operation; #571 remains
  separate from the injected/unmounted M36 evidence.
- The v4 introduction clarifies the already-recorded synthetic unresolved-source
  binding-create variant and blocked remap. No ledger row, source commit, CI
  identity, disposition or remaining qualification is changed.
- `run-healthy.mjs` adds five SOURCE selections (AI review, AI adapter, offline
  electrical copy, network trace and electrical group) and two BROWSER selections
  (electrical regression and capture save/reopen/remove). These are registrations,
  not per-operation execution evidence; none is removed or disabled here.

The other 63 input pins, every operation/profile/admission value, historical
evidence entry and current execution/installed/browser state remain unchanged.

The same runner pin was reinspected again at composition parent
`3dba170d` before publishing the follow-up: one generated offline presentation
SOURCE selection was added (78 SOURCE / 1 BUILD / 7 BROWSER). It extracts the
actual root/reopen logic with synthetic hook/owner boundaries, not MCP execution.
All prior selections and the two sandbox-blocked cases remain. Only this pin is
refreshed; every operation, historical evidence and qualification state is kept.

The following same-runner reinspection adds two generated inspection-owner and
manual native-handoff SOURCE selections after `b19e7d91` (80 SOURCE / 1 BUILD /
7 BROWSER). The backend selected-input module registration adds no operation or
route. No historical evidence is promoted and every previous selection remains.

Three inputs were then reinspected after `0183afd6`: the agent schema changes
exactly 126 logical HomeBox collection constraints to the original opaque scalar
bound; native_schemas updates only its exact schema digest; healthy_examples adds
two authored default-library structural/descriptor controls. No native binding,
capability, operation/profile or historical execution result is changed. These
hash updates establish only the reviewed amended source, not current execution.

Two further pins were reinspected after qualified main `f712288f` and helper
source `0f0dd48c`: the workflow adds only selected Ubuntu-job pinned-helper
always-cleanup; `healthy_examples.rs` changes only the existing collection-test
import formatting from `903ad712`. The CI helper is isolated from native MCP
operation/profile/admission and authority. All other 65 pins, historical evidence,
operation rows and execution/browser/installed states are unchanged. This source
reinspection qualifies no new runtime or operational boundary.

## Source reinspection at `bd1873bf`

All nine stale pins were matched to exact reviewed bytes in public main history
and compared with `bd1873bfe8b766d492d3f03cdeb66126cef9cebd`.

- `.github/workflows/ordinary-core.yml` (`3b86a3db`) adds the 42 synthetic
  Network collector cases and reflects them in the job summary.
  The bridge exception still selects its original three read cases.
- `http/agents/mod.rs` (`65ed4e1b`) registers the mounted evidence module
  and adds a borrowed Viewer identity-read fixture, all under test compilation.
  `healthy_identity.rs` and `healthy_local_atlas.rs` (`780700d4`) add borrowed
  principal and strict Store reopen helpers and register the evidence read
  controls.
- The v4 ledger (`98c52650`) changes the E profile description.
  The server config, persistent rebind and mounted transport confirm that
  `mcpCommands` is receipt-bound and that an initialized server changes it
  through offline `rebind-commands`.
  Mounted initialization still requires an authenticated Editor in either
  profile. The operation sets and their ceilings match the existing matrix.
- `run-healthy.mjs` (`49ec2fc7`) expands the explicit frontend selection
  to 99 source, one build and 11 browser cases and preserves full failure
  output. These are suite registrations and diagnostics.
- `bridge.py` and `test_bridge.py` (`164fd096`) add held-session `401` handling
  and four separate fake-transport regression selections.
  The owner drops the rejected cookie/CSRF pair and returns the failure.
  At most one fresh session issuance is attempted on the next independent
  operation. The bridge checks the issued and current actor, current CSRF,
  scope and journal binding as before, and a dispatched write stays `UNKNOWN`
  pending native reconciliation.
- `healthy_network_host.rs` (`3462286c`) matches the revised publication
  result shape and treats `NeedsReview` as a fixture failure.
  The three mounted saved-query operations still use the retained generation
  and current matching source binding.

This reinspection records source behavior and test selection.
The historical execution references still point to their original source and jobs.

## Mounted Editor ordered evidence batch

| Operation | Profile and fixture | Named case | Scope |
| --- | --- | --- | --- |
| `atlas.batch.execute` | E, disposable in-process Host with genuine generated Editor login and current CSRF | [`mounted_editor_ordered_evidence_batch_retains_child_receipts`](../../backend/src/http/agents/mounted_evidence_controls.rs) | One successful ordered batch of two distinct `atlas.evidence.create` children |

This case extends the batch coverage beyond the borrowed MCP fixture in M12
and the single-command mounted Editor controls.
The actual `atlas_records` schema admits the batch, and the MCP response
correlates to the root request with equal text and structured payloads.
The Host's read-only `/api/atlas/retained-intent` POST uses a fresh lookup ID
and returns the original root response and both original child receipts.
Canonical response validation checks ordered record and audit flattening.
Both distinct active revision-one records agree with native reads.
The root and children have separate operation IDs, and their child audit IDs
line up with the actual Editor-attributed SQLite audits in commit order.

The existing default backend-library command discovers the case.
This row records coverage separately from the historical PASS registry.
The [opt-in production-binary qualification](../contributing/verification.md#opt-in-mounted-editor-evidence-batch-through-the-production-binary)
checks the same ordered creates and retained receipts over loopback HTTPS.
It uses a caller-selected executable, generated Editor and Viewer accounts,
ordinary record GETs and the Editor's native operation-event page.
Other batch shapes, replay, failure outcomes, restart, bridge, WebMCP,
and configured installation and device acceptance remain outside this case.
Issue #288 remains open.

## Mounted MCP download handle expiry

| Operation | Profile and fixture | Named case | Scope |
| --- | --- | --- | --- |
| `atlas.asset.download` | M, disposable in-process Host with generated Editor and one UTF-8 original | [`mounted_mcp_asset_download_expires_at_issuer_deadline`](../../backend/src/http/agents/asset_download_healthy.rs) | Authenticated GET immediately before and at the issuer's five-minute deadline, plus fresh authorized issuance and GET |

The case extends M34's positive transfer to the exact expiry boundary.
It obtains the handle through mounted MCP and reads its stored deadline
from the Host's registry.
A fixture-local clock supplies monotonic time to the same issuance,
validation, and redemption decisions used by the Host.
At deadline minus one nanosecond, authenticated GET returns the exact original.
At the deadline, GET of that handle returns `403` with no attachment.
The same HTTP cookie and MCP session can still issue a distinct handle
for the same asset and retrieve identical bytes.

This case is discovered by the existing default backend-library command.
The source inventory refreshes the two reviewed issuer and fixture pins.
The fixture uses one generated asset and tests a request arriving at expiry.
Expiry during delivery, session expiry/revocation, process restart,
other formats, browser behavior, and installed acceptance remain open.

## Mounted MCP and stock WebMCP synthetic qualification

The named cases below record current source separately from the historical
PASS registry, using public main `71f86348` as the implementation baseline.
The default library and existing source-only WebMCP bootstrap discover them.
The backend cases use the production in-process router and generated accounts
with disposable SQLite. The frontend cases run the production stock mount and
family binding with the shared stock schemas and fake ports.

| Issue criterion and operation | Profile | Named case | Disposition and boundary |
| --- | --- | --- | --- |
| #288 atomic batch failure and readback, `atlas.batch.execute` | E | [`mounted_editor_batch_stale_child_refuses_without_partial_commit`](../../backend/src/http/agents/mounted_evidence_controls.rs) | Canonical root `CONFLICT` for a stale second child, both targets checked, selected factual tables equal. Real provider partial effects remain open. |
| #288 pagination/history and #289 fresh identity, `atlas.evidence.list` / `.history` | M | [`mounted_evidence_cursors_distinguish_query_and_access_issuance`](../../backend/src/http/agents/mounted_evidence_controls.rs) | A fresh login refuses the list cursor and changed filters refuse both cursors before either is used successfully. With the original filter, the same list cursor works under another MCP session with the original cookie and the same history cursor works under a fresh login by the same Editor. #533 continues to own old-session non-rebinding. |
| #288 bounded input and #289 scope, `atlas.evidence.create` | E | [`mounted_evidence_refuses_wrong_scope_and_invalid_input`](../../backend/src/http/agents/mounted_evidence_controls.rs) | Anonymous and foreign route refusal, wrong workspace/home in the envelope, wrong-typed and extra fields, and oversized declared-length refusal above 64 KiB. Refusals leave selected records/audit/receipt tables equal. A subsequent valid call uses the same session. |
| #288 cached read parity and #289 missing grant, `homebox.entity.list` | M | [`mounted_cached_homebox_list_requires_current_partition_grant`](../../backend/src/http/agents/mounted_evidence_controls.rs) | Authorized saved entities match native readback. Disabling Access to the retained partition causes a correlated refusal in the same MCP session with the same request target. Configured source and provider access remain open. |
| #288 operation admission/limits and #289 scope, `atlas.evidence.list` / `.create` / `.tombstone`, `atlas.batch.execute`, `homebox.field.list` | W | [`stock admission refuses wrong scope, invalid envelopes and unadmitted batch children before dispatch`](../../frontend/src/webmcp/healthy.examples.mjs) | Fake current admission intersects the existing executable binding. The unbound HomeBox arm stays unavailable. The batch remains admitted after context replacement, but a mixed batch with the now-unadmitted second child reaches no dispatch owner. Foreign scope and invalid list fields also reach no dispatch owner. |
| #288 delayed/unknown batch completion and #289 context replacement, `atlas.batch.execute` / `atlas.evidence.list` | W | [`stock replacement withholds delayed results and returns canonical unknown only after presentation`](../../frontend/src/webmcp/healthy.examples.mjs) | Preserves a fake owner's correlated `unknown-held` result and reconciliation direction, with no retry. Replacement withholds the delayed result and exposes the new read-only catalog. This does not create a durable unknown operation. |
| #288 media resolution, `atlas.asset.download` | W | [`stock download presents only same-origin paths with a valid owner lifetime`](../../frontend/src/webmcp/healthy.examples.mjs) | Exact canonical result survives a fake resolution port. Same-origin path with a five-minute budget is presented. Cross-origin and out-of-budget candidates supply no link. Native byte transfer and expiry remain separately evidenced by M34 and the exact-deadline case above. |
| #288 remap hold, `atlas.binding.remap` | L / E | [M33 and mounted Editor discovery](#concrete-findings-and-disposition) | Held. The existing native test refuses direct and mixed-batch remap, including a supplied but unproven receipt. The mounted profile omits the arm. A genuine approval issuer and atomic consumption remain owner work. |

Reinspection adds the mounted evidence fixture source pin and refreshes the
three changed WebMCP pins. Invocation now checks each batch child against the
current host admission already used by the discovery schema.
Shared domain authorization and the historical evidence entries stay intact.
Installed/configured scope, real provider effects, browser/device acceptance,
and the operator disable/recovery handoff remain open or deferred.

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
