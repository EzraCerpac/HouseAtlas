# Native stock wire3 contracts

This component validates the adopted stock.2 wire3 inputs from published main
`e9de66477c04c43eb74a29d932b22322115e33d5`. It is a pure contract component with
embedded schemas and catalog metadata. It supplies no provider, authority,
storage, dispatch, receipt lookup or runtime presence admission.

## Domain interface

`StockValidation::new()` prepares the offline registry and catalog. Its
`validate(local_schema_ref, &Value)` method matches the domain's narrow
`StockContractPort` checker signature. It validates the entire input against a
known adopted definition without defaults, coercion, field stripping, array
sorting or numeric normalization. Unknown schema selectors are explicit errors.
No JavaScript or external schema retrieval is used.

`StockRequest::parse(&validator, value)` and `validator.decode_request(bytes)`
produce an immutable schema-checked envelope: typed operation/context/target,
original JSON, request ID, intent digest, omission/null accessors and ordered
batch children. There is no unchecked constructor or mutable original value.
Payloads remain complete schema-checked JSON instead of a second hand-written
copy of every payload arm. `StockContract` provides schema-backed generic
decode/validate/encode for fixed-definition typed DTOs.

`StockResponse::parse(&validator, &request, value, child_values)` validates the
catalog's exact output mapping, request/command/scope correlation, committed
Atlas request digests, exact local targets, remap identities, ordered batch
child flattening, selected owner/source/resource correlation, requested output
bounds and provider activity distinctions. It returns typed response/activity
states and explicit `OutputObligation`s. These require current disclosure
authority and actual owning/impact/ancestor/new-identity/artifact facts from the
domain. The owner must discharge root and child obligations; contract success
does not grant authority or prove a provider invocation or termination.

The domain owner can replace its injected checker with this native object by
implementing its trait in the domain namespace:

```rust,ignore
impl StockContractPort for StockValidation {
    fn validate(&self, schema: &str, value: &serde_json::Value) -> StockResult<()> {
        StockValidation::validate(self, schema, value)
            .map_err(|_| StockError::InvalidContract)
    }
}
```

The trait/error names in this small adapter refer to the domain's types. The
contracts implementation has its own detailed `StockError`. Main does not yet
contain the stock domain module, so this adapter is an integration instruction,
not a claim of composed service coverage.

## Structural coverage and semantics

The native registry embeds the four resource-map schemas and verifies their
SHA-256 pins. Frozen Atlas references resolve by canonical `$id` and a synthetic
repository file-URL alias. Agent references resolve at their adopted URN;
presence relative references resolve entirely in memory. The compiler's
retrieval is explicitly offline. The schemas and resource map are unchanged.

There are 451 agent definitions, including 164 request and 158 result
definitions, and 48 frozen Atlas definitions. All 164 catalog input/output
mappings and ten family input/output mappings are retained. The 164 output
mappings select 161 distinct definitions; shared feature/outcome definitions
are not invented result arms. `compile_all` compiles 503 validators: the 499
definitions and four roots, including witness and qualification schemas.

Catalog order, all operation IDs, family membership, complete metadata and the
four capability classifications are preserved: 150 supported pending
qualification, nine unsupported, three append-only forbidden and two held.
These are specification classifications, not runtime eligibility decisions.

Intent hashing reuses the accepted native canonical JSON/SHA-256 implementation.
Only root `requestId` and `approvalReceiptId` are excluded. Only a HomeBox root
also excludes `preconditions.providerObservation`. Child IDs and approvals,
ordered arrays, guards, omission/null and submitted payloads stay in the parent
intent. No recursive exclusions or wire rewriting occur. Numeric schema bounds
remain exact within the existing checked processing envelope; digest arithmetic
uses the published finite JavaScript number model.

Date, date-time and URI formats reuse the reviewed native predicates. Operational
result clocks additionally require a finite timestamp from the accepted native
Date.parse comparison parser. This is a source-backed parser for the published
schema's admitted forms, not a general date parser. No runtime clock is read.
JSON Schema lengths count Unicode code points. Duplicate-key intake remains the
core HTTP/parser owner's policy; a Value cannot recover discarded keys.

Typed witness/qualification decode/validate/encode helpers check full schema
shape and conditional arms; see [presence scope](README.presence.md). They do
not establish trusted authority, source membership/freshness, atomic witnesses,
durable persistence, recovery or runtime availability admission.

## Verification boundary

Actual source compilation uses a task-owned Cargo harness whose tiny library
glue points directly at `backend/src/contracts/mod.rs`; no implementation is
copied. It pins the accepted dependencies and disables automatic target
discovery. Shared manifests and locks remain with the integrator. The reviewed
core semantic source from checkpoint `003f9d6ae91418c793361894d47be0f8b258455c`
was first carried byte-identically onto main in commit
`2f526a95aa00458d320be552462e5517d18d6712`. This component only exposes its
existing date/finite-time helpers for reuse; existing semantic logic is unchanged.

The explicit valid-example scope covers local schema compilation, catalog
metadata, healthy synthetic envelopes/correlations/digests and witness shapes.
It executes no service mutation, provider, authorization or durable admission.
Rejection, mutation/omission, adversarial, guard reversal, replay, expiry,
revocation, fault/crash, concurrency and negative-consumer controls remain unrun.
Boundary behavior is source-reviewed and unqualified by these valid examples.
