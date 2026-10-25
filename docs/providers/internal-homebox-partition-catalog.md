# Internal HomeBox partition catalog

References #285; broader acceptance remains open.

Source base: `860c079fff43aa286cabd94cd3b45b79a7c5495b`. This is an internal
native metadata read, with no HTTP route, MCP tool, canonical command, provider
client or startup binding. A later exposure/installation decision is separate.
HomeBox's existing home-wide `sourceStatuses` behavior is unchanged.

The closed output is `{schemaVersion:1, scope:{workspaceId,homeId},
partitions:[{owner:"homebox",sourceInstanceId,collectionId}]}`. The selected
scope comes from the original native principal and must be a current Core home.
Collection spelling is preserved exactly. Valid registered targets without any
published cache generation are included; membership in this catalog says
nothing about inventory, population, availability or freshness. A subsequent
cached command still needs its own current native authorization. Output contains
no inventory, endpoints, configuration, allowlists, credentials, epochs or digests.

## Native bounds and authority

The native Store reads only its selected-home `sources` table: at most 64 rows,
with a 65th-row sentinel causing whole-operation unavailability. SQL `CASE`
checks registration body size before materializing text into Rust. Each Store
and Access registration is limited to 64 KiB for this operation only. Source-key
columns are bounded before materialization and compared with the typed body.
Malformed, oversized or mismatched rows never become an empty successful result.
No snapshot, projection, entity, attachment or cache-status array is loaded.

HomeBox candidates need an enabled exact Access partition and a retained original
partition grant. Every initial, retained and final registration read uses the
catalog's bounded lookup. Complete Store/Access registrations must match,
including ordered allowlists and partition mode. Their original metadata/version
is retained internally and compared again under held Access read authority.
Non-HomeBox and currently unauthorized targets are omitted. A successful catalog
is complete within this profile, with at most eight targets and no cursor or
truncation. A ninth authorized target makes the whole read unavailable.

The worker retains the original selected-home principal allocation, owning Core,
Store and Access, and the caller's existing native admission permit. It attempts
Core -> Store -> Access locks once with `try_lock`; contention is unavailable.
The Store's configured authorizer must own the same Access allocation. Store
queries use a borrowed authorizer backed by the already-held Access guard;
there is no relock, replacement principal, new connection or source grant policy.
Capture is sealed before final full-cut comparison and original-grant release.

## Cooperative disclosure budget and cleanup

One monotonic deadline is created before `spawn_blocking`: t0 plus five seconds.
Queue time counts. Dropping the awaiting request makes cancellation sticky; it
does not abort a running blocking closure. A stopped worker starts no database
business work. The same budget covers SQL preparation/execution, every candidate,
parsing/validation/digests, comparisons, capture, final fenced revalidation,
transaction completion, private capped encoding, cleanup completion and handoff.
No partial response bytes are released. Encoded output is capped at 256 KiB.

Both native connection policies are installed before initial authorization or
capture. Each sets operation-local `busy_timeout(0)` and a progress callback
every 1,000 VM instructions. The callback checks only the immutable deadline and
sticky cancellation: no SQL, lock, allocation or logging. Only the existing pinned
rusqlite `hooks` feature is added; dependency versions/lockfiles are unchanged.
The native owners certify empty callback slots: their private connections have
no other progress-handler writer, the policy holds exclusive mutable ownership,
and entry requires idle/autocommit. SQLite exposes no callback getter; none is
invented. No nested policy or callback escapes the owner helper.

Access retains `BEGIN IMMEDIATE` with immediate contention failure. Catalog
transactions use explicit native completion; a failed operation leaves rollback
to mandatory cleanup, after all statements drop. Cleanup removes the callback
before explicit rollback, confirms idle/autocommit, and restores/verifies Access's
5,000 ms timeout and Store's actual `StoreOptions.busy_timeout_ms`. It runs even
after cancellation. Admission and owner guards remain held through cleanup.
The deadline is checked again afterward and immediately before handing off data.

Failed/uncertain cleanup consumes only the affected original Mutex guard in a
contained `resume_unwind`, catches outside that unwind and verifies poisoning.
All consumers of that owner therefore see the normal poisoned-mutex failure;
unaffected owner guards remain outside the unwind. There is no panic-hook change,
callback panic, application unsafe, poison clearing/recovery, reopen or silent
replacement. The internal worker refuses abort-only builds. Cleanup may outlast
the five-second budget, but may never enable an expired success. This is a
cooperative result-acceptance deadline, not a hard filesystem/kernel-I/O or
cleanup wall-clock guarantee.

## Coverage and remaining limits

New in-process synthetic test source covers pre-work cancellation, sticky expiry,
rollback/callback removal/timeout restoration after cancellation, isolated original
owner poisoning, capped output, original held Access metadata and ordered
allowlists, oversized initial/retained Access lookups, registration-only Store
reads without projection tables, selected-home isolation, 64/65 candidate bounds,
oversized Store bodies, body/key mismatch and the closed selectors DTO.

These fixtures are UNRUN locally. Compilation, formatting, Clippy, tests and
publication verification are delegated to existing CI; no runner/workflow changes
or local qualification gate is added. Combined native worker scheduling, real
contention/cancellation races, cleanup-failure injection and installed/native
operation remain unqualified. Source/synthetic results establish no live provider,
installed service, browser/device or broader issue acceptance.
