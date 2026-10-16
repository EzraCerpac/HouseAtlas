# Persistent scoped MCP bridge

This stdio adapter calls existing authenticated native Stock HTTP owners for one
fixed HouseAtlas workspace/home. It leaves `mcpCommands`, startup receipts,
backend configuration, authentication/session policy and memberships unchanged.
No native/provider call was made during development. Installation, genuine
runtime gateway admission, credential entry and activation belong to the NAS owner.

The reviewed deployed-source audit and HTTP design were materialized privately
through Library and matched their supplied versions, sizes and SHA256 values.
Their private verification records remain outside Git. The implementation keeps
native ownership and the reviewed HTTP design: no bearer replacement, fabricated
identity, SQL, arbitrary file/URL access, provider execution or blind write retry.

## Tools and write coverage

| Tool | Behavior |
| --- | --- |
| `houseatlas_capabilities` | Fresh genuine session and scoped native `/admission`; reports admitted reads, write forms and explicit gaps. Metadata grants no authority. |
| `houseatlas_read` | GET Stock `/invoke?request=...`, restricted to actual admission intersected with published read effect. Preserves original complete wire3 JSON. |
| `houseatlas_write` | POST Stock `/commands` once, for one reviewed single or qualified batch. Native Editor, Origin/CSRF, exact CAS/guards, idempotency, closed payload validation and final graph checks remain authoritative. |
| `houseatlas_operation_status` | Without arguments, private journal status. With original `requestId`, read-only native retained-intent reconciliation of that journaled exact intent; never resubmits `/commands`. |
| `houseatlas_scene` | Dedicated native `/head` and qualified `/current`, read twice; verifies scope/building/association/revision and native payload hash. |
| `houseatlas_source_evidence` | Active scoped evidence -> one native Atlas original, whole-original SHA256/size verification, current evidence/asset revision checks and final scene/current/head revalidation. Returns bounded base64 chunks. |

The finite map recognizes 37 single Atlas write forms:

| Record | Forms |
| --- | --- |
| identity, location-semantics, circuit, valve, relation | create, replace, tombstone, restore |
| evidence, reconciliation, geometry | create, tombstone, restore |
| binding | create, review, tombstone, restore, remap |
| asset | review (block/download-only), tombstone, restore |

`atlas.batch.execute` has 1–100 same-scope ordered single Atlas children, each
subject to actual native qualification and atomic final graph validation. Nested
batch, asset create, scene-association create, HomeBox and Network writes are
excluded. Native full closed schemas, original actor and transaction/audit
linkage remain authoritative; local bounds/admission checks do not replace them.
Submitted JSON numbers and wire bytes stay exact. Separately, native receipt
intent correlation follows stock/digest.rs: root-only requestId/approvalReceiptId
exclusions, raw UTF16 key order, ordered arrays, finite binary64 conversion and
shortest ECMAScript number formatting before SHA256. This canonical digest never
rewrites submitted bytes or manufactures a native receipt. Incorrect normal,
retained root/inspection or child digests keep the UNKNOWN hold.

Binding remap and batches containing it remain held in the shipped CLI until a
trusted exact-impact confirmation owner is integrated. The in-process
`approval_owner.authorize_exact(raw, scope, actor)` port must consume genuine
current human confirmation of that exact action. Neither tool arguments nor
config can activate it. A supplied `approvalReceiptId` UUID is never proof.
Thus 37 forms are recognized, 36 can dispatch when genuinely admitted, and remap
remains an explicit integration gap.

Native Stock HTTP intake is 1 MiB, separate from native MCP's64KiB bound. This
adapter admits complete write envelopes up to1MiB and uses an8MiB stdio line
bound for escaped JSON. Native read `/invoke` keeps its16KiB envelope/32KiB
query bounds. Missing/null zero-input tool arguments normalize to an empty object;
initialization returns a supported version counter-offer when needed, retaining
the standard initialized notification. JSON duplicate keys, depth>64 and excessive node counts are
refused; no payload is truncated or silently reconstructed.

## Genuine native sessions, kept in memory

