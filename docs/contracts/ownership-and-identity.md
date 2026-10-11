# Authority and identity contract

Contract version: `1.1.0`; record schema version: `1`.
This is the synthetic authority and identity contract package.
It defines contract `1.1.0` / record schema `1` ownership boundaries.
Integration, authorization and deployment prerequisites remain separate.
This package does not complete those prerequisites or release their consumers.

## Authority

| System | Editable authority | Atlas behavior |
| --- | --- | --- |
| HomeBox | Inventory fields; location labels and parentage; files, photos and external attachments; item maintenance | Native read projections and verified HomeBox navigation |
| Atlas | Permanent physical identities; reviewed qualified bindings and semantic annotations; circuits, valves, physical evidence relations; optional geometry; its original assets; its audit | Revision-checked owned-record mutations |
| Network | Curated network inventory, observations, confidence and history | Allowlisted GET projections; existing UI for changes or diagnostics |

Atlas has no editable inventory name, manufacturer, quantity, serial, location
parent, photo, URL attachment or item-maintenance field in its mutation schema.
A location semantic annotation records reviewed meaning such as room or floor.
It may also carry an optional Atlas-owned display label supplied by a person,
with the same evidence, review status, revision checks and audit as the annotation.
This label is independent of any HomeBox name; it neither renames the HomeBox
entity nor establishes a second parent tree. An omitted label remains unnamed
in Atlas. Removing a label omits it from the new annotation while preserving
prior revisions and evidence. Labels are not identity keys or physical placement.
Arbitrary HomeBox containers remain arbitrary containers until reviewed.
Neither names nor tree depth identify a building, floor or room.

Circuits and valves may have their own labels, unknown panel or endpoint data,
and evidence.
Network segment membership does not establish an electrical circuit, cable
route, outlet, adjacency or floor placement.
Network devices can bind to physical items; interfaces and abstract segments
cannot become additional physical inventory identities.
A Network group binding is a reviewed place reference, not physical placement
or a floorplan survey.

## Permanent identities and qualified sources

Every Atlas-owned record has an opaque random UUID, workspace, home, schema
version, record revision, lifecycle and audit pointer.
Atlas identity kinds are `location` and `item`.
Identity kind and home/workspace scope are immutable.
The identity payload contains evidence references, not duplicated source fields.
Names, addresses, IPs, MACs and geometry IDs are never identity keys.
Every UUID-typed wire identifier uses canonical lowercase spelling, including
HomeBox external entity IDs.
Normalize source UUIDs at adapter ingress before key comparison/storage;
reject noncanonical Atlas records, references and commands.
Preserve the spelling of other opaque, case-sensitive source IDs.

Each binding has its own record ID; several bindings may reference one Atlas
identity.
The unique source key is `(workspaceId, sourceInstanceId, collectionId,
sourceKind, externalId)`.
This key is unique across homes inside the workspace, including proposed,
rejected, retired and tombstoned bindings.
The binding's home must match its identity and registered source partition.
Adding `homeId` to the database uniqueness key would permit the same upstream
entity to acquire conflicting physical identities across homes.
Use the full qualified key, never external ID alone.

A source registration is server-controlled configuration and contains no
credentials.
An `exclusive-home` collection belongs to exactly one home inside the workspace.
A shared collection uses disjoint, reviewed entity allowlists.
Neither a user-supplied collection nor an upstream location name establishes
authorization.
Queries and media access must enforce the registered home partition before
returning any cached projection.
Unassigned source records stay in the authorized intake boundary.
Do not expose an entire collection to each home merely because it has the same
upstream tenant credential.

Binding `reviewStatus` and `sourceState` are separate.
An accepted identity match can remain accepted while its source is unresolved,
archived or access-revoked.
Source archival never tombstones Atlas identity automatically.
A missing record in an offset-paginated fetch becomes unresolved, even after
all pages succeed; this fetch is not a transactional snapshot.
Confirmed deletion requires a targeted authorized check and explicit review;
retain the binding, identity and prior evidence.
Auth failures, outages and incomplete fetches provide no deletion evidence.

