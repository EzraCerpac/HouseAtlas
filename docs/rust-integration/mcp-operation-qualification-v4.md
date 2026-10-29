# MCP operation qualification ledger, version 4

Source baseline: `8d49266113bdd808e760f821adc8b6daac0e1cff`, inspected
29 October 2026. References #288 and index #277. This is a source/evidence
deliverable, not a new dispatcher, grant list, test suite or acceptance release.

Version 3 grouped operation classes but did not join individual IDs to execution
evidence. This ledger lists all 168 canonical IDs once, including family,
effect/confirmation class, actual owner/profile and a bounded disposition.
Counts: 10 QUALIFIED-SYNTHETIC paths, 73 BLOCKED for broader operation evidence,
80 UNSUPPORTED-GENERIC, two HELD and three FORBIDDEN. These are profile/evidence
dispositions, not the static catalog counts (154 pending, nine unsupported,
two held, three forbidden). A missing generic binding is not proof that a
dedicated application/native owner is absent.

QUALIFIED-SYNTHETIC means only the concrete operation/variant executed by the
listed real Access/StockService/disposable SQLite fixture. It does not qualify
all payloads, actors, profiles or installed operation. Binding create is the
unresolved/source-free synthetic path; binding review is a committed rejected
business decision. Batch evidence is an ordered successful two-circuit atomic
batch, not arbitrary partial/provider/unknown results. Every qualified row still
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
| B01 | `healthy_large_read_page` | PASS | Fake bridge evidence-list/cursor forwarding and geometry page below 2 MiB; no native cursor/record owner |
| B02 | `denial_read_profile_bounds` | PASS | Fake bridge scope/page/response refusal and retained read availability; no native expiry or provider execution |
| B03 | `denial_read_correlation` | PASS | Fake bridge request ID/command/scope mismatch refusal; no actual private connector invocation |

M01–M02 live in `backend/src/transports/mcp/healthy_download.rs`;
M03–M07 in `healthy_examples.rs`; M08–M10 in `healthy_mappings.rs`;
M11 in `healthy_native.rs`; M12 in `healthy_local_atlas.rs`; M13–M19 in
`lifecycle/synthetic_contracts.rs`. B01–B03 are the three exact existing
`tools/houseatlas-mcp-bridge/test_bridge.py` selections. Their finite ordinary-CI
exception remains unchanged. Shared M08/M09 metadata coverage applies to every
row but is deliberately not repeated as operation-execution evidence.

## Profile and domain owner key

These are source applicability conditions. They do not claim fresh installed
capability discovery, and role/catalog metadata never substitutes for actual
current Access and owner authorization.