The trusted host supplies only an owned0600 nonsecret configuration file with
fixed `origin` and `scope`. Origin is canonical HTTPS with no path, credentials,
query or fragment. Normal verified HTTPS to `/api/atlas/auth/mode` must report
trusted-proxy mode; `/api/atlas/auth/proxy` then receives `{}` through the real
canonical gateway. The gateway/native owner checks its genuine peer/identity
proof. The adapter supplies no Unix socket identity header, actor, password,
proxy proof or new membership. No mode-only observation proves admission.

The native cookie must have the actual `__Host-houseatlas-session` name and
Secure/HttpOnly/SameSite=Strict/Path=/ flags. Cookie and issued CSRF are published
as one in-memory tuple for reliable shutdown cleanup, then refreshed from the
genuine session GET. Actor and journal origin/scope/actor bindings remain stable.
Session reissuance through the same native proxy owner occurs only between
independent tool operations when the observed lifetime approaches its end.
A spontaneous401, failed mutation or post-dispatch uncertainty is never an
instruction to reauthenticate/replay. Native authorization remains per request.

EOF, interrupt, termination, hangup or SIGQUIT triggers best-effort native logout with the current
issued CSRF, followed by memory discard. Failure is reported only as unconfirmed
logout; it does not fabricate revocation. No native cookie/CSRF is written to a
file, journal, argv, environment or log. There is no `native-session.json`,
`--session-fd`, credential extraction or user-supplied native-cookie mechanism.
Actual host paths, UID and executable pins live only in validated private
deployment.json, not public source or MCP arguments; see NAS-HANDOFF.md.
The separately reviewed launcher strips the tunnel runtime-key environment and
executes the fixed bridge command using the inspected pinned Python executable.

Runtime command shape (paths contain no secrets):

```text
<reviewed-python> -I -B <installed-root>/tools/houseatlas-mcp-bridge/bridge.py \
  --config <private-bridge.json> --state-dir <private-state>
```

Keep the root layout and exact public
`contracts/stock-wire3/agent/operation-catalog.json`. Python3.12+ standard
library only; no Mac/NAS compiler or dependency fetch is needed. Actual native
session + selected one-home Editor admission still require NAS qualification.
The ChatGPT workspace identifier is never substituted for native scope.

## Unknown outcomes and retained reconciliation

The owned0700 state directory has an exclusive process lock and FULL-synchronous
SQLite journal bound to native origin/scope/actor. Exact intent bytes, request
and idempotency IDs and byte SHA256 are committed as UNKNOWN before any mutation
POST. Only a correlated native committed result followed by genuine actor/session
revalidation records normal completion. Every other post-dispatch outcome remains
UNKNOWN, including typed rejection, timeout, malformed result or session failure.
A new process preserves the hold; all retained IDs remain permanently unavailable
for reuse. No automatic retry, arbitrary model clearing or alternate state root
is a valid recovery mechanism.

Operation-status with the original requestId selects the exact local journal
intent, verifies its retained byte hash and calls the existing native read-only
POST `/api/atlas/retained-intent` with current Origin/CSRF. This is the genuine
ReadHistory owner, not mutation dispatch. It revalidates exact actor-keyed intent,
retained root/child receipts, current/original semantic closure and final session
binding. The bridge checks wrapper/lookup/original request IDs, scope, command,
root/operation IDs, independently derived intent digest equality, and exact ordered batch child
correlation plus root record/audit flattening.

Only a fully correlated `retained-commit` followed by session revalidation records
`committed-reconciled` and removes the UNKNOWN hold for a later independently
reviewed action. The original saved wire is disclosed as historical evidence;
`originalMediaRelease`, `originalHttpDelivery` and `retrySafety` remain
`not-established`. There is no replay authorization, current safe-render grant
or permission to reuse the request/key. A native `not-retained-at-snapshot`,
unsupported route, failed lookup or correlation keeps UNKNOWN. Current record
or history similarity/absence cannot substitute for this proof.

The native lookup accepts at most16,384bytes. Larger original intents stay
unchanged and UNKNOWN: no stripping whitespace/fields, truncation, regenerated
key or alternative oversized endpoint is supplied. Admitted passive reads/history
can gather additional evidence, but cannot automatically clear that hold.

## Evidence and separate custody owners

