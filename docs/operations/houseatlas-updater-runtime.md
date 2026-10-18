# HouseAtlas owner-bound updater runtime adapters

`tools/houseatlas-updater-runtime/houseatlas_updater_runtime/` implements concrete
stdlib adapters for the existing updater controller. It imports the core types;
it changes no protocol, controller, release packaging or acquisition interface.
There is no platform discovery, command runner, dynamic import of caller code,
network transport, environment configuration, service installer or target
entrypoint. Constructing the adapters requires explicit trusted owner bindings.
Caller requests retain the existing closed code-release selection protocol.

## Implemented behavior

`CodeStore(policy, parse_manifest)` verifies the digest-selected stored manifest,
all-and-only code files, canonical paths, single-link file identities, modes and
hashes, and any frontend shell identity. `parse_manifest` is the owner's pinned
packaging normalizer `parse_manifest(raw_bytes, absolute_deadline)` with retained
trusted release/producer context; it must enforce that supplied deadline and must not
turn unchecked manifest strings into trusted evidence. Retained components are
resolved through their original immutable release and reverified recursively.
New closures are exclusively reserved at `publication_root/manifestSha256`;
existing directories are never overwritten, including incomplete ones. Bounded
payloads and exact manifest bytes are copied using exclusive file creation and
synced before activation. The original staged directory remains disposable.

The private `.runtime-selection.json` records only the revision and the two
component paths relative to the configured publication root. The initial
owner-onboarded closure can omit this record only when both components are
replacements contained in that release. The source neither moves nor adopts a
legacy live directory. A partial unactivated release remains for owner review;
there is no cleanup/retry/adoption command. Immutability means these adapters
never rewrite or delete a retained closure; filesystem permissions alone do not
protect against the account owner changing it.

`publication.PreservingManifestVerifier(delegate, launcher, store)` wraps the
existing trusted manifest verifier without changing its core interface. Owner
construction must use this wrapper so known asset incompatibility is rejected
during `check`/admission, before stopping the service. It reads the fresh installed
closure and requires every verified prior `/assets/**` URL to remain present with
the exact size, SHA256 and mode in a replacement frontend's declared file list.
The complete prior asset map is required conservatively; no filename heuristic,
browser-cache assumption or inferred tab retirement removes a requirement.
`CodeStore` repeats this check before creating the candidate directory, and
publication repeats it against actual verified closures before CAS. Frontend
retention preserves the same canonical closure. Without the wrapper the stopped
publication check still refuses an incompatible replacement, but the wrapper is
required for the earlier pre-stop eligibility decision.

The runtime never unions files after manifest verification and never adds HTTP
fallback roots. Retained directories alone are not HTTP-addressable: the current
backend loads only its selected frontend directory and misses return 404. A
producer may later supply an explicitly declared compatibility asset union under
its separately reviewed input/provenance policy; every byte must appear in the
new manifest and closure digest. This runtime supplies no producer qualification
or old-client API compatibility verdict.

`Launcher(store, inspector, operations, read_installed, service_identity)` checks
the exact existing job/account/domain identity, full process birth, canonical
executable and complete argv. Stop fences automatic launchd relaunch before
stopping that exact birth, obtains full exit evidence, proves no replacement
process is present, and only then obtains the existing native lock lease.
Every stopped inspection checks that same lease and fence. Each observation
contains a one-shot claim, retained privately by object identity and bounded by
a monotonic freshness interval. Publication consumes only the latest actual
observation and repeats installed/native inspection. No persisted token grants
maintenance authority.

`Publication(launcher, store, compare_and_swap)` creates and verifies the new
closure, then invokes the owner's existing guarded leaf activation mechanism:
`compare_and_swap(expected, replacement, native_lease, relaunch_fence, deadline)`.
The binding must atomically compare the exact previous installed identity and
select the matching canonical executable/frontend pair. It must preserve the
original configuration and all other native state. The adapter verifies the
actual installed selection and native state after this call. Its source-only
restore path requires a matching successful publication in this same adapter
instance, a fresh consumed claim, identical native/configuration/receipt state,
compatible storage and the retained verified closure, then runs the same exact
CAS. It restores code selections only. It provides no restart recovery or native
data/receipt restore.
Restore also checks the reverse asset requirement: every current candidate
`/assets/**` tuple must remain available identically in the prior frontend.
Otherwise it reports `rollback-incompatible`; it cannot silently discard files
needed by new tabs or add them to the prior immutable closure. Rollback
qualification remains open and is not exercised by the generated positive case.