| Key | Profile / real owner and admission | Class, limits and implementation boundary |
| --- | --- | --- |
| R | Borrowed `http::agents::mcp::bind_read` / StockService / `capabilities::reads_for` | 30 Atlas read IDs + four cached HomeBox IDs; two mediated-history IDs only when history is enabled |
| L | `bind_local_atlas` / same StockService under actual Editor issuance | Atlas subset of admitted(core, principal), excluding download; no provider/download owner is added |
| M | `bind_owned_admission` / OwnedStockService | R plus asset-download handles, three saved Network reads and five native HomeBox reads only with matching configured scope/partition |
| E | Explicit mounted Editor composition / same native stock planner/store | 31 direct + six derived Atlas IDs and batch; independent root/child admission, CAS/guards and current-principal transaction fence |
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
| `atlas.identity.get` | atlas_records | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | M14, M17, M18, M19 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.identity.list` | atlas_records | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | B02 | BLOCKED; G-operation |
| `atlas.identity.history` | atlas_records | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.identity.create` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.identity.replace` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.identity.tombstone` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.identity.restore` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.binding.get` | atlas_bindings | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | M12 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.binding.list` | atlas_bindings | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.binding.history` | atlas_bindings | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | M12 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.binding.create` | atlas_bindings | supported-pending-qualification | write; none | A-derived; L,E (owner inputs); W?; B-write? | M12 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.binding.review` | atlas_bindings | supported-pending-qualification | write; none | A-derived; L,E (owner inputs); W?; B-write? | M12 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.binding.tombstone` | atlas_bindings | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.binding.restore` | atlas_bindings | supported-pending-qualification | write; none | A-derived; L,E (owner inputs); W?; B-write? | none beyond shared metadata | BLOCKED; G-media/operation |
| `atlas.evidence.get` | atlas_records | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | M02, M11 | BLOCKED; G-operation |
| `atlas.evidence.list` | atlas_records | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | B01, B02, B03 | BLOCKED; G-operation |
| `atlas.evidence.history` | atlas_records | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | M11 | BLOCKED; G-operation |
| `atlas.evidence.create` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.evidence.tombstone` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.evidence.restore` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.location-semantics.get` | atlas_records | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.location-semantics.list` | atlas_records | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.location-semantics.history` | atlas_records | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.location-semantics.create` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.location-semantics.replace` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.location-semantics.tombstone` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.location-semantics.restore` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.circuit.get` | atlas_records | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | M12, M15, M16 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.circuit.list` | atlas_records | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | M16 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.circuit.history` | atlas_records | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | M12, M13, M15 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.circuit.create` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | M12, M13, M15, M16 | QUALIFIED-SYNTHETIC; G-full |
| `atlas.circuit.replace` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.circuit.tombstone` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.circuit.restore` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.valve.get` | atlas_records | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.valve.list` | atlas_records | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.valve.history` | atlas_records | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.valve.create` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.valve.replace` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.valve.tombstone` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.valve.restore` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.relation.get` | atlas_records | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.relation.list` | atlas_records | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.relation.history` | atlas_records | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.relation.create` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.relation.replace` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.relation.tombstone` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.relation.restore` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.geometry.get` | atlas_media_geometry | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.scene-association.get` | atlas_media_geometry | supported-pending-qualification | read; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-admission |
| `atlas.geometry.list` | atlas_media_geometry | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | B01 | BLOCKED; G-operation |
| `atlas.scene-association.list` | atlas_media_geometry | supported-pending-qualification | read; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-admission |
| `atlas.geometry.history` | atlas_media_geometry | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.scene-association.history` | atlas_media_geometry | supported-pending-qualification | read; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-admission |
| `atlas.geometry.create` | atlas_media_geometry | supported-pending-qualification | write; none | A-derived; L,E (owner inputs); W?; B-write? | none beyond shared metadata | BLOCKED; G-media/operation |
| `atlas.scene-association.create` | atlas_media_geometry | supported-pending-qualification | write; none | D-native; D only; not generic; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-dedicated |
| `atlas.geometry.tombstone` | atlas_media_geometry | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.geometry.restore` | atlas_media_geometry | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.asset.get` | atlas_media_geometry | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.asset.list` | atlas_media_geometry | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.asset.history` | atlas_media_geometry | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.asset.create` | atlas_media_geometry | supported-pending-qualification | write; none | D-native; D only; not generic; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-dedicated |
| `atlas.asset.review` | atlas_media_geometry | supported-pending-qualification | write; none | A-derived; L,E (owner inputs); W?; B-write? | none beyond shared metadata | BLOCKED; G-media/operation |
| `atlas.asset.tombstone` | atlas_media_geometry | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.asset.restore` | atlas_media_geometry | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.reconciliation.get` | atlas_records | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.reconciliation.list` | atlas_records | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.reconciliation.history` | atlas_records | supported-pending-qualification | read; none | A-read; R,L,M; W?; B-read? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.reconciliation.create` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.reconciliation.tombstone` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.reconciliation.restore` | atlas_records | supported-pending-qualification | write; none | A-direct; L,E; W?; B-write? | none beyond shared metadata | BLOCKED; G-operation |
| `atlas.binding.remap` | atlas_bindings | supported-pending-qualification | write; exact-impact-human | A-derived; L,E (owner inputs); W?; B-write? | none beyond shared metadata | BLOCKED; G-remap |
| `atlas.asset.download` | atlas_media_geometry | supported-pending-qualification | read; none | A-download; M (issuer/redemption); W?; B-read? | M01, M02 | BLOCKED; G-transfer |
| `homebox.entity.get` | homebox_entities_locations | supported-pending-qualification | read; none | H-cache; R,M (cache scoped); W?; B-read? | none beyond shared metadata | BLOCKED; G-provider |
| `homebox.entity.list` | homebox_entities_locations | supported-pending-qualification | read; none | H-cache; R,M (cache scoped); W?; B-read? | none beyond shared metadata | BLOCKED; G-provider |
| `homebox.entity.history` | homebox_entities_locations | unsupported-capability | read; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.entity.create` | homebox_entities_locations | supported-pending-qualification | write; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.entity.update` | homebox_entities_locations | supported-pending-qualification | write; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.entity.archive` | homebox_entities_locations | supported-pending-qualification | write; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.entity.unarchive` | homebox_entities_locations | supported-pending-qualification | write; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.entity.reparent` | homebox_entities_locations | supported-pending-qualification | write; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.entity.delete` | homebox_entities_locations | supported-pending-qualification | write; permanent-delete-human | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.entity.restore-deleted` | homebox_entities_locations | unsupported-capability | write; permanent-delete-human | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.entity.duplicate` | homebox_entities_locations | supported-pending-qualification | write; none | not-bound; no R/L/M/E; W?; B-unavailable | none beyond shared metadata | UNSUPPORTED-GENERIC; G-provider |
| `homebox.location.get` | homebox_entities_locations | supported-pending-qualification | read; none | H-cache; R,M (cache scoped); W?; B-read? | none beyond shared metadata | BLOCKED; G-provider |
| `homebox.location.list` | homebox_entities_locations | supported-pending-qualification | read; none | H-cache; R,M (cache scoped); W?; B-read? | none beyond shared metadata | BLOCKED; G-provider |
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
| `network.inventory.get` | network_queries | supported-pending-qualification | read; none | N-saved; M (binding scoped); W?; B-read? | none beyond shared metadata | BLOCKED; G-provider |
| `network.snapshot.get` | network_queries | supported-pending-qualification | read; none | N-saved; M (binding scoped); W?; B-read? | none beyond shared metadata | BLOCKED; G-provider |
| `network.history.get` | network_queries | supported-pending-qualification | read; none | N-saved; M (binding scoped); W?; B-read? | none beyond shared metadata | BLOCKED; G-provider |
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
| G-remap | BLOCKED | Existing exact-impact/approval owner, current preimages, durable old/new/journal correlation and actual remap qualification required; no receipt/grant minted |
| G-transfer | BLOCKED | Actual owner-issued upload/download, byte/type/size/hash/original identity, expiry and final current authorization/readback remain unqualified. Link rendering/codec equality is not completed transfer |
| Actual expiry / cancellation lifetime | NOT RUN for expiry | M18 rotation and M19 revocation/membership controls are not clock-driven expiry evidence. No expiry guarantee is inferred |
| Unknown durable outcome / replay | BLOCKED | Bounded response or dropped delivery after a known commit proves that known synthetic effect survives; it does not qualify every unknown transport failure or authorize retry/replay |
| WebMCP document/session/visible completion | DEFERRED for browser/device; partial synthetic adapter evidence separate | Exact current host binding, one document registration owner, visible commit ordering, replacement context/cleanup and unsupported-browser behavior still require their admitted owner/evidence |
| Complete per-operation installed matrix | OPEN | This ledger completes the 168-ID source/evidence index only. It cannot certify installed execution, private data, operational roles, whole-profile admission or deferred device acceptance |

Publication changes documentation only. No new tests, runner/workflow registration,
production routing, credentials, grants, provider calls, held controls, browser,
model work or deployment. No local build/test/Clippy qualification gate ran.
