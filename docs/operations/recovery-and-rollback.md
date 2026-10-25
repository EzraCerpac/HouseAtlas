# Recovery and rollback requirements

Recovery objectives are proposed and unmeasured. The off-host destination is
the owner's iCloud Drive through the nightly job in
[icloud-backup.md](icloud-backup.md), which keeps every copy and proves each one
restores after downloading it back from iCloud. Keep secrets and permission
recovery under a separate private procedure with current revocation reconciliation.

A coherent point drains all writers, fences owned blob deletion, captures a
consistent SQLite backup and pins every referenced immutable blob plus required
configuration/identity/release metadata. Stage privately and publish a complete
manifest atomically only after integrity, scope and compatibility checks.
Protect the trusted manifest; byte hashes alone do not authenticate provenance.

The legacy JavaScript recovery bundle covers Atlas DB/media and Network
sidecar. Native Rust recovery bundles Atlas database images and retained owned
originals; it excludes Network source state. Current native persistence uses
profile5, future stock activity uses profile6, and legacy JavaScript uses schema3.
Access DB, sessions, credentials, server settings and provider originals are
excluded.
Supply current authority/configuration separately after restore. Provider backup
is a separate source-owner operation. Restore into fresh isolated state and
verify IDs/reservations/relations, bytes/modes, compatible schema and current
membership before reopening. Invalidate old sessions and reconcile revocations.

Prefer code rollback only when the prior release reads the current DB/policy.
Otherwise a coherent pre-change state restore needs an explicit loss scope.
Never restore HomeBox/Network merely to undo an Atlas release. Real target,
migration failure/crash/replay/concurrency, session/secret recovery, off-host
retention, power loss and measured objectives remain unverified.
