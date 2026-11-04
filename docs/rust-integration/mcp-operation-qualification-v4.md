# MCP operation qualification ledger, version 4

Source baseline: `8d49266113bdd808e760f821adc8b6daac0e1cff`, inspected
29 October 2026. References #288 and index #277. This is a source/evidence
deliverable, not a new dispatcher, grant list, test suite or acceptance release.

Version 3 grouped operation classes but did not join individual IDs to execution
evidence. This ledger lists all 168 canonical IDs once, including family,
effect/confirmation class, actual owner/profile and a bounded disposition.
Counts after the M20–M32 increments: 74 QUALIFIED-SYNTHETIC paths,
9 BLOCKED for broader operation evidence,
80 UNSUPPORTED-GENERIC, two HELD and three FORBIDDEN. These are profile/evidence
dispositions, not the static catalog counts (154 pending, nine unsupported,
two held, three forbidden). A missing generic binding is not proof that a
dedicated application/native owner is absent.

QUALIFIED-SYNTHETIC means only the concrete operation/variant executed by the
listed real Access/StockService/disposable SQLite fixture. It does not qualify
all payloads, actors, profiles or installed operation. Binding create is the
unresolved synthetic path; explicit binding reviews cover rejected, retired
and accepted fixture decisions without adopting source presence. Batch evidence
is an ordered successful two-circuit atomic batch, not arbitrary partial/provider/unknown results. Every qualified row still
has G-full. Descriptors, protocol fixtures and fake downloads/read peers never
receive real-service qualification by themselves.

## Evidence identity and method

