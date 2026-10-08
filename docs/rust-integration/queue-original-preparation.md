# Initial queue preparation retention

The native preparation owner now retains the exact original raw captures and
opaque qualification evidence in a closed, borrowed `RetainedFreshPreparation`.
It keeps the same preparation/source/contract allocations, original command and
authority, owner and wrapped preflights, and native plan. Revalidation calls the
same existing source qualifier against the same evidence and compares the full
result. The compatibility `StockPreparationPort` still returns DATA only.

`NativeQueueOriginalPreparation` binds that carrier to the actual original
prepared graph by pointer identity. It also checks the same original request,
principal, captured source and partition handles and fresh transaction guard.
The existing graph authorizer remains mandatory. This is a source correlation
and revalidation boundary; it issues no queue, approval or dispatch permission.

The distinct held profile-8 definition describes schema versions 1 through 6
plus `0008_queue_original_preparation.sql`. It excludes profile 7. The new
`queue_original_preparations` table retains one immutable version-1 DATA packet
and SHA-256 digest for an actual queue job. Packets are bounded to 1 MiB. Rust
must verify digest, canonical encoding and full original job/registration links;
SQL shape checks alone cannot establish them.

`StoreOptions::queue_original_preparation_profile` defaults to `Disabled`.
Selecting `FreshV8` returns unavailable before opening a database, running a
PRAGMA, migrating or inspecting an existing image. The existing runtime migration
catalogs, schema-5/schema-6 behavior and sealed migration files remain unchanged.
This definition does not install a schema, upgrade, backfill or rewrite old
request envelopes. Profile 7 remains separately unavailable.

The source `QueueSession::enqueue_original_prepared` inserts retention with the
new job inside the existing IMMEDIATE enqueue transaction, under actual original
Domain/native and queue authorization fences. It rejects existing receipts on
this fresh-only path, reloads the exact packet/digest and records committed DATA
before later release checks. A release error after commit cannot imply rollback
or safe retry. The default enqueue path keeps its existing behavior. There is no
post-enqueue sidecar retention path. This engine compiles but remains unreachable
under the held profile-8 gate; no queue execution or schema installation is
claimed.

The retained packet explicitly marks qualification evidence as not archived.
The encoder bounds 100 raw captures, 1000 combined source/partition selectors,
512 KiB original bytes and 1 MiB encoded bytes. An inspected pure encoder positive
preserves complete original packet facts, numeric spelling, raw bytes/digests and
the original evidence allocation; it does not execute queue or database code.
Generic opaque source evidence has no independent historical custody contract;
raw bytes, digests, serialized authority data and current projections cannot
reconstruct it. Production original write qualification, complete impact and
hidden-field preservation, approval provenance, historical evidence custody and
exhaustive profile admission remain missing source dependencies. Runtime
profile-8 admission, migration, replay and recovery controls remain held.
