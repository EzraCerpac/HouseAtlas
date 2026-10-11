# Source-only reference and reclamation planning

`CacheResidencyGuard::plan_reclamation` is advisory source analysis. It retains
the original Store's IMMEDIATE transaction, issuer and original owner guard;
it has no delete, maintenance, archive release, grant or proof API. No plan may
be used as permission to remove bytes. Production maintenance requires separate
explicit authority and retention policy accepted by the original owners.

The complete persisted inventory merges Core current pointers, permanent
`cache_generations` IDs, live Store pins, every separately persisted Network
projection row, raw archive catalog/reservations and permanent archive IDs.
Projected rows match raw archive captures only through the verified projected
receipt digest. Unpaired or conflicting rows stay `StagedOrAmbiguous`; invalid,
missing, unknown-source, over-limit or unverifiable catalogs fail closed.
Repeated reasons are preserved and count against the existing reference bound.

Reference origins distinguish a Store's burned identifier fact from actual
retained history. Only the private Store SQL enumerator can label a reservation
origin. An original owner's `History` reference remains a payload protection.
Every permanent Core/archive identifier remains reserved: planning changes no
ID, table, trigger, capacity setting, catalog, reservation or byte.

`SqliteNetworkSidecar::archive_custody_snapshot` is a native owner read-only API
for the verified original archive under its existing database and segment owner
leases. It reports permanent burned IDs and remaining slots, sealed segment
bytes, active reservation count and bytes, and remaining bytes against the
unchanged 10,000-ID and 256-MiB ceilings. Its per-reference protected bytes
are segment bytes when sealed, reserved bytes while active, or zero for an ID
whose byte reservation was cancelled. Each row carries its exact persisted
partition and scope, generation, state, and available raw/projected/segment
digests. A sealed row carries the original full registration from its verified
segment header. Reservation-only and cancelled-ID rows have no persisted full
registration, so that field is unknown; any current configured registration is
reported separately and may differ from the historical original. The
snapshot does not combine Store history or external custody and carries no
release operation, retention decision, or reclamation authority.

The owner policy names a revision and exact full registration, generation UUID
and raw digest for each requested archived payload. No implicit policy, age/count
window, partition wildcard or oldest-row rule exists. The planner retains all
nonrequested references and unknown requests. Current/in-flight/staged/history/
disclosure/recovery references, missing/conflicting digest or registration,
unknown publication disposition and incomplete coverage block candidacy.

The original reference guard is re-enumerated at plan time because admission
can create a new reservation after guard creation. Core SQL and live Store pin
facts stay stable under that same exclusive Store borrow. Successful plan
metadata never escapes the lock as a capability. Future execution must acquire
and revalidate actual original custody and every reference again, preserve
burned IDs, and be authorized separately; this source adds no such executor.

Network currently has no complete live-disclosure/recovery registry. Its coverage
is explicitly `Unknown`, protecting every production entry even if an owner
policy requests release. An empty catalog does not establish absent external
references. A future `Complete` implementation must enumerate actual retained
disclosure leases, recovery obligations and external pins under the original
exclusive owner guard. This is an explicit remaining source hold, not a fabricated
empty reference issuer or a claim that reclamation is operationally ready.

The named isolated fixture exercises a small real Store reference graph and
synthetic reference-owner metadata, plus one disposable unpaired projection.
It runs no deletion, archive maintenance, settings, live provider, recovery,
fault or stress code. Original small inventory/revision inputs are preserved.
Root alone declares its explicit example target in the reviewed separate
compiler lane; root manifests/modules/router and shared dev/main remain untouched.
