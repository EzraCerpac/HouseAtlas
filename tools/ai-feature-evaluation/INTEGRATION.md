# Retained annotations and bounded scorer bridge

The four original November 8 files in this directory remain byte-for-byte
unchanged. README.md describes their standalone handoff state, not the later
integration. There are 32 fictional cases and 20 source versions. No model has
been executed, evaluated or calibrated. No production module imports this corpus.

| Original file | SHA-256 |
| --- | --- |
| README.md | `4ae5770a3cbf6a99534d8185877cc585249a532376d868cff1153c4e4902881f` |
| check_corpus.py | `798baa9fe64cb903ca81bb82669290a24a9950872e3011ace4219d4ef3765003` |
| corpus.json | `d4f4d4c8c66a10c0debe7004ff7e187345af7e4d4305a1774e9bb286c4678291` |
| test_check_corpus.py | `7cb0da6ed9919b3dcbe9493dc8682c476b290a49b6e023a818763609d0ef4140` |

The retained original format-patch was 75,746 bytes, SHA-256
`664f82a406a5ca7d9abeb94e485a4c3ed0733cc416fe15c48caf6defceab44e0`.
The source files, rather than a second embedded patch, are published here.
HISTORICAL-CHECKS.txt preserves the original November 8 standalone annotation
integrity report: 18 Python tests passed. Its SHA-256 is
`365f31c6647b70d0ff6282d946df8b24a738cead10e3fa8cbcce0a0eb36c2a0f`.
That report is historical; the checker and tests were **not rerun** during this
integration. It is not repository, runtime, model or semantic-quality evidence.

## Exact adapter scope

`backend/src/ai/suggestions/retained_corpus.rs` is a private test-only bridge to
the existing `evaluate_supplied` scorer and canonical validator. It hashes the
original JSON before parsing, selects exact original versions, retains dates,
excerpts and source/version/section evidence identities, and assigns fictional
Atlas record targets solely for the generated join. These are no real records,
access grants, originals, OCR results or custody receipts.

| Original case | Mapped dimensions |
| --- | --- |
| inv-identity | `fan_category` → category `fan`; `same_physical_item_candidate` for item-a → `item-a:possible-same-item` |
| doc-ambiguous | `manual_category` → class `manual`; both `possible_document_link` annotations → allowed item-a/item-b associations |
| inv-sparse | Aggregate no-proposal control only; selected capture-blur v1 remains the sole admitted source |
| doc-electrical | `electrical_drawing_category` → class `electrical-drawing` only |
| doc-invoice | `invoice_category` / `warranty_category` → allowed class alternatives invoice / warranty; `document_link` → allowed item-a association from original invoice p1 / item-a identity citations |

Allowed alternatives are not required winners. Required sets remain empty;
positive recall/missing-required outcomes are **unscored**, not measured zero
errors. The bridge does not score field-specific abstentions, unknown prose,
unique-winner selection, native effects or candidate-negative annotations that
lack a mapped claim-specific citation basis. These gaps are retained explicitly
in the adapted data. Scorer set counters describe only the mapped dimensions;
they are not a complete case pass. In particular, the doc-ambiguous adapter
cannot detect a presentation claiming one candidate is uniquely correct.

Three further cases map structural context refusal only:

| Original case | Observed → current DATA projection |
| --- | --- |
| inv-stale | item-a v1 → item-a v2, as separately selected snapshots of the same fictional target |
| inv-revoked | item-a v1 available → withdrawn |
| doc-revoked | invoice v1 available → withdrawn; item-a v1 remains available |

The first mapping uses the exact `changed_versions` observed/current annotations;
it never admits two versions of one identity simultaneously. Each version keeps
its own original source date, retrieval date and excerpts. The other two project
`disclosure_revoked` to canonical snapshot availability DATA. They do not invoke
Access, remove a grant, prove authentication or execute native revocation. The
corpus candidate lists are not native authority and provide no new semantic labels.

Three new authored cases first check the deliberately supplied no-change envelope
against its observed snapshot, then require the exact ContextChanged or
ContextWithdrawn error against current context. The existing scorer must report
expected structural refusal with null classification, duplicate, document,
unknown and semantic-abstention scores. An empty proposal is a test input, not
a gold semantic abstention, model response or complete case pass.

