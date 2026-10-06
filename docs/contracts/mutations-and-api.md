# Atlas mutations and API

The OpenAPI 3.1 document is `atlas.openapi.json`.
It uses the canonical schema definitions in
`packages/contracts/schemas/atlas.schema.json`.
No API origin or service is installed by this package.
Paths require both workspace and home.
List cursors are opaque, authorization-scoped server cursors; changing the
home, user or filter invalidates the cursor.
Empty, error and stale source statuses accompany read projections.
Do not use a list failure as an empty inventory response.

## Revision and transaction behavior

The mutation endpoint is
`POST /api/atlas/v1/workspaces/{workspaceId}/homes/{homeId}/records/{recordType}/{recordId}/mutations`.
The target record ID is a random UUID that must be unique within the workspace
across record types and homes.
Clients cannot move an existing record into another home.
The operation, expected revision, reason, mutation ID and guarded reference
revisions are mandatory.
The client does not supply actor, audit ID, timestamps, revision or lifecycle.
Those values come from the authorized server transaction.

| Operation | Expected revision | Value | Result |
| --- | --- | --- | --- |
| create | null | Typed owned payload | Absent record becomes revision 1 |
| replace | positive integer | Typed owned payload | Active record changes at exactly the matched revision |
| tombstone | positive integer | Absent | Active record retains payload and ID, becomes tombstoned |
| restore | positive integer | Absent | Tombstoned record retains payload and ID, becomes active |

Every successful command increments only its target record revision once.
Unrelated records can change independently.
Revision increments must fail at the maximum safe integer.
Missing preconditions produce 428; stale target or guard revisions produce 412.
Do not automatically retry a failed edit with the latest revision.
Return the authorized current revision, then require the editor to review the
current record before issuing a new command and mutation ID.
Cross-home lookups return 404 without foreign revision or record details.

References used to decide a mutation require guards against their pre-transaction
record revisions.
Guard the old and new referenced identities, evidence, physical endpoints,
original assets, geometry versions and reconciliation bindings.
Validate every guard under the same authorized home and transaction.
New references created within the same batch are exempt from an existing-record
revision guard and must pass final graph validation.
Source registry/partition policy is server-controlled and is checked in the
transaction boundary; a client cannot authorize itself by sending a source key.
Atlas guards provide no upstream HomeBox compare-and-swap guarantee.

The write transaction commits record changes, audit entries and idempotency
receipts together, along with verified owned asset manifests where applicable.
A crash, uniqueness violation, stale reference or failed audit/asset write
commits none of them.
Storage must enforce permanent-ID and qualified-source uniqueness atomically;
the pure validator alone cannot prevent a concurrent insert race.
Single-record commands also validate the resulting graph before committing.
Tombstoning an identity with accepted active bindings requires retiring those
bindings in the same reviewed batch.
Historical relation references remain resolvable to retained tombstones and
must display their lifecycle, never an invented live endpoint.

Evidence statements, geometry versions and reconciliation journal payloads are
append-only.
Create a superseding evidence or geometry version rather than replace its
original facts.
Tombstone/restore still preserves those payloads.
Binding identity and source key are immutable; source status and review state
can change with matching revision and evidence.
Original asset digest, size, type, purpose and storage identity are immutable.

## Atomic batches and remapping

`POST /api/atlas/v1/workspaces/{workspaceId}/homes/{homeId}/mutations` accepts a
batch ID, reason and at most 100 commands.
Each command has a unique target and mutation ID.
All preconditions are checked against the same pre-transaction state;
the final candidate graph is checked before commit.
Each changed record gets its own revision increment and audit entry.
Either the entire batch commits or none of it does.

An import-ID remap is a reviewed batch with three commands:

1. Retire the old binding at its expected revision, preserving the source key.
2. Create the new accepted binding for the same Atlas identity and new source ID.
3. Create the reconciliation journal linking the retired and accepted bindings.

