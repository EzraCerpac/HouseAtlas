# HouseAtlas updater source contract

This source-only controller lives in `tools/houseatlas-updater/`. It implements
one transaction API for future dots, MCP and application maintenance callers.
It installs no target entrypoint, network transport, service or authorization.
The sole NAS owner must supply and qualify acquisition, manifest verification,
publication, existing launchd control and health interfaces before activation.
The target is selected in owner configuration; the generated examples use Intel
Darwin headers and execute no native binary.

## Scope and protocol

`protocol.schema.json` owns the closed version-one `check`, `apply`,
`statusRequest`, `status` and `result` definitions. Requests contain an operation
UUID, expected installed revision and exact version, source commit/tree, release
ID, asset ID/name and archive/manifest SHA256. They contain no URL, runtime path,
shell command, hook or service selection. The repository, trusted workflow/ref,
platform, ABI, bounded acquisition policy and local paths are owner configuration.
An exact operation and request hash returns its retained result without another
activation. A UUID reused for different inputs is refused. This source implements
that journal behavior; replay, crash and recovery execution are not qualified by
the named happy paths below.

The controller uses Python 3.12+ standard library modules. This is a source
requirement, not evidence of a Python runtime qualified on the NAS. The callable
CLI is `houseatlas_updater.cli.run(controller, binary_input, text_output)` and
reads at most 4097 bytes to enforce its 4096-byte request bound. It emits one JSON
result line and never prints exception messages or process output. Its result
`ok` means the request was handled; callers must inspect `status.phase`, `code`,
`healthVerified` and `recoveryNeeded` to determine the operation outcome. Calling
the CLI module without an owner-bound controller reports `boundary-failed` and
cannot activate anything. No dynamic adapter loading is available.

`check` acquires and validates the complete bundle and privately stages its
files, but does not stop or publish. It is advisory: `apply` must use its own
operation ID and repeat acquisition, verification and fresh target inspection.
`statusRequest.operationId=null` reads the latest operation; an explicit UUID
reads that operation. An absent history returns `status=null`. Status contains
only release-code identities and fixed outcomes, never native data/configuration
hashes, file paths, household contents or secrets.
An operation's installed/rollback fields describe its recorded observation;
historical status is not a fresh current-target or rollback authorization.

## Packaging boundary

The packaging owner owns `houseatlas.release-bundle.v1`. The in-process
`ManifestVerifier` must validate the exact acknowledged raw schema and producer
evidence, then normalize it to `model.Bundle`. The controller independently
checks selected asset/manifest bytes, producer repository/workflow/ref and source
commit/tree, platform/OS/ABI, component retain requirements, storage compatibility
and all-and-only archive file closure. Matching strings and SHA256 alone do not
establish a trusted producer; the acquisition/verifier adapter must verify actual
provenance before returning evidence.

The updater acknowledges packaging commit
`6be0a4d9fe16859794ffe3587e6ad8ddb6080bc2`, schema SHA256
`421ce99daf71e45df1580cafcc1eb146be1561023059075825fc6b77b2700a0f`, and
generated fixture SHA256
`8073e8a088c9976e50659bd7828881d4898da81a47f6e5b8777320de3b193635`.
`release_bundle.ReleaseBundleV1` consumes the exact supplied schema bytes, checks
their compiled-in pin, validates the closed schema and cross-field identities,
and normalizes the admitted manifest. It adds no downloaded schema lookup.
The schema uses only a bounded subset of draft-2020-12 keywords, interpreted
locally against these exact bytes. New schema bytes require source review.

Owner inputs must independently map a reviewed unchanged storage-contract hash
to actual receipt/protocol/Access/Atlas profile versions, and pin the reviewed
native build profile. Unqualified/null storage declarations are ineligible for
activation. Normal mode requires `build.kind=github-actions`; explicit
`synthetic_only=True` instead requires generated fixture evidence and is used
only in the disposable contract test. No flag to select this mode exists in the
caller protocol. The supplied packaging fixture is unqualified and nonexecutable;
its schema admission is a positive check, not runtime compatibility acceptance.

The original `tests.synthetic.FixtureManifest` remains a private generated profile
`houseatlas.updater.provisional-fixture.v1`; its statuses explicitly say
`bundleContract=provisional-fixture`. It is never a production release parser.
Actual production acquisition, producer verification, native/storage profiles and
target binding remain unqualified even though the schema is acknowledged.