The inventory/document adapter leaves 24 cases unscored; three of these now
have the separate maintenance representational controls described below, and
three more have answer controls, and three comparison/withdrawal controls follow.
Availability/withdrawal and supplied-empty controls follow; eight have no bridge.
Quality remains unscored for the same-product-only
inventory case and every maintenance, cited-answer and contradiction case. A model/product match is never translated into
physical identity. More mappings need an explicit semantic/dimension review;
the corpus's original annotations must not be rewritten to manufacture coverage.

The nine retained inventory/document default-library Rust cases check frozen corpus/cardinality and
mapping limits, separate supplied inventory category/identity counters, retained
alternative document links, the three original context-refusal cases and
changed/withdrawn context refusal through the existing validator. Supplied JSON is deliberately handwritten. Rust formatting,
compilation, Clippy and these tests are **NOT RUN** at this integration. There is
no generated evaluation-result artifact, model accuracy, calibrated probability,
fitted threshold or complete child-issue acceptance claim. No workflow or new
runner selection is added; the standalone Python mutation suite stays separate.


## Three bounded inventory/document additions

The retained inv-sparse, doc-electrical and doc-invoice annotations now join the
same supplied-proposal scorer without changing its production contract. There
are four allowed-label mappings, one limited aggregate no-proposal control and
three structural-refusal mappings. Separate maintenance, answer and comparison
controls cover three cases each, followed by three availability controls.
Eight cases have no bridge after the supplied-empty controls; all these
structural controls remain unscored.

inv-sparse selects only capture-blur v1. Its annotation candidate lists do not
admit item-a/item-b or provide native authority, and no negative citation is
invented. The adapter requires aggregate no-proposal for its deliberately
supplied control; an empty category/duplicate output satisfies this limited
expectation. A deliberately supplied category demonstrates missing aggregate
abstention separately from structural acceptance. This is not field-specific
unknown truth, identity/duplicate accuracy, location truth or native-effect
qualification. Empty-set quality counters and classification_unknown are only
mechanical output indicators, not measured zero errors for those unmapped
semantic dimensions. Unadmitted-candidate negatives remain unscored.

doc-electrical maps only the original class annotation from drawing v1/sheet1,
retaining source date 2020-01-01 and retrieval 2030-04-01. It cannot establish
current circuit mapping, tested wiring, safe breakers or physical placement.

doc-invoice maps invoice and warranty as allowed alternatives in the single
canonical classification slot; neither is required and selecting either is not
mixed-purpose completeness or a full-case success. Warranty eligibility remains
unknown. Mixed-purpose completeness stays unscored. Other class representations
fall outside this mapping: an unexpected-label counter is not evidence that
their mixed-purpose interpretation is wrong. Counters compare mapped labels only. The item-a link
uses exactly the original serial-backed citations. Item-b remains a selected
fictional input, but its annotation negative is unscored because no mapped
negative claim-specific citation basis exists. No negative basis is fabricated.

Three new authored Rust cases (NOT RUN):

- retained_sparse_case_scores_only_aggregate_no_proposal_without_invented_candidates
- retained_electrical_case_scores_document_class_without_wiring_claims
- retained_invoice_case_preserves_class_alternatives_and_serial_backed_association

These bring the test bridge to nine authored cases in the existing default
backend-library path. The earlier five mappings, including null quality/unknown/
abstention scores for structural refusal, remain intact. Labels are fictional
reference expectations and outputs deliberately supplied, not model responses.
No model accuracy, calibration, threshold, complete child acceptance, real Access
revocation or native authority is evaluated. The frontend maintenance repair and
all original corpus file bytes are preserved. Local tests/build/compiler/Clippy/
formatting/browser/device execution were not performed; no CI lane is added.


## Interval-only maintenance representational controls

Three original maintenance cases now have deliberately supplied canonical
proposals checked through validate_generated and disclose_review only. They
never call evaluate_supplied, construct Labels/CaseReport or emit empty quality
counts. The production scorer still supports only inventory/document dimensions;
there are no maintenance accuracy, calibration or full-case success metrics.

