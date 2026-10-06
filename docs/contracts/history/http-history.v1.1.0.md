# HTTP history sidecar 1.1.0

This additive HTTP contract defines one scoped read of existing Atlas audit
history.
Use `docs/contracts/atlas.openapi.v1.1.0.json` for the seven-path HTTP surface.
The accepted `atlas.openapi.json` remains the six-path 1.0.0 artifact.
Every existing path object in the sidecar is identical to that artifact.

Version 1.1.0 applies to the HTTP description and history response sidecar.
The frozen package version, `CONTRACT_VERSION`, snapshot `contractVersion`,
record schema and audit schema retain their accepted 1.0.0/schema 1 values.
The `/api/atlas/v1` URL prefix remains compatible.
There is no version field or wrapper in the history response.

## Scoped history read

`GET /api/atlas/v1/workspaces/{workspaceId}/homes/{homeId}/records/{recordType}/{recordId}/history`

The four required path parameters reuse the existing record GET definitions.
The authenticated principal must be authorized for `read-history` in the
requested workspace and home, and the typed record must exist there.
The existing session scheme and 401/403/404 error shapes apply.
This describes the existing authority boundary; its enforcement remains with
the authorization, storage and HTTP owners.

A successful response is a bare JSON array of existing schema 1 audit entries.
It contains recorded entries for that scoped typed record in ascending durable
audit sequence, which is commit order.
Consumers preserve that order rather than sorting by `at` or audit UUID.
The durable sequence itself is not added to the response.
No pagination, cursor, limit, filtering, request body or response envelope is
defined by this addition.

Active records and retained tombstones support the same read.
An existing record without recorded audit entries returns `[]`.
Importing or seeding a record does not fabricate an earlier audit entry.
Entries describe recorded Atlas changes, including their actor, reason,
operation, revisions and digests.
They do not reconstruct complete record snapshots or complete HomeBox actor
history.
The read does not call an upstream provider or write data.
No audit history UI or alias for an undocumented route is introduced here.

## Source and response schema

The storage method `history(principal, scope, target)` authorizes `read-history`,
checks scoped typed record existence and returns stored audit JSON bodies ordered
by `audits.seq` in a read transaction. The service forwards that array unchanged.
The exact current storage and HTTP source bytes are listed in the publication
source manifest; private ancestry and input receipts remain outside this tree.

`packages/contracts/history/http-history.v1.1.0.schema.json` is a JSON Schema
2020-12 array with an item reference to the existing audit definition.
Resolve its relative references from that file's location; no remote schema
fetch is required.
The frozen audit schema is reused without duplication or edits.
The schema validates wire shape.
Scope, existence, authorization and durable ordering come from the storage
read and cannot be established by an array schema alone.

## Ordinary verification

From the repository or candidate root, with the accepted contract dependencies
available, run these explicit commands:

```sh
node --check packages/contracts/history/check-history.mjs
node packages/contracts/history/check-history.mjs
```

The checker compiles the history schema, validates only fixed valid empty,
recorded and tombstone examples, and checks their expected order and scope.
It checks the two recorded examples against their supplied synthetic committed
record digests without executing a mutation.
It also verifies the original OpenAPI/schema preimages and that all six path
objects, shared components, security and existing metadata except the HTTP
version/description remain identical.
Fixture `contexts.json` is checker metadata, not a response envelope.

The checker does not invoke existing package scripts, test globs, the mutation
oracle, a service, a database, an authorization evaluator, or upstream adapters.
The existing `build` script validates deliberately invalid empty objects, so it
is not part of this permitted check set.
The full existing test suite is also not run for this addition.

Guard reversal, mutation/omission controls, adversarial and denial controls,
failure injection, concurrency, crash, replay, revocation and the unidentified
flagged qualification category remain stopped.
This sidecar supplies static compatibility, schema compilation and valid
synthetic examples only.
Production security acceptance, live qualification and downstream release
remain separate owner decisions.