The normalized archive profile is strict gzip/ustar with regular files, optional
normal directories and an optional exact embedded selected manifest. No links,
special files, PAX/GNU extensions, traversal, duplicate or case-colliding paths,
special modes or runtime hooks are admitted. Each code file has a bounded size,
SHA256 and exact mode. Replacement payload paths are the owner-configured backend
entry, frontend descendants or software `licenses/*.txt`, never native data. Case collisions
are checked across every path prefix for common macOS filesystems. The strict
header parser bounds extension/decompression input before allocating any member.
Default limits are 64 MiB compressed, 512 KiB manifest, 128 MiB payload and 2048
files. Limits are checked during acquisition by its adapter and again in core.

Thin Mach-O replacement backends are inspected without execution. The CPU type
and baseline subtype must match the selected Intel/ARM Darwin target; load
commands must select macOS and must not require an OS newer than the manifest
declares. Universal binaries and specialized CPU subtypes are currently
unsupported. Native dependencies, loader ABI and actual minimum-OS execution
remain builder/NAS-owner qualifications. Frontend-only bundles retain the exact
currently verified backend component and canonical path.

## Transaction and preservation

Owner configuration supplies existing canonical private staging, publication and
journal directories plus the complete protected native roots. Staging and
publication must share a filesystem. Journal and protected roots must be disjoint
from the release/staging trees. The controller does not create configuration,
credentials, a deployment or a service. Its only direct writes are its journal
and its fresh private extraction directory.

One stable `updater.lock` flock inode spans resolution, checks, staging, stop,
publication, health and any rollback. It is separate from the existing native
`server.lock`; neither is removed or replaced. The journal is private mode 0600,
uses a synced exclusive `journal.next`, atomic replacement and parent-directory
sync, and retains at most 256 operation records/2 MiB. Exhaustion requires owner
maintenance; no record eviction weakens operation identity. Staged files and
directories are synced before publication. Scratch cleanup never deletes
published releases or changes an already durable terminal outcome; an OS cleanup
error can leave its identifiable stage for the owner.

The sequence is:

1. Inspect the verified current release and actual native state; match the
   caller's expected installed revision. Resolve exact selected assets and verify
   producer, manifest, platform, compatibility and archive closure.
2. Stage on the publication filesystem, then obtain fresh target evidence and
   recheck installed/native drift.
3. Durably record stopping. The launcher stops the existing qualified launchd
   job, fences automatic relaunch, proves full process exit and holds the native
   state lease for read-only inspection. HTTP drain or a closed port is not exit.
4. Obtain fresh one-shot owner target evidence, record publishing and call the
   publication adapter. That adapter must consume the fresh claim, compare and
   swap the exact installed revision, preserve immutable prior closures and
   atomically activate a versioned replacement using the qualified owner
   mechanism. New replacement paths must be disjoint from previous component
   paths. This source does not substitute an unqualified whole-directory or
   symlink-root swap for the owner's guarded leaf publication.
5. Revalidate published closure and native state, record starting, release the
   native lease and start through the existing launcher. Record verifying and
   require bounded actual running release, backend/frontend, native-state and
   readiness evidence before recording succeeded. Default health budget is
   30 seconds; its adapter must enforce the deadline, not merely accept a number.

`Installed` binds canonical executable/frontend paths. HouseAtlas rejects a
noncanonical `frontendDirectory`; pointing the private config through a `current`
symlink fails. The launch adapter must select a matching canonical frontend and
executable together. `Runtime.configuration` is an owner-normalized invariant
binding of every private configuration/argv/source/model/AI/shell selection,
excluding **only** those two release-derived path selections. Original private
configuration bytes remain pinned and untouched. If the qualified launcher uses
a derived runtime configuration, only the two release-derived selections may
differ. Health binds their actual canonical paths separately. The server's state
digest alone is insufficient because it omits frontend/TLS/log paths.

