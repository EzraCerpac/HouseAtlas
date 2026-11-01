# Prospective storage protocol v2

References #497; broader acceptance remains open. This is a source contract for
an injected owner adapter, not an installed custody route. No prospective
production demonstration has occurred. `disposition.py` and its closed v1 API
remain unchanged, including every `authority: unverified` diagnostic.

## Owner and interface

`storage_adapter.StorageAdapter(OwnerConfig, OwnerPorts)` is importable Python
stdlib code. It has no CLI, built-in filesystem/transport/clock/lock, credential
provider, host discovery, pruning, installer or live integration. Do not wire it
into the source-only maintenance placeholder in dotfiles: that caller has no
custody transport/journal and its lock is not the storage owner's lock.

The existing sole operational writer supplies **all** `OwnerPorts` methods.
`OwnerPorts`, frozen dataclasses and method docstrings are the executable
interface. Main calls are:

| Call | Purpose |
| --- | --- |
| `capture_intent(raw, operation, event_id, kind, state)` | Admit raw closed-v1 input, freeze byte identity, authorize and reserve a fresh prospective cycle; append/read back immutable intent and a separate verification artifact. |
| `dispatch(raw, operation, event_id, kind, state, effect)` | Under the owner's nonblocking lease, verify retained intent/artifact, scope, registry, clocks and protected fence; durably append a distinct dispatch marker before calling the owner's conditional-dispatch port. |
| `record_outcome(..., phase, references)` | Record complete/failed/interrupted/unknown after dispatch. A supported complete requires strictly later prospective evidence and an unexpired intent. No failure is overwritten. |
| `record_observation(..., references)` | A separately authorized read-only observation, with a fresh operation. It never supplies prior mutation intent or completion. |
| `reconcile_operation(..., references, reconciles)` | New immutable read-only observation covering every retained record hash in this dimension under the authoritative frontier. No effect is replayed. |
| `resolve_reference(reference, raw_record)` | Verify one exact evidence ID through raw-v2 admission, the current injected clock and the scoped qualified resolver. |
| `verify_durable_readback(raw)` | Read-only verification of an already retained event and its separate verification artifact. It emits no new event. |
| `project_current(kind=...)` | Return a bounded current observation plus retained history/conflict/reconciliation hashes, or unknown/refusal. |
| `diagnose_v1(raw, as_of=...)` | Explicit closed-v1 diagnostic only; no v2-to-v1 conversion. |

Arguments after `raw` are keyword-only except for `resolve_reference`. Inputs
are original UTF-8 JSON **bytes**, immutable source bytes and finite concrete
tuples/lists. Exceptions carry fixed codes, without echoing private input or
owner exception messages. A port failure means no authority result; it is not
permission to retry an effect. A recorded dispatch with no outcome is uncertain.

## Exact original identity and admission

Every operation starts with `disposition.parse(original_raw_bytes)`, before any
generic decoder can lose duplicate keys. Requests have an empty `events` list;
completed historical v1 operations are refused as prospective requests. The raw
request text is retained in each v2 event without reserialization. All v1 token,
field, identity, hash, count, array-order and size restrictions apply.

`PinnedSource(manifest: bytes, payloads: tuple[(token, bytes), ...])` hashes the
**untouched original marker/manifest bytes** and every actual payload separately.
It never reconstructs the original JSON. The manifest and sorted named payload
pins use v1's exact `identity` algorithm. Names come from the fixed reviewed
private registry, not filenames or discovery. Source manifests, native sources,
supplemental plans, recovery archives and carriers remain distinct: evidence
carriers are never silently inserted into the original ready payload set.

`FrozenExport` requires original bytes, an independently constructed optional
release, label, expected registry provenance and retained-original status.
`registry_sha256` binds these exact byte pins and provenance. Labels cannot be
rebound within the authoritative scope ledger. Registry changes fail closed.
Qualification/selection additionally refuse null releases and original/release
identity aliasing. The configured `kinds` and per-call owner authorization must
permit the specific dimension/mode. Custody supplies no consumer authority or
invented `unselected` observation.