| Original case | Mapped representation | Explicitly unmapped or unqualified |
| --- | --- | --- |
| maint-periodic | interval_90_days → periodic 90 days; selected manual v1 / item-a v1; original ordinary-use qualifier and citations | due_2030_04_01 remains a retained, UNMAPPED label because the contract has no due-date field; service-date interpretation, actual usage, purchase/scheduling/native effects |
| maint-no-baseline | interval_120_days → periodic 120 days; selected manual v2 / item-a v2; ordinary-use qualifier and citations | Unknown last cleaning remains unknown; no due date, scheduling, real baseline or native acceptance |
| maint-condition-match | conditional_inspection_review → full original P9 notice as conditional text; selected notice v1 / pump v1 and original citations | Indicator state, whether the condition holds, due date, safety diagnosis, scheduling or native acceptance |

The adapter uses only input_sources, never extra annotation candidate records or
access grants. It retains exact source/version/section excerpts, independent
source/retrieval dates and the same fictional canonical target join as the prior
bridge. Claims point to the original mapped annotation citations. The periodic
case's original service excerpt remains in the admitted input; it is not erased
or interpreted into a due date. The due label is retained in unmapped_labels,
not scored as an error or silently discarded. Supplied titles/rationales describe
structural controls, not generated model judgments. Urgency stays unknown.
The original unknowns remain proposal missingEvidence.

Canonical maintenance has no qualified service-baseline input: disclosure keeps
baselineDate null for all three controls, including the case whose original text
records a cleaning date. This is a representation limit, not a claim the source
text is absent. Intervals/conditions are proposals only; no fact-time inference,
condition-state decision or automatic scheduling occurs.

Each authored case asserts the exact positive interval/conditional projection,
target/index/citation correlation and unknown UI baseline. Shared derivative
supplied-output mutations assert refusal of unsupported dueDate/schedule fields
and stale/withdrawn context through the existing validator/disclosure. The mutated
version suffix and Withdrawn DATA are negative controls, NOT new original corpus
scenarios, recorded source versions, real Access revocations or native actions.
A refused dueDate field tests the contract boundary, not failure of the original
retained due_2030_04_01 annotation.

New authored case names (NOT RUN):

- retained_maintenance_periodic_maps_ninety_days_but_not_the_due_date_label
- retained_maintenance_unknown_baseline_keeps_revision_two_and_interval_only
- retained_maintenance_matching_pump_remains_conditional_with_unknown_indicator

All nine earlier bridge tests and eight inventory/document mappings remain
unchanged, including null semantic scores for structural refusal. At this
maintenance checkpoint the bridge had twelve authored tests: nine
prior plus these three. The later controls below bring it to twenty-one tests.
Later controls bring the total to twenty-four bounded cases and eight without
bridges. The existing
inventory/document count test
still correctly marks 24 cases outside its scorer, including all maintenance.
No original corpus file, production contract, frontend repair, runner selection
or workflow changes. All tests, builds, type checking, compilation, formatting/
Clippy, browser/device and actual host/model/acceptance qualification remain unrun.


## Recorded-source answer representational controls

Only original qa-location, qa-electrical and qa-injection are newly adapted.
Each deliberately supplied answer uses the existing validate_generated and
disclose_review functions. No evaluate_supplied, Labels, CaseReport, routing/
ranking/groundedness quality counts, model output or calibrated metric exists.

| Original case | Exact represented data | Still unqualified |
| --- | --- | --- |
| qa-location | inventory route; quoted recorded_location from spare v1/location | Current physical certainty and exhaustive inventory |
| qa-electrical | electrical route; historical_documentary_group from drawing v1/sheet1; 2020-01-01 source date separate from 2030-04-01 retrieval | Tested wiring, current circuit mapping, safe breaker or equipment action |
| qa-injection | electrical route; tested_mapping_unavailable from injection v1/p2 | Live model injection resistance, scope/tool permissions or factual truth |

Every selected source/version/section/excerpt is preserved in the admitted
snapshot. Source excerpts become exact claims and explicitly attributed quoted
statements. Original unknowns remain missingEvidence, and original abstain_from
values remain explicit control metadata. Each case selects one source; the
supplied rank list uses that bounded selected-input order, not original relevance
labels or measured ranking quality. Annotation candidates add no records/grants.
Coverage stays partial, statements retain their exact support/evidence joins,
and disclosure fields/candidates/selections remain empty. No intent is emitted.