Native data, SQLite files/sidecars and their device/inode identities, Access/rate
state, receipts, media, models, config/secrets, logs, retained copies and unknown
native files remain in place. The launcher must inspect actual owner schemas and
receipts, all pending transition fences and full native identities, not report
version integers supplied by a manifest. Ordinary Atlas and full-geodata profiles
must be distinguished. This initial controller admits only exactly unchanged
storage/protocol/receipt profiles and `migration=none`; it runs no initialization,
receipt repair, SQL migration or origin rebind.

## Recovery boundary

Before stop, an unsuccessful operation is rejected without service activation.
After stop, an ambiguous publication/launcher failure records recovery-needed;
it never guesses that the previous release is still active. When a known
published candidate fails, code rollback first stops/fences it and freshly
inspects native state under its lease. Only identical invariant configuration,
receipt/native identities, no pending transition and compatibility with the prior
release permit the publication adapter's code-only CAS restore. The retained
release must then pass actual identity/readiness verification. Changed schemas,
receipts, native bindings or incomplete proofs block rollback. No data, credential,
receipt or provider restore occurs.

A nonterminal durable operation after its lock becomes free is reported
recovery-needed with active identity unknown, health unverified and rollback
blocked. Abandoned `journal.next` returns the global `recovery-required` error;
it may belong to a newer operation and must not rewrite a historical result.
An active writer's snapshot remains readable.
New execution stays fenced until separately reviewed owner recovery; the source
contains no automatic adoption, pending-file removal or migration undo command.
Filesystem fsync here is not evidence of macOS power-loss durability; native
full-sync requirements and crash recovery remain unqualified.

## Exact generated checks

The source release initially authorizes only these generated local happy paths,
outside ordinary CI. Inspect `tests/test_happy.py`, `tests/synthetic.py` and the
imported updater modules before running from `tools/houseatlas-updater`:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest tests.test_happy.GeneratedHappyPaths.test_check_generated_full_bundle tests.test_happy.GeneratedHappyPaths.test_apply_generated_full_bundle_preserves_native_state tests.test_happy.GeneratedHappyPaths.test_apply_frontend_only_retains_exact_backend tests.test_happy.GeneratedHappyPaths.test_cli_json_check_and_durable_status
```

The tests create fresh `TemporaryDirectory` roots, generated gzip/ustar payloads,
non-executable Mach-O header specimens, tiny synthetic SQLite files, model/media
and private-text fixtures, and deterministic in-process fake ports. No socket,
external request, subprocess, credentials or actual launchd action is used. They
check full bundle check/apply, canonical binary/frontend selection, retained prior
closures, exact frontend-only backend retention, unchanged native file bytes,
modes and identities, and durable sanitized CLI status. The fixture publisher
uses an atomically replaced generated activation record; it does not qualify the
NAS owner's publication mechanism. Ordinary success does not qualify failure,
denial, concurrency, replay, expiry, crash, rollback or target installation.

After reading the pinned packaging `bundle.py` and `fixtures.py` and
`tests/test_packaging.py`, the composed checkout additionally supports these two
exact generated positive contract cases from `tools/houseatlas-updater`:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest tests.test_packaging.PackagingHappyPaths.test_pinned_packaging_fixture_schema tests.test_packaging.PackagingHappyPaths.test_packaging_generated_bundle_apply
```

Before composition, supply `HOUSEATLAS_PACKAGING_SOURCE` pointing to the reviewed
packaging checkout's `tools/release` directory. This is test-only source selection;
the test verifies the schema, fixture and imported helper source SHA256 values
before use. The apply test calls the pinned packager on newly generated files,
uses a nonexecutable Mach-O header specimen and synthetic reviewed-profile
declarations, then verifies license, frontend shell, closure and native
preservation through the same controller. It creates no real producer proof or
native compatibility qualification.

Independent review must pin the exact source after corrections and report the
exact commands/outcomes. Publication manifest, verification registration, CI,
workflow, app/MCP/dots adapters, runtime bindings and final source composition
belong to their respective owners.

## Dependency assessment

No dependency is added. The upstream
[`self_update` API](https://github.com/jaemk/self_update#multi-file--non-executable-install)
offers acquisition/checksum and multi-file move helpers, but does not provide
HouseAtlas's owner-bound launchd/native-state/health/journal transaction. Its
single-executable high-level update is not used. A later Rust acquisition adapter
could evaluate its bounded download/verification primitives after exact dependency
review; the present Python core remains independent of them.