The operational owner must preserve the raw input snapshots and immutable
private registry mapping, with original byte provenance, before calling. This
library's hashes authenticate bytes, not the issuer, storage location or truth.

## Bounded streaming pins for large original payloads

The small `PinnedSource` convenience path remains capped at 64 MiB. Large inputs
use `StreamingSource(manifest_bytes, tuple[StreamPayload, ...])`. Each immutable
`StreamPayload` declares a reviewed name, opaque private-registry handle, exact
expected byte count/hash and immutable backing-state digest. Its
`identity_object()` is explicitly a **declared projection**, never evidence of
byte verification. `StorageAdapter` independently reads and hashes the actual
stream before accepting that projection.

The caller must supply explicit `StreamLimits(max_payload_bytes,
max_source_bytes, chunk_bytes, max_chunks)`. There are no streaming defaults.
The bounds admit at most 64 GiB per payload, 128 GiB total streamed data per
adapter call, 1 MiB per chunk and 1048576 chunk/EOF reads; the qualified owner
selects smaller resource limits appropriate to its route. The exact actual
input size is not a public fixture or a policy constant. The retained manifest
is exact original bytes, bounded at 256 KiB; each source retains v1's 128 named
payload cap. Limits are admission constraints, not deletion/retention policy.

The owner implements `stream_state(scope, handle, budget_ns=...)` and
`open_stream(scope, handle, expected_state=..., max_bytes=..., max_chunks=...,
budget_ns=...)`. An opened `StreamReader` exposes immutable `StreamState` and
`read_chunk(max_bytes=..., budget_ns=...) -> bytes`, followed by `close()`.
`StreamState` pins the backing identity digest, qualified independent read route
and durable/independent-readback status. No path, host discovery or caller-supplied
iterator is accepted. The owner must atomically open the expected immutable
backing identity and change that identity whenever backing bytes change.

The adapter enforces finite raw-byte chunks, exact cumulative byte count,
explicit EOF and incremental SHA-256. It refuses short/extra data, mutable or
unbounded chunk containers, hash mismatch, aliased opaque handles, excessive
calls and admission violations. It checks qualified backing state before and
after the read and closes the owned stream on every path. Hashing never loads
the entire master into memory. A per-call verified cache avoids repeated bulk
reads while still rechecking backing seals; a restarted adapter must verify
actual streamed bytes again. The cache does not confer a reusable effect permit.
Original and release streams remain independent.

Verified stream byte counts/hashes, routes and backing seals are bound into the
registry digest and separate verification artifact. Before dispatch, the owner
receives the exact `stream_seals` and must recheck them inside its real
conditional-dispatch exclusion, alongside the protected fence, authorization,
clock/deadlines and durable dispatch marker. Cached hashes or a resolver's
unsupported digest are not that owner guarantee. No distributed exclusion or
self-authentication of injected storage is implied. The per-operation 1024
ordinary-port limit is separate from the explicit streamed-chunk budget; owner
deadlines must also cover the incremental reader. Real route/resource/durability
qualification remains an operational adoption obligation.

## Versioned precision and freshness

V2 is separately versioned as `publication-input-storage-v2`, with evidence
profile `publication-input-storage-evidence-v2` and verification profile
`publication-input-storage-verification-v2`, plus immutable
`publication-input-storage-admission-v2` markers. It is **not** a v1 extension and
cannot be passed to the v1 classifier. V1 remains conservative for opposed
histories and accepts whole-second timestamps only.

`ClockSample` takes exact integer wall/monotonic nanoseconds and a pinned clock
source. Wire timestamps are exact UTC fixed-nine fractions
`YYYY-MM-DDTHH:MM:SS.nnnnnnnnnZ`. Conversion uses integer division, Gregorian
calendar arithmetic and no float epoch conversion. Monotonic nanoseconds are
**decimal strings** in JSON, never unsafe JavaScript numbers. Booleans, negative
or out-of-range clocks, offsets, leap-second spellings, shortened fractions and
invalid dates are refused. No synthetic delay or added nanosecond creates order.

