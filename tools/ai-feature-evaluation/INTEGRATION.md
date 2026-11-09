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

The other 24 cases return no adapted case and remain explicitly unscored,
including the same-product-only inventory case and every maintenance, cited
answer and contradiction case. A model/product match is never translated into
physical identity. More mappings need an explicit semantic/dimension review;
the corpus's original annotations must not be rewritten to manufacture coverage.

Nine authored default-library Rust cases check frozen corpus/cardinality and
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
three structural-refusal mappings; the other 24 cases remain wholly unmapped.

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