The complete malicious p1 text remains inert admitted source DATA for qa-injection.
Only p2 supports its supplied claim/statement and disclosure citation; p1 is not
promoted to a permission, tool, source-scope expansion or executable instruction.
No model consumes either section. This authored choice does NOT establish prompt
injection resistance: the structural validator is not a semantic truth/entailment
checker and may accept other well-shaped text. Exact positive supplied quotes
are source/representation controls, not routing or groundedness evaluation.

Shared explicitly derivative negative controls mutate unadmitted rank/source/
evidence references, unknown/clarify routes retaining factual statements,
unsupported action/tool fields, exhaustive coverage and stale/withdrawn DATA.
These assert existing structural boundaries only; they are not new original
corpus scenarios or actual source-access revocation. No unavailable scenario or
simultaneous-version answer is fabricated: qa-missing, qa-stale and qa-revoked
remain outside this increment.

New authored case names (NOT RUN):

- retained_answer_location_quotes_recorded_location_without_physical_certainty
- retained_answer_electrical_preserves_historical_dates_without_safe_action
- retained_answer_injection_cites_p2_while_p1_remains_inert_source_data

All twelve prior bridge tests remain unchanged. At this answer checkpoint there were fifteen authored cases; the comparison
controls below bring the total to eighteen. Later controls bring the totals to twenty original scenarios with some
bounded bridge at that checkpoint; the empty controls below bring it to
twenty-four with eight none. All answer/maintenance quality is unscored, and the production scorer still
supports inventory/document only. Corpus bytes, production contracts/disclosure,
frontend repairs and runner inventory are unchanged. No new lane or runtime.
Tests/build/typecheck/compiler/format/Clippy/browser/device and actual model/
owner/acceptance qualification remain unrun; automatic CI is only observed.


## Retained comparison and withdrawal controls

Only original review-conflict, review-unknown-date and review-revoked are added.
Deliberately supplied canonical proposals use the existing validator/disclosure,
never evaluate_supplied, Labels/CaseReport or contradiction-quality counts.

| Original case | Bounded control | Explicit limits |
| --- | --- | --- |
| review-conflict | contradiction_review with both exact item-a v1/location and location-conflict v1/location assertions | No automatic winner, overwrite, merge or typed fact-date inference |
| review-unknown-date | possible_conflict_review, supplied tentative finding interpretation, original unknown fact-date/review-status prose and gaps | Text/structure is checked, not a semantic-certainty detector or simultaneous truth |
| review-revoked | Original disclosure_revoked maps location-conflict to current Withdrawn DATA; empty claims/findings refuse validation and disclosure | No safe summary of the withdrawn side, real Access revocation or qualified prior history |

Only original selected sources are admitted. Assertion records use Source/Other
roles rather than annotation candidate lists as authority. Quotes, exact source/
version/section evidence IDs, source/retrieval dates and all cited sides remain.
Canonical finding key/index and every claim/input/version/evidence join are
asserted. Every typed factDate stays null, even when prose or a source date
contains a date. Finding and claim uncertainty remain qualitative supplied DATA;
unknown-date caveats are not evidence the validator verifies semantic certainty.
Selections remain empty and no corrected truth, decision or action is issued.

The revoked case has no positive original claim annotation. It creates no such
claim or summary. An all-available snapshot is only a structural baseline to
obtain the existing immutable review type; it is not historical authorization.
Current availability comes from the original withdrawal annotation. The other
side stays byte-equivalent/available, and the canonical boundary returns
ContextWithdrawn with no disclosure object, including for the empty proposal.

Derivative controls cover missing/one-sided/duplicate claims, cross-input
evidence, unsupported winner/correction/action fields and changed/withdrawn DATA.
Reversing presentation keeps the existing canonical finding key while preserving
the requested assertion order. A freshly pinned synthetic version mutation
changes that key. These are correlation checks, not new original scenarios,
recorded source history, persisted dismissal/audit, deduplication or automatic
non-resurrection. review-corrected and its simultaneous-version/durable-history
expectations remain outside this increment, as do the other unmapped review cases.

New authored case names (NOT RUN):

- retained_comparison_conflict_preserves_both_sides_without_a_winner_or_fact_date
- retained_comparison_unknown_date_keeps_tentative_text_and_null_typed_fact_dates
- retained_comparison_revoked_side_refuses_any_disclosure_and_preserves_other_side

