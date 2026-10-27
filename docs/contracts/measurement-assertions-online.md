# Online occurrence-area contract

The measurement wire schema is contract 1.0.0 at
https://houseatlas.invalid/contracts/measurement-assertions/1.0.0/atlas.schema.json.
JSON Schema and native semantic validation are authoritative; generated Rust and
TypeScript carriers do not issue grants. The first slice serves new audited-create
OccurrenceArea streams only: no legacy adoption/backfill or automatic retry.

## Proposals, server fields and idempotency

Create accepts a client mutation UUID; the server allocates assertion identity
only after an authorized complete-key receipt miss. Correct names the existing
assertion, exact expected revision and payload digest. Keep exact decimal token,
unit, method, target/publication/artifact pins, evidence/input expectations and
comparison preconditions. Client data never supplies persisted revision, actor,
recording/audit time, audit identity or resulting digests.

Canonical proposal hashing uses the explicit typed projection in online_contract
and a separate proposal domain. Exclude the resulting digest itself and all
server-owned assertion/audit/outcome fields. Optional attestation is omitted when
absent so earlier proposal bytes remain unchanged. Personal acquisition requires
the closed personally-measured attestation iff its personal method is selected.
The attestation participates in the complete canonical digest and immutable receipt.

Only absent/empty personal notes get the documented personal default reason;
nonempty whitespace/control/oversized reasons refuse before hashing. Other methods
need truthful reasons. Reason mapping precedes proposal freezing and hashing.

The receipt key is workspace, home, original actor and mutation UUID. Identical
retries return the retained committed outcome before allocation/rematerialization;
a changed complete proposal conflicts. Distinct actors can reuse a mutation UUID.
Missing outcome means not recorded at that authorized read point, not rollback,
failure, permission to replay, or proof an unknown intent never ran.

## Transactions and read projections

One original Atlas Store connection/transaction atomically retains the complete
proposal/digest, immutable committed receipt/value/provenance, audit correlation,
head CAS pointer, per-version/artifact pending work and mutation outcome. Immutable
receipts are the sole measurement value/history store; heads contain pointers.
There is no parallel database or shadow value journal. Full history contains old
values/provenance, not merely overwritten current rows plus audit digests.

Current returns the exact head with a fresh conflict projection bound to the
same authenticated complete read cut. Commit-time pending remains immutable.
Later contradictions and affected successor heads enter the fresh projection
without rewriting prior receipts. CurrentValueReview also compares active exact
same-target/property values without requiring explicit contradiction links.
Incomplete historical association/coverage cannot imply empty consistency.

Receipt digests are external hashes of retained complete receipt bodies, used
consistently for current and historical versions. They are not inserted into the
hashed body. Keep proposal, assertion payload, audit and external receipt digests
distinct; none is a geometry-verification receipt.

## Authority and HTTP operations

The five bounded operations are create, correct, known-ID current, full immutable
history and current-actor mutation outcome. The additional read-only POST
/api/atlas/measurements/v1/workspaces/{workspace_id}/homes/{home_id}/occurrence-context
admits context without reserving a mutation, assertion or pending obligation.
The closed bounded request uses the existing original authentication, Origin and
CSRF conventions. Context retains ORIGINAL Read capabilities; write POSTs obtain
fresh ordinary mutation fences. Locks preserve Store-then-Access ordering.

The original principal allocation, source grants, current user/session/membership
versions and Store/Access/vault instance identities are revalidated. A decoded
export, label, historical room binding or mesh ordinal supplies no mutation
permission. Actual native room/accepted-semantics/evidence rows and retained
review receipts must correlate with the original pinned publication owners.
Missing reviewed occurrence mapping refuses writes. Documentary provisional
lineage never fabricates custody, registration, Geometry or SceneAssociation.

Context binds one authorized SQL cut to exact admitted target/artifact pins,
current exact-publication occurrence heads, both fresh review projections,
explicit coverage, admissible methods/evidence/inputs, and current-actor committed
identities with versions/external digests. Overflow, inaccessible references or
incomplete closure refuse completeness. Closed context errors distinguish
unavailable authority, stale selection and incomplete coverage.

Write eligibility is advisory, derived from original revalidated Read facts,
Editor role and separately captured mutation-required whole-home source closure.
It is not a write permit. Capture failure disables personal entry but preserves
independently authorized current/history disclosure. Actual writes still require
a fresh ordinary Mutate principal and unchanged original source/owner fences.

## History and client limits

Historical value disclosure is separate from current mapping/mutation authority.
Only current original read/source authorization may disclose retained values.
Failure exposes no values, IDs or hidden counts. Exact-current claims stay bound
to their current publication/occurrence; old streams retain original artifact
pins, provenance, receipt digests and pending work. Reviewed relations distinguish
applicable from not-applicable. A native-room match alone proves neither.

Opaque optional old producer context may remain recorded-context-unverified;
no producer file is dereferenced merely to qualify historical receipt inventory.
No claim of available/missing content is made without a check. Missing configured
retained owners truthfully limits applicability and affected writes. All required
native/Document/media integrity and source grants remain strict.

Stable in-memory intent ownership can survive form remounts. Full reload recovers
only authorized committed current-actor identities; lost unrecorded intents remain
unrecoverable. Session/actor changes require fresh authorization. No durable browser
queue, automatic replay, closure operation or UI mount is supplied here.

## Qualification

Pure-contract, authenticated native and client synthetic checks have distinct
historical source pins. Native composition checks use genuine Store/Access owners
and generated public data. Current candidate generation consistency, formatting,
warning-free Clippy and exact hosted qualification remain separate checks. No old
result qualifies changed source or releases held denial/omission controls.