The event's `recorded` instant is the outcome evidence's actual observation;
`captured` retains the adapter clock sample. Persistence/readback evidence must
be observed at or after that outcome, and before the captured instant. New
completion must be strictly later than its own intent **and dispatch**, from
the same operation. Equal, earlier or other-operation evidence does not resolve
intent. Original historical timestamp precision stays in its retained private
evidence; there is no truncation/rounding or historical-success conversion.

`Horizons` must be selected explicitly by the caller. Exported **engineering
proposals** are five minutes for intent dispatch and one hour for observations;
these are not deployed policy, retention deadlines or storage disappearance.
Both horizons are measured from the original event/observation instant, using
wall and elapsed-clock freshness together. Completion also retains its intent
fence and elapsed lease; changed protected state stops a dependent new intent. They
cannot be extended by replay. Intent expiry is checked using wall time and
elapsed monotonic time; reversal or changed clock provenance refuses progress.
A restarted owner must establish continuity of the qualified elapsed clock;
formatting alone cannot solve wall-clock rollback or prove continuity.

After expiry, current projection is unknown (or reference verification refuses
with a fixed code); a new cycle cannot refresh old evidence. The owner can
supply a genuinely fresh authorized read-only reconciliation with a new event
ID and actual readback. An operation outliving intent cannot manufacture a
completion: preserve uncertainty and reconcile. Never replay mutation just to
refresh an observation, rewrite expiry, or infer a horizon for historical data.

## Immutable journal and separate durability artifacts

V2 records have exactly the fields enforced by `parse_record`: profile, immutable
ID/operation, raw v1 request, scope/owner, dimension/state/phase, exact recorded/
captured/expires timestamps, clock source, decimal monotonic time, fence snapshot,
registry digest, predecessor/reconciled hashes, evidence references and mode.
The phase enum is intent/dispatch/complete/failed/interrupted/unknown/observation/
reconcile. Mode is mutation for the first five outcome/dispatch phases (including
unknown) and observation only for observation/reconcile. Unknown fields fail.
There is no generic "accepted" or "verified complete" state.

`append(scope, id, frozen_bytes, expected_tail)` must perform exclusive creation,
fsync/durability and atomic comparison against the authoritative tail under the
same owner lock/version claim. It cannot replace old bytes. An immutable event
is serialized **before** append. `independent_read` must retrieve exact bytes
through the separately qualified read route, not echo an argument or return a
cached caller object. Hash and full bytes must match. Changed-but-valid JSON,
stale bytes and short reads fail. A successful write callback alone is not proof.

After event readback, a **separate immutable verification artifact** binds the
event hash/size, write/read routes, original identity, registry digest, clock/
fence observations and resolved reference byte hashes, roles, provenance and
bindings. It is independently stored/read back too. This avoids self-referential
receipt hashes and never rewrites intent/completion to append its own proof.
No sidecar is itself a production receipt. Failure between any stages preserves
existing bytes and uncertainty.

