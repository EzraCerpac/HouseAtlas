# Generated backend storage compatibility — prepared, not executed

This is a proposed manual harness for independent source review and a later,
explicitly released execution. Preparation runs no fixture body, delivered
binary (including `--help`), Rust build, Mac/NAS operation or new executor.
There is no default case and no ordinary CI registration. The acknowledgement
argument below is an operator scope acknowledgement, not an approval credential
or evidence that execution has been released.

Exactly two new paths belong to this writer: this document and
`tools/rust-integration/backend-storage-compatibility.mjs`. Source owner
`owner01a13158-c477-746d-8023-299d117550d6` retains guide/AGENTS/manifest
registration, independent acceptance, PR and merge. Candidate commit/push is
allowed; no PR, tag, deployment or main movement is proposed here.

## Immutable inputs

| Role | Source | Tree / provenance | Executable bytes / SHA256 |
| --- | --- | --- | --- |
| Harness base | `a333a7e3b75a4820b287ff091473fd631e421f19` | `90785480a8e863e2409c7d9c026336e807ddda67` | No build |
| Old backend20 | `20acc832919f4d5b7ec93e6d6641660f999e7688` | Existing GitHub artifact `12124795558`, run `39094030939`; accepted Library `libfile_a3cee31de8048191adf997e672e0968c` | `40994600` / `2699f230c03084b1ecb1f86b577615a25a51470fe2c2bd994d0fdcb0452db7d0` |
| Candidate | `d36a48546a92b58cb3c515d8034272dfa1d92e5a` | `9567e8f9da5c81a8b9b9e4d088b09b269a5bdd8a`; run `39849910196`, attempt `1`, recipe `6e725d2e26bff3ca0deefadc22b1391bdf171437` | `41093032` / `107770cea136e5f1042e8433d068fb1578e61f7d21e724f24554a4805e2cd941` |

The exact artifacts were already independently located/verified by their owners;
preparation does not download, rebuild or execute them. The candidate package
is Library `libfile_8d8747cf759c8191bd7922e7598e33f1`, static review
`libfile_ced581663c74819181deae085650b742`, eligibility
`libfile_59a85204daf08191b123d0bec31d94a3`. The reported 898-input closure,
x86_64 PIE, macOS 15.0 / SDK 15.5, four system dylibs, no rpath/DYLD environment,
expected unsigned status and four generated native example successes are
artifact/qualification evidence only. They do not accept storage, a profile,
installation or a target.

The non-executing NAS-owner plan was read from
`libfile_13b523d61ec48191a505b8c7a9526d60`, supplied v0, 15734 bytes,
SHA256 `d1e07d1f281ba608b5deb21fd2a8493ccc5cb22a8710f6de60a9b64b97b59714`.
This document deliberately narrows its aspirational changed-path coverage:
the shipped startup does not mount every added administrative validator.
The plan's corruption/FK-negative suggestions remain held regression cases.

## Source-supported interfaces

Read root `AGENTS.md` and `docs/coordination/worker-handoff.md` first. No local
repository `SKILL.md` or more specific AGENTS file applies to these two paths.
`README.md` links `docs/contributing/verification.md`; this new runner is not
registered there and is not an approved ordinary command merely by existing.

The old-to-candidate source diff leaves Cargo dependencies/lock, migrations,
`backend/src/config/server.rs`, `backend/src/main.rs`, the router and persistent
startup wiring unchanged. The actual executable command dispatcher supports:

```text
houseatlas initialize --server-config OWNED.json --provisioning-file OWNED.json
houseatlas serve --server-config OWNED.json
```

`initialize` creates private Access schema 1, Atlas v5, an empty native media
vault, a server lock/log and a state receipt. The fake user/membership is
provisioned through the normal owner. It starts no listener. Password mode
supports an explicit ephemeral numeric loopback port; native loopback-local
mode fixes port 48743, so this harness does not select it. Trusted-proxy mode,
Unix gateway sockets, AI account, full-geodata, overview, scene and room-link
selectors are not used. `serve` accepts no provisioning option. It checks the
native state/config/inode receipt, opens the existing stores, builds the Host
without configured providers and binds exactly `127.0.0.1:PORT` over fixture TLS.
SIGTERM selects the implemented graceful shutdown and fixed lifecycle events.

