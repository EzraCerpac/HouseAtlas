# Contract serialization correction

This correction appends to PR 5 baseline head
`7f5faca11aa65a723bb3a4540654e0a436afbacf`. That commit and its original scoped
patch remain preserved. Correction ownership is limited to contracts, baseline
tools/docs and generated frontend DTOs; transferred manifests, locks and module
declarations are unchanged.

## Open-object serialization

Previously, public flattened extra-property maps could serialize a modeled key
after its typed field. The resulting JSON value could replace the typed value
before `validate`/`encode` checked it. The generator now emits per-struct extras
serializers for all four open HomeBox shapes:

- `HomeboxPageWire`: items, page, pageSize, total.
- `HomeboxPageWireItemsItem`: id, name, archived, updatedAt, entityType, parent.
- `HomeboxPageWireItemsItemEntityType`: id, name, isLocation.
- `HomeboxPageWireItemsItemParent`: id.

Each serializer passes its entire schema property set to the shared helper. The
helper returns a Serde error if any extras key is modeled. Optional modeled keys
are reserved even when their values are omitted. Child DTO serialization invokes
the corresponding child helper, so nested typed objects apply the same rule.
Direct Serde serialization and the existing `validate`/`encode` paths propagate
the error instead of returning overwritten JSON. Legitimate extra properties
remain supported; TypeScript and wire schemas are unchanged.

This behavior is a source-backed correction. No collision construction or
rejection probe was executed. Static review checked each generated modeled-key
set against its schema properties, including the optional item fields.

## Numeric proposal and evidence

Integer classification and literal-number comparison now delegate to the locked
schema library's numeric operations. [numeric-semantics.md](numeric-semantics.md)
proposes paired precision features to the shared manifest owner, documents the
previous default-mode rounding and discloses remaining scientific-notation,
JavaScript consumer and canonical-digest questions. No schema maximum, string
wire substitution or claim of complete unbounded-number fidelity is added.

The inspected `tools/rust-baseline/check.mjs` runner passed on Rust/cargo 1.99.0,
Node 26.10.0 and npm 11.19.1 with the proposed precision pair selected through
Cargo flags and the existing unchanged Cargo.lock:

- Deterministic generation drift; 48 compiled core schemas plus history;
  10 explicitly named healthy fixtures and two context committed records.
- All 14 existing HTTP compatibility/schema/valid-history checks.
- Rust fmt/check/clippy with warnings denied; 13 existing typed round-trips.
- Disposable SQLite 3.53.2 transaction and in-memory Axum/Tower request.
- Strict TypeScript compilation and the Vite production compiler-scaffold build.

The complete correction runner log is outside Git at
`/tmp/houseatlas-at51-correction-check.log`. Original fixture inputs were not
edited. No collision, mutation, omission, adversarial, fault, concurrency,
large-number boundary or negative-consumer controls were executed. The hosted
original publication allowlist remains the integration owner's reconciliation
task; this correction does not change it.