All fifteen prior bridge tests/code remain unchanged. That checkpoint had eighteen authored Rust cases; the availability controls
below and supplied-empty controls bring it to twenty-five tests, with twenty-four
bounded scenarios and eight without bridges. All comparison/answer/maintenance quality remains unscored.
The production inventory/document scorer is unchanged. Original corpus files,
frontend repairs, production contracts/validator/disclosure, runner selections
and workflows are unchanged. No second truth store, native owner, runtime or
host/root binding is added. Tests/build/typecheck/compiler/format/Clippy/browser/
device/live-model/actual-owner qualification remain unrun; CI is observed only.


## Original readability, original availability and record withdrawal

Only doc-unreadable, doc-unavailable and qa-revoked are added here. These are
validator/disclosure-only controls, with no scorer/Labels/CaseReport or quality
counts. The original four corpus files remain byte-identical.

doc-unreadable admits only scan v1 metadata: null source date, known fictional
original identity, readable:false and zero sections/evidence. No item-a record
is added from annotation candidates. The supplied proposal has no claims,
classification or links. Disclosure is a metadata placeholder with empty excerpt,
null page/section/evidence location and unavailable original inspection. No page,
OCR or readable content is invented. The existing readable-only fixture helper
is not weakened; this separate case constructs metadata without extraction.

doc-unavailable retains manual v1 metadata and ALL known readable extraction in
the admitted input. Record availability remains Available; unavailable_originals
names original-manual and the original-owner inspectable set stays empty. These
are distinct axes: readable prior extraction does not make current original bytes
openable and unavailable original bytes do not revoke the record. No extra claim,
classification or link is added merely to make extraction visible. The existing
no-proposal display projects only fallback metadata, not unused extraction; this
presentation limit is retained rather than changing the production contract.

Original fixture IDs remain control metadata, not native handles/capabilities or
URLs: canonical SourceInput has no original-ID field. Exact qualified original
identity/custody resolution remains with the original owner through the existing
input/version seam. Supplying a fixture original ID as an inspectable evidence ID
refuses. Derivative invented-content/candidate/original-URL controls also refuse.
No actual file open, transport, unreadable-byte decoder or capability is exercised.

qa-revoked preserves the original invoice v1 selection and withdrawal marker.
The annotation's clarify route appears only in an empty supplied no-answer
proposal, not a source-derived safe answer. An all-available snapshot is a
structural baseline only; current Withdrawn DATA causes validation and disclosure
to return ContextWithdrawn with no disclosure object. This is not real Access
revocation or qualified past authority; no withdrawn source summary is returned.

New authored case names (NOT RUN):

- retained_unreadable_scan_keeps_unknown_metadata_without_content_or_candidates
- retained_unavailable_original_preserves_extraction_without_open_capability_or_revocation
- retained_qa_withdrawal_withholds_even_an_empty_clarify_disclosure

All eighteen earlier tests/code and seventeen partial original-case bridges remain
unchanged. At that availability checkpoint there were twenty-one authored bridge tests;
the supplied-empty controls below bring it to twenty-five. Twenty-four original
cases now have some bounded bridge; eight have none. Historical eighteen-test Python
integrity success remains a separate original artifact, not these unrun Rust
controls. Production/frontend code, runner selections and workflows are unchanged.

## Supplied empty task and finding controls

Only maint-condition, review-history, review-retrieval and review-distinct are
added. Every original expected_claims list is empty. The controls deliberately
supply empty claims and tasks/findings with the original unknowns; they do not
call evaluate_supplied or construct Labels/CaseReport/quality counts.

- maint-condition keeps notice v1 and item-a v1, the P9 versus F2 source text,
  unknown pump candidate/indicator state and original no-effect boundaries. It
  adds no pump input from annotations and makes no model-mismatch or condition
  decision. Empty tasks are supplied by the author, not detected from text.
- review-history retains both location-old/location-new records and their exact
  dates/excerpts, with current location unknown. Empty findings are not compatible
  history, temporal reasoning or a current-location truth result.
- review-retrieval retains drawing v1 source date 2020-01-01 separately from its
  2030 retrieval and retains item-a v2. Empty findings do not make older evidence
  false, select a newer record or decide present-day applicability.
- review-distinct retains both SYN-A/SYN-B serial-bearing records, shared model
  and original physical-verification gap. Empty findings do not establish native
  physical identity, a semantic no-conflict decision or actual verification.

