# Native session policy

The native Rust Access boundary issues new sessions for 365 days by default.
It has no inactivity timeout and no per-user device-count eviction. Absolute
expiry, monotonic timestamps, the restore epoch, current user/version,
membership/version/role, native session cookie, same-origin evidence and mutation
CSRF remain required. Logout deletes only the requesting session; trusted
user-session revocation and recovery epoch invalidation retain their existing
meaning. Issuance incrementally removes expired rows in bounded batches using
its existing primary-key index; expired rows are refused immediately even while
awaiting physical cleanup.

The existing explicit `POST /api/atlas/auth/proxy` sign-in is also the renewal
path in trusted-proxy mode. Each call requires a freshly checked gateway channel
and selected identity proof bound to the actual native request. It replaces a
supplied old session token and issues a fresh 365-day absolute lifetime. It can
run after the old session expires. `GET /api/atlas/auth/session` does not extend
expiry, and CSRF-backed session rotation keeps the original expiry. The frontend
continues to show its existing expired state and explicit Open home action;
there is no automatic or silent renewal. Loopback and password modes keep their
existing separate sign-in requirements.

Gateway identity admission remains mandatory on every proxied request. It checks
the actual Unix peer UID, selected socket and parent custody, and the exact
selected bounded identity. The separate gateway owns native WhoIs; HouseAtlas
then applies native session and scoped authorization. Gateway identity alone
cannot issue a native Editor mutation principal or bypass same-origin CSRF.

## Bounded generated verification

Inspect `backend/src/app/trusted_gateway/session_policy_tests.rs` and its Access
and `GatewaySocket` imports, plus the bounded cleanup case in
`backend/src/access/store.rs` and the capture retirement case in
`backend/src/http/homebox_pinned_files.rs`, before running these exact commands in an isolated
synthetic lane. Use Rust 1.99.0, locked cached dependencies and an owned Cargo
target outside the checkout. The six named cases are ignored by default and run only
with explicit `--ignored --exact` selection. No workflow or default suite is added.

The generated database-reopen case canonicalizes only its freshly created
temporary fixture directory before forming the database filename. SQLite
NOFOLLOW and strict reopen validation remain unchanged.

```sh
# Reuse this already-owned external target after coordinating its writer.
export CARGO_TARGET_DIR=/tmp/houseatlas-offline-read-pack-target-20261016
cargo test --offline --locked -p houseatlas-backend --lib app::trusted_gateway::session_policy_tests::year_sessions_keep_devices_and_idle_then_expire_and_renew_with_identity -- --ignored --exact --test-threads=1
cargo test --offline --locked -p houseatlas-backend --lib app::trusted_gateway::session_policy_tests::year_sessions_preserve_logout_revocation_scope_and_csrf -- --ignored --exact --test-threads=1
cargo test --offline --locked -p houseatlas-backend --lib app::trusted_gateway::session_policy_tests::generated_local_gateway_admission_benchmark -- --ignored --exact --test-threads=1 --nocapture
cargo test --offline --locked -p houseatlas-backend --lib access::store::bounded_session_cleanup_tests::indexed_cleanup_bounds_each_issuance_and_preserves_current_authority -- --ignored --exact --test-threads=1
cargo test --offline --locked -p houseatlas-backend --lib access::store::bounded_session_cleanup_tests::fresh_cleanup_seeds_and_circular_budget_reach_later_ranges_after_reopen -- --ignored --exact --test-threads=1
cargo test --offline --locked -p houseatlas-backend --lib http::homebox_pinned_files::session_retirement_tests::ended_native_sessions_release_capture_capacity -- --ignored --exact --test-threads=1
```

The first generated case retains eight independent live sessions through nine
idle hours, checks the exact 365-day expiry boundary, unchanged rotation lifetime,
and explicit renewal with fresh request-bound proof. The second checks own
logout, another retained device, user revocation, membership revocation, scoped
read and real native Editor mutation/Origin/CSRF checks. Fixtures use generated
identities, in-memory Access and one disposable private Unix socket with actual
OS peer credentials; no external listener, real credentials, household or
provider data, production cookie, account or installed service is used.

The fourth case uses 4,096 generated retained rows interleaving expired and
active sessions. It checks primary-key range-search plans, exactly 64 inspected
candidates and 32 expired removals per initial issuance, preservation of every
active row, eventual expired-row purge, circular cursor wrap, and immediate native refusal
of an expired session while its row remains stored. It opens no listener.

The fifth case uses only a disposable generated schema-1 database. Fresh strict
reopens choose distinct random cursor seeds; controlled seeds demonstrate
bounded later-range cleanup after separate reopens and immediate circular wrap.
It does not prove deterministic completion under repeated short process runs.
The sixth uses generated native sessions and no provider: 128 fresh actions are
admitted before explicit rotation, and fresh actions reclaim capacity after
rotation, logout, user revocation/version changes and epoch invalidation. The
separate ignored replay/changed-wire/quota control case remains source-only and
is not run by these commands. The live per-session quota stays bounded.

