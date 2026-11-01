# Descriptor-backed present observations

`storage_owner_ports.py` implements transport-free filesystem ports for prospective
`disposition:present`, phase/mode `observation`, with a null release. It is an
importable library, not an installer, host selector or maintenance caller.
Mutation dispatch and settlement always refuse. Source presence, cloud upload,
recovery, qualification, selection and physical acceptance remain independent.

Source and disposable CI do not qualify an operational route. Actual private
roots, registry, permits, clock, immutable backing and actor participation remain
the sole storage owner's responsibility. No private locator, source identity or
production receipt belongs in public source, tests or comments.

## Explicit capabilities and scope

The caller supplies `PrivateRoots`, `FrozenRegistry`, `OperationPermit` objects,
`ClockEpoch` and explicit adapter `OwnerConfig`/`StreamLimits`. Construction checks
descriptors read-only; an admitted observation creates its prospective namespace.

`PrivateRoots` contains already-open distinct journal, evidence, registry and
retained-payload directory descriptors, plus an explicit `LockCapability`: the
already-open directory descriptor and registered entry for the existing lock.
No lock path is discovered. Descriptors cannot alias standard I/O. Deliberate `Requirements` bind exact
uid/gid/mode and regular-file link count. The library duplicates and owns those capabilities, pins directory identity and
rechecks it before child I/O. Caller close/reuse of the supplied descriptor numbers
cannot redirect a later write. `close()` releases only the owned duplicates after
terminal child/lease handling. The library changes no permissions, discovers no
roots and accepts no request-supplied path.

Two supplied qualification assertions are mandatory: the admitted namespace is
exclusive to cooperating writers using the actual lock, and retained source
backing is immutable for this observation. Neither is inferred from permissions,
no observed writer, advisory flock or a directory listing. They do not establish
distributed fencing or global actor coverage. A prunable incoming directory is
not automatically suitable retained backing.

`FrozenRegistry` binds scope, owner, provenance, label, untouched manifest bytes,
sorted payload entries, protected application/selection/policy entries and local
generation. Every entry pins one token to one registered basename, SHA-256,
ownership requirements and these native integer fields:

```text
st_dev st_ino st_mode st_uid st_gid st_nlink st_size st_mtime_ns st_ctime_ns
```

No JavaScript-number conversion occurs. Payload tokens and filenames are
one-to-one. Directory-relative `O_NOFOLLOW`/`O_NONBLOCK` opens reject traversal,
separators, symlinks, nonregular files, wrong ownership/mode/link count and changed
backing. A stream retains its actual descriptor and rechecks identity on close.
Missing entries are never rebound to newly found paths.

Permits bind exact scope, owner, operation, original identity, epoch, issuer,
validity and the admitted `journal`/`evidence` targets. The coarse four-argument
`authorize` port cannot authorize a state or phase by itself. Actual event,
evidence and admission boundaries require the issued byte-verified present
observation and exact original/null-release request. Other states/dimensions and
all intent/dispatch/mutation writes fail, including direct port misuse.

## Supported interface and one held lock

```python
ports = FilesystemObservationPorts(roots, registry, permits, clock, config)
adapter = StorageAdapter(config, ports)
result = ports.record_present(adapter, operation=operation, event_id=event_id)
checked = ports.verify_present(adapter, operation=operation, event_id=event_id)
```

These calls perform real evidence writes with real descriptors and require a
separately permitted prospective operation. Tests use generated disposable roots.
`record_present` acquires the existing nonblocking flock once, checks actual
manifest/payload bytes through bounded streams, captures new role-specific
evidence, persists it and lends its exact held lease to one adapter observation.
The keeper opens an independent no-follow lock description through the supplied
capability, so two instances or aliases cannot treat a shared open-file
description as two successful acquisitions. Local descriptor passing lends only
that lease description to its parent and active helpers; helpers never flock it.
It remains held while any owned helper is genuinely unreaped, including keeper
loss or parent interruption. No capability from another lease can be unlocked.
Other nested acquisition refuses; borrowed views are one-shot and real/stale
lease close is identity-bound and idempotent. `verify_present`
explicitly binds the read operation before lending the held lease to projection.

Lease snapshots read actual protected pins and bind the supplied cooperating
generation and operation claim. Existing publishers cannot be invoked unchanged
inside this lease: they acquire their own lock, and mutation remains unsupported.

## Authoritative prospective journal

The closed journal namespace contains only `scope`, `event_TOKEN`, `verify_TOKEN`
and `admit_TOKEN`. A first immutable scope anchor binds original identity, owner,
scope, clock source and fresh process epoch in an explicitly empty namespace.
Legacy receipts are not imported as admitted events. There is no cached tail or
auxiliary index whose crash window can hide an event.

Under the actual lease, reads verify the exact anchor, enumerate the bounded
namespace, raw-parse all events and walk one complete predecessor chain from
genesis. Partial records, forks, unknown files and orphan sidecars refuse progress.
Completeness requires the qualified scope capability and held exclusion as well
as byte checks; listing alone establishes none.