`NativeInspector` reads bounded canonical original/effective configuration,
pins original bytes and identity, compares every parsed configuration field
except `frontendDirectory`, and binds the effective canonical frontend separately
to the installed release. Original argv after the executable remains exact,
including a stable effective `--server-config` path. Its private invariant binds
all remaining configuration, original bytes, argv and owner-declared custody
artifacts. Each `NativePolicy.artifacts` entry is an explicit owner-bound
`ArtifactPin(name, path, byte_size, sha256, maximum_bytes)`: the exact recorded
size and digest are independent of its reviewed per-artifact maximum. The latter
must be positive and no greater than the reviewed 32 MiB model ceiling; smaller
TLS/config/source artifacts retain their own smaller declared bounds. These
values are never caller protocol inputs. Artifact inspection uses 64 KiB reads,
incremental hashing and exact size checks without accumulating the model bytes,
then rechecks the same descriptor's metadata and the named path's identity and
metadata. Both private captures must agree around native validation. Effective
configuration replacement may change only that frontend
selection; source does not write any real configuration. TLS, source/model/AI,
shell and other external selected artifacts require a complete owner inventory
with custody pins. Every native directory/file/SQLite sidecar, including unknown
files, is inventoried by device/inode under a bounded tree scan; native modes,
owners, groups and file link counts also remain bound to the private invariant. Symlinks,
multiple file links, unknown special files and changed inventory block progress;
the configured native gateway socket is identified without opening it. This
conservative capture grants no permission to normalize ephemeral native state.

Inspection requires all existing native roots, lock and event-log paths. It
checks all three persistent lifecycle fences from the inspected backend:
`server-state.rebind.pending`, `server-state.receipt-compatibility.pending` and
`server-state.receipt-compatibility.next`. It compares the complete closed native
receipt with actual Access/Atlas device/inodes, reviewed schemas/profile and the
native configuration digest. Original/compatibility receipts are also captured
unchanged. Ordinary `atlas` and explicit `full-geodata` profiles select distinct
receipts and formats; a manifest cannot select or qualify a native profile.

`HealthProbe(launcher, runtime.ApplicationExpectations(...))` requires explicit
owner-pinned scope and explicit model/scene/room-link configuration declarations,
with no defaults. Configured selections require exact publication,
overview-manifest, model size/SHA256, source revision/SHA256, scene-semantics and
room-link expectations as applicable. These selected files also require existing
native artifact custody pins. An owner-validated unconfigured selection requires
explicit `False` and explicit `None` pins; it is distinct from an unavailable
configured source or an omitted response. Scene requires model; room links require
scene. Every profile still requires actual authorized scoped application reads.
There is no generic readiness-boolean or absent binding fallback. It verifies
the actual running process and immutable code, exact argv/canonical frontend,
actual served frontend index bytes, native state and typed actual application
readiness. It repeats process/native/installed verification after
the service probe. A fixed absolute monotonic deadline spans the whole health
attempt, including `read_installed(absolute_deadline)`, release-manifest parsing,
recursive immutable closure verification, native scanning and bounded file reads.
Nested stopped/publication checks preserve the outer operation's absolute budget
instead of starting another budget. Every injected operation receives the same deadline and **must enforce
it internally**, including bounded response streaming and cancellation; Python
cannot preempt a blocking arbitrary callback. Adapters reject elapsed deadlines
before and after local bounded chunks, scan entries and operations. Those checks
cannot preempt blocking filesystem calls or guarantee hard real-time completion;
the existing bounded core shell-marker helper is checked before and after its
bounded call as well. No unbounded background timeout thread is used.

The index proof strictly inverts only the exact bootstrap attribute insertion in
`backend/src/main.rs::frontend`: the raw index must be UTF-8 with exactly one
`id="root"`; the served response must contain exactly one complete fixed injected
sequence, and undoing that sequence must reproduce the pinned raw bytes exactly.
No HTML parser, whitespace rewriting or arbitrary normalization is accepted.
The response limit is the existing raw-index limit plus the exact fixed insertion
length. Saved-shell index bytes retain their unchanged raw comparison. A backend
bootstrap-transform change requires review of this coupled serving proof.