There is **no integrity-check executable CLI**. Other existing backup, rebind
and receipt-upgrade/rollback subcommands are outside this harness. The
disposable CLI initializes synthetic fixtures; it is not an existing-store
reopen interface and is not used.

Actual HTTP interfaces used, with generated same-origin headers and the fake
password session:

| Phase | Supported interface and assertion |
| --- | --- |
| Old setup only | `POST /api/atlas/auth/login`; two fresh `POST /api/atlas/v1/workspaces/{w}/homes/{h}/records/{type}/{id}/mutations` for populated cases; no replay/retry |
| Old / candidate / old reopen | Scoped `GET .../records?limit=100`, each exact record and `/history`, plus empty `/homebox/entities?limit=100` and `/network/relations?limit=100`; exact expected bodies, IDs, revisions, audit identity and unchanged histories |
| Candidate only | `GET /api/atlas/offline/v1/workspaces/{w}/homes/{h}/manifest` and its scoped snapshot resources; verify resource length/SHA256, Atlas section completeness and exact retained identity aggregate/member bytes against SQL `records.body` |

The candidate empty export must have no retained-identity descriptor. Populated
exports have one identity, one member at offset 0, no omissions, revision 1,
exact scope/ID, original body length/hash, and the aggregate original bytes.
Manifest timestamps/snapshot IDs are not compared across processes. No in-memory
export token is resumed after restart. This is a small mounted-path positive;
it does not qualify numeric-token extremes, budgets or private-result composition.

Normal Atlas v5 reopen validates the compiled migration/catalogue profile; it
does **not** invoke the newly added complete recovery validators. Access
existing-open validates its compiled catalogue/meta/epoch before its normal
read/write connection. Added Access/current-profile/native-retained-byte
administrative methods remain library APIs. The runner neither exposes nor
pretends to call them. `PRAGMA main.integrity_check` in
`storage/recovery_checks.rs` belongs to recovery validation, not to a newly
invented startup check. The independent SQLite observer below checks the
generated stores without claiming execution coverage of that Rust change.

## Exactly one healthy case per invocation

| Explicit case | Generated state | Bounded coverage |
| --- | --- | --- |
| `empty` | Old initialized pair; zero Atlas records/audits/receipts; one fake Editor/membership and one normal login session | Empty business state, complete schema/metadata, auth references and all empty table states |
| `populated` | Old creates one evidence and one item identity referring to that evidence, with its required revision guard; two native audits/receipts | Nonempty record bodies, graph reference, actor/audit/history/idempotency rows; no asset, source or provider enrollment |
| `committed-wal` | Same populated state; an owned idle SQLite connection selects WAL on both generated stores before old setup commits | Main plus nonempty committed WAL on both stores; WAL header/page/frame bounds and at least one commit marker; SQLite observes the actual committed state and healthy integrity/FKs |

No case selector includes corrupt, FK-invalid, crash, denial, replay, expiry,
revocation, omission, race or fault cases. An ordinary healthy assertion failure
stops and retains evidence; it never drives a negative-control sequence.

1. Verify both exact binary lengths/hashes, canonical regular executable paths,
   single links, distinct inodes and nonwritable ancestry. Copy their verified
   bytes into the exclusively created private run root. Rehash each owned copy
   before invoking it. Input executables are never overwritten or rebuilt.
2. Create only owned frontend placeholder, TLS config/cert/key, provisioning,
   config, home and temp paths. Use fixed fictional UUIDs/credentials and no
   installed frontend, real config, browser, service registration or session.
   Reserve one ephemeral IPv4 loopback port; release it immediately before the
   child uses it. A bind conflict stops without trying another port or process.
