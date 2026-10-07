# Checked numeric semantics

The frozen core schema permits unbounded integers in several source/wire fields.
JSON wire numbers remain numbers; this implementation neither clamps them nor
changes them into strings. Canonical per-field bounds, published schemas and
generated TypeScript are unchanged. The backend explicitly reports unsupported
numeric processing outside the bounded representation described below.

## Feature selection for the integrator

The shared manifest owner should select the existing exact versions as follows:

```toml
serde_json = { version = "=1.0.151", features = ["arbitrary_precision", "raw_value"] }
jsonschema = { version = "=0.58.6", default-features = false, features = ["arbitrary-precision"] }
```

AT51 correction ownership excludes shared manifests and locks, so they are not
edited in this handoff. The accepted object-preservation compiler harness selected
all three features explicitly. The unchanged scoped runner selects the precision
pair with Cargo flags and inherits `raw_value` when the shared manifest selects
it. The existing lock supports that selection.
Ordinary compiler/fixture success is evidence for that feature configuration;
it is not evidence that the integrator has selected the features in its build.

The checked parser calls the feature-gated `serde_json::Number::as_str`, so the
source requires the parser feature rather than silently compiling with rounded
tokens. The compiler runner explicitly selects both precision features. The integrator
must also select the matching schema arithmetic feature in its manifest;
enabling only the parser feature is insufficient for schema numeric comparisons.
`raw_value` supports the object-preserving parser and open HomeBox DTO conversion.
Those DTOs require serde_json's raw capture protocol; generic Serde deserializers
and buffered `flatten`/`untagged` wrappers around them are unsupported. None is
used for those types by the supplied schemas. See the [handoff](README.md) for
the supported JSON and already-preserved Value paths.

## Backend processing envelope

Every numeric token must have valid JSON number grammar and meet all three
processing limits:

- At most 4,096 token bytes.
- Explicit decimal exponent magnitude at most 4,096; an absent exponent is zero.
- Magnitude of `exponent - fraction_digit_count` at most 4,096.

The lexical parser uses checked exponent multiplication/addition/sign, fraction
length conversion, subtraction and absolute value. It performs no floating-point
conversion or power expansion. Numeric instances are checked before schema
validation, including unknown properties and every nested extra property. Frozen
schema numbers are checked before schema compilation. This keeps dependency
exponent subtraction and normalization inside its exact-parser arithmetic limits.
The limits constrain representation work, not the canonical numeric value bound:
an unsupported spelling returns an explicit processing error, never a coerced
value or an invented schema maximum.

`decode` and numeric validation of JSON values return
`ContractError::UnsupportedNumber(&'static str)` outside this envelope. Direct
Serde deserialization of `JsonNumber`/`JsonInteger` and serialization of open-wire
extras report Serde errors for unsupported numeric tokens; `validate`/`encode`
propagate those serialization errors as `ContractError::Json`. Private numeric
wrapper fields prevent bypass through public construction. Their i64/u64
constructors fit the envelope, and `from_f64` checks both finite conversion and
the lexical envelope.

Within the envelope, `JsonInteger` classifies the coefficient digits and decimal
shift exactly. Zero is integral; a negative shift requires enough trailing zero
digits. `ConstInt<N>` compares normalized decimal digits and sign against `N`
without dependency equality or f64 fallback. Schema comparisons still use the
locked schema library with its paired precision feature. `JsonInteger` and
`JsonNumber` retain serde_json Number tokens; serde_json may normalize the `+`
sign of a positive exponent, so byte-for-byte lexeme preservation is not promised.
Explicit `as_i64`/`as_u64`/`as_f64` callers remain responsible for their chosen
conversion; a missing result is not zero.

## JavaScript consumers and digests

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

## Source review and qualification

Static review of locked jsonschema-value 0.58.6 found that scientific exponents
parse as i64, exponent-minus-fraction subtraction is unchecked, and some
BigInt/BigFraction exponent adjustments are capped at 1,000,000. Failed exact
parsing can fall back to f64, including underflow. The checked envelope precedes
all dependency numeric processing and exact DTO integer/literal checks no longer
use that fallback. Full mathematical JSON Schema semantics for every possible
numeric spelling are not claimed. Client/canonicalization decisions remain with
the integration and storage owners; this backend processing correction supplies
no lossless browser consumer or replacement digest algorithm.

These statements come from source inspection of serde_json 1.0.151
`src/number.rs` (token representation), jsonschema 0.58.6 `src/lib.rs` (public
numeric reexports), and jsonschema-value 0.58.6 `src/cmp.rs`, `src/types.rs` and
`src/numeric.rs` (numeric comparisons and exponent limits). No large-number,
collision, mutation, omission, adversarial or negative-consumer probes were run.
Only the existing explicitly named healthy fixtures and source compilers are
authorized for this correction.