`PlatformOperations.readiness` now receives `runtime.ReadinessRequest(process,
nonce, expected)` and the same absolute deadline, and returns
`Readiness(process, actual_frontend_index, runtime.NativeReadiness(...), saved_index)`.
`NativeReadiness` must carry that exact fresh request object, the expected actual
scope/publication/manifest/model/source/semantics pins, exact model length, type
and content-digest, and consistent fresh scene/model/source selection revisions.
It may not substitute a revision retained from the prior process: the native
scene owner regenerates selection revision at startup. Configured room links also
require their exact response hash and the same fresh scene revision. Explicitly
unconfigured optional geometry is accepted only when the qualified native owner
validates that selection and the actual application read reports the same state,
with no invented model, scene or map. Missing fields do not declare unconfigured state.

## Required native owner bindings and onboarding

These adapters do not qualify a NAS, launchd binding or native validator. The
sole NAS runtime owner retains all target paths, original schemas, target binding,
service mechanism and activation authority. Existing backend source was inspected:

- `backend/src/config/server.rs` validates the complete private configuration and
  computes `houseatlas-server-state/2` using JCS. That digest omits frontend, TLS
  and log paths, so it is insufficient for updater configuration invariants.
- `backend/src/lifecycle/persistent.rs` holds the existing `server.lock` inode,
  checks closed receipts and exact database identities and distinguishes the
  ordinary/full receipts. Its serving reopen also opens native stores and logs;
  invoking normal startup as an inspection callback is inappropriate.
- `backend/src/access/existing.rs` validates the exact compiled SQL catalog,
  single `access_meta` version row and opaque epoch in read transactions. Its
  public open wrapper subsequently opens read-write. The owner must expose its
  read-only validation peer without that write-capable continuation.
- `backend/src/storage/existing_validation.rs` delegates the ordinary native-v5
  catalog/ledger/lineage validation through a read-only query-only transaction.
  This schema-only peer alone does not validate complete runtime/native custody.
- `backend/src/storage/geodata_full_store.rs` and the recovery/profile owners
  validate full core, recovery peers, document closure and legacy media bytes.
  Normal open paths can enable WAL. Use the actual appropriate read-only peer,
  with the selected policy and custody bindings; no numeric `PRAGMA user_version`
  or ordinary-v5 verdict substitutes for full-profile validation.

`NativeInspector` requires `validate_native(NativeInput, absolute_deadline)` to
return `NativeValidation` bound to that fresh capture's nonce, actual Access and
Atlas identities, reviewed `Storage`, and the native JCS configuration digest.
The binding must validate both captured original/effective configuration and the
complete argv/artifact selection, actual catalog/meta/epoch, ledger/lineage,
profile/protocol, receipts, pending transitions and required native custody. It
must use coherent read snapshots while running and the supplied native lease
while stopped. It must preserve native identities, Access/rate/session state,
receipts and private bytes, and add no initialization, migration, repair, origin
rebind or receipt adoption. The generated callback below deliberately validates
only its tiny synthetic schema and supplies no native qualification.

`PlatformOperations` must bind the existing service account/domain/job and its
existing stop/start mechanism, full native process birth/exit APIs, automatic
relaunch fence, and exclusive native lease on the unchanged `server.lock` inode.
The updater's separate `updater.lock` remains held by the controller. The start
binding must release/handoff only the held native lease and same launchd fence,
preserve original argv/model/AI/source/shell selections, and start that existing
job with the selected pair. It creates no service or lock replacement. The
readiness binding must validate actual existing-authority scoped application
reads and bounded frontend responses for that full process birth. It must read
the selected native home view and, for each configured selection, its model
overview descriptor, unified Atlas descriptor
with the exact expected overview-manifest pin, and that descriptor's exact model
route with expected SHA256 and fresh selection revision. Validate successful
status, fixed same-origin routes, no redirect/cache, current scope/authorization,
bounded complete body, MIME, length/hash/content-digest, overview-manifest and
selection headers, source pins and the configured scene's admitted references.
Configured room-links or other companions additionally require their own current
authorized pinned reads. Existing browser read contracts in
`frontend/integration/model-overview-reader.ts`, `unified-atlas-reader.ts` and
`unified-atlas-room-links-reader.ts` define these coherence requirements. No
session, Media/Read grant, refresh demand or provider action is created. A missing
qualified callback or existing read authority cannot establish health. A listening
port, disk read, native schema verdict or manifest assertion is insufficient;
actual browser rendering acceptance remains a separate owner qualification.
The actual whole-profile no-write native validator and coherent running/native
inventory cut remain open owner bindings. A stopped-only validator cannot satisfy
the initial running observation by pretending no process is present. Existing
`ServerLease::acquire(false)` opens logs/lock and syncs directories, and Access's
`open_existing` wrapper later opens read-write; neither is an acceptable substitute
for the required no-write inspection peer. No native inventory/lock adaptation
is supplied or qualified by these leaf repairs.
The owner-bound
`read_installed(absolute_deadline)` and exact activation CAS must enforce their
supplied deadlines and read and use the real qualified
leaf mechanism, not a fake activation record or a new `current` symlink.