3. Old initializes and serves the generator, logs in once, commits the selected
   setup, reads and gracefully closes. Successful HTTP mutation responses plus
   subsequent SQL/HTTP state distinguish committed data from a command exit.
4. Freeze a byte-for-byte `baseline/` copy while all writers are stopped. In the
   WAL case, the keeper has no transaction/writes after its readiness marker;
   only its idle connections remain. The pair's main/WAL/SHM is copied during
   that no-writer interval, then the keeper closes normally. This is generated
   fixture capture, not a method approved for a live store. Opening/checking the
   preserved baseline itself is avoided: observers open their own copies.
5. Old initializes `transition/` independently. Overwrite only its new database
   **bodies in place**, retaining its inode and genuine initializer-issued
   receipt/config. Copy each preserved WAL companion when present. Do not copy
   SHM into this transition; SQLite rebuilds it from main/WAL. No receipt is
   fabricated, rewritten, migrated or relaxed, and no existing companion is
   deleted to force admission. Compare its SQL state with the baseline first.
6. Candidate serves/reads/exports/closes the transition; old then reopens,
   reads and closes **that same candidate-touched pair**. The single generated
   cookie is carried across these sequential reads; this is no native/MCP
   session recovery claim. Only the candidate performs the identity export.
7. Preserve candidate-closed and old-reopen-closed tree siblings plus separate
   observation copies. Compare the original baseline's final hashes/modes with
   its capture. Keep every sibling and receipt, on success as well as failure.

## SQL and persistent-state verdict

The embedded Python helper uses only stdlib SQLite under `-I -S`, no installed
site packages or SQLite extensions. Its `mode=ro`, `query_only=ON` connection
opens **observation copies** with a read transaction; `immutable=1` is deliberately
absent because it would ignore WAL. Exactly `main` must be selected. No attached
database scope is implied. Each of Atlas and Access must return exactly
`[("ok",)]` from `PRAGMA main.integrity_check`, and independently zero rows from
`PRAGMA main.foreign_key_check`. Unknown PRAGMAs/no result, a non-`ok` row,
additional integrity rows, FK rows, SQLite exceptions, process errors and
timeouts all stop the run. Actual results are retained, not just process codes.

The observer records and compares the full `sqlite_schema` including SQL for
tables/indexes/triggers, every table's columns, every logical row including
metadata/migration ledger, declared FKs, `user_version`, `application_id` and
journal mode. Rows are sorted deterministically and BLOBs encoded as hex. The
tiny generated values fit JavaScript's exact integer range; this is not a
private database dumper or an arbitrary numeric-fixture acceptance tool.
SQL bodies must match the actual HTTP-created records; audit and receipt counts
must match. HTTP graph validation and exact record/history reads cover this
fixture's evidence reference and audit/actor correspondence. FK checks cover
actual declared constraints on both stores. This is not a replacement for all
domain recovery/history/retained-media validators.

Atlas rows must remain exactly unchanged. All Access users, verifiers,
memberships, epoch/meta, sources and sessions remain compared. The sole session's
`last_seen` may advance monotonically inside the observed read window. The
source-confirmed hashed request-user rate bucket may increase by exactly the
observed authentications if its window persists; a new 60-second window may
contain only the observed count or fewer after a boundary. Other existing rate
rows must remain byte-equivalent or expire normally. There is one authentication
per scoped read, two per offline resource/manifest request (Read plus Media).
No sessions/users/epochs are discarded from the comparison. Detailed before/
after rows and admitted read windows remain in the receipts.

Byte equality of working databases is **not** required: normal Atlas open
selects WAL; SQLite may rebuild SHM, checkpoint committed WAL into main on last
close, remove WAL/SHM, change header counters, page allocation/freelist counts
and file hashes. Access authenticated GETs also write the narrowly accounted
rate/last_seen state. These raw file hashes/lengths/modes, journal mode and page/
freelist counts are retained for review. Persistent journal mode, schema,
metadata and logical rows must satisfy the comparisons; an unexplained byte
change is not automatically accepted as housekeeping. Events logs normally gain
listening/shutdown entries. Server-state receipt bytes stay fixed through both
transition reopens. The allowed file namespace is only both database files,
optional WAL/SHM, lock, receipt and fixed events log; the media vault stays empty.
Unexpected files/media bytes or leftover rollback journals stop without deletion.

