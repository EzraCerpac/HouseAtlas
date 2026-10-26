# Optional maintenance caller

This is technical caller/state source for the existing updater v1 contract. It
has no UI mount, endpoint, default transport or installation authority. Construct
`MaintenanceCaller()` for explicit unavailable behavior. Only a separately
qualified host may inject a `MaintenanceTransport` connected to the existing
authorized dispatcher. The transport receives the exact request JSON, one of
`check`, `apply`, `status`, and a local wait signal; it returns original result
JSON. It must bound its own I/O. No fetch, MCP discovery, login or grant is
implemented here.

The host calls `select(owner, selection)` with an actor/home/session lifetime
identity and the exact selected release and expected-installed revision. The
host supplies distinct operation UUIDs to `check` and deliberate `apply`.
Check is advisory and can stage software; apply still requires fresh server
admission and separate action-time approval. Replacing a selection invalidates
check authority even if the replacement looks identical. IDs cannot be reused
within an instance; after 256 commands a fresh lifecycle owner is required.

After dispatch, apply identity is retained before awaiting any response. Lost,
timed-out, malformed, uncorrelated and status-null responses leave it unknown.
`poll()` sends only status for that exact operation, owner and selection.
`recover()` is an explicitly invoked, sequential polling batch: default three,
at most twenty requests, with 1–30 second intervals and 1–120 second per-call
waits. There is no automatic apply retry. Exhaustion leaves identity intact.
Recovery-needed remains fenced for the runtime owner; this layer offers no
reset-to-retry button. Terminal responses are historical observations, not proof
of the current installation or a new approval.

`snapshot()` preserves the complete validated result, including phase, fixed
code, health and recovery fields. `reported-verified-success` requires an apply
status with succeeded phase, healthVerified and no outcome error. `ok` alone
never produces that label. `pending()` returns a copy of unresolved identity
and its last correlated status, even when the current selection has retired.

Call `retire()` on navigation, sign-out, session replacement and disposal. It
invalidates repaint authority, aborts local waits and wakes polling delays; it
does not cancel a server operation. Retain this instance while unresolved, or
retain its pending identity with the owning host for manual reconciliation.
There is no persistence, reload recovery or restoration API here. A host must
not discard unresolved identity and create another apply as a retry. The host's
owner token is a lifecycle fence, not a maintenance grant.

`contract.ts` retains the fields of `tools/houseatlas-updater/protocol.schema.json`
and checks result identity against the original request. Its dotted-version
expression agrees with the schema and the Python parser in
`tools/houseatlas-updater/houseatlas_updater/validation.py`.
No wire schema is changed here.
`synthetic.ts` exports finite fixture definitions for unavailable, advisory
check, lost reply/status, retirement and timeout transitions. They are UNRUN
source until explicitly executed by CI/integration. No runner or CI expansion is
included. Mounted accessibility, installed authority, browser/device behavior,
native binding and actual delivery acceptance remain open.

References #290; broader acceptance remains open.