Append compares the exact authoritative tail, creates exclusively, fsyncs file
and parent directory, then independently reopens and reads exact bytes. Separate
verification artifacts receive separate fsync/readback. IDs never overwrite
history. Partial artifacts and crash orphans remain retained for reviewed recovery.
Unsupported external writers invalidate the qualification.

Evidence is issued only after actual source byte verification and fresh protected
pins. Outcome records original presence; persistence records durably stored
observation evidence; readback records independently executed retrieval. Each body
binds operation, original identity, role, actual timestamp and provenance. The
resolver compares complete bytes to the issued immutable entry. These roles
establish neither backup nor cloud, retention or consumer authority.

## V3 process-local admission

V2's closed atomic-commit marker stays unchanged. A filesystem precheck/write/fsync
sequence cannot fabricate its actual commit clock. The narrow new profile is
`publication-input-observation-admission-v3`.

Disk bytes contain exact proposal bindings/deadlines plus actual prewrite
`prepared` and decimal-string `prepared_monotonic_ns`. They have no `committed`
field and remain **provisional**. Embedded timestamps alone never admit them.

After exclusive persistence, fsync and independently executed exact readback,
the owner rechecks authority, fence, frontier, registry and backing seals. A final
continuous integer wall/elapsed sample must precede both deadlines and permit
expiry. Only then is an in-memory confirmation created, binding all three exact
event/verification/admission hashes, uninterrupted process epoch and actual
post-durability sample.

`independent_admission_read` reopens all three objects in separate reader
processes, compares hashes and validates the current epoch before returning typed
`ProcessAdmissionReadback`. Its confirmation is outside the earlier immutable
disk bytes. The adapter checks those bindings and uses the actual confirmed
wall/elapsed cut as a continuity floor. Plain `Readback` flags cannot promote v3
bytes. This branch admits only present observations; v2 and pure v1's
`authority:unverified` remain unchanged.

This is bounded uninterrupted-process confirmation, not atomic filesystem
deadline evidence or restart-safe commit. It witnesses an upper bound on completed
durability through the qualified process-local route; the prewrite sample is not
relabeled as fsync completion. Timeout, expired postcheck or lost write reply
before confirmation retain tentative bytes without admission. A valid confirmation
may survive a lost later readback reply through fresh reads in the same process.

New epochs refuse existing scope anchors even if a clock-source token is reused.
Copied JSON, disk-only markers and prewrite timestamps cannot restore the admitted
set. Uncertainty, restart, permit expiry or missing proof require owner review or
a separately versioned recovery/migration protocol. This version cannot
self-reconcile every incomplete namespace or fabricate a late admission.

## Bounds and independently executed readback

Individual records/evidence/artifacts are bounded by 256 KiB; event history by
256 events/1 MiB and the closed namespace by 769 entries. Actual stream chunks
are hashed with count/EOF and configured bounds; declared digests are not byte
verification. Existing adapter aggregate and proof-snapshot bounds remain active.

Explicit engineering proposals, not installed defaults, are 512 MiB per payload,
1 GiB aggregate, 1 MiB chunks and 4,096 reads including EOF. Five-minute intent,
one-hour observation and sixty-second callback budgets likewise remain proposals.
Generated fixtures establish no actual source size, throughput or deadline fit.

The fixed isolated Python worker receives only admitted descriptors, registered
entries and bounded requests. It reopens actual files rather than echoing writer
arguments or cached objects. Owned pipe exchange bounds frames/output and integer
elapsed deadlines; nested I/O shares the enclosing callback deadline. Stalled
read/fsync/close leaves uncertainty. If an owned child cannot be reaped, progress
is poisoned and the lease retained rather than claiming cancellation or unlocking
a live writer. Kernel/process availability remains an operational qualification;
Python cannot prove cancellation of uninterruptible kernel I/O.

Different processes demonstrate independently executed reopening/readback on the
same host/kernel/storage failure domain. Names and PIDs establish neither separate
storage durability nor issuer truth, cloud completion or distributed exclusion.
No transport, credentials, installation or security/network changes are included.

Existing ordinary CI uses generated temporary directories and owned local child
processes only. Actual route durability, actor coverage, clock continuity,
representative throughput and independent execution still need qualification by
the sole storage owner. Source/CI/merge success leaves operational adoption open.

Every scope/event/verification/evidence/admission write revalidates the exact
active operation permit and allowed target both before worker startup and after
its root check. The child verifies the delegated wall/elapsed expiry and approved
byte hash immediately before exclusive creation. This admits the write attempt,
not an atomic durable transaction: an already admitted write can outlive expiry
and remain uncertain, but cannot authorize another role or marker write. Normal
disposable fixtures use explicit sixty-second headroom; dedicated timeout cases
retain short reader/write/close bounds. Those are test settings, not installed
operational defaults.

A failed observation without an established confirmation poisons its owner epoch;
partial evidence cannot be bypassed by choosing another operation ID. Artifacts
remain intact for reviewed recovery. A genuinely established confirmation is not
erased by a lost later reply, though unavailable readback still blocks authority.
