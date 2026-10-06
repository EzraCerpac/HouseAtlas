# Numeric semantics proposal

The frozen core schema permits unbounded integers in several source/wire fields.
Those fields must not be given an undocumented i64/u64 or JavaScript safe-integer
maximum. JSON wire numbers remain numbers; this proposal neither clamps them nor
changes them into strings. The published schemas and generated TypeScript are
unchanged.

## Feature selection for the integrator

The shared manifest owner should select the existing exact versions as follows:

```toml
serde_json = { version = "=1.0.151", features = ["arbitrary_precision"] }
jsonschema = { version = "=0.58.6", default-features = false, features = ["arbitrary-precision"] }
```

AT51 correction ownership excludes shared manifests and locks, so they are not
edited in this commit. The scoped compiler runner selects this proposed pair
with Cargo `--features` arguments. The existing lock supports that selection.
Ordinary compiler/fixture success is evidence for that feature configuration;
it is not evidence that the integrator has selected the features in its build.

Without this pair, serde_json may convert a numeric token beyond i64/u64 through
f64 before validation, losing its original integer value. That previous default
representation remains a known limitation of builds that omit the proposal.
Enabling only the parser feature is insufficient: validation must select the
matching arbitrary-precision numeric operations as well.

## Intended backend and JavaScript behavior

With the pair selected, `JsonInteger` and `JsonNumber` retain serde_json Number
tokens without an implicit f64 conversion. The library may normalize the `+`
sign of a positive exponent; byte-for-byte lexeme preservation is not promised.
`JsonInteger` classification and `ConstInt<N>` comparison delegate to the locked
schema library's numeric operations. These use BigInt/BigFraction before f64 for
large ordinary integer/decimal forms. Explicit `as_i64`/`as_u64`/`as_f64` callers
remain responsible for their chosen conversion; a missing result is not zero.

The published JavaScript and generated TypeScript use IEEE-754 `number`. A
regular JSON.parse consumer does not gain exact large-integer handling from a
Rust backend. Safe bounded revision fields keep their published schema bounds.
Exact handling of an unbounded source integer in a browser needs a lossless JSON
consumer or a separately versioned wire decision; no such consumer is supplied
here. Already parsed JavaScript numbers cannot recover their original tokens.

AT51 implements no audit digest algorithm. Numeric normalization in the existing
JavaScript JSON.stringify-based canonical representation needs reconciliation
with storage/history owners before new large values are used in compatible
audit digests. Current healthy fixtures use the accepted existing representation.

## Remaining precision qualification

The paired feature names do not establish unlimited arithmetic. Static review
of locked jsonschema-value 0.58.6 found that scientific exponents parse as i64,
and some BigInt/BigFraction exponent adjustments are capped at 1,000,000. Failed
exact parsing can fall back to f64, including underflow. Full mathematical JSON
Schema semantics for every scientific-notation form are therefore not claimed.
No extra numeric bound is added to the frozen schema, and unsupported arithmetic
must not be presented as a new schema restriction or silently accepted as an
exact value. The integrator must resolve supported-domain/error handling and
client/canonicalization semantics before claiming full unbounded-number fidelity.

These statements come from source inspection of serde_json 1.0.151
`src/number.rs` (token representation), jsonschema 0.58.6 `src/lib.rs` (public
numeric reexports), and jsonschema-value 0.58.6 `src/cmp.rs`, `src/types.rs` and
`src/numeric.rs` (numeric comparisons and exponent limits). No large-number,
collision, mutation, omission, adversarial or negative-consumer probes were run.
Only the existing explicitly named healthy fixtures and source compilers are
authorized for this correction.