## Future commands and prerequisites — do not run during preparation

A separately reviewed, explicitly released **offline isolated Intel macOS 15+
executor** is required for these exact Mach-O artifacts. This task creates none.
Have Node **26.10.0**, an already installed reviewed Python 3 with SQLite capable
of the v5 STRICT schema, and reviewed OpenSSL/LibreSSL supporting the standard
`req -x509 -newkey rsa:2048 -nodes -config ... -days 1` invocation. Supply the
canonical absolute executable paths (resolve existing symlinks before selection);
the runner rejects symlink/hardlink aliases and writable ancestry. Tools are
preexisting; no install, new dependency, lockfile or network change is proposed.
The observer records its SQLite version; system Python SQLite differs from
the embedded backend SQLite and is independent observation evidence.

After independent source review and a later execution release, run each case
as a separately authorized command, replacing only executable paths and the
one case value:

```sh
node tools/rust-integration/backend-storage-compatibility.mjs \
  --case empty \
  --old-binary /CANONICAL/VERIFIED/backend20 \
  --new-binary /CANONICAL/VERIFIED/backend-d36 \
  --old-sha256 2699f230c03084b1ecb1f86b577615a25a51470fe2c2bd994d0fdcb0452db7d0 \
  --new-sha256 107770cea136e5f1042e8433d068fb1578e61f7d21e724f24554a4805e2cd941 \
  --python /CANONICAL/REVIEWED/python3 \
  --openssl /CANONICAL/REVIEWED/openssl \
  --acknowledge generated-only-after-independent-review
```

For the other two commands use `--case populated` or `--case committed-wal`;
there is no `all` selector, environment alias, default, automatic retry or
negative-control option. The runner cannot itself grant execution authority.
It never invokes a binary with `--help` or probes a delivered executable to
discover behavior. Child argv are fixed to the source-reviewed operations above.

Run roots are exclusively created below canonical `/private/tmp/` as
`houseatlas-generated-storage-*`, mode 0700, files 0600 (owned executable copies
0700). No arbitrary config/store/output directory can be supplied. Each file
read checks canonical path, owner, regular type, link count, size and named/fd
identity before/after; tree traversal refuses aliases. Binary hashes bind input
bytes to the two exact pins. Child environment is cleared and limited to owned
HOME/TMPDIR, system PATH and C locale: no credentials, proxy, DYLD, provider,
LaunchAgent, bridge/MCP or inherited app settings. Requests use Node HTTPS to
the one numeric loopback origin with only the generated certificate as CA;
redirects/status changes fail. No browser or external URL is contacted.
These are source/path fences, not an OS network sandbox: later execution must
provide the reviewed isolation and finite exclusion of other writers in the
owned root. No host firewall/security setting change is implied.

Bounds: 35 seconds for one-shot tool/initializer/observer, 45 seconds per server,
90 seconds for the idle WAL keeper, 15 seconds for readiness, 5 seconds per HTTP
request and 210 seconds for the run. Output/HTTP bodies are bounded to 4 MiB;
files to 64 MiB; one copied store tree to 128 MiB and 256 files. On timeout or
interruption only recorded ChildProcess handles receive TERM then KILL after
seven seconds, and their close events are awaited. No PID scan, unrelated
process kill, service restart, production cleanup or fixture deletion occurs.
Readiness polls only owned stdout; no failed mutation/request is retried.

Numbered create-only JSON receipts retain pins, input paths/inodes, exact argv,
owned PIDs, start/close/code/signal/stdout/stderr, fake session data in its private
file, SQL results, file hashes, read windows and final status. `pass-generated-only`
requires all closes and comparisons; `held`/`uncertain` preserves the root and
needs review. A normal close is awaited; forced/error outcomes cannot count as
PASS. Abrupt executor loss can leave only earlier receipts/children; reconcile
that uncertainty before any further operation. Retention/cleanup after review
is a later owned-fixture decision, never production cleanup authority.

