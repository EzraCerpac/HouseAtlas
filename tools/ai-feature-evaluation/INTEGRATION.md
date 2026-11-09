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

| Original case | Mapped allowed labels |
| --- | --- |
| inv-identity | `fan_category` → category `fan`; `same_physical_item_candidate` for item-a → `item-a:possible-same-item` |
| doc-ambiguous | `manual_category` → class `manual`; both `possible_document_link` annotations → allowed item-a/item-b associations |

Allowed alternatives are not required winners. Required sets remain empty;
positive recall/missing-required outcomes are **unscored**, not measured zero
errors. The bridge does not score field-specific abstentions, unknown prose,
unique-winner selection, native effects or candidate-negative annotations that
lack a mapped claim-specific citation basis. These gaps are retained explicitly
in the adapted data. Scorer set counters describe only the mapped dimensions;
they are not a complete case pass. In particular, the doc-ambiguous adapter
cannot detect a presentation claiming one candidate is uniquely correct.

The other 30 cases return no adapted case and remain explicitly unscored,
including the same-product-only inventory case and every maintenance, cited
answer and contradiction case. A model/product match is never translated into
physical identity. More mappings need an explicit semantic/dimension review;
the corpus's original annotations must not be rewritten to manufacture coverage.

Three authored default-library Rust cases check frozen corpus/cardinality and
mapping limits, separate supplied inventory category/identity counters, retained
alternative document links and changed/withdrawn context refusal through the
existing validator. Supplied JSON is deliberately handwritten. Rust formatting,
compilation, Clippy and these tests are **NOT RUN** at this integration. There is
no generated evaluation-result artifact, model accuracy, calibrated probability,
fitted threshold or complete child-issue acceptance claim. No workflow or new
runner selection is added; the standalone Python mutation suite stays separate.
