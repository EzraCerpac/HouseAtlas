# Network original archive composition

The Network producer retains the exact successful inventory response body before
projection. The original archive stores its registration, generation, retrieval
context, raw SHA-256 and projected receipt correlation. It syncs an immutable
segment, reopens the bytes and verifies their projection before sealing the
SQLite catalog. Capacity admission uses the actual Store residency guard and
the Network catalog guard in Store-then-Network order, before transport/provider
construction and fetching.

The development limits are 16 MiB per active segment, 256 MiB protected capacity,
10 MiB raw body and 10,000 complete catalog entries. Every permanent generation,
reservation and sealed archive is retained. Storage also contributes its own
current/history and live staged/in-flight/ambiguous pins. No reclamation,
retention release, deletion or trigger reversal is implemented. A missing legacy
original archive cannot be reconstructed from a projected digest; it fails
closed. The original unpublished-disposition proof is unavailable, so that path
also fails closed.

The existing named healthy Network root fixture uses one disposable TLS inventory
GET and actual native custody-aware publication. Its positive archive assertions
reopen the Native archive and compare the original response bytes, digest,
registration and generation; the catalog has one sealed row, no active capacity
reservation and one retained permanent generation ID. Its genuine viewer then
logs in and performs two cached facet and three relation/room/item reads on the
same Core, Access and Store. A scoped admission read and all three exact stock
inventory/snapshot/history invocations add four healthy requests, for ten actual
Root TLS requests in total. Browsing performs no inventory request. This is
Linux loopback fixture evidence, not a configured provider or browser acceptance.

The three saved Network stock query forms are mounted through HTTP for scopes
with an actual configured binding. Root captures that binding's actual original
partition and member grants before sealing source capture, releases Core around
the original runtime read, retains its original disclosure lease in the witness,
and recomputes the exact wire result under current authority before final release.
No independent issuer, Store, constructed facet or provider request supplies
this path. The Core-only MCP catalog remains unchanged and Network WebMCP
browser execution is unqualified. Unresolved snapshot
endpoints remain concealed. Populated recovery, unpublished disposition, legacy
archive migration and capacity exhaustion are unqualified. No negative, fault,
replay, expiry, revocation, crash, concurrency or held guard control is added to
the ordinary lane.
