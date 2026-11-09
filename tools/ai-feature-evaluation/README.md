# Generated AI feature evaluation annotations

This independent corpus contains 32 fictional scenarios and 20 source versions
for #564 inventory (6), #565 documents (7), #566 maintenance (6), #567 cited
questions/routing (6), and #568 record review (7), under #563. Every object,
serial, product, room and date is synthetic. The 2030 dates are deliberately
fictional fixture dates, not observations about a real household.

## Scope and ownership

These JSON annotations are NOT a canonical schema, runtime wire format,
provider response, approval, credential, source manifest or truth store.
They have no production imports. No runtime, schema, UI, manifest, CI,
credential or deployment file is changed. No model has been called or scored.
Readable excerpts simulate extracted text; no images/PDF/OCR engine or actual
original bytes are provided. Original IDs are fictional comparison labels,
not downloadable handles or custody receipts.

The source coordinator must choose the final path and adapt the annotations to
the existing shared validator once its contract is confirmed. Suggested path:
`tools/ai-feature-evaluation/`. No runner registration or publication is included.

Public source was refreshed through the GitHub connector on 2026-11-08:
`main` resolved to `4c5434de928dcbbad568223e08924b0711710349`.
The exact bodies of #563 through #568, root AGENTS.md,
`docs/coordination/worker-handoff.md` and relevant verification/runner guidance
in `docs/contributing/verification.md` were read before implementation/checks.
The handoff preserves private ancestry and all existing runtime/UI owners.

## Run locally

Python standard library only. Inspected code reads only these supplied files;
mutation controls copy the generated JSON into memory. No subprocess, network,
model inference, credentials, provider, browser, actual inventory or user files
are used. `-B -I` disables bytecode writes and ambient Python import paths.

From the artifact root:

```
python3 -B -I tools/ai-feature-evaluation/check_corpus.py
python3 -B -I tools/ai-feature-evaluation/test_check_corpus.py -v
```

## Annotation interpretation

- IDs are stable local fixture identities. `input_sources` picks exact versions;
  source date and retrieval date remain separate, with explicit null unknowns.
- `authorized_candidates` describes the generated initial bounded candidate set,
  not a real access grant. `allowed_candidates` are permissible review candidates,
  not mandatory unique winners. `forbidden_candidates` are negative labels.
  Subsequent `disclosure_revoked` removes disclosure permission in that scenario.
- `expected_claims` are labeled reference expectations with exact version,
  section and excerpt. They do not form an executable proposal. A source citation
  alone does not mechanically establish semantic entailment.
- Abstentions, unknowns and rationale are explicit. All effects are forbidden and
  review is required. Scores are uncalibrated; there are no numeric probabilities
  or chosen model thresholds. Empty/partial retrieval is never exhaustive.
- Changed versions may be shown together for historical comparison but cannot
  authorize applying an earlier proposal. Original unavailability is separate
  from unreadable text and access revocation.
- Repeat expectations label unresolved reuse, dismissal retention and changed
  source re-review. They do not execute or qualify a production deduplicator.
- Untrusted source text includes adversarial instructions as data. No content
  in this corpus grants tool use, scope expansion or any consequential action.

## Future thin adapter and measurement

An eventual adapter should resolve fixture IDs to the shared owner's test IDs,
feed only the selected generated records, and map the shared validator's output
back to these label/candidate/reference tuples. Keep that mapping outside the
runtime contract; never implement a competing proposal authority here.

Report inventory classification errors separately from duplicate-candidate
false positives/negatives (same product is not same physical item). Report
question routing errors separately from factual groundedness, exact citations
and correct abstention. Preserve multi-candidate labels instead of forcing one
winner. Maintain separate document-class/link and maintenance interval/date
counts. Report access/version safety failures independently of semantic quality.

No model accuracy, calibrated confidence, cost, latency or live acceptance can
be inferred from the integrity checker. Later thresholds require an explicit
cost/risk objective, independent generated evaluation split, coverage versus
abstention analysis and owner review. This small authored corpus is a seed,
not a representative benchmark or threshold justification.

## Checks and remaining gaps

The checker verifies selected-source/version/section/quote integrity, unique IDs,
bounded disjoint candidate labels, mandatory uncertainty and no-effect scope,
withheld revoked/unreadable citations, stale application holds, limited due-date
baseline annotations, bounded routes and key electrical/instruction boundaries.
It checks required coverage tags, not natural-language truth. It is a small
trusted-fixture linter, NOT a general hostile-output parser or security boundary.

The tests mutate generated annotations and assert checker refusal. They do not
exercise production access revocation, original custody, schema compatibility,
review components, model behavior, actual semantic entailment, OCR, budget,
offline UX, provider/service/device operation or deployment. Those remain with
the relevant owners. No shared CI or publication check ran because this is a
standalone artifact, not a composed repository checkout.