The repository has legacy software trees (including `frontend/`) and the
controller requires canonical versioned binary/frontend paths beneath its
publication root. `backend/src/main.rs` rejects a noncanonical frontend for both
direct serving and gateway mode. Therefore onboarding must first review and
qualify the exact existing layout and owner mechanism for an initial immutable,
manifest-pinned release plus paired canonical selections. A private derived
configuration at an approved stable canonical path outside the native data tree
and distinct from the original configuration may select the new frontend;
all other fields, argv selections and original private config bytes must remain
exact. Do not point `frontendDirectory` through `current`, rewrite original
private configuration, relocate native data, add a service, or infer onboarding
authority from this source. Model/source/AI/shell artifacts must all be enumerated,
and transient sidecar/socket inventory must have an owner-reviewed coherent cut.
The source intentionally supplies no target adoption command. Compiled native
read-validator, existing launchd/fence/lease, real readiness and guarded activation
CAS bindings remain absent. Runtime qualification remains open: this source is
not evidence that a Mac-independent real target update has been achieved.
Sidecar/socket lifecycle changes are never silently omitted or normalized; the
source admits only an already qualified coherent inventory cut.

Before any real action, the NAS owner needs the exact reviewed source checkpoint,
target/platform/native build/storage profiles, service/account/domain identity,
canonical code/staging/journal/protected paths, trusted release/producer evidence,
original configuration and custody pins, actual native read validators, bounded
process/fence/lease/readiness bindings and exact activation/restore plan. Target
access and G1/G2 releases must be obtained at action time through that owner.
An active owner/browser reservation remains exclusive; this work performs no
NAS read, native request, launchd operation, credential access or deployment.

## Exact generated positive check

After inspecting the package above, the core controller/model/validation/archive/
journal modules, `tools/houseatlas-updater/tests/synthetic.py` and
`tools/houseatlas-updater-runtime/tests/test_runtime_happy.py`, run this one exact
case from `tools/houseatlas-updater-runtime`:

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=../houseatlas-updater:. python3 -m unittest tests.test_runtime_happy.RuntimeHappyPaths.test_generated_full_and_frontend_apply_with_journal_coherence
```

The case creates a fresh `TemporaryDirectory`, generated nonexecutable Mach-O
headers, code/frontend files, tiny synthetic SQLite catalogs, a generated
5 MiB + 17 byte model specimen with exact custody and a reviewed 32 MiB limit,
smaller explicitly bounded artifact pins, generated typed application-read
specimens, private-text/native
fixtures and deterministic in-process owner callbacks. It applies one full
release, then a frontend-only release retaining the exact backend. It verifies
immutable prior closures, actual paired selections within the fake service,
fresh observations, successful fence/exit/lease/CAS/start sequencing, native
bytes/modes/inodes, manifest/retention reread, and durable sanitized status.
All generated releases contain a normal React root and explicitly list the same
legacy lazy chunk. The fake served index uses the actual backend's checked-in
replacement literal, independently of the adapter constant. Thus the success
path checks exact bootstrap inversion and declared asset preservation. The
synthetic application evidence binds a fresh request/full birth and current
generated model/source pins and revisions; it represents no native authorization.
It uses no platform command, subprocess, socket, native binary execution,
network, credentials or real state. Its fake readiness callback reads generated
bytes in process; it does not qualify real HTTP, model parsing or native readiness. Rollback is
implemented for review but is not executed. This adds no denial, failure,
concurrency, replay, expiry, crash, rollback, broad suite, CI or target permission.
The integration owner alone registers shared verification and manifests.