Source key and bound identity are immutable within a binding record.
A HomeBox import/restore that changes upstream IDs creates a new binding for
the same Atlas identity, retires the old binding and adds a reconciliation
journal record in one atomic batch.
The journal includes both binding IDs, reason and evidence.
No heuristic name match, ZIP import or reimport silently establishes identity.
Correcting an erroneous match to a different Atlas identity is deliberately
held for a separately reviewed reconciliation design; do not free or reuse
the old qualified key as a workaround.

## Provenance and uncertainty

Evidence is append-only.
It records a statement, qualified source when present, raw source revision and
confidence, evidence basis, fact date, retrieval time, vantage and uncertainty.
Unknown dates, model details and endpoints remain null or unresolved.
Retrieval time is not a fact date or fresh physical confirmation.
Source confidence is an opaque retained string; do not remap it into stronger
Atlas certainty.
For example, source `confirmed` with basis `owner-report` remains an owner
report and never becomes a fresh cable survey.

Uncertainty statuses are `supported`, `inferred`, `unknown`, `disputed`,
`withdrawn` and `superseded`.
Supported means the stated claim is supported by its described evidence basis.
It does not imply a physical survey or current observation.
Inference must remain inferred; an unknown basis cannot support a claim.
Evidence revisions do not rewrite facts.
Corrections and withdrawals add evidence that supersedes prior evidence IDs.
Consumers must resolve supersession when presenting a current claim and retain
the previous statement in history.
A superseding statement with unknown or disputed facts does not imply the
opposite claim is proven.

Atlas physical relations and read-only Network relations are different shapes.
Physical relations can retain an unresolved endpoint without creating a
fictional hidden connection.
Network relations preserve source revision, snapshot time, fact time, vantage,
confidence and temporal status.
Segment membership is member-to-segment; it carries no ordering between members.
Historical or disputed associations never become current connections or room
placement.
Stale observations do not mean a device is off.

## Source projections and cache