## Held regression cases — descriptions only

These are absent from the executable selector and have no proposed execution
command. Each needs separate case-body/source review and exact lane release:

- Generated structural corruption in an additional disposable clone: the
  observer must inspect the actual integrity error/non-`ok` result, never infer
  healthy/rejected status from an exit code alone. Preserve the healthy baseline.
- Generated SQL FK violation in an additional disposable clone: integrity may
  still report `ok`; independent `foreign_key_check` must show the violation.
  Specify the intended constraint, actual row result and failure classification.
- Any crash, concurrent writer, alias/omission mutation, fault, denial, replay,
  expiry or revocation control. Healthy-path safeguards do not release their
  deliberate exercise. Do not add a wrapper or rename one into this case set.

## Coverage limits and later gates

This is proposed generated Atlas v5 + Access schema 1 storage old/new/old
compatibility, mounted basic reads and one small identity export. A later PASS
would not certify all 11 changed production Rust paths. Material/GLB admission,
AI/provider dispatch, full-geodata v1, stock/queue populated histories,
retained assets/media/documents, admin current-connection validators and the
Rust recovery integrity branch are not exercised here. Empty tables remain
explicit empty-state coverage. The held whole ScopeA/private-result composition
remains absent and held; do not revive it.

Private native snapshot cloning/capture/read authority, cross-store/media
consistency on a real host, target/protocol/session/browser/device acceptance,
profile adoption, installed executable-pointer rollback and production data
restoration require later separately reviewed scopes. Old reopen here touches
only an owned generated sibling. It authorizes no production rollback, backup
restore, config/plist access, binary replacement, launchctl, bridge/MCP session,
household intake, new credentials or external connection. Preserve existing
user activity and consumed claims. Four native qualification examples and this
preparation do not open any target claim or G1–G5 gate.

## Source byte review pins

SHA256 of exact Git blobs, old then candidate; these are source pins, not runtime
coverage claims. The harness base has the same relevant backend bytes as the
candidate. Dependencies, migration bodies, dispatcher/router/startup changes
were independently checked with the old-to-candidate source diff (empty for
those paths). The changed-production set is 11 paths plus three test bodies;
do not confuse inspecting them with running them.

