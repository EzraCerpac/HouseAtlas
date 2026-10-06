# Checked numeric processing correction

This correction appends to PR 5 correction head
`dac410e22f63a231118f513a0a565093e0836213`. Both that head and the original
`7f5faca11aa65a723bb3a4540654e0a436afbacf` scaffold remain preserved. Only the
retained contracts and baseline documentation namespaces change; transferred
manifests, locks, module declarations and frontend configuration remain unchanged.

The first numeric correction delegated integer classification to the locked
schema library. Its failed exact parser could fall back to f64, and its exponent
subtraction preceded the dependency cap. Documentation of those limitations did
not prevent the paths. The new lexical parser checks valid number grammar,
4,096 token bytes, exponent magnitude 4,096 and checked decimal-shift magnitude
4,096 before dependency processing. It classifies integral values and compares
literal i64 values directly from digits, without f64 or exponent expansion.

Instance validation and embedded schema compilation traverse every numeric
value before calling jsonschema. Private number wrappers check deserialization;
open-object serializers recursively check extras as well as modeled-key
collisions. Unsupported processing is an explicit error. The exact API and
feature requirements are recorded in [numeric-semantics.md](numeric-semantics.md).

Published core/history schemas, healthy fixtures, generated Rust/TypeScript DTO
shapes and JavaScript canonicalization remain unchanged. This supplies no audit
digest implementation and promises no lossless IEEE-754 browser handling.

Independent source review found no guard coverage defects. The existing inspected
`tools/rust-baseline/check.mjs` runner passed with the paired features selected:

- Deterministic DTO drift check, 48 compiled core schemas plus history, ten
  explicitly named healthy fixtures and two context committed records.
- All 14 existing history compatibility/schema/valid-example checks, including
  accepted committed-record digests.
- Rust fmt/check/clippy with warnings denied and 13 typed fixture round-trips.
- Disposable SQLite 3.53.2 transaction and in-memory Axum/Tower request.
- Strict TypeScript compilation and Vite production compiler-scaffold build.

The full runner log is `/tmp/houseatlas-at51-numeric-check.log`, outside Git.
No boundary, underflow, overflow, collision, mutation,
adversarial, fault, concurrency or negative-consumer probes are introduced or run.
The original hosted publication allowlist still requires owner reconciliation.