The tested source boundary is official HomeBox `v0.26.2`.
The minimum raw page fixture is intentionally smaller than the full API spec.
The normalized schema is Atlas's read contract, not a replacement HomeBox API.
The tagged controller supplies explicit `isLocation` and `includeArchived`
filters; absent `isLocation` defaults to items.
Fetch location and item partitions explicitly with bounded `page` and
`pageSize`, repeated `parentIds`, and intentional archive handling.
Preserve `entityType.id/name/isLocation`, including null when unavailable,
and `parent.id`.
Do not invent a default type when the source type is unavailable.
The controller is the authority where the tagged Swagger omits filters.
[Tagged controller](https://raw.githubusercontent.com/sysadminsmedia/homebox/v0.26.2/backend/app/api/handlers/v1/v1_ctrl_entities.go),
[tagged Swagger](https://raw.githubusercontent.com/sysadminsmedia/homebox/v0.26.2/backend/app/api/static/docs/swagger.json).

Cache state separates last successful fetch, last attempt, generation, status
and sanitized error.
Each projection retains its own source update time and retrieval time.
Complete, authorized, bounded and schema-validated staging replaces a cache
generation atomically; do not expose a partially fetched generation.
Deduplicate UUIDs within the source scope.
Identical repeats may collapse; conflicting repeats abort the generation and
retain the previous cache.
Detected count drift, malformed pages, tenant mismatches and pagination limits
must abort rather than claim completeness.
Offset pagination still cannot prove a coherent source snapshot.

An outage does not freshen record retrieval times, change the last successful
fetch or empty existing data.
An access revocation retains recovery metadata privately but denies cached
records and media to the revoked principal.
HomeBox or Network unavailability cannot block permitted room/document browsing
from another source or the persistent cache.
No disconnected mutation queue or remote write-back exists in version one.

HomeBox updated timestamps and a GET/merge/PUT sequence provide no Atlas-style
atomic revision guarantee.
The first read adapter has no PUT capability.
Source history is not promised to include every upstream actor or edit.
[Tagged entity repository](https://raw.githubusercontent.com/sysadminsmedia/homebox/v0.26.2/backend/internal/data/repo/repo_entities.go).

## Media and optional geometry

HomeBox owns its stored files, URL attachments and maintenance attachments.
Atlas records references without claiming ownership or recovery of those bytes.
External links have `archived: false` and are never silently fetched by the
server.
Authenticated proxying must validate instance, collection, entity, attachment,
home permission, type and byte limits.
Credentials stay on the server; never put them in browser URLs.
The initial redirect ceiling is zero.
Any redirect exception requires a reviewed destination allowlist and repeated
scope/content checks.
Never pass active SVG or scripts through the preview boundary.
SVG, PDF and raster rendering policy remains an explicit AT-12 decision;
`unreviewed` or `blocked` content cannot render.

Atlas original assets have immutable digest, content identity and opaque
server storage key; manifests and authorization do not expose filesystem paths.
Asset bytes must be verified before a manifest becomes available.
Commit asset manifest, owned record, audit and receipt coherently.
Failed transactions must leave no visible partial attachment and must clean
only their own staged bytes.
Retention and hard purge remain recovery-policy decisions; tombstones preserve
identity and evidence references until those decisions are approved.

Geometry is optional and accepts Magicplan only.
The manifest retains producer version, export format, original asset, import
time, units, scale, affine transform, reviewed mappings and geometry version.
Unknown units leave scale and transform null.
Proposed mappings never change bindings, room identity or parentage.
When accepting a new mapping that supplies a HomeBox entity, require an active
accepted binding for that exact qualified key and Atlas location identity.
Guard the binding revision when accepting the mapping.
Retained historical geometry keeps its exact immutable compatible binding
reference, even if that binding or identity later retires or is tombstoned.
Current review/source/lifecycle states are presented alongside that historical
match; they never imply current availability from earlier acceptance alone.
Repeated remaps preserve the original journals and geometry versions;
they do not rewrite the old producer/source IDs or transfer physical identity.
Later terminal retirement or tombstoning also preserves historical match facts.
Current availability comes from binding/source/identity lifecycle and is shown
separately from historical mapping acceptance.
New remap journals and accepted mappings must validate their creation-time
retired/accepted binding preconditions against the final transaction graph.
Snapshot validation checks retained scope/identity/key compatibility and
acyclic journal facts without requiring a permanently live historical endpoint.
Geometry versions are append-only; replacements preserve existing Atlas IDs
and the original private files.
No importer or private reference geometry is required for the plan-free release.

## Reviewed topology amendment (1.1.0)

Resolved location identities can have evidence-backed, proposed or accepted
building/level membership and door/stair/opening access facts. Only active
accepted membership defines current grouping. Each child has one current parent
per membership kind; parents require matching reviewed building/floor semantics.
Buildings cannot be members, floors cannot be floor members, and accepted cycles
or contradictory direct and level-derived building membership are invalid.
HomeBox parentage, labels, depth and Magicplan categories never create membership.
A directly contained location without a known level remains ungrouped by level.

Access records preserve present/absent/unknown and bidirectional/from-to facts.
Missing access means unknown, and present access grants no safe route, navigation
or accessibility authority. Optional floor elevation is unknown or measured
metres relative to a named location datum; zero and negative values are valid.
Omitted elevation stays unknown. Magicplan -52 Higher Ground and -51 Semi Basement
never supply metres or rank. Existing evidence supports these reviewed facts.

The public schema/package/URI is 1.1.0 and accepts legacy 1.0.0 snapshot envelopes
and unchanged original record shapes. Record schema remains 1. Native storage,
domain projection and recovery lineage metadata retain their original 1.0.0 tag;
this amendment changes no on-disk schema or image authority. Old closed readers
reject amended payloads even when their envelope retains the legacy tag.

The optional native place label is compatible with existing records that omit
it. Older closed-schema binaries cannot read annotations containing that field.
After labeled records are written, rollback requires a compatible binary or an
explicitly reconciled restore; labels and history must not be silently stripped.