The journal's dependencies are validated against the final graph.
Existing identities, evidence and old binding revisions are guarded against
the initial graph.
At creation, a journal requires a retired source binding and active accepted
destination for the same identity.
Later retirement does not rewrite or invalidate this historical transaction.
Keep compatible acyclic journals and report current binding availability
separately from the earlier match.
This is identity reconciliation evidence, not an inventory import or HomeBox
write.

## Idempotency and audit

Receipts are scoped by `(workspaceId, homeId, actorId, mutationId)`.
Batch receipts additionally bind the batch ID, full ordered command set and
individual command receipts.
Authenticate and authorize before looking up or replaying receipts.
Canonicalize JSON with RFC 8785, then hash the complete target, operation,
preconditions, guards, reason and value with SHA-256.
[RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html).
Reject duplicate JSON keys before validation/canonicalization.
The server-derived actor is bound in the receipt scope.

An exact retry returns the original record/audit result with `replayed: true`
and creates no additional revision or audit.
It may return an older authorized revision after later edits; label it as the
original receipt rather than the current record.
Reusing a receipt key with different content produces 409.
An altered or partial batch with existing receipts also produces 409.
Keep receipts durably with audit; expiry must not enable a duplicate mutation.

Audit entries contain workspace/home, record type/ID, operation, previous and
result revisions, server actor/time, reason, mutation ID and canonical before/
after record digests.
For a create, previous revision and before digest are null.
Audit result revision and ID must match the committed record and its pointer.
The result verifier checks operation/lifecycle, prior revision and create
before-digest semantics, plus the canonical after digest.
When a prior record is supplied, it also verifies the before digest and prior
scope/revision/lifecycle/timestamps.
A standalone result cannot prove an unavailable prior payload.
Export audit only to an authorized viewer and keep credentials, raw upstream
errors and private server paths out of responses and exports.
Atlas audit covers Atlas-owned changes, not complete HomeBox actor history.

## Access, links and errors

The wire session name is a placeholder for AT-11 to implement.
Home membership, viewer/editor capability, session expiry, secure cookie
policy, CSRF/Origin checks, rate/byte limits and media authorization are
mandatory server responsibilities.
Viewer sessions cannot mutate, including replay.
Synthetic actor UUIDs and the test harness are not production authentication.

Native HomeBox links contain no secrets or credential query/fragment.
Only server-registered source origins and verified version-specific routes may
be offered as navigation actions.
Synthetic examples use `verifiedRoute: false`; hide those actions until the
adapter owner verifies the route.
Do not invent a HomeBox editor URL from an API route or accept an arbitrary
client origin.
If route verification is unavailable, provide a registered HomeBox navigation
entry without claiming a working item editor link.

Errors use a schema-versioned envelope with sanitized message and request ID.
401 indicates no session; 403 denied capability; 404 unavailable authorized
resource; 409 identity/idempotency/lifecycle conflict; 412 stale revisions;
422 invalid contract; 428 missing preconditions; 503 unavailable source.
Do not expose an upstream error body, key, auth header or foreign-home record.
A read may return a permitted stale cache page with its explicit source status.
An access-revoked cache must not be returned merely because it exists on disk.

## Verification boundary

`validateShape`, `validateSnapshot`, `assertTransition`, `assertGuards` and
`assertFinalMutation`, `validateResult`, `canonicalJson` and `recordDigest` are
pure contract helpers.
Inside the transaction, validate preconditions and guards, build and validate
the final candidate graph, then apply `assertFinalMutation` to each command
before committing records/audits/receipts.
They perform no fetch, authorization, persistence or service startup.
The test-only in-memory harness illustrates atomicity, audit, idempotency,
conflicts and authorization expectations using synthetic identities.
It is not a production storage or auth implementation.
AT-07, AT-08, AT-09, AT-11 and AT-12 must prove their own implementation against
these expectations after AT-06 release.