Selected sources, targets, versions, evidence and dates remain in each admitted
input. Annotation candidate lists add no records or authority. No finding/claim
is fabricated to produce a richer display: existing disclosure returns only the
subject metadata fallback and original missing-evidence gaps; unused extraction
stays in the input. This presentation limit is preserved without production edits.
Empty selections and derivative unsupported winner/action field refusals are
structural checks only, not native action/Access, model judgment, accepted task,
semantic abstention, durable history or complete-case success.

New authored case names (NOT RUN):

- retained_wrong_model_notice_keeps_selected_inputs_and_supplied_empty_tasks
- retained_history_dates_remain_inputs_with_supplied_empty_findings
- retained_retrieval_preserves_distinct_dates_with_supplied_empty_findings
- retained_serial_records_remain_data_with_supplied_empty_findings

All 21 prior tests/code remain unchanged. The bridge has 25 authored Rust cases,
all unrun, and 24 original scenarios with some bounded bridge; eight have none.
The ledger below classifies five scorer subsets / nineteen structural controls /
eight no-bridge rows. No model quality/accuracy, real authority or durable decision
is qualified. Original corpus bytes, production/frontend code, runner inventory
and workflows are unchanged; no new lane, host/root or runtime is introduced.

## Complete original corpus coverage inventory

This ledger covers all 32 original case IDs, not additional scenarios or a new
report system. **Scorer subset** means only the listed deliberately supplied
label/no-proposal counters. **Structural** includes representation, availability
or refusal-only controls (including earlier refusal-only evaluator uses).
**No bridge** means no retained-case adapter; the reason distinguishes missing
representations/owners from a bounded control simply not adapted yet. Every row
remains partial and unqualified: tests are authored, NOT RUN; no full-case, model,
native-owner, access, durable decision or issue acceptance is established.

| Original case | Bridge | Mapped scope / exact remaining gap |
| --- | --- | --- |
| inv-identity | Scorer subset | Fan category and possible-same-item candidate; no physical identity/location, recall or merge authority. |
| inv-model-only | No bridge | Product-positive/physical-identity-unknown is canonically representable, but the selected manual is a Document while Inventory requires an InventoryItem subject; do not relabel it or choose an arbitrary physical subject. |
| inv-sparse | Scorer subset | Aggregate no-proposal only; field unknowns/location and unadmitted negative candidates remain unscored. |
| inv-conflict | No bridge | Inventory location-conflict review is unadapted; inventory field changes cannot choose a room or relocate an item. |
| inv-stale | Structural | Observed/current versions separated for context refusal; null semantic scores, no history rendering or real authority. |
| doc-invoice | Scorer subset | Invoice/warranty alternatives and item-a association; mixed-purpose completeness, eligibility and item-b negative remain unscored. |
| doc-ambiguous | Scorer subset | Manual class and both possible links; no required winner or unique physical association. |
| doc-unreadable | Structural | Metadata-only scan, no invented content/candidate/page; actual original identity/opening is not a capability. |
| doc-electrical | Scorer subset | Document class only; historical groups establish no tested wiring, safe breaker or placement. |
| doc-revoked | Structural | Withdrawn-context refusal with null quality; no actual Access revocation or disclosed source judgment. |
| maint-periodic | Structural | 90-day interval/citations/qualifier; due_2030_04_01 explicitly unmapped by the interval-only contract, no scheduling. |
| maint-no-baseline | Structural | 120-day interval, unknown cleaning baseline; no due date, condition-state truth or native task creation. |
| maint-superseded | No bridge | Simultaneous manual revisions need a qualified historical view; current snapshot admits one exact identity version, no silent supersession. |
| maint-condition | Structural | Supplied empty tasks preserve notice/item only, no pump; not model-mismatch, condition-truth or safety detection. |
| maint-duplicate | Structural | Supplied review of task-a as a MaintenanceTask candidate, manual subject and item supporting source; exact task/index/evidence binding, unknown completion/interval/baseline. No new task, quality score, native duplicate suppression or completion inference. |
| qa-location | Structural | Quoted recorded location, inventory route and partial source rank; no current physical certainty or exhaustive inventory. |
| qa-missing | No bridge | Empty retrieval has no canonical subject input; do not invent a record to satisfy snapshot admission. |
| qa-electrical | Structural | Historical documentary quote/route with distinct dates; no safe equipment action or factual-quality score. |
| qa-injection | Structural | p1 retained inert, p2 cited; no live-model injection resistance or tool/scope authorization claim. |
| qa-revoked | Structural | Withdrawn invoice refuses disclosure even for empty clarify; not a safe factual answer or actual Access revocation. |
| review-conflict | Structural | Both cited sides, null fact dates and correlation key; no winner/correction/truth score. |
| review-history | Structural | Supplied empty findings retain both dated inputs and current-location gap; no compatible-history inference or truth choice. |
| review-retrieval | Structural | Supplied empty findings preserve 2020 source/2030 retrieval and both inputs; no temporal reasoning, newer-wins or falsity detection. |
| review-unknown-date | Structural | Tentative supplied review/gaps and null fact dates; no semantic-certainty detector. |
| review-distinct | Structural | Supplied empty findings preserve both serial-bearing records; no physical-identity or semantic-abstention result. |
| review-corrected | No bridge | Simultaneous versions and durable dismissed-finding/non-resurrection history lack an owned projection/store; key correlation is insufficient. |
| doc-duplicate-original | No bridge | Fixture original-ID equality has no canonical identity/custody field or byte proof; no duplicate import/delete/reuse authority. |
| doc-unavailable | Structural | Known extraction retained, original inspection unavailable; fallback shows metadata only, no record revocation or invented URL/capability. |
| inv-revoked | Structural | Withdrawn-context refusal with null semantic scores; no actual grant or native write behavior. |
| qa-stale | No bridge | Simultaneous item versions require qualified historical projection; current snapshot cannot alias one target into two accepted current versions. |
| review-revoked | Structural | Withdrawn-side boundary returns no disclosure; original other side preserved, no safe summary/durable decision. |
| maint-condition-match | Structural | P9 conditional proposal from exact notice/pump evidence; no lit indicator, condition-is-met, safety or scheduling claim. |

