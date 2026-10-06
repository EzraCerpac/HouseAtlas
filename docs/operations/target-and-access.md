# Target and access configuration

No host, origin, port, path, audience or operator identity is selected here.
config/deployment.example.json has null destinations, empty memberships and
liveReady=false. Fill a private instance configuration after its scoped review.

Keep Atlas application/state/media, HomeBox and Network ownership/lifecycles
separate. Qualify the actual OS/architecture/runtime, storage/mounts/capacity,
service identity, startup mechanism, listener collisions and HTTPS route/client
trust before target actions. Existing services or routes imply no Atlas grant.
Prefer loopback backends with authenticated HTTPS audience reach when qualified.
Use a dedicated local SQLite filesystem and immutable owned blobs; network-share
SQLite, platform installation, service migration and autostart need explicit scope.

Use separate named viewer/editor identities and a scoped recovery/operator role.
Atlas roles do not confer HomeBox roles or source credentials. Enforce principal,
home, partition and media authority on every read and before receipt replay.
Use exact origins, bounded attempts and secure HttpOnly sessions with expiry,
rotation/revocation and current membership. Synthetic logins are not real grants.

HomeBox and Network adapters remain allowlisted GET with no automatic redirects.
Only Network /api/inventory is currently pinned. HomeBox native links require
actual route/source/collection qualification. Credential material stays in a
separate private secret store/procedure, never client URLs, logs or Git.
Restore requires current revocation reconciliation and previous-session invalidation.
G1-G5 target/source/write/pilot/promotion gates remain unresolved.
