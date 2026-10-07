# Specialized Atlas writes

The existing stock commands endpoint and native stock dispatcher now bind the
Domain owner's six single derived forms: binding create, review, restore and
remap, geometry create, and asset review. Editor HTTP admission uses the same
closed Domain operation predicate as execution. The root HTTP batch arm still
requires every child to map directly. The Domain/Storage mixed derived batch
adapter below is available for the integration owner to mount.
The host retains its existing fresh-only Intake, Validate, Candidate and
Precommit fence. Retries and replay remain unavailable; retained projection
support is not permission to execute those phases.

Preparation derives immutable inputs from the actual authorized Store snapshot.
Binding create and the new side of remap receive `unresolved` source state;
neither the requested key nor its cached projection establishes a presence
witness. Review and restore retain the complete original binding preimage.
Each geometry command's import time comes from one server clock sample retained in
its plan, including a separate retained sample for each geometry child in a batch.
Asset review preserves the original asset envelope and admits only `block` and
`download-only` with null renderer receipt IDs. `request-preview` remains held
because the actual renderer-receipt qualification peer is unavailable.
Standalone stock `asset.create` remains outside admission; the existing qualified
attachment route retains its genuine Media stage and atomic consumption profile.

The original per-call principal, source handles, full original graph and native
closure remain under the existing Access transaction fence. Capture covers all
original graph sources, including source-bearing root guards, then the native
plan's prospective references before sealing. The specialized Storage adapter
uses the same SQLite connection and command engine, checks preimages against
the transaction's original snapshot, and preserves the mandatory current-presence
hold, native transitions, original guards, complete candidate graph and stock
authorization phases. Remap is one stock operation with three ordered native
entries; no synthetic batch envelope is introduced. Disclosure is limited to
those exact retained entry targets in the genuine committed candidate.

The native stock commit retains the versioned derivation alongside its original
intent, entries, native results and real operation/audit IDs. Existing direct and
staged JSON receipts remain readable without derivation fields. History and
retained projection reconstruct the specialized plan from those saved inputs;
original preimages must match the actual linked creation/replacement audit's
before digest. Current rows, renewed authority and new clock samples supply no
retained derivation. This adds no database schema migration or recovery authority.

The exact ordinary in-process runner remains:

    cargo run --locked -p houseatlas-backend --example healthy-agent-stock

Its additional specialized helper uses a separate private temporary synthetic
Store, real native Access issuance, the shared stock dispatcher and exact positive
envelopes. Its fixture selects one home and the relevant Atlas records from the
published optional-geometry graph, with unresolved bindings and a missing,
blocked synthetic asset. It submits eight fresh commands: create, review,
tombstone, restore and remap bindings, create geometry, then review the asset
as download-only and blocked. One further ordinary tombstone prepares the
restore child in the positive mixed batch below. Remap supplies an explicit
guard on the old binding for its new journal. After an ordinary close/reopen,
seven record reads
and ten matching history reads check the actual saved revisions and audit IDs.
This is native in-process executor evidence, not HTTP transport qualification.
It adds no socket, provider call, real credential, user database,
denial, replay, expiry, revocation, crash, failure or concurrency case. Compilation
and any reported positive results qualify only their named source and inputs;
all held control and deployment gates remain unchanged.


## Mixed derived batch owner adapter

`plan_derived_atlas_batch_commands` composes direct and specialized children
through the same `plan_atlas_commands_with` group factory. Its ordered
`[Option<AtlasDerivation>]` must match the submitted child array exactly. A null
entry maps a direct operation; a supplied derivation maps its corresponding
specialized operation. At least one specialized child is required; all-direct
batches retain their existing adapter. No staged asset child is admitted here.

The shared factory still checks exact scope, root and child guard separation,
unique native targets and mutation IDs, and the frozen batch contract's aggregate
100-entry bound. Each remap remains one stock child with three ordered entries,
and uses the unchanged child-intent-based native mutation IDs. The expanded
entries consume three of the 100 slots. Root and child stock idempotency keys
and receipt operation IDs retain their existing meanings.

`execute_derived_stock_batch_json_with_authorization` uses the original Store,
principal type and native command transaction. All derived preimages are checked
against the same transaction-original snapshot, before any child is applied.
Current-presence admission holds and unavailable renderer qualification are
unchanged. Native results, stock groups, keys, audit links, receipt IDs and the
new metadata persist atomically through the existing engine.

The existing `atlas-derived-command/1` single-command format remains unchanged.
New mixed batches use `derivationFormat: "atlas-derived-batch/1"` with
`childDerivations`, an ordered nullable vector, and no single `derivation`.
These carriers are mutually exclusive. Retained validation checks child count,
child index, complete original envelope, intent digest, derivation kind and the
corresponding child's native audit preimage digest/revision. Reconstruction uses
only saved derivations and the original root/children, with no new clock sample
or current record lookup. The existing history projector uses that reconstructed
plan and checks its ordered native entries/results against the saved commit.

Backward compatibility is explicit: absent optional fields still deserialize
for existing direct and staged commits; v1 single derivations still reconstruct
with their original planner. Those existing operations serialize without
`childDerivations`. This is an additive private JSON subformat in the existing
stock operation body, with no SQL/table migration or relabeling of the native
stock row codec. Older binaries that deny unknown fields cannot read new batch
bodies and must not receive a database containing them; this source change does
not authorize a live data upgrade or rollback deployment.

HTTP preparation, source capture, transaction fence adoption and result release
remain integration-owner work. Replay execution is excluded. The same named `healthy-agent-stock` example mounts a fixture-only Store peer
around a genuine Access-issued editor principal and synchronous mutation guard.
It pins the same Store original snapshot and immutable plan, captures actual
source and partition grants including prior remap journals' retired bindings,
enforces exact Intake/Validate/Candidate/Precommit order and pins the candidate
and receipt through Precommit. It exercises all six specialized children and
one direct circuit child on disjoint targets: seven stock groups expand to nine
native records/audits. Typed response parsing checks root/child envelopes;
operation IDs are the actual distinct runtime IDs and audit IDs match the
native result carriers. After normal close/reopen, nine matching record/history
pairs validate retained reconstruction and actual audit digests for every
expanded output. The existing single-command v1 history checks still pass in
the same Store. This is positive native owner-adapter evidence; HTTP mounting
and its root result-release fence remain unqualified here.