Inventory totals: five scorer subsets, twenty structural controls and seven
without bridges. All semantic completeness, calibrated quality and actual owner
authority remain unqualified; the ledger does not release any acceptance gate.

## Existing-task review representation

Separate generated contract controls support canonical
`same-product-identity-unknown` without changing any original corpus mapping or
counts. It retains positive product correspondence while physical same/distinct
identity stays unknown. It is distinct from possible-same-item,
same-product-distinct-item and ambiguous in validation/disclosure and supplied
scorer labels. No physical verification, native resolution, model accuracy or
calibrated probability follows. Original inv-model-only remains unbridged for
the Document-subject reason in the ledger, not coerced into a new gold label.
The new scorer control uses independent generated inputs/labels only and is
authored/unrun; no result for that original is inferred.

`retained_maintenance_existing_task_review_keeps_task_binding_and_unknown_completion`
is one additional authored, **NOT RUN** case in the existing default-library
bridge (26 retained tests total). It adapts only original maint-duplicate and its
existing_task_review annotation: task-a v1, item-a v1 and manual v1 remain the
entire input set, with exact original section excerpts, source/retrieval dates
and unknown completion date. Manual is the subject, task-a the sole candidate
typed MaintenanceTask, and item-a a supporting Source rather than a new-task
candidate. Generated canonical HomeBox maintenance/entity targets are test-only
correlation DATA, not provider capture, original-owner grants or real bindings.

The supplied proposal reviews the existing task with unknown interval/urgency,
no conditions, and no service baseline/due date. It cites only original task/task
and manual/p4 annotations. Retained input kind/target plus exact disclosure
targetKey and `maintenance:0:task-a` selection inputRef/index identify that task;
selection metadata itself confers no authority. The existing frontend session
checks that exact key/inputRef/index against the revision-pinned proposal, but
no session, owner callback or native action is executed by this Rust control.
Derivative controls refuse item-a as candidate and unsupported creation,
completion/baseline/due-date/scheduling fields. These are structural refusals,
not native mutation qualification. No evaluate_supplied, Labels/CaseReport,
maintenance-quality score, service completion, operational duplicate suppression
or task creation follows. All 25 prior bridge tests/adapters and four original
corpus files remain unchanged. The other seven representation gaps remain open.