| Source path | Old SHA256 | Candidate SHA256 |
| --- | --- | --- |
| `backend/src/main.rs` | `db623ea8fe7d6caa81a83da4f31c75460d0fe3f2874847cdfca2f67c7303b92a` | `db623ea8fe7d6caa81a83da4f31c75460d0fe3f2874847cdfca2f67c7303b92a` |
| `backend/src/config/server.rs` | `c37777ff1bdedbfc5409d81564a24f514a61900eb0ed3c14ac5232c3af043579` | `c37777ff1bdedbfc5409d81564a24f514a61900eb0ed3c14ac5232c3af043579` |
| `backend/src/lifecycle/persistent.rs` | `e665e006a263ef1f7f10e1551a374450c8088b6826e0ee3f8273d7bbacb33f1e` | `e665e006a263ef1f7f10e1551a374450c8088b6826e0ee3f8273d7bbacb33f1e` |
| `backend/src/http/mod.rs` | `48b7a8a57b58902b96cd76d897993784987e589ed1bc94e106639636cd9a903d` | `48b7a8a57b58902b96cd76d897993784987e589ed1bc94e106639636cd9a903d` |
| `backend/src/http/reads.rs` | `4d046fb886ac7b5a781230e9c26eb866ac7a5adf9401919d7bd336010755667c` | `4d046fb886ac7b5a781230e9c26eb866ac7a5adf9401919d7bd336010755667c` |
| `backend/src/http/mutations.rs` | `e1392c8d9de86ae18677d461d151767528d5232fef1ae32b7ee4f55990049ba1` | `e1392c8d9de86ae18677d461d151767528d5232fef1ae32b7ee4f55990049ba1` |
| `backend/src/http/auth.rs` | `592c9b486804efc65c9c800900302631c4f2001ab63c264e94d9ea00114d2d7f` | `592c9b486804efc65c9c800900302631c4f2001ab63c264e94d9ea00114d2d7f` |
| `backend/src/access/schema.sql` | `36f818330ffa904e5205fb6580166ebfc2f1525b6a2ed9a12fd85fee57063e03` | `36f818330ffa904e5205fb6580166ebfc2f1525b6a2ed9a12fd85fee57063e03` |
| `backend/src/access/boundary.rs` | `4a25201a7a4783e37cc9cb50ad84cdaf24db401086430189080b283b38d84695` | `0114881ed8caa6231e19ed2907c02109656c6279ab2e47cc94dcfbb27c5daec7` |
| `backend/src/access/store.rs` | `531da23843cb1a37c8ef8d710d0a25eab63ce00d54de2a7864bd4c81687822f0` | `531da23843cb1a37c8ef8d710d0a25eab63ce00d54de2a7864bd4c81687822f0` |
| `backend/src/access/existing.rs` | `130d72fc5549df8bf8b56a03774a88ea44b7419931754cc64289e81c7daa78ff` | `f7f6e7c0c1b665d30cd3ef2954ed9d10500eb79a372af6291ee5824770d6de55` |
| `backend/src/storage/store.rs` | `4e5b89758cee0b803094c91f2500ea400dfb1ffdbe872f00c3d4f57ba07089cd` | `435478a071a42fa1ac29624ad5c1d18abc1a00e5c224cfbb593764de872cbb1f` |
| `backend/src/storage/migrations.rs` | `001226fbc9a4d91c76acf998b85dcba63bbcc9bec1960e69f38af0ee60fc1c43` | `001226fbc9a4d91c76acf998b85dcba63bbcc9bec1960e69f38af0ee60fc1c43` |
| `backend/src/storage/recovery_checks.rs` | `6d9b74f504e70986ca2c0125f980333095ff673ae5435102073ef110cce1081b` | `f796273795f6a66cafbd0c16914102070ef67952285e60a8bf14ccfd98c4c610` |
| `backend/src/storage/updater_read_validation.rs` | `absent` | `2b9e239da5ec240893346bb5469bb204c47a0cba3f6acd84fa8791193ffd0102` |
| `backend/src/storage/home_read_pack.rs` | `0be829e116936ec7f852d75c19cde9c22ffdb81bf4e3026e72e0332bc855e25d` | `15ff141eccbe7a8e18e47993756d08bc6000d20a69329499f26f1f79404bf6b1` |
| `backend/src/http/offline_read_pack.rs` | `4f89331d8b729270dde75071e99cd89746e0ec1973e78defbf1348ed587c7662` | `18a8cf6ca2e8f3ff16bf9ec4d4407dacfb7fb6a95fb2f7bcb2ff855515f8c993` |
| `backend/src/media/native.rs` | `3c93213db7b1d24ebcbcaed6deee5ab35e69d8526e9689f05a84c74adda7e394` | `3c93213db7b1d24ebcbcaed6deee5ab35e69d8526e9689f05a84c74adda7e394` |

## Preparation validation

Only syntax/whitespace/source checks are permitted here. The proposed checks
parse without importing/evaluating the runner or invoking its helper:

```sh
node --check tools/rust-integration/backend-storage-compatibility.mjs
git diff --check
```

The embedded `SQLITE_TOOL` literal can additionally be extracted as text and
passed to Python `ast.parse`; do not execute/compile-and-run it, import the
runner, invoke its CLI, run a delivered binary or run a new fixture. Record
the final two file SHA256s, two-file diff, candidate commit/tree and static-check
outcomes in the handoff. Independent review/registration and execution release
remain pending, even after those checks pass.