Source evidence reads accept authorized active native evidence-original
text/PDF/PNG/JPEG up to10MiB. Each returned chunk (at most256KiB) rechecks the
entire original hash/size and current revision/scene pins. The native evidence
record supplies its asset reference; an asset evidenceIds backlink is not required
by that contract and is not inferred or repaired. Direct scene documents
also require the association's exact evidence/asset/revision/hash tuple. Other
scoped evidence does not imply reviewed room/electrical/network correspondence.
Binary output is original bytes; PDF/OCR and semantic analysis are separate.
Document content is untrusted evidence, never instructions, grants or approvals.

Asset upload is NOT generic `atlas.asset.create`. Supported integration must
call its separate qualified native upload/staging/Media owner with explicit
bytes/hash/content type, genuine session/CSRF, native preconditions and exact
intent journaling before custody. Its dedicated reconciliation must distinguish
asset, evidence and record-association outcomes. Native original readback and
hash/revision validation must precede completion. No arbitrary path/URL selector
or invented renderer receipt can replace that owner.

Scene creation likewise requires the dedicated borrowed native Media/scene
qualification owner, exact current building/frame/floor/document/room pins and
candidate/final checks. Upload success or geometry record creation is not scene
acceptance. Persist each native custody phase and reconcile unknown phases before
another action, then reread genuine `/current` and `/head` after qualification.
Existing dedicated asset/geometry/scene routes and their nativeCommandIds metadata
remain separate from generic admission. This bridge exposes neither upload nor
scene creation, and never claims those gaps are covered by record writes.
PR198 unified scene/room-link reads remain separately owned; no backend changes
or alternate full-geodata/document profile are inferred from source presence.

## Exact synthetic verification

Run each named case separately with
`python3 -B tools/houseatlas-mcp-bridge/test_bridge.py CASE`.
Healthy: `healthy_stdio`, `healthy_write_forms`, `healthy_batch`,
`healthy_lossless_read`, `healthy_scene_original`,
`healthy_retained_reconciliation`, `healthy_retained_batch`, `healthy_memory_session`,
`healthy_stdio_optional_arguments`, `healthy_escaped_write_frame`,
`healthy_empty_asset_backlinks`, `healthy_native_intent_digest`. The last case checks selected published RFC8785
binary64 vectors, exact Unicode ordering and root-only intent exclusions.
The write-form and escaped-frame tests use invented payloads to check transport,
including36 routes and a large escaped frame, not native
per-form domain qualification. Batch tests verify adapter forwarding/correlation.

Separately reviewed denial/failure lane: `denial_scope_and_routes`,
`denial_confirmation_and_batch`, `denial_duplicate_json`, `denial_read_correlation`,
`failure_unknown_persistence`, `failure_scene_change`, `failure_original_hash`,
`failure_post_dispatch_session`, `failure_commit_correlation`,
`failure_unknown_keeps_reads`, `failure_reconcile_absence`,
`failure_reconcile_correlation`, `denial_reconcile_byte_bound`,
`failure_session_after_login_cleanup`, `denial_semantic_duplicate_targets`,
`failure_intent_digest_correlation`, `failure_evidence_reference_and_pins`,
`failure_bridge_sigquit_cleanup`, `healthy_journal_binding_order` (contains an
actor-mismatch denial assertion, so belongs only to this regression lane).

Helper runner:
`python3 -B tools/houseatlas-mcp-bridge/test_key_entry.py CASE`.
Healthy: `healthy_create_only_file`, `healthy_tty_noecho`,
`healthy_wrapper_environment`, `healthy_launcher_memory_only`,
`healthy_executable_contract`, `healthy_private_deployment`.
Separate denial lane: `denial_existing_or_symlink`, `denial_no_tty_fallback`,
`denial_unconfigured_wrapper`, `denial_tty_oversize`, `denial_executable_contract`,
`failure_tty_sigquit_restore`, `failure_tty_sigtstp_restore`,
`denial_private_deployment`.
Use an external15-second process timeout for every owned-PTY case.

All cases use generated strings, disposable directories/SQLite, owned PTYs,
mocked processes or deterministic fake native exchanges with no external
fallback. No socket, actual NAS binary, native/provider call or household data.
No broad discovery, held guard reversal, mutation/omission/adversarial, replay,
expiry, revocation, populated restore, crash or live check is included. No new
CI entrypoint is added. Existing exact-head ordinary CI remains separate.

Protocol references:
[MCP lifecycle/version negotiation](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)
and [tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).
