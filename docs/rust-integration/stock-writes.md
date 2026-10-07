# Fresh native stock writes

POST `/api/atlas/stock/v3/workspaces/{workspaceId}/homes/{homeId}/commands`
accepts the complete native stock wire3 envelope for a fresh `atlas.circuit.create`
or an `atlas.batch.execute` containing only `atlas.identity.create` children.
These are local Atlas operations. Other stock commands remain held.

The route captures the actual AT11 Mutate principal, trusted request evidence and
CSRF before collecting the bounded body. It uses the existing duplicate-key JSON
intake and ten-second collection deadline. Its admission permit stays with the
actual blocking work. Wire context must equal the authenticated URL scope.

Actual domain `prepare` and `dispatch` use `NativeStockContract`; preparation
retains the exact request and actual authorized SQLite graph. It captures the
complete original source/partition handles and prospective native reference
closure, then seals capture. No graph or grant is substituted after preparation.

Execution calls the actual storage `execute_stock_json_with_authorization` under
the original access transaction fence. The callbacks use the borrowed access
guard, never ordinary access locks or nested SQLite reads. They verify immutable
root and ordered child envelopes, native entries, separate root guards, genuine
native semantic closure, extended owner stock closure, stable context ID and
the original graph. Only the fresh Intake, Validate, Candidate and Precommit
sequence is admitted by this bounded adapter.

The owner supplies the real candidate, native results and stock receipt before
its single SQLite commit. Exact raw Candidate and Precommit values remain
pinned separately from the durable snapshot, which is derived with the actual
native owner's canonical serialization. Successful return plus the completed
access fence marks the witness committed. Final disclosure verifies the actual
committed snapshot and genuine root or ordered child receipt; newly created
targets use the retained real candidate. Frozen receipts are never promoted to
stock receipts. Server operation IDs, audit IDs, times, revisions and digests
come from their actual owners.

The separate inspected `healthy-stock-write-loopback.mjs` runner adds ten
ordinary requests to the 56-request media/read flow: two actual session reads,
one circuit POST, one ordered identity-batch POST, and the three resulting frozen
record/history pairs. Each root is submitted once. Read-only SQLite inspection
also checks two stock operations, three groups, four permanent keys and three
stock audit links. It makes no stock history, provider, replay or rejected call.

Whole-home graph authority is deliberately conservative. Access and Atlas
storage are separate databases; this fence is not a distributed atomic commit
or crash qualification. There is no public independent durable stock-commit
reread API. Native stock history is separately bound in [stock-history.md](stock-history.md).
Record editing UI, other command families, queue
admission, source-presence admission, physical effects and approval spending
remain unbound. The domain owner's stock error-union ordering correction remains
outstanding. All stopped controls remain unrun.