After verification-artifact independent readback, the adapter checks the final
clocks, original completion lease, fence and registry again. It then calls the
owner's **conditional durable** `commit_admission(scope, id, proposal_bytes,
budget_ns=...)`. That owner must enforce the actual commit-time wall/elapsed
deadlines, clock source, fence/frontier/stream seals, scoped authority and
already independently read durable event/artifact prerequisites under its real
transaction semantics. Only then may it retain an immutable admission marker
and acknowledge durability. There is no built-in implementation or claim that
an advisory lock alone provides this atomic storage transaction.

The marker binds event and artifact hashes, operation/scope/owner/kind/mode,
registry and stream seals, fence, actual validated/committed nanosecond clocks
and both deadlines (elapsed numbers are decimal strings). An independent bounded
`independent_admission_read` must return the retained exact marker. Missing,
changed, future, expired-at-commit or context-rebound markers cannot support
completion after restart. If a lease expires during event/artifact persistence,
no admission is created; their mere existence remains insufficient. Late reply
time does not retroactively reject an already valid conditional admission.
The qualified owner must distinguish durable committed admission from pending/
uncertain transactions after a lost reply. A genuinely valid on-time commit may
be recovered through independently retrieved immutable admission proof, even
when its acknowledgement or readback reply was lost. This is explicit read-only
recovery of actual committed state, not promotion of a rejected late commit.
Missing/invalid proof remains blocked until fresh authorized reconciliation;
this library never redispatches the effect. Synchronous callback cancellation
and real atomic fsync/conditional-commit guarantees are owner qualifications,
not facilities supplied by this source library.

Covered incomplete records/artifacts remain retained. A genuinely subsequent
read-only reconciliation may support a new current observation over them, but
cannot retroactively admit the old completion. Projection reports all history,
retained conflict hashes, covered-history references and active conflicts;
`history_authority: retained-not-reverified` explicitly distinguishes preserved
history from the new observation's verified owner routes. Missing/changed sidecars or final admissions cannot unlock dispatch,
current projection or a new dependent cycle without explicit fresh reconciliation.

Identical repeated event admission returns the original retained bytes/artifact;
changed ID content is rejected. This is **storage idempotence only**. A new
adapter instance consults the durable ledger: it cannot reuse an intent or
allocate another operation to evade an unresolved dispatch. An intent is usable
only while it is the current dimensional frontier. A covering reconciliation or
newer cycle supersedes the old permit, including after restart; a delayed old
completion cannot establish current authority either. Dispatch is journaled
before invocation, including the crash-before-invocation window. Even when the
effect might not have run, the adapter has no automatic retry. Effect success
followed by completion write/readback failure is also unresolved.

## Qualified references and recovery

Opaque reference objects retain v1's exact id/hash/binding/role shape. The
resolver must return exactly one immutable retained raw body through a configured
route, with durable storage and independent status for the readback role. Its
closed evidence body binds profile, scope, owner, operation, dimension, state,
original/release hash, role, exact observation timestamp, clock source, provenance, prospective
origin, cloud status and carrier hashes. The adapter checks both those semantics
and the claimed byte hash; role strings alone are insufficient. Missing,
ambiguous, rebound, stale/future, wrong-operation, cross-role, wrong-scope/owner,
unqualified-route or changed-provenance evidence refuses authority verification.

Outcome, persistence and independent-readback roles are all required for a
supported completion or observation. No parser, formatter or adapter can
self-authenticate these routes: their operational qualification remains with the
sole owner. The separate artifact's `authority: injected-owner-evidence` describes
that conditional trust boundary. It never upgrades pure v1's `unverified` result
or proves custody, global exclusion, physical acceptance or operational adoption.

Recovery `recoverable` evidence requires actual `uploaded` status and explicit
carrier pins. Local file presence with pending/error/conflict upload is not cloud
completion. Incoming readiness is neither recovery qualification nor selected
publication. Failed observations remain evidence; they cannot become successful
by relabeling or formatting.

## Fences, frontier and reconciliation

The injected nonblocking lease is the existing owner's advisory lock plus
exclusive version claim. Its snapshot binds local generation, claim token and
protected application/selection/policy hashes. The adapter refuses busy locks,
known independent actors and changes during readback or final checks. A local
generation denotes only cooperating-writer sequence. No distributed fencing,
global process absence or promise that unrelated pruning/consumer writers honor
this advisory lock is made.

The effect is invoked only by `dispatch_under_fence`, not by a library
check-then-call. That owner port must hold its **actual** scoped exclusion and
conditional-write semantics, freshly recheck authorization, pinned registry,
protected state, clock provenance, wall/elapsed deadlines and dispatch hash,
then dispatch under that same guarantee. An independent mutable callback returning
"fence OK" does not implement this port. Real residual races outside the owner's
coordination must be disclosed as unsupported; they cannot become global proof.

`LedgerSnapshot` is a finite immutable tuple plus authoritative tail, complete
flag and qualified provenance. Completeness is an owner-route requirement, not
inferred from a list. Records form one append-only hash chain under scope, with
one original identity, immutable IDs and operation bindings. Forks, duplicate IDs,
missing predecessors, invalid phase ordering, changed clock provenance and
incomplete history refuse progress. Before append, the adapter checks the same
frontier again; the owner must also enforce the atomic expected-tail comparison.

A reconciliation must name **every** retained record hash in that dimension,
not a caller-selected conflict subset. Its genuinely new outcome observation
must be strictly later than both the recorded and captured instants of **every**
covered event, including dispatch/unknown cuts. All three references must have
new immutable IDs and independently established readback at/after that new
observation. A still-fresh pre-effect or equal-cut observation cannot reconcile
an uncertain mutation, even with a new capture time and a complete frontier. It uses fresh independently resolved
observation evidence and the current fence/frontier. Missing conflicts or a
concurrent append make it stale. Prior failed/interrupted/unknown and opposed
histories remain immutable and are returned alongside reconciliation hashes.
Only explicit qualified reconciliation changes the current observation over
those histories. Later completion alone never erases a failure; opposed cycles
remain unknown until reconciled. A legitimate new cycle needs a new operation.
Reconciliation itself is read-only and cannot retroactively complete mutation.
V1 has no reconciliation rule and continues to return unknown for conflicts.

## Bounds and callback limits

Requests, v2 records, evidence bodies and verification artifacts are at most
256 KiB each; JSON nesting is at most 12. Retained history is at most 256 records
and 1 MiB aggregate. Each identity admits at most 128 payloads. Whole-buffer
manifest/payload bytes remain capped at 64 MiB; the separately admitted streaming
path above verifies larger payloads incrementally without trusting declared
hashes or removing bounds.
At most eight references and 256 reconciliation hashes are admitted. New work
must use a fresh authoritative scope when the bounded retained ledger is full,
under an explicit owner migration protocol; silently dropping old history is not
supported. An unbounded iterable is not a valid ledger/resolver input.

Every owner port receives an explicit `budget_ns`; read ports also receive byte/
record limits. A maximum of 1024 owner-port calls is allowed per operation;
reference resolution in one completion/observation is at most eight calls.
The frozen config requires a positive per-callback budget at most 60 seconds.
**The owner must enforce deadlines inside its ports.** This synchronous library
cannot cancel blocking Python callbacks, prevent a dishonest owner from
preallocating an oversized response, or guarantee a whole-operation latency
bound. Lease snapshot/close must be nonblocking. Oversized returned objects are
rejected before decoding or serializing them; fixed diagnostics expose no locator.

## Source qualification and operational handoff

`test_storage_adapter.py` uses generated byte fixtures and fake clock, registry,
resolver, lease, ledger, independent readback and conditional dispatch ports.
No native service, production data, credentials, network, actual filesystem
custody operation, installer or runtime configuration is used. Existing CI owns
qualification; local tests/builds/compilation were not run for this git-first
source lane. The original 29 pure v1 tests remain separately registered.

The operational owner still must qualify the concrete lock/frontier, conditional
dispatch, raw registry, clock continuity, durable fsync and independent resolver/
readback routes. On a genuinely authorized **future** operation, retain untouched
source snapshots, exact reviewed adapter identity, truthful prospective intent/
dispatch/outcome timestamps, immutable event bytes/hash, independently retrieved
bytes and all three authoritative evidence roles. Demonstrate idempotence,
interruption, failure and conflict reconciliation without replaying live effects.
Read-only observation can qualify observation/readback, not prior mutation or
selection authority. Installation, source storage, recovery, consumer
qualification, selected publication and physical/device acceptance remain
independent. Source/CI/merge success does not satisfy operational adoption.

**No adapter is installed or wired into an operational caller by this change.
#497 operational adoption remains open with the existing sole storage owner.**