The original [run 40630687211 / backend job 122626144885](https://github.com/EzraCerpac/HouseAtlas/actions/runs/40630687211/job/122626144885)
passed the 19 MCP cases below on source `21c769e2dc947396acffafca04278249d215d8c8`
on 28 October. The newer resulting-main [run 40954769380 / backend job 123731954960](https://github.com/EzraCerpac/HouseAtlas/actions/runs/40954769380/job/123731954960)
explicitly repeats all 19 as `ok` on this ledger's source baseline on
29 October, between 21:09:32 and 21:10:33 UTC. The newer evidence is used for
the rows. No test was rerun locally or triggered to create this ledger.

The original [three-case bridge job 122753693719](https://github.com/EzraCerpac/HouseAtlas/actions/runs/40669890411/job/122753693719)
passed on PR head `5d626dc527565f4e6b2d3dc08f03cbbea629f73c`, merge candidate
`0d97fe97d5ef9cba117b0799679c97482b422897`, base `21c769e`.
The newer resulting-main [ordinary job 123731880594](https://github.com/EzraCerpac/HouseAtlas/actions/runs/40954769432/job/123731880594)
explicitly repeats all three as `ok` on this ledger's source baseline at
21:06:07 UTC, 29 October. B01–B03 are fake-owner bridge evidence, never private
connector/native/provider execution.

### Native evidence increment, 4 November 2026

M20 adds actual Access/StockService/disposable-SQLite evidence for
`atlas.evidence.create`, `atlas.evidence.list`, `atlas.evidence.get` and
`atlas.evidence.history`. The exact source head is
`d8c943a0b3159ab113d177daa8df2f44f0ad9c7f` (tree
`1f18a683c3626e8f4aaed71d1ec304fdf94154db`, base
`7bb93c7fb052715a075a12fec02f89b965ae90c1`). The existing default backend-library
[job 126504076115 / run 41809250428](https://github.com/EzraCerpac/HouseAtlas/actions/runs/41809250428/job/126504076115)
checked out that source head and explicitly emitted
`healthy_native_evidence_create_pages_get_and_reopened_history ... ok` at
09:44:51 UTC. The job completed with 231 passed, zero failed, 12 ignored and
three filtered out. No local test/build/formatter/Clippy ran.

The case creates three active fictional evidence records out of UUID order,
then completes the matching query in two native pages (2 + 1 records), forwarding
only the owner's returned opaque cursor and requiring terminal null. Every
response checks canonical text/structured equality, schema/request/command/scope
correlation, replayed=false and validated wire3 shape. Complete Unicode payload
equality preserves explicit unknown/null provenance. Native get and single
create-event history checks retain actual audit IDs, actor, target and intent
digest. After strict SQLite close/reopen, a fresh complete cursor chain and
get/full-history data must equal their pre-close native results. Access is
retained; neither process-restart credentials nor cursor persistence is claimed.

Only these four rows move from BLOCKED to narrow QUALIFIED-SYNTHETIC, changing
the prior 10/73 counts to 14/69. This is a filtered synthetic query, not an
installed inventory/census, all evidence lifecycle variants or multi-event
history pagination. It does not qualify W?, B?, actual endpoint identity or any
installed/media/WebMCP/expiry/unknown-outcome acceptance. G-full remains on each
row; the other 164 dispositions and static catalog statuses are unchanged.

### Native identity increment, 4 November 2026

M21 adds actual local Editor Access/StockService/disposable-SQLite evidence for
identity create, replace, tombstone, restore, list and history, plus lifecycle
readback on the already-qualified get row. Exact source head
`c34645d4fc48d378fcf2a8cf82a74aef169dd29f` (tree
`05511d0392500d91a1017e6113a850aa3f4a2d35`, base
`3b86a3db91cf8e8bb20c7cc5ef3d424d30728dbe`) was checked out by
[backend job 126518179694 / run 41813339489](https://github.com/EzraCerpac/HouseAtlas/actions/runs/41813339489/job/126518179694).
Its log explicitly emitted
`healthy_native_identity_lifecycle_lists_history_and_reopen ... ok` at
10:24:17 UTC. Totals: 232 passed, zero failed, 12 ignored and three filtered out.
Four formatting differences on historical initial head `9574b87` were corrected
exactly from hosted output; no assertions or expectations were weakened and no
local tests/build/formatter/Clippy ran.

Three fictional item identities are created out of UUID order. One follows
create/replace/tombstone/restore at revisions 1/2/3/4 with actual target revision
preconditions and the existing evidence-revision guard. Immutable physical kind
is preserved; replacement changes only evidence links. Native get validates
each lifecycle result. Complete owner-cursor list chains check UUID order and
active-only versus includeArchived selection through the tombstone/restore
sequence. Four-event history uses only owner-issued cursors and requires exact
event/actor/target/intent-digest correlation to committed results, chronological
operation order, explicit null create preimage and before/after digest continuity.
After strict SQLite close/reopen, fresh complete list/history traversals and get
results must equal the pre-close native records/events. Access is retained;
neither process/session restart nor arbitrary lifecycle/authority failure cases
are qualified.

The closed `atlas.schema.json` identityPayload contains only kind/evidenceIds;
it has no nullable/unknown payload variant. The case preserves valid empty and
nonempty evidence arrays, canonical create/approval nulls in correlated original
intents and the native explicit null audit preimage. It invents no payload field
and does not reclassify unrelated unknown/provenance or media behavior.

Only six identity dispositions advance from BLOCKED to narrow
QUALIFIED-SYNTHETIC (14/69 becomes 20/63). Get gains M21 evidence without changing
its disposition. M20, the other 161 operation rows and static catalog statuses
are preserved. G-full still applies; this filtered synthetic item query does not
qualify all identity kinds/variants, R/M/W?/B? profiles or installed execution.
The separate #289/#533 expiry/session evidence and its matrix are not changed.

### Native evidence lifecycle increment, 4 November 2026

M22 adds actual local Editor Access/StockService/disposable-SQLite evidence for
`atlas.evidence.tombstone` and `atlas.evidence.restore`. Exact source head
`54f4d1c569fc9e88a8cb38984696cef65777005f` (tree
`62185cae17973a2409b84cdc41850f03b8829abe`, base
`6ab8365f383fead09d9fc2596413e6cbc418a165`) was checked out by
[backend job 126533327556 / run 41817860552](https://github.com/EzraCerpac/HouseAtlas/actions/runs/41817860552/job/126533327556).
Its log explicitly emitted
`healthy_native_evidence_tombstone_restore_pages_history_and_reopen ... ok`
at 11:04:17 UTC. Totals: 236 passed, zero failed, 12 ignored and three filtered
out. Retained M20 and M21 cases also explicitly passed. No local qualification
ran and no source/CI repair was needed for this increment.

Three new fictional evidence records are created out of UUID order. Source is
null, references/supersedes are empty and no other record refers to their IDs;
the documented dependency guard set is empty. One follows create/tombstone/restore
with current target preconditions and revisions 1/2/3. Empty lifecycle command
payloads retain its complete original Unicode and explicit unknown/null content.
Canonical commit/get envelopes are validated by the existing native MCP client.
Complete filtered owner-cursor list chains require UUID order, active-only
exclusion and includeArchived inclusion. Three-event native history traverses
only actual returned cursors to terminal null and matches event IDs, actor,
target and original intent digests to the committed results, preserving null
create preimage and before/after digest continuity. Strict SQLite close/reopen
requires equal records and history entries through fresh complete cursor chains.
Access is retained; process/session restart and cursor persistence are not proved.

Only these two dispositions advance (20/63 becomes 22/61). Already-qualified
evidence create/get/list/history gain bounded M22 evidence without reclassification.
The other 162 operation rows and the M20/M21 registry entries are preserved.
Evidence replace stays FORBIDDEN append-only, with its row and all canonical
schemas/admission unchanged. This does not qualify retirement/restoration of
referenced or source/media-dependent evidence, other guard/authority variants,
R/M/W?/B? profiles, installed operations, transfer or unknown outcomes. G-full
remains on every qualified row; #288 remains open.

### Native valve and circuit increment, 4 November 2026

M23/M24 add actual local Editor Access/StockService/disposable-SQLite evidence
for stored valve and circuit descriptors. Exact source head
`3ee7ebaf5025e5d66e70d89b27a98eb507bdfced` (tree
`48dc0e0a0a9ec71633a0175742d1e7cdf6c4740c`, base
`48d3422b5e7ce473e9018456fb77001f10bc333c`) was checked out by
[backend job 126549553919 / run 41822479219](https://github.com/EzraCerpac/HouseAtlas/actions/runs/41822479219/job/126549553919).
Its log explicitly passed
`healthy_native_circuit_lifecycle_lists_history_and_reopen` at 11:44:16 UTC
and `healthy_native_valve_lifecycle_lists_history_and_reopen` in the same
second. Totals: 238 passed, zero failed, 12 ignored and three filtered out.
Retained M20–M22 cases also explicitly passed. Two formatting differences on
historical initial head `4e386dfd` were corrected exactly from hosted output;
assertions/expectations were unchanged and no local qualification ran.

Each case creates two fictional evidence records through the actual native
owner, then three descriptors out of UUID order. Circuit also creates an item
identity through the actual owner for the replacement panel. One descriptor
follows create/replace/tombstone/restore at revisions 1/2/3/4 with current target
CAS. Replacement guards cover both old and new evidence references; circuit
also guards the item-panel identity. Tombstone/restore guard the retained
replacement references. Valve begins with explicit null label and unknown
medium, then replaces label/medium/evidence. Circuit begins with explicit null
label/panel, then replaces label/evidence and uses a real item-panel endpoint.
Unicode labels and the valid null/unknown payloads remain exact. Companion
descriptors retain their original null/unknown fields through reopen.

The existing canonical MCP client checks request/command/scope/schema,
text/structured equality, replayed=false and original-intent digest correlation.
Commit/get readback requires exact records. Complete filtered owner-cursor lists
require UUID order and active-only/includeArchived selection through
replacement/tombstone/restore. Four-event history uses only returned owner
cursors to terminal null and checks exact event IDs, actor, target,
original-intent digest, committed state,
explicit null create preimage and before/after digest continuity. Strict SQLite
close/reopen requires equal descriptors/dependencies via native get, complete
fresh list chains and equal complete history entries. Access is retained;
process/session restart, persisted cursors and crash durability are not proved.

Seven valve dispositions and only the three remaining circuit lifecycle
dispositions advance from BLOCKED to narrow QUALIFIED-SYNTHETIC
(22/61 becomes 32/51). Four already-qualified circuit rows gain bounded M24
evidence without reclassification. Other 154 operation rows, M20–M22 entries,
static catalog statuses and #533 expiry/session fixtures are preserved.
These fictional descriptors invoke no physical control. This does not qualify
all media/relations, endpoint kinds, invalid/reversed guards, lifecycle/authority
failures, other valve media, R/M/W?/B? profiles, installed execution or unknown
outcomes. G-full remains on every qualified row and #288 remains open.

### Native proposed-place and documented-relation increment, 4 November 2026

M25/M26 add actual local Editor Access/StockService/disposable-SQLite evidence
for proposed location-semantics and ordinary documented-connection records.
Exact source head `0a51cfdd49ef528daa7ad9e2b0a818c7972d6cd9` (tree
`eecb467712f2e52d38161a73fa86b914f31bcf7e`, base
`fd8da69ad9ce10de936fdba0a89ccb390f402750`) was checked out by
[backend job 126564468589 / run 41826948683](https://github.com/EzraCerpac/HouseAtlas/actions/runs/41826948683/job/126564468589).
The log explicitly passed
`healthy_native_documented_relation_lifecycle_pages_and_reopen` at 12:16:01 UTC
and `healthy_native_location_semantics_lifecycle_pages_and_reopen` at 12:16:07.
Totals: 240 passed, zero failed, 12 ignored and three filtered out. Retained
M20–M24 cases also explicitly passed. One tuple-wrapping difference on historical
initial head `c12f0872` was corrected exactly from hosted output; no assertion
or expectation changed and no local qualification ran.

Both cases create two fictional evidence dependencies through the actual native
owner. M25 creates native location identities, while M26 creates native item
identities for both connection endpoints. Three family records are created out
of UUID order; one follows create/replace/tombstone/restore at revisions 1/2/3/4.
Current target CAS and the full union of old/new evidence and native identity
references are supplied on replacement. Tombstone/restore guard the retained
replacement references. No dependency, result or cursor is fabricated.

M25 stays proposed: unclassified semantics with omitted optional label/elevation
are replaced by proposed floor semantics with a Unicode label and explicit
unknown elevation, on another real native location identity. No null label,
null elevation, known metres or datum is invented. Unchanged companions preserve
their omitted fields through reopen. This does not establish accepted
classification, reviewed physical placement or actual floor/elevation acceptance.
M26 uses only documented-connection between native items, replacing actual
endpoints/evidence while preserving unknown medium and uncertainty. The initial
null uncertainty explanation and replacement Unicode explanation remain exact;
companions preserve their original nulls. No physical-access/location-membership,
HomeBox/provider endpoint, circuit/valve control or topology inference is tested.

The unchanged canonical MCP client checks complete request/command/scope/schema,
text/structured equality, replayed=false and committed original-intent digest.
Exact committed/get records, complete filtered UUID-ordered owner-cursor lists
and active-only/includeArchived selection through replacement/tombstone/restore
are required. Four-event history checks actual event/actor/target/intent
correlation, committed state, explicit null create preimage and before/after
digest continuity, to terminal null using only owner cursors. Strict SQLite
close/reopen requires equal family/dependency records through native get,
complete fresh list chains and equal complete history entries. Access is
retained; process/session restart, persisted cursors and crash durability are
not proved.

Only fourteen location-semantics/relation dispositions advance from BLOCKED
to narrow QUALIFIED-SYNTHETIC (32/51 becomes 46/37). Other 154 operation rows,
M20–M24 registry entries, static catalog statuses and #533 are preserved.
G-full remains: accepted/known-elevation semantics, other relation/endpoint
variants, arbitrary graph/guard/authority cases, R/M/W?/B? profiles, installed
execution, media and unknown outcomes remain unqualified. #288 remains open.

### Native unresolved-binding and correction-journal increment, 4 November 2026

M27/M28 add actual local Editor Access/StockService/disposable-SQLite evidence
for unresolved binding list/tombstone/restore and ordinary direct reconciliation
read/create/tombstone/restore. Exact source head
`b21981d8f85680040271e5ccc3438f6140499570` (tree
`c0edd94568fe753a2d8955e879694a29e9748b4e`, base
`a9ad6eb95ff611cf0a9e6cab060550a83b4f3388`) was checked out by
[backend job 126582182194 / run 41832233468](https://github.com/EzraCerpac/HouseAtlas/actions/runs/41832233468/job/126582182194).
The log explicitly passed
`healthy_native_unresolved_binding_lifecycle_pages_and_reopen` at 12:51:28 UTC
and `healthy_native_reconciliation_lifecycle_pages_and_reopen` at 12:51:31.
Totals: 242 passed, zero failed, 12 ignored and three filtered out. No source/CI
repair or local qualification ran for this increment.

Both cases create fresh fictional evidence and one native item identity through
the actual owners, then create bindings with unique fictional keys under the
existing fixture source configuration. Binding input omits sourceState; the
actual owner derives unresolved, which exact committed/readback payloads retain.
This asserts neither provider presence nor provider absence and contacts no
provider. Explicit null/unknown/Unicode evidence, canonical null approval/create
fields and complete required binding/journal payloads remain exact. Those closed
payloads have no nullable optional slot to invent.

M27 creates three bindings out of UUID order, reviews one rejected with new
evidence and complete old/new guards, then tombstones/restores it at revisions
1/2/3/4. Existing binding restore derives the genuine retained tombstoned
preimage from the authorized snapshot; this unresolved variant needs no Media
input or client-supplied original. It does not qualify restore of present-source
bindings requiring the separate presence owner or other derivation variants.

M28 creates three disjoint pairs of actual native bindings for the same item.
Real review commands commit retired source and accepted destination decisions
at revision 2 while both source states remain unresolved. These are synthetic
binding review statuses, not external identity adoption, source presence or
operational acceptance. Distinct retained compatible pairs and no outgoing
destination edges meet the native journal compatibility/no-cycle contract.
Three reviewed-correction journals are created with current evidence/identity
and actual revision-2 binding guards. One follows create/tombstone/restore at
revisions 1/2/3, retaining its immutable payload. No binding remap is invoked;
immutable reconciliation replacement stays FORBIDDEN.

The existing canonical MCP client validates full request/command/scope/schema,
text/structured equality, replayed=false and original-intent digest correlation.
Exact committed/get records, complete filtered UUID-ordered native cursor lists
and active-only/includeArchived selection through tombstone/restore are required.
Four-event binding and three-event journal history use only owner-issued cursors
to terminal null, matching actual event IDs, actor, target, original intent and
committed state, plus null create preimage and digest continuity. Strict SQLite
close/reopen requires equal family/dependency records via native get and equal
fresh complete list/history traversals. Access is retained; process/session
restart, cursor persistence and crash durability remain unproved.

Only nine dispositions advance (46/37 becomes 55/28): three binding and six
reconciliation paths. Four already-qualified binding rows gain bounded evidence
without reclassification; other 155 operation rows, M20–M26 registry entries,
static catalog statuses and #533 are preserved. G-full still excludes other
source states/reasons, graph/guard/authority variants, actual remap, R/M/W?/B?
profiles, installed/media/WebMCP/device and unknown outcomes. #288 stays open.

### Native geometry and missing-asset metadata increment, 4 November 2026

M29/M30 add actual local Editor Access/StockService/disposable-SQLite evidence
through the existing `GeometryMetadata` fixture ingress. Exact source head
`88b3f60196e8352b8cfe8481b8fa4b0cfded98d8` (tree
`41561c8f6841473289fccc4dca0eb2a7ed5f18ec`, base
`b40affea921411bedf3ee27c986b710664902d6c`) was checked out by
[backend job 126608113001 / run 41839672521](https://github.com/EzraCerpac/HouseAtlas/actions/runs/41839672521/job/126608113001).
The log explicitly emitted
`healthy_native_geometry_metadata_pages_history_and_reopen ... ok` at
13:42:56 UTC and `healthy_native_missing_asset_metadata_history_and_reopen ... ok`
at 13:42:57 UTC. Totals: 244 passed, zero failed, 12 ignored and three filtered
out. Initial head `c6fc4ac2` failed compilation before tests with an incorrect
module import. The correct MCP identity import and exact hosted formatting
repairs changed no fixture assertions or expectations. No local
test/build/formatter/Clippy ran; no qualification follows from that failed head.

M29 creates three native geometry metadata records out of UUID order against
the actual retained, missing original asset. Fresh evidence and a native location
identity are created through their real owners. Companion mappings are empty;
the primary mapping is proposed with `homeboxEntity: null`. Unknown units,
nullable producer version/scale/transform/previous geometry and Unicode fields
are preserved. `importedAt` is supplied only by the real stock owner, then
compared unchanged through get, list, history and reopen; it is never submitted
as fabricated input. Guarded create/tombstone/restore revisions 1/2/3 use current
target and actual dependency revisions. Complete filtered active/archive list
chains use one-record native pages, UUID order and only owner-issued cursors.
Three genuine operation events check canonical request/result correlation,
actual event/actor/target/original-intent identity, null create preimage and digest
continuity. The original asset remains exactly unchanged.

M30 reads the actual seeded asset, compares it with the existing fixture ingress
and requires initially empty history: seed revision 1 and `lastAuditId` supply
no create audit prehistory. Real download-only review, tombstone and restore
commit revisions 2/3/4 with complete old/new evidence guards. Availability remains
missing and renderer receipt is null. Canonical commit/get/list projections omit
only `storageKey`; authorized native raw reads preserve the full record and key.
The singleton/empty active/archive lists terminate with null cursors and do not
qualify multi-page asset listing. Complete three-event history does use actual
owner-issued cursors, retaining event/actor/target/intent identity. Its first
non-null preimage digest equals the actual full seeded record's native digest,
and each later before/after digest equals the real retained record and links
to the preceding event. No seed create event or media-byte proof is invented.

Both cases strictly close/reopen SQLite, then require exact native get, fresh
complete list/history chains and full retained-record equality where available.
Access is retained; process/session restart, cursor survival and crash durability
are not established. Only twelve dispositions advance (55/28 becomes 67/16):
six geometry metadata and six missing-asset operations. Other 156 operation rows,
M20–M28, #533 and static catalog statuses remain unchanged. G-full still excludes
other payload/guard/authority/profile variants, actual byte availability or
transfer, imported-shape validity, accepted mapping/placement, renderer,
installation and WebMCP/device acceptance. Asset creation remains dedicated,
geometry replacement forbidden, and #288 remains open.

### Cached HomeBox and saved Network increment, 4 November 2026

M31 registers the existing cached HomeBox example body as one ordinary default
backend-library test, preserving its standalone entry point and all assertions.
Exact corrected source head `ebfad7e220a0cbd1ff2ca013971ee0a5b7d9f211` (tree
`14237f1673a222c5138c28aa26b67e1fc91e62a1`, base
`c2a73c820dc3ec34dfeed6c0ffa1692ef07600e6`) was checked out by
[backend job 126628500729 / run 41845668770](https://github.com/EzraCerpac/HouseAtlas/actions/runs/41845668770/job/126628500729).
It explicitly passed `healthy_cached_homebox_stock_and_mcp_reads` at
14:17:38 UTC, finishing with 245 passed, zero failed, 12 ignored and three
filtered out. The test-only self alias is confined to the backend library root,
so the shared example keeps its ordinary external-library import under either
target. Initial head `127b32a4` also passed its library run; review identified
and corrected that dual-target alias ambiguity and missing scope documentation.
No assertion changed or local test/build/formatter/Clippy qualification ran.

M31 uses real Viewer Access, source registrations, SQLite, native StockService
and borrowed in-process MCP for homebox.entity.get/list and
homebox.location.get/list. Public fixture collection IDs are consistently rebound
to UUIDs; this is not opaque-ID compatibility. Native and MCP structured/text
results are equal and wire-validated, with independent expected checks for
selected identity/name/original timestamps and stale sourceStatus. Each list
returns one resource at pageSize 100, cursor null, includeArchived false and
terminal nextCursor null. No continuation, search or archive variant is proved.
Access/Store reopen precedes the reads, and before/after snapshots remain equal;
there is no second post-read reopen or cursor-persistence claim. Private
disposable-file handling and the example body remain unchanged. No refresh,
transport/provider call, mediated history, native tags/fields/maintenance or
installed HomeBox acceptance is established.

M32 reconciles already executed saved Network operations without adding a test
or dispatch. On the same corrected source, existing Linux
[source job 126628501132 / run 41845668770](https://github.com/EzraCerpac/HouseAtlas/actions/runs/41845668770/job/126628501132)
explicitly emitted the genuine Editor/current-CSRF mounted-MCP all-three saved
query PASS at 14:18:21 UTC, followed by the exactly-one-passive-GET and disposable
certificate/key cleanup PASS. Prior resulting-main
[job 126617043586 / run 41842353571](https://github.com/EzraCerpac/HouseAtlas/actions/runs/41842353571/job/126617043586)
on `c2a73c82` emitted the same passes at 13:57:43 UTC. The unchanged
`healthy_network_host.rs` and existing `healthy-network-loopback.py` driver use
the actual canonical Access/lifecycle/source/partition owners and native
NetworkBinding with reviewed-origin custody-aware publication from one disposable
TLS inventory GET. Genuine Viewer HTTP-owner reads precede fresh Editor MCP
initialization/discovery and network.inventory.get/snapshot.get/history.get.
Full canonical request/result correlation, wire validation and complete data
equality with those actual HTTP reads are checked, with no extra upstream GET
during MCP reads. Scope is one synthetic reviewed-allowlist generation, five
nodes, three inventory/snapshot relations and one history relation, retaining
the selected unresolved endpoint with null ID. Native archive close/reopen
requires exact original bytes/hash/registration/generation; it is not a reopened
Host/MCP execution, multi-generation history, household installation or
revocation/failure/concurrency proof. This is distinct from fake saved-query peers.

Only seven dispositions advance (67/16 becomes 74/9): four cached HomeBox and
three saved Network reads. Other 161 operation rows, M20–M30, #533 and static
catalog statuses remain unchanged. G-full still excludes other profiles and
variants, bridge/WebMCP/device and installed acceptance. No workflow command,
provider harness, production admission or authority changes. #288 remains open.

### Native remap hold source increment, 4 November 2026

The exact-impact-human contract requires a separate trusted human approval
issuer bound to actor/home/target/intent/impact/epochs/expiry and atomic
consumption. This composition has no remap-specific issuer/consumption owner;
null or supplied UUID receipt fields, an authenticated session and a lower-level
planner mapping cannot supply that authority. Native Editor discovery now uses
the same closed operation predicate as shared-root execution, excluding remap
and refusing singles or any containing batch before owner work. Other direct,
derived and batch operations remain admitted. Canonical schemas/catalog status,
bridge exact-approval holds and existing approval owners are unchanged.

M33 adds one explicit ordinary in-process actual Access/StockService/SQLite
hold case, currently NOT RUN pending hosted qualification. It covers null and
unproven receipt UUIDs, direct singles and containing mixed batches in both
orders, MCP discovery/refusal, exact row equality in ten owned
record/reservation/audit/receipt tables after each attempt, strict store reopen
with retained Access and a subsequent permitted direct/derived batch. This is
negative hold evidence only, never positive remap qualification or an issuer.

Historical repaired head `ea7bb52f` in
[backend job 126660319054 / run 41854746975](https://github.com/EzraCerpac/HouseAtlas/actions/runs/41854746975/job/126660319054)
ran the case but failed before refusal
attempts because a substring assertion searched complete tool descriptors,
including unchanged canonical output schemas (245 passed, one failed).
That failed execution establishes
no M33 qualification. The corrected fixture resolves actual input top-level and
batch-child arms, requires remap absent and permitted arms present, and validates
canonical refused/permitted requests against those advertised input schemas.
Output contracts are preserved. NOT RUN refers to this corrected fixture until
its complete hosted execution is observed.

The existing specialized root example replaces its invalid positive remap with
explicit refusal and unchanged native snapshot. Ordinary supported binding
creation supplies subsequent setup. Its independent lower-level seven-child
Store fixture retains synthetic authorization and derivation coverage, accurately
labelled as neither root admission nor human approval. No production bypass,
receipt fabrication, new grant/endpoint/issuer or workflow is introduced.
The remap row remains BLOCKED; the 74/9 counts and other 167 rows' dispositions
are unchanged. Installed exposure, actual human approval/consumption and all
broader #288 acceptance remain open.

| Key | Exact existing case | Observed result | Method and limit |
| --- | --- | --- | --- |
| M01 | `transports::mcp::healthy_download::healthy_asset_download_sealed_codecs_preserve_canonical_wire` | PASS | fake download codec |
| M02 | `transports::mcp::healthy_download::healthy_native_queries_download_and_record_owner_composition` | PASS | domain composition with fake authority/download peers |
| M03 | `transports::mcp::healthy_examples::healthy_catalog_pages_use_current_principal` | PASS | protocol/catalog fake peers |
| M04 | `transports::mcp::healthy_examples::healthy_history_fixtures_preserve_bare_array_and_order` | PASS | bare-array fake history fixtures |
| M05 | `transports::mcp::healthy_examples::healthy_lifecycle_and_host_close` | PASS | protocol/session fake peers |
| M06 | `transports::mcp::healthy_examples::healthy_native_json_numbers_and_literal_object_keys` | PASS | numeric/literal-key protocol preservation only |
| M07 | `transports::mcp::healthy_examples::healthy_record_and_mutation_fixture_mapping` | PASS | mutation/read fixture mapping only |
| M08 | `transports::mcp::healthy_mappings::healthy_admitted_family_input_descriptors` | PASS | descriptor schema selection only |
| M09 | `transports::mcp::healthy_mappings::healthy_finite_operation_mappings` | PASS | 168-ID metadata join only |
| M10 | `transports::mcp::healthy_mappings::synthetic_admitted_batch_child_descriptors` | PASS | batch-child descriptor selection only |
| M11 | `transports::mcp::healthy_native::healthy_native_catalog_context_and_core_reads` | PASS | real Access/SQLite reads plus manually assembled stock DTO; partial only |
| M12 | `transports::mcp::healthy_local_atlas::healthy_local_atlas_native_mutations_batch_and_reopened_history` | PASS | real Access/StockService/SQLite create/review/batch and reopened get/history |
| M13 | `transports::mcp::lifecycle::synthetic_contracts::cancellation_close_and_future_drop_preserve_committed_audit` | PASS | real committed circuit under cancellation/close/drop plus history |
| M14 | `transports::mcp::lifecycle::synthetic_contracts::configured_input_byte_ceiling_accepts_exact_and_closes_one_over` | PASS | real identity read at input ceiling; no-dispatch oversize |
| M15 | `transports::mcp::lifecycle::synthetic_contracts::configured_response_ceiling_preserves_committed_circuit_without_redispatch` | PASS | real circuit commit under bounded response, duplicate ID and fresh get/history |
| M16 | `transports::mcp::lifecycle::synthetic_contracts::native_circuit_list_pages_preserve_canonical_records_and_empty_query` | PASS | real circuit list/get with native cursors, empty query |
| M17 | `transports::mcp::lifecycle::synthetic_contracts::read_cancellation_preserves_exact_id_and_drains_owner_completion` | PASS | real identity read cancellation/ID control |
| M18 | `transports::mcp::lifecycle::synthetic_contracts::rotation_fences_late_result_old_credentials_and_replacement_identity` | PASS | real identity read rotation/current authority control; not expiry |
| M19 | `transports::mcp::lifecycle::synthetic_contracts::revocation_and_membership_change_withhold_completed_native_reads` | PASS | real identity read revocation/membership control; not expiry |
| M20 | `transports::mcp::healthy_local_atlas::healthy_native_evidence_create_pages_get_and_reopened_history` | PASS | real Access/StockService/SQLite; three evidence creates, complete filtered native cursor traversal, get/single-create history equality after strict store reopen; retained Access |
| M21 | `transports::mcp::healthy_local_atlas::identity::healthy_native_identity_lifecycle_lists_history_and_reopen` | PASS | real local Editor/StockService/SQLite; item create/guarded replace/tombstone/restore, complete filtered active/archive lists and four-event history, get and strict store-reopen equality; retained Access |
| M22 | `transports::mcp::healthy_local_atlas::evidence_lifecycle::healthy_native_evidence_tombstone_restore_pages_history_and_reopen` | PASS | real local Editor/StockService/SQLite; unreferenced evidence create/tombstone/restore, unknown/null payload retention, complete filtered active/archive lists and three-event history, strict reopen equality; retained Access |
| M23 | `transports::mcp::healthy_local_atlas::infrastructure::healthy_native_valve_lifecycle_lists_history_and_reopen` | PASS | real local Editor/StockService/SQLite; guarded valve descriptor create/replace/tombstone/restore, complete filtered active/archive lists, four-event history and strict reopen equality; retained Access |
| M24 | `transports::mcp::healthy_local_atlas::infrastructure::healthy_native_circuit_lifecycle_lists_history_and_reopen` | PASS | real local Editor/StockService/SQLite; guarded circuit descriptor lifecycle with actual item-panel dependency, complete filtered active/archive lists, four-event history and strict reopen equality; retained Access |
| M25 | `transports::mcp::healthy_local_atlas::places_relations::healthy_native_location_semantics_lifecycle_pages_and_reopen` | PASS | real local Editor/StockService/SQLite; proposed unclassified/floor-unknown location semantics, guarded lifecycle, complete filtered active/archive lists, four-event history and strict reopen equality; retained Access |
| M26 | `transports::mcp::healthy_local_atlas::places_relations::healthy_native_documented_relation_lifecycle_pages_and_reopen` | PASS | real local Editor/StockService/SQLite; documented-connection with native item endpoints and unknown medium/uncertainty, guarded lifecycle, complete filtered active/archive lists, four-event history and strict reopen equality; retained Access |
| M27 | `transports::mcp::healthy_local_atlas::bindings_reconciliation::healthy_native_unresolved_binding_lifecycle_pages_and_reopen` | PASS | real local Editor/StockService/SQLite; unresolved create/rejected review/tombstone/original-derived restore, complete filtered active/archive lists, four-event history and strict reopen equality; retained Access |
| M28 | `transports::mcp::healthy_local_atlas::bindings_reconciliation::healthy_native_reconciliation_lifecycle_pages_and_reopen` | PASS | real local Editor/StockService/SQLite; reviewed-correction create/tombstone/restore over real retired/accepted unresolved binding pairs, complete filtered active/archive lists, three-event history and strict reopen equality; no remap; retained Access |
| M29 | `transports::mcp::healthy_local_atlas::media_metadata::healthy_native_geometry_metadata_pages_history_and_reopen` | PASS | real local Editor/StockService/SQLite; missing-original geometry metadata create/get/list/history/tombstone/restore, owner import time, empty/proposed-null-external mappings, complete filtered cursor chains and strict reopen; retained Access; no bytes/shape/accepted placement |
| M30 | `transports::mcp::healthy_local_atlas::media_metadata::healthy_native_missing_asset_metadata_history_and_reopen` | PASS | real local Editor/StockService/SQLite; seeded missing asset get/list/history/download-only review/tombstone/restore, public projection, initially empty history and actual non-null seed digest anchor, three-event cursor chain and strict reopen; singleton/empty lists only; no transfer |
| M31 | `http::providers::homebox_stock_healthy::healthy_cached_homebox_stock_and_mcp_reads` | PASS | real Viewer Access/source registrations/reopened SQLite/native StockService and borrowed MCP; four cached get/list reads, stale dates, canonical parity and unchanged snapshots; UUID-rebound collection, singleton first-page lists only; no provider IO or post-read reopen |
| M32 | `healthy-network-loopback.py` driving `healthy-network-root-router` / `healthy_network_host.rs` mounted-MCP saved-query loop | PASS | existing real canonical Access/native NetworkBinding/disposable TLS publication; genuine Editor/current-CSRF MCP for three saved reads equals actual Viewer HTTP-owner data, five nodes/one generation/unresolved endpoint; one upstream GET total, immutable archive reopen only |
| M33 | `transports::mcp::healthy_local_atlas::remap_hold::native_remap_hold_preserves_store_and_permitted_batch` | NOT RUN | actual synthetic Editor/StockService/SQLite hold: null/unproven receipt singles and both mixed-batch orders, current MCP refusal, exact retained rows/reopen and permitted direct/derived batch; no remap approval or success |
| B01 | `healthy_large_read_page` | PASS | Fake bridge evidence-list/cursor forwarding and geometry page below 2 MiB; no native cursor/record owner |
| B02 | `denial_read_profile_bounds` | PASS | Fake bridge scope/page/response refusal and retained read availability; no native expiry or provider execution |
| B03 | `denial_read_correlation` | PASS | Fake bridge request ID/command/scope mismatch refusal; no actual private connector invocation |

M01–M02 live in `backend/src/transports/mcp/healthy_download.rs`;
M03–M07 in `healthy_examples.rs`; M08–M10 in `healthy_mappings.rs`;
M11 in `healthy_native.rs`; M12 in `healthy_local_atlas.rs`; M13–M19 in
`lifecycle/synthetic_contracts.rs`; M20 in `healthy_local_atlas.rs`. B01–B03 are the three exact existing
`tools/houseatlas-mcp-bridge/test_bridge.py` selections. Their finite ordinary-CI
exception remains unchanged. Shared M08/M09 metadata coverage applies to every
row but is deliberately not repeated as operation-execution evidence.

M21 lives in `backend/src/transports/mcp/healthy_identity.rs`, a test-only child
of `healthy_local_atlas`; it reuses the same actual canonical MCP client and
command helpers. No lifecycle fixture or workflow selection is replaced.

M22 lives in `backend/src/transports/mcp/healthy_evidence_lifecycle.rs`, another
test-only child, reusing M21's actual factory/client/reopen helper through parent
visibility only. M20/M21 assertions and #533 lifecycle fixtures remain unchanged.

M23/M24 live in `backend/src/transports/mcp/healthy_infrastructure.rs`, a
test-only child reusing the unchanged actual M21 factory and canonical MCP client.
Only its module declaration is added; M20–M22 and lifecycle assertions are preserved.

M25/M26 live in `backend/src/transports/mcp/healthy_places_relations.rs`, reusing
M21's real factory and M23/M24's canonical record/list/history assertions through
test-only parent visibility. Shared list selection takes the same valve/circuit
kind/query tuple as before; all prior assertions and M20–M24 entries remain intact.

M27/M28 live in `backend/src/transports/mcp/healthy_bindings_reconciliation.rs`,
reusing the unchanged actual M21 factory and M23/M24 canonical read/history
helpers. Only its test-only child declaration is added; prior helpers and
M20–M26 assertions remain intact.

M29/M30 live in `backend/src/transports/mcp/healthy_media_metadata.rs`, reusing
M21's real factory and canonical MCP helpers. The test-only factory's default
still delegates to exactly the Standard profile; an explicit profile option
selects the existing GeometryMetadata ingress only for these two cases.
No production owner, lifecycle fixture or workflow selection changes.

M31 reuses `backend/src/http/providers/homebox_stock_healthy.rs` as both its
existing example and a test-only library module; the fixture body is not copied.
M32 already runs from `tools/rust-integration/examples/healthy_network_host.rs`
through the explicit existing Linux source-job command. It is separate from
the default backend-library test count. AGENTS and the verification guide name
the new M31 scope and reconcile the eleven already merged M20–M30 cases plus
#533's three retained cases; those documentation changes add no execution.

## Profile and domain owner key

These are source applicability conditions. They do not claim fresh installed
capability discovery, and role/catalog metadata never substitutes for actual
current Access and owner authorization.

| Key | Profile / real owner and admission | Class, limits and implementation boundary |
| --- | --- | --- |
| R | Borrowed `http::agents::mcp::bind_read` / StockService / `capabilities::reads_for` | 30 Atlas read IDs + four cached HomeBox IDs; two mediated-history IDs only when history is enabled |
| L | `bind_local_atlas` / same StockService under actual Editor issuance | Atlas subset of admitted(core, principal), excluding download; no provider/download owner is added |
| M | `bind_owned_admission` / OwnedStockService | R plus asset-download handles, three saved Network reads and five native HomeBox reads only with matching configured scope/partition |
| E | Explicit mounted Editor composition / same native stock planner/store | 31 direct + five admitted derived Atlas IDs and non-remap batch; remap held pending genuine approval issuer/consumption; independent root/child admission, CAS/guards and current-principal transaction fence |
| W? | `bindAtlasService` and `bindCommandFamilies` / injected StockDispatchPort | Seven bindable families only; executable owner IDs intersect current session/scope admission. No per-operation end-to-end WebMCP service pass is inferred from native or fake adapter tests |
| W7-unbound | Other three catalog families | The seven-family helper supplies no binding; separately injected gateway owners remain their own qualification |
| B-read? | `Bridge.read` / fresh native admission and catalog effect=read | Page size 1–8, request envelope 16 KiB, encoded query 32 KiB, response 2 MiB plus JSON depth/nodes; native domain owns target and cursor lineage |
| B-write? | `Bridge.write` / existing Atlas WRITES or qualified batch only | Current Editor/CSRF/CAS/guards/idempotency and durable outcome rules; native reason at most 1024 characters; remap needs exact-impact owner |
| B-unavailable | No allowed bridge form | No grants or replacement dispatch may be inferred; native dedicated application routes are separate |
| D | Dedicated native Media HTTP owner | Asset/scene creation is absent from generic stock/MCP admission; generic bridge upload/scene-create flags remain false |
| A-read | Native Atlas query/Store via StockService | Scope/disclosure, stable ID ordering and owner-issued cursor; 1–100 native page size; unknowns/nulls preserved by owner validation |
| A-direct | `atlas_direct_operation` / planner, Store | Original-principal mutation fence; frozen record/guard/approval and durable audit/intent owners |
| A-derived | `atlas_derived_operation` / specialized owner derivation and Store | Binding/geometry/asset owner inputs required; mapping alone supplies no receipt or approval |
| A-batch | Shared ordered native planner / Store | Every ordered child checked; canonical 1–100 children, no transport business rules |
| A-download | Existing mounted issuer/redemption handle owner | Core-only L excludes this ID; codec/token success does not establish byte transfer |
| H-cache | HomeBox retained generation query owner | Exactly entity/location get/list; passive cache reads, no upstream write |
| H-mediated | HomeBox configured mediated-history owner | Exactly entity/location **mediated-history**, not entity/location history; historical owner enablement required |
| H-native | Scoped NativeHomeBoxReadBinding | Exactly entity.tags.get, field get/list, maintenance get/list; no other HomeBox ID inferred |
| N-saved | Saved Network query owner | inventory/snapshot/history only; matching configured source, retained generation, no collection demand |
| D-native | Dedicated asset/scene creation owner | Not available through these generic stock profiles; dedicated native custody qualification remains separate |
| not-bound | No R/L/M/E admission in reviewed source | Catalog/family may map the ID, but the generic host supplies no executable owner/admission for it |

Source owner/admission pins:
[capabilities](https://github.com/EzraCerpac/HouseAtlas/blob/8d49266113bdd808e760f821adc8b6daac0e1cff/backend/src/http/agents/capabilities.rs),
[mounted/borrowed service](https://github.com/EzraCerpac/HouseAtlas/blob/8d49266113bdd808e760f821adc8b6daac0e1cff/backend/src/http/agents/mcp.rs),
[direct planner](https://github.com/EzraCerpac/HouseAtlas/blob/8d49266113bdd808e760f821adc8b6daac0e1cff/backend/src/domain/stock/atlas_commands.rs),
[derived planner](https://github.com/EzraCerpac/HouseAtlas/blob/8d49266113bdd808e760f821adc8b6daac0e1cff/backend/src/domain/stock/derived_atlas_commands.rs),
[cached/mediated HomeBox](https://github.com/EzraCerpac/HouseAtlas/blob/8d49266113bdd808e760f821adc8b6daac0e1cff/backend/src/http/providers/homebox_stock.rs),
[native HomeBox](https://github.com/EzraCerpac/HouseAtlas/blob/8d49266113bdd808e760f821adc8b6daac0e1cff/backend/src/http/providers/homebox_native.rs),
[saved Network](https://github.com/EzraCerpac/HouseAtlas/blob/8d49266113bdd808e760f821adc8b6daac0e1cff/backend/src/providers/network/saved_queries.rs),
[WebMCP family binding](https://github.com/EzraCerpac/HouseAtlas/blob/8d49266113bdd808e760f821adc8b6daac0e1cff/frontend/src/webmcp/coverage/families.ts),
[bridge](https://github.com/EzraCerpac/HouseAtlas/blob/8d49266113bdd808e760f821adc8b6daac0e1cff/tools/houseatlas-mcp-bridge/bridge.py).
The effect/confirmation column below is retained catalog metadata; “none” never
waives Access, guards, domain approval or a separate Media receipt requirement.

## Operation rows

All IDs/families/classes/statuses come from the
[canonical catalog at the same source pin](https://github.com/EzraCerpac/HouseAtlas/blob/8d49266113bdd808e760f821adc8b6daac0e1cff/contracts/stock-wire3/agent/operation-catalog.json).
UNSUPPORTED-GENERIC describes the reviewed R/L/M/E host profiles; it does not
retire a separate application feature. A W? or B? entry is conditional, not an
executable capability promise. Evidence cells refer to the exact registry above;
M01/M02/M11/B01–B03 are partial or fake-owner evidence and cannot qualify a native
end-to-end operation. A native synthetic pass does not qualify W? or B? automatically.

| Operation | Family | Static catalog status | Effect; confirmation metadata | Actual owner; profiles | Execution evidence | Disposition; remaining requirement |
| --- | --- | --- | --- | --- | --- | --- |
| `atlas.identity.get` | atlas_records | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | M14, M17, M18, M19, M21 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.identity.list` | atlas_records | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | B02, M21 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.identity.history` | atlas_records | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | M21 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.identity.create` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | M21 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.identity.replace` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | M21 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.identity.tombstone` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | M21 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.identity.restore` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | M21 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.binding.get` | atlas_bindings | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | M12, M27, M28 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.binding.list` | atlas_bindings | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | M27 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.binding.history` | atlas_bindings | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | M12, M27 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.binding.create` | atlas_bindings | supported-pending-qualification | write; none | A-derived; L,E (owner inputs); W?; B-write? | M12, M27, M28 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.binding.review` | atlas_bindings | supported-pending-qualification | write; none | A-derived; L,E (owner inputs); W?; B-write? | M12, M27, M28 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.binding.tombstone` | atlas_bindings | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | M27 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.binding.restore` | atlas_bindings | supported-pending-qualification | write; none | A-derived; L,E (owner inputs); W?; B-write? | M27 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.evidence.get` | atlas_records | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | M02, M11, M20, M22 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.evidence.list` | atlas_records | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | B01, B02, B03, M20, M22 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.evidence.history` | atlas_records | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | M11, M20, M22 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.evidence.create` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | M20, M22 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.evidence.tombstone` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | M22 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.evidence.restore` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | M22 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.location-semantics.get` | atlas_records | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | M25 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.location-semantics.list` | atlas_records | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | M25 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.location-semantics.history` | atlas_records | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | M25 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.location-semantics.create` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | M25 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.location-semantics.replace` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | M25 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.location-semantics.tombstone` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | M25 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.location-semantics.restore` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | M25 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.circuit.get` | atlas_records | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | M12, M15, M16, M24 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.circuit.list` | atlas_records | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | M16, M24 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.circuit.history` | atlas_records | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | M12, M13, M15, M24 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.circuit.create` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | M12, M13, M15, M16, M24 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.circuit.replace` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | M24 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.circuit.tombstone` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | M24 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.circuit.restore` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | M24 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.valve.get` | atlas_records | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | M23 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.valve.list` | atlas_records | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | M23 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.valve.history` | atlas_records | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | M23 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.valve.create` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | M23 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.valve.replace` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | M23 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.valve.tombstone` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | M23 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.valve.restore` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | M23 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.relation.get` | atlas_records | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | M26 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.relation.list` | atlas_records | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | M26 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.relation.history` | atlas_records | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | M26 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.relation.create` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | M26 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.relation.replace` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | M26 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.relation.tombstone` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | M26 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.relation.restore` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | M26 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.geometry.get` | atlas_media_geometry | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | M29 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.scene-association.get` | atlas_media_geometry | supported-pending-qualification | read; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-admission |
| `atlas.geometry.list` | atlas_media_geometry | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | B01, M29 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.scene-association.list` | atlas_media_geometry | supported-pending-qualification | read; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-admission |
| `atlas.geometry.history` | atlas_media_geometry | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | M29 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.scene-association.history` | atlas_media_geometry | supported-pending-qualification | read; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-admission |
| `atlas.geometry.create` | atlas_media_geometry | supported-pending-qualification | write; none | A-derived; L,E (owner inputs); W?; B-write? | M29 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.scene-association.create` | atlas_media_geometry | supported-pending-qualification | write; none | D-native; D only; not generic; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-dedicated |
| `atlas.geometry.tombstone` | atlas_media_geometry | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | M29 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.geometry.restore` | atlas_media_geometry | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | M29 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.asset.get` | atlas_media_geometry | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | M30 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.asset.list` | atlas_media_geometry | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | M30 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.asset.history` | atlas_media_geometry | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | M30 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.asset.create` | atlas_media_geometry | supported-pending-qualification | write; none | D-native; D only; not generic; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-dedicated |
| `atlas.asset.review` | atlas_media_geometry | supported-pending-qualification | write; none | A-derived; L,E (owner inputs); W?; B-write? | M30 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.asset.tombstone` | atlas_media_geometry | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | M30 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.asset.restore` | atlas_media_geometry | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | M30 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.reconciliation.get` | atlas_records | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | M28 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.reconciliation.list` | atlas_records | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | M28 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.reconciliation.history` | atlas_records | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | M28 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.reconciliation.create` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | M28 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.reconciliation.tombstone` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | M28 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.reconciliation.restore` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | M28 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.binding.remap` | atlas_bindings | supported-pending-qualification | write; exact-impact-human | native-held; no R/L/M/E; W?; B-write? (separate exact owner required) | M33 NOT RUN | BLOCKED; G-remap |
| `atlas.asset.download` | atlas_media_geometry | supported-pending-qualification | read; none | A-download; M (issuer/redemption); W?; B-read? | M01, M02 | BLOCKED; G-transfer |
| `homebox.entity.get` | homebox_entities_locations | supported-pending-qualification | read; none | H-cache; R,M (cache scoped); W?; B-read? | M31 | QUALIFIED-SYNTHETIC; G-full |
| `homebox.entity.list` | homebox_entities_locations | supported-pending-qualification | read; none | H-cache; R,M (cache scoped); W?; B-read? | M31 | QUALIFIED-SYNTHETIC; G-full |
| `homebox.entity.history` | homebox_entities_locations | unsupported-capability | read; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.entity.create` | homebox_entities_locations | supported-pending-qualification | write; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.entity.update` | homebox_entities_locations | supported-pending-qualification | write; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.entity.archive` | homebox_entities_locations | supported-pending-qualification | write; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.entity.unarchive` | homebox_entities_locations | supported-pending-qualification | write; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.entity.reparent` | homebox_entities_locations | supported-pending-qualification | write; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.entity.delete` | homebox_entities_locations | supported-pending-qualification | write; permanent-delete-human | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.entity.restore-deleted` | homebox_entities_locations | unsupported-capability | write; permanent-delete-human | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.entity.duplicate` | homebox_entities_locations | supported-pending-qualification | write; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.location.get` | homebox_entities_locations | supported-pending-qualification | read; none | H-cache; R,M (cache scoped); W?; B-read? | M31 | QUALIFIED-SYNTHETIC; G-full |
| `homebox.location.list` | homebox_entities_locations | supported-pending-qualification | read; none | H-cache; R,M (cache scoped); W?; B-read? | M31 | QUALIFIED-SYNTHETIC; G-full |
| `homebox.location.history` | homebox_entities_locations | unsupported-capability | read; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.location.create` | homebox_entities_locations | supported-pending-qualification | write; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.location.update` | homebox_entities_locations | supported-pending-qualification | write; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.location.archive` | homebox_entities_locations | supported-pending-qualification | write; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.location.unarchive` | homebox_entities_locations | supported-pending-qualification | write; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.location.reparent` | homebox_entities_locations | supported-pending-qualification | write; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.location.delete` | homebox_entities_locations | supported-pending-qualification | write; permanent-delete-human | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.location.restore-deleted` | homebox_entities_locations | unsupported-capability | write; permanent-delete-human | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.location.duplicate` | homebox_entities_locations | supported-pending-qualification | write; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.entity.children.sync` | homebox_entities_locations | supported-pending-qualification | write; exact-impact-human | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.entity.mediated-history` | homebox_entities_locations | supported-pending-qualification | read; none | H-mediated; R,M (history enabled); W?; B-read? | none beyond shared metadata | BLOCKED; G-provider |
| `homebox.location.children.sync` | homebox_entities_locations | supported-pending-qualification | write; exact-impact-human | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.location.mediated-history` | homebox_entities_locations | supported-pending-qualification | read; none | H-mediated; R,M (history enabled); W?; B-read? | none beyond shared metadata | BLOCKED; G-provider |
| `homebox.entity.quantity.set` | homebox_entities_locations | supported-pending-qualification | write; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.entity.type.set` | homebox_entities_locations | supported-pending-qualification | write; exact-impact-human | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.location.tree` | homebox_entities_locations | supported-pending-qualification | read; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.entity.path` | homebox_entities_locations | supported-pending-qualification | read; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.tag.list` | homebox_tags_fields | supported-pending-qualification | read; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.tag.get` | homebox_tags_fields | supported-pending-qualification | read; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.tag.create` | homebox_tags_fields | supported-pending-qualification | write; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.tag.update` | homebox_tags_fields | supported-pending-qualification | write; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.tag.delete` | homebox_tags_fields | supported-pending-qualification | write; permanent-delete-human | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.entity.tags.get` | homebox_tags_fields | supported-pending-qualification | read; none | H-native; M (binding scoped); W?; B-read? | none beyond shared metadata | BLOCKED; G-provider |
| `homebox.entity.tags.set` | homebox_tags_fields | supported-pending-qualification | write; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.entity.tags.add` | homebox_tags_fields | supported-pending-qualification | write; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.entity.tags.remove` | homebox_tags_fields | supported-pending-qualification | write; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.field.list` | homebox_tags_fields | supported-pending-qualification | read; none | H-native; M (binding scoped); W?; B-read? | none beyond shared metadata | BLOCKED; G-provider |
| `homebox.field.get` | homebox_tags_fields | supported-pending-qualification | read; none | H-native; M (binding scoped); W?; B-read? | none beyond shared metadata | BLOCKED; G-provider |
| `homebox.field.create` | homebox_tags_fields | supported-pending-qualification | write; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.field.update` | homebox_tags_fields | supported-pending-qualification | write; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.field.delete` | homebox_tags_fields | supported-pending-qualification | write; permanent-delete-human | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.entity.field-names` | homebox_tags_fields | supported-pending-qualification | read; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.entity.field-values` | homebox_tags_fields | supported-pending-qualification | read; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.file.list` | homebox_files_links | supported-pending-qualification | read; none | not-bound; no R/L/M/E; W7-unbound; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.file.get` | homebox_files_links | supported-pending-qualification | read; none | not-bound; no R/L/M/E; W7-unbound; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.file.upload` | homebox_files_links | supported-pending-qualification | write; none | not-bound; no R/L/M/E; W7-unbound; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.file.update` | homebox_files_links | supported-pending-qualification | write; none | not-bound; no R/L/M/E; W7-unbound; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.file.download` | homebox_files_links | supported-pending-qualification | read; none | not-bound; no R/L/M/E; W7-unbound; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.file.delete` | homebox_files_links | supported-pending-qualification | write; permanent-delete-human | not-bound; no R/L/M/E; W7-unbound; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.file.replace-bytes` | homebox_files_links | unsupported-capability | write; permanent-delete-human | not-bound; no R/L/M/E; W7-unbound; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.file.restore-deleted` | homebox_files_links | unsupported-capability | write; permanent-delete-human | not-bound; no R/L/M/E; W7-unbound; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.document-link.list` | homebox_files_links | supported-pending-qualification | read; none | not-bound; no R/L/M/E; W7-unbound; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.document-link.get` | homebox_files_links | supported-pending-qualification | read; none | not-bound; no R/L/M/E; W7-unbound; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.document-link.create` | homebox_files_links | supported-pending-qualification | write; none | not-bound; no R/L/M/E; W7-unbound; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.document-link.update` | homebox_files_links | supported-pending-qualification | write; none | not-bound; no R/L/M/E; W7-unbound; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.document-link.delete` | homebox_files_links | supported-pending-qualification | write; permanent-delete-human | not-bound; no R/L/M/E; W7-unbound; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.document-link.retarget` | homebox_files_links | unsupported-capability | write; permanent-delete-human | not-bound; no R/L/M/E; W7-unbound; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.maintenance.list` | homebox_maintenance | supported-pending-qualification | read; none | H-native; M (binding scoped); W?; B-read? | none beyond shared metadata | BLOCKED; G-provider |
| `homebox.maintenance.get` | homebox_maintenance | supported-pending-qualification | read; none | H-native; M (binding scoped); W?; B-read? | none beyond shared metadata | BLOCKED; G-provider |
| `homebox.maintenance.create` | homebox_maintenance | supported-pending-qualification | write; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.maintenance.update` | homebox_maintenance | supported-pending-qualification | write; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.maintenance.schedule` | homebox_maintenance | supported-pending-qualification | write; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.maintenance.complete` | homebox_maintenance | supported-pending-qualification | write; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.maintenance.reopen` | homebox_maintenance | supported-pending-qualification | write; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.maintenance.delete` | homebox_maintenance | supported-pending-qualification | write; permanent-delete-human | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.maintenance.attachment-upload` | homebox_maintenance | unsupported-capability | write; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.maintenance.attachment-delete` | homebox_maintenance | unsupported-capability | write; permanent-delete-human | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.entity-type.list` | homebox_templates_types | supported-pending-qualification | read; none | not-bound; no R/L/M/E; W7-unbound; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.entity-type.create` | homebox_templates_types | supported-pending-qualification | write; none | not-bound; no R/L/M/E; W7-unbound; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.entity-type.update` | homebox_templates_types | supported-pending-qualification | write; exact-impact-human | not-bound; no R/L/M/E; W7-unbound; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.entity-type.delete` | homebox_templates_types | supported-pending-qualification | write; permanent-delete-human | not-bound; no R/L/M/E; W7-unbound; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.template.list` | homebox_templates_types | supported-pending-qualification | read; none | not-bound; no R/L/M/E; W7-unbound; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.template.get` | homebox_templates_types | supported-pending-qualification | read; none | not-bound; no R/L/M/E; W7-unbound; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.template.create` | homebox_templates_types | supported-pending-qualification | write; none | not-bound; no R/L/M/E; W7-unbound; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.template.update` | homebox_templates_types | supported-pending-qualification | write; template-field-delete-human-if-present | not-bound; no R/L/M/E; W7-unbound; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.template.delete` | homebox_templates_types | supported-pending-qualification | write; permanent-delete-human | not-bound; no R/L/M/E; W7-unbound; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.template.create-item` | homebox_templates_types | supported-pending-qualification | write; none | not-bound; no R/L/M/E; W7-unbound; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `atlas.binding.reassign-identity` | atlas_bindings | held-policy | write; exact-impact-human | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | HELD; G-admission |
| `atlas.asset.hard-purge` | atlas_media_geometry | held-policy | write; permanent-delete-human | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | HELD; G-admission |
| `atlas.evidence.replace` | atlas_records | forbidden-append-only | write; exact-impact-human | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | FORBIDDEN; G-admission |
| `atlas.geometry.replace` | atlas_media_geometry | forbidden-append-only | write; exact-impact-human | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | FORBIDDEN; G-admission |
| `atlas.reconciliation.replace` | atlas_records | forbidden-append-only | write; exact-impact-human | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | FORBIDDEN; G-admission |
| `network.inventory.get` | network_queries | supported-pending-qualification | read; none | N-saved; M (binding scoped); W?; B-read? | M32 | QUALIFIED-SYNTHETIC; G-full |
| `network.snapshot.get` | network_queries | supported-pending-qualification | read; none | N-saved; M (binding scoped); W?; B-read? | M32 | QUALIFIED-SYNTHETIC; G-full |
| `network.history.get` | network_queries | supported-pending-qualification | read; none | N-saved; M (binding scoped); W?; B-read? | M32 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.batch.execute` | atlas_records | supported-pending-qualification | write; inherits-child-exact-impact-human | A-batch; L,E (each child); W?; B-write? | M12 | QUALIFIED-SYNTHETIC; G-full |
| `homebox.bulk.execute` | homebox_product_features | supported-pending-qualification | write; exact-impact-human | not-bound; no R/L/M/E; W7-unbound; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.import.csv` | homebox_product_features | supported-pending-qualification | write; exact-impact-human | not-bound; no R/L/M/E; W7-unbound; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.export.create` | homebox_product_features | supported-pending-qualification | read; none | not-bound; no R/L/M/E; W7-unbound; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.query.read` | homebox_product_features | supported-pending-qualification | read; none | not-bound; no R/L/M/E; W7-unbound; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.label.output` | homebox_product_features | supported-pending-qualification | variant; none | not-bound; no R/L/M/E; W7-unbound; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.qrcode.render` | homebox_product_features | supported-pending-qualification | read; none | not-bound; no R/L/M/E; W7-unbound; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |

## Remaining requirements and acceptance boundary

| Requirement | Current disposition | Exact remaining work / owner |
| --- | --- | --- |
| G-full | BLOCKED for full operation acceptance | Fixture variants only have synthetic passes; actual installed identity, current role/profile/scope and exact intended operation observation remain with existing acceptance owner. No issue closure follows |
| G-operation | NOT RUN for the individual operation path in this evidence set | Existing admission/planner may implement the ID; supply a justified actual-service case for that exact ID/variant rather than counting descriptors as execution |
| G-provider | BLOCKED on provider-specific qualification | #285 reads, #287 mutation contract and #286 recovery inputs gate their respective stages; independent metadata/fixture work need not wait. No live provider call made |
| G-admission / G-dedicated | UNSUPPORTED-GENERIC | No R/L/M/E binding; existing dedicated native owner requires its own custody/integration contract, not a new endpoint/grant/dispatcher here |
| G-media/operation | BLOCKED | Qualified derivation/Media input owner and exact correlated result evidence required; binding-review evidence does not qualify restore/geometry/asset variants |
| G-batch | BLOCKED beyond successful local fixture | Ordered two-circuit success is observed; complete intended partial/unknown/per-child failure classes remain unqualified. Atomic Atlas success does not imply provider partial-outcome handling |
| G-remap | BLOCKED; native root/admission hold | No remap-specific trusted human issuer and atomic consumption owner in this composition. Null/supplied receipt IDs are unproven; singles and containing batches refuse. Lower-level synthetic Store authorization is not human approval. A genuine exact actor/home/target/intent/impact/epochs/expiry-bound owner and actual remap qualification remain required; no receipt/grant minted |
| G-transfer | BLOCKED | Actual owner-issued upload/download, byte/type/size/hash/original identity, expiry and final current authorization/readback remain unqualified. Link rendering/codec equality is not completed transfer |
| Actual expiry / cancellation lifetime | NOT RUN for expiry | M18 rotation and M19 revocation/membership controls are not clock-driven expiry evidence. No expiry guarantee is inferred |
| Unknown durable outcome / replay | BLOCKED | Bounded response or dropped delivery after a known commit proves that known synthetic effect survives; it does not qualify every unknown transport failure or authorize retry/replay |
| WebMCP document/session/visible completion | DEFERRED for browser/device; partial synthetic adapter evidence separate | Exact current host binding, one document registration owner, visible commit ordering, replacement context/cleanup and unsupported-browser behavior still require their admitted owner/evidence |
| Complete per-operation installed matrix | OPEN | This ledger completes the 168-ID source/evidence index only. It cannot certify installed execution, private data, operational roles, whole-profile admission or deferred device acceptance |

The initial version-4 publication changed documentation only. M20–M31 add
ordinary in-process native fixture cases in the existing default backend-library
selection; M32 records the existing Linux loopback harness. Those M20–M32
increments changed no production routing or held-control classes.
M33 is separate: its bounded fail-closed predicate changes native Editor
admission and shared-root remap eligibility, with one explicitly selected
ordinary hold regression. No new runner/workflow command, approval issuer,
credential/grant, provider call, browser action, model work or deployment.
No local build/test/Clippy qualification gate ran.
