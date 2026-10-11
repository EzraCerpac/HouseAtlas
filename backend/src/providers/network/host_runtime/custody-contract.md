# Sidecar custody inputs still required

This is an integration contract proposal, not an accepted peer API or a deletion
implementation. The actual immutable sidecar exposes stage/load; Atlas owns the
issuing fence, permanent generation reservations and publication history. The
runtime cannot establish reclamation authority from the current cache pointer.

Two different dispositions are needed for findings 4210549449 and 4210645136:

1. **Rejected staged candidate.** Original Store/native publication must return
   owning custody of the original staged receipt with an opaque, issuer-bound
   definite-never-published disposition. It must bind the exact Store instance,
   registration, complete partition, reserved generation and sidecar digest.
   An ambiguous commit/error outcome remains protected. A failed authority check
   does not authorize deletion or grant recovery with a fresh principal.
2. **Superseded published generation.** Root/Storage must provide an explicit
   retained-reference/history policy and an authoritative complete protected set
   from the same exclusively borrowed native Store. Inputs must include current
   pointers, retained history, active read/disclosure custody, in-flight stages,
   recovery obligations and any archive references. Permanent reservations are
   never reused. This owner must decide whether historical generations are kept
   locally or transferred to an approved archive; no implicit age/count cutoff
   or assumption that superseded means disposable is supplied by this runtime.

The operation must serialize candidate selection and disposition with original
native publication and read custody. A projected list, another Store connection,
or a current-pointer comparison is insufficient. Protected-set completeness and
policy revision must be validated before reclamation; missing or contradictory
inputs fail closed. An accepted sidecar operation must consume original custody,
verify the receipt's exact partition/generation/digest, and preserve every
protected row. It cannot remove no-delete triggers as an ad hoc runtime step.

The concrete original-owner proposals are Storage's custody-preserving outcome
and live same-Store guard in [6044956475](https://github.com/EzraCerpac/HouseAtlas/pull/73#issuecomment-6044956475),
and [its residency/archival proposal](https://github.com/EzraCerpac/HouseAtlas/pull/73#issuecomment-6044805309).
They are not published compiler APIs. The host would retain the actual rejected
native staged object/fence/receipt, release Access, then consume that fence into
the same Store's live never-published guard before a candidate-only sidecar abort.
Guard acquisition/release errors must retain custody; ordinary errors confer no
cleanup permission. Native must distinguish a newly inserted row from immutable
replay and bind original receipt custody as well as matching metadata.

For published rows, an initial bounded working-store design is immutable segment
rotation: seal, fully sync and reopen/verify the old segment; retain its original
rows read-only; commit a durable original generation-to-segment catalog under
native residency/pin exclusivity; then stage in a new bounded active segment.
The loader must resolve protected archived generations through that same catalog
before hot residency changes. This preserves v1 immutable rows and permanent
Atlas reservation history without reversing DELETE/UPDATE triggers. A verified
archive witness must bind original bytes/partition/ID/digest and approved catalog
custody. Root must specify protected archive capacity and fail-closed backpressure
when full, or explicitly authorize a complete reference-based retention release.
Rotation bounds active-store pressure; it does not bound unlimited total history.
Archive/catalog/pin APIs and this Root policy remain missing actual inputs.

Bounded processing must use owner-selected finite count/byte budgets within the
existing 10,000-row/16 MiB packet/10 MiB row limits. Enumerate all protected
references or stop without reclamation; never truncate a protection list. When
there is insufficient space for the next complete generation, reject admission
before transport/staging with an explicit capacity result. Do not evict retained
generations to make room. Root must specify the admission/reservation API and
approved archive/retention policy; Storage/native/sidecar owners must publish
the actual proof/custody types and atomic consuming operations before the host
can call them. These are concrete missing inputs, not substitute DTOs.

Filesystem reclamation must occur after releasing the original Access guard,
while retaining native exclusivity and original custody. It must not hide file
I/O inside authority callbacks. On cancellation or ambiguous storage failure,
retain custody and rows for explicit owner disposition. This proposal promises
no crash recovery and releases no historical crash/replay/revocation tests.

Until those actual APIs and policy inputs are accepted, both lifecycle findings
remain source holds. The current runtime keeps all current-authority checks,
original-fence publication and immutable rows; operational refresh/retention
qualification remains blocked. The authorized synthetic regression lane tests
only its named concurrency, cancellation and captured-failure-time cases.
