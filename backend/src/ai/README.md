# AT42 AI component

This namespace contains an embeddable Rust component for the new modular
monolith. It adds no database, executor, service framework, listener, credential
store, login implementation or provider transport. Include `pub mod ai;` from
AT51's backend crate. Local types are proposed boundary contracts; AT51 owns
their eventual generated forms and application manifests.

## Coded behavior

`AiRunner::run` accepts an opaque server context `C`, a host-selected model slug,
a browser request ID/prompt, a cancellation handle and bounded local limits.
The context has no serialization or cloning requirement and never enters model
input. Browser/model actor, role, route and home claims do not grant authority.

Each inference round rechecks connection state and the authorized shared domain
catalog. Read-only calls dispatch through that catalog with current context.
Source refresh, diagnostics and mutation calls must have `RequiresReview` effect;
the runner returns their proposals before executing any call in that round.
There is no approval/resume operation. The shared catalog retains responsibility
for schema validation, source authorization, current membership, history ordering,
revision guards and storage transaction boundaries. AI duplicates none of them.

The SIWC request builder enforces an explicit input array, namespaced functions,
`store:false` and `stream:true`. It emits no unsupported SIWC parameters or
credentials. Schemas pass through without rewriting nullable/optional fields;
`strict:false` avoids independently changing the canonical domain schema.
Completed output items, including opaque reasoning, are retained in order before
correlated JSON-string tool results. `completed_event` decodes a terminal
`response.completed` with completed status, never a partial text/tool delta.
An actual transport still must bound streams and supply replayable output items.

Identity authorization, direct inference permission, request eligibility and
runtime availability are independent. SIWC readiness requires validated granted
permission (the `chatgpt.tokens.use.direct` scope). Unknown request eligibility
can proceed to an explicitly requested inference; known ineligibility cannot.
No plan allowlist, automatic billing fallback or permanent awake-Mac assumption
exists. The host verifies the selected account's current model and capabilities.

Cancellation requests are distinct from confirmed upstream cancellation. The
runner stops scheduling at checkpoints and reports `stopped`; adapters may report
`cancelled` only with terminal confirmation. Known provider failures resolve
`failed` with measured usage. Unresolved transport failure returns
`UnconfirmedRun`; totals stay unknown for unmeasured attempted rounds. Token
counts are optional provider observations, never quota, price or reset estimates.
Structured provider status/code/parameter/request ID remains in an internal
reporting port, outside the browser DTO and without raw response content.

## Proposed peer interfaces

- `ConnectionPort<C>::check`: revalidate account, direct permission, known
  eligibility, selected model and runtime observation.
- `RuntimePort<C>::status`: scoped runtime observation, with no automatic
  process start or wake; the connection adapter can compose this port.
- `InferencePort<C>::infer`: bounded async inference with a request ID and
  cancellation handle; return completed, known failed, locally stopped or
  confirmed cancelled outcome. Unresolved transport errors remain distinct.
- `DomainCatalog<C>::tools/execute_read`: authorized catalog projection and
  shared domain dispatch; no independently registered AI tools.
- `UsagePort<C>::observed/provider_failed`: measured round usage and private
  structured failure evidence.
- `CancelPort<C>::cancel`: scope-bound request cancellation with requested,
  confirmed, already-finished or unsupported receipt.

`PortFuture` uses `std::future::Future`; no Tokio dependency is required. Proposed
application dependencies: `serde = =1.0.229` with `derive`, `serde_json = =1.0.151`.
The component accepts no SQLite handle; the shared domain/storage owner supplies
the existing atomic operations through its catalog adapter.

Missing exact integration inputs are AT51's Rust catalog descriptor/result/error
types and schema-reference resolution, AT11's current opaque context and epoch
bindings, the host request-ID lifecycle/status recovery port, selected-account
model settings, replayable provider input conversion, and AT41's SIWC adapter
design. No independently fabricated OAuth registration, redirect, token-refresh,
credential-retention or approval capability is provided.

## Prior scoped checks

An isolated, locked compiler harness compiled these actual source files using
Rust 1.99.0. Format, check, build and clippy with warnings denied passed. The
application manifest, dependency lock and CI remain AT51 integration work;
private harness paths and exact execution logs stay outside source delivery.

Both `healthy_examples` passed: credential-free
connection/browser DTOs with granted permission and unknown eligibility, plus
published scoped records and recorded-history reads with two synthetic inference
rounds. They use the exact published record schema, plan-free snapshot, history
contexts and recorded bare audit array. They preserve unknown circuit labels,
history array shape, scope and opaque reasoning. The connection, inference,
catalog and usage peers in these examples are explicitly stubbed; no actual
provider, account, grant, domain mutation, SQLite transaction or listener runs.

Stopped rejection, guard-reversal, mutation/omission, adversarial, fault, crash,
concurrency and negative-consumer controls remain deferred and unexecuted.
Legacy broad aggregates were not run. Ordinary compile/example success does not
qualify provider behavior, security, target readiness or deployment. No further
validation was run during durable source packaging; delivery is not acceptance.

## Official source inputs

Reviewed on 2026-10-06:

- [SIWC models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference):
  public Responses endpoint, selected-account models and completed-stream success.
- [SIWC preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations):
  supported request subset, tool namespaces and explicit history.
- [SIWC errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery):
  direct-use permission, eligibility/usage failures and structured diagnostics.
- [Function calling](https://developers.openai.com/api/docs/guides/function-calling):
  namespace/function shapes and correlated tool outputs.
- [Reasoning context](https://developers.openai.com/api/docs/guides/reasoning):
  opaque reasoning preservation in stateless continuation.
- [Self-hosted VMs](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms):
  runtime placement independent from an awake Mac.
- [Official Responses cancellation implementation](https://github.com/openai/openai-python/blob/main/src/openai/resources/responses/responses.py):
  direct cancel supports background responses, which SIWC excludes.