The benchmark runs 200 warmups and 2,000 timed calls for each of an empty control,
actual native authorization, actual `GatewaySocket::admit`, and both native
paths together. It prints p50/p95/mean nanoseconds and total measured runtime.
Native authorization includes its actual in-memory SQLite state, rate and
last-seen work. The test alone raises its generated request budget to 10,000;
production limits are unchanged. The socket admission path performs its real
filesystem custody, UID and strict JSON allowlist checks on every iteration.
This is a debug/test-build local comparison, not production request latency.
External gateway WhoIs, daemon transport, TCP/TLS, browser work and contention
are unmeasured; this receipt cannot establish that they are fast or slow.

## Bounded capture admission and explicit rotation

HomeBox file capture retains each spent request ID through every later failure
while its native session can still authorize that same binding. At the next
capture admission it reclaims entries only for absolute expiry or authoritative
native retirement: a removed session, changed restore epoch, or disabled/version-
changed native user. A temporary membership/source denial or clock rollback does
not release a spent ID. Every new admission still needs current native authority;
retirement observations never grant access or reset an active session's replay
history. The live budgets remain 128 spent IDs per binding and 1,024 globally.

Existing explicit `POST /api/atlas/auth/rotate` accepts the current same-origin
cookie, actual `Origin` and `x-atlas-csrf` header; it rejects query parameters
and requires no body. Its
successful `{schemaVersion:1,actorId,csrfToken,expiresAt}` response sets the new
secure host cookie, invalidates the old credential and preserves absolute expiry.
A client exposing this action must install/reconcile the confirmed session and
withdraw old local captures before permitting a fresh explicit capture with a
new request ID. It must not automatically replay the old capture; an unconfirmed
rotation is resolved through the canonical session GET instead of a blind POST
retry. Trusted-proxy sign-in remains the separate fresh-identity renewal path.
The capture quota does not itself rotate a browser or transparently renew it;
the coordinated frontend exposes this action explicitly, withdraws its old local
binding and scope, then requires GET/POST/canonical GET reconciliation before a
new capture can be chosen. An uncertain POST offers only a separate session
check; it is never automatically retried. No replay-safe early eviction of live spent IDs is available in the
current request contract, which carries no server-bound action deadline.

## Reviewed deployment-plan input

Source changes are limited to native policy in
`backend/src/access/boundary.rs`, expired-only session cleanup in
`backend/src/access/store.rs`, the existing healthy expiry expectation, the
isolated generated test modules, capture admission retirement in
`backend/src/http/homebox_pinned_files.rs`, and policy docs.
The coordinated frontend changes are limited to expiry scheduling and explicit
session rotation/canonical reconciliation, with their named generated checks.
The external gateway, native POST authentication, routes, configuration,
contracts, schema, migration SQL and legacy `packages/access` JavaScript package
are unchanged. The standalone legacy package still has its earlier defaults;
this policy applies to the native deployed backend.

Cleanup seeks at most 64 candidate rows in token-hash order using the existing
primary-key index, deletes only expired selected keys, and inserts the new
session in the same transaction. The process-local cursor advances only after
commit. A short first range can wrap through a second disjoint indexed range;
both ranges share the same total 64-row budget. Each initialization or strict
reopen chooses an unpredictable 256-bit starting cursor, avoiding a fixed prefix
on every short process run. Cross-restart fairness is probabilistic; no durable
cleanup progress or deterministic cross-restart completion is claimed. No new
index, schema or migration is required, and session expiry/authority is unchanged.

There is no database migration, account reprovisioning, membership change,
session bulk rewrite or history reset. Existing sessions keep their persisted
`expires_at` and original browser cookie expiry, generally the earlier seven-day
lifetime; rotation does not extend them. A still-present session previously
ineligible only due to eight idle hours becomes usable again until its stored
absolute expiry. Previously evicted, logged-out, revoked, epoch-invalidated or
absolutely expired sessions are not recovered. Fresh explicit trusted sign-in
issues the new lifetime and cookie. The frontend's existing expiry timer already
uses `min(remaining, 2147483647)` and rechecks on visibility, focus and pageshow,
so a one-year timestamp does not overflow that app timer. The native document
reader also recomputes and rearms its capped expiry callback. The coordinated frontend also rearms evidence-document, scene-source,
retained-geometry and overlay-source expiry timers against the absolute deadline;
cancellation retires the complete rearm chain. Four named generated clock and
transport checks cover that helper and explicit rotation reconciliation. They do
not establish complete reader lifecycles, mounted React events or installed
annual-session compatibility.

A later approved deployment should pin the exact reviewed source/binary, stop
and drain only the selected service, retain the unchanged configuration and
Access/Atlas databases and history, then restart with the candidate. Verify the
canonical trusted origin/mode, existing native session read and explicit fresh
trusted sign-in, the returned 365-day expiry and secure cookie, a scoped read,
and a separately authorized native Editor/CSRF mutation check. Source-only
synthetic results do not qualify the installed service or native WhoIs.

Rollback uses the pinned previous compatible binary with the same current
configuration and databases, preserving all auth and Access history. No database
restore or epoch reset is needed. The previous binary resumes its eight-hour
idle check immediately; its next issuance can again evict to five sessions.
It reads stored one-year `expires_at` values without shortening them, so rolling
back the binary alone does not revert already-issued absolute lifetimes or
browser cookies. Any requirement to shorten existing lifetimes would need a
separate explicit reviewed session-revocation decision. No deployment or
rollback command is executed by this source work.
