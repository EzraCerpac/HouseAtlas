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
`backend/src/access/store.rs`, before running these exact commands in an isolated
synthetic lane. Use Rust 1.99.0, locked cached dependencies and an owned Cargo
target outside the checkout. The four tests are ignored by default and run only
with explicit `--ignored --exact` selection. No workflow or default suite is added.

```sh
# Reuse this already-owned external target after coordinating its writer.
export CARGO_TARGET_DIR=/tmp/houseatlas-offline-read-pack-target-20261016
cargo test --offline --locked -p houseatlas-backend --lib app::trusted_gateway::session_policy_tests::year_sessions_keep_devices_and_idle_then_expire_and_renew_with_identity -- --ignored --exact --test-threads=1
cargo test --offline --locked -p houseatlas-backend --lib app::trusted_gateway::session_policy_tests::year_sessions_preserve_logout_revocation_scope_and_csrf -- --ignored --exact --test-threads=1
cargo test --offline --locked -p houseatlas-backend --lib app::trusted_gateway::session_policy_tests::generated_local_gateway_admission_benchmark -- --ignored --exact --test-threads=1 --nocapture
cargo test --offline --locked -p houseatlas-backend --lib access::store::bounded_session_cleanup_tests::indexed_cleanup_bounds_each_issuance_and_preserves_current_authority -- --ignored --exact --test-threads=1
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
active row, eventual expired-row purge, cursor wrap, and immediate native refusal
of an expired session while its row remains stored. It opens no listener.

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

## Reviewed deployment-plan input

Source changes are limited to native policy in
`backend/src/access/boundary.rs`, expired-only session cleanup in
`backend/src/access/store.rs`, the existing healthy expiry expectation, the
isolated generated gateway test module registration and module, and policy docs.
The external gateway, native POST authentication, routes, frontend, configuration,
contracts, schema, migration SQL and legacy `packages/access` JavaScript package
are unchanged. The standalone legacy package still has its earlier defaults;
this policy applies to the native deployed backend.

Cleanup seeks at most 64 candidate rows in token-hash order using the existing
primary-key index, deletes only expired selected keys, and inserts the new
session in the same transaction. The process-local cursor advances only after
commit. A short page wraps on the next issuance; a full final page can require
one empty seek before wrapping. No issuance inspects a second page. Restart
resets only this cleanup position; it changes no session expiry or authority.
Cleanup is eventual and does not require a new index, schema or migration.

There is no database migration, account reprovisioning, membership change,
session bulk rewrite or history reset. Existing sessions keep their persisted
`expires_at` and original browser cookie expiry, generally the earlier seven-day
lifetime; rotation does not extend them. A still-present session previously
ineligible only due to eight idle hours becomes usable again until its stored
absolute expiry. Previously evicted, logged-out, revoked, epoch-invalidated or
absolutely expired sessions are not recovered. Fresh explicit trusted sign-in
issues the new lifetime and cookie. The frontend's existing expiry timer already
uses `min(remaining, 2147483647)` and rechecks on visibility, focus and pageshow,
so a one-year timestamp does not overflow the timer.

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
