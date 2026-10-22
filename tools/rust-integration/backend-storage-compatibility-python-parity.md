# Python generated-storage counterpart — source preparation only

Prepared sources are `backend-storage-compatibility.py` and this document.
They require independent review, source-owner registration and a later explicit
execution release. No harness/helper/binary/fixture, listener, containment
canary, host probe, package install, workflow rerun or target action is part of
preparation. No PR, merge, main update or source-manifest edit is included.
The unrelated frontend 23:00–23:40 UTC window remains protected.

Base: `e2aad6929e0a8ae5926c18519c50333b91834377`, tree
`b8179b7f38e00964690ce4a66b03c68bc59c91a4`. Its only change from parent
`5c3aad0ab6b3b67cdac53f073def715aa2cc175f` is the source-manifest registration.
Both registered files remain byte-for-byte unchanged:

| Registered source | SHA256 |
| --- | --- |
| `backend-storage-compatibility.mjs` | `6554df16e0e6230395a09009570037451b98b69c70752762fd5195ca3fa31601` |
| `backend-storage-compatibility-cases.md` | `19ceb326ffc6de6c59e0ec96ce27f262a1c6ea9bb17459fb7cbd3bbf955dcefe` |

The existing [cases and source review](backend-storage-compatibility-cases.md)
remain authoritative about backend source interfaces and bounded coverage.
Root AGENTS and the worker handoff were read; no more specific AGENTS or local
SKILL applies here. This source-only counterpart is not an ordinary registered
verification command. The original MJS interface receives no new flags.

## Reason and remaining runtime dependencies

The owner reports one bounded inventory: macOS 15.8/x86_64, Python 3.14.7,
SQLite CLI 3.53.4 and OpenSSL 3.6.4. Four approved Node paths were absent. That
does not establish host-wide Node absence or the existence of another version.
Python's optional `sqlite3`/`ssl` modules and linked native closure remain
unobserved. This preparation performs no further inventory or runtime probing.

The new source requires exactly Python 3.14.7 on Intel Darwin, `-I -S` and no
`-O`. This version fence records the reported interpreter; it does not qualify
its modules, TLS implementation, ABI, native inputs or inherited containment.
The SQLite CLI is not used: it does not prove Python's SQLite linkage. Only
Python stdlib modules and preexisting selected OpenSSL are proposed, with no
dependency installation. Tool paths/inodes/hashes and actual future SSL/SQLite
versions enter receipts; runtime closure acceptance remains a separate gate.

Exact executable pins remain:

| Role | Product source | Bytes | SHA256 |
| --- | --- | --- | --- |
| Old | `20acc832919f4d5b7ec93e6d6641660f999e7688` | 40994600 | `2699f230c03084b1ecb1f86b577615a25a51470fe2c2bd994d0fdcb0452db7d0` |
| Candidate | `d36a48546a92b58cb3c515d8034272dfa1d92e5a` | 41093032 | `107770cea136e5f1042e8433d068fb1578e61f7d21e724f24554a4805e2cd941` |

Candidate tree remains `9567e8f9da5c81a8b9b9e4d088b09b269a5bdd8a`. Existing
artifact acceptance/qualification evidence is neither repeated nor broadened.
No binaries are downloaded, rebuilt, inspected by executing them, or run with
`--help` during preparation.

## Restrictive inherited launcher contract — design, not an implemented profile

An independently reviewed parent launcher must select the exact artifact/tool
closure, generate an empty directory owned by this effective user with mode
0700, retain its device/inode and select one unused unprivileged numeric port.
The launcher supplies all four values **before** starting Python, so inherited
containment can be bound to those exact objects and that single endpoint.
The orchestrator does not allocate a random root/port or create another executor.

The launcher must establish inherited filesystem, process and network restrictions
before Python or its native libraries load. Its reviewed read closure must cover
only the exact Python/stdlib/native-loader dependencies, exact OpenSSL closure,
the two verified artifacts and the selected source. Its write scope must be the
one generated root and required private runtime operations. Its network scope
must be only the selected `127.0.0.1:PORT` fixture exchange, with no DNS, provider,
proxy, external endpoint, all-loopback or broad temporary-prefix exception.
Filesystem/process prerequisites needed by Python, SQLite, SSL and Rust must be
reviewed as concrete closure; this document supplies no speculative sandbox
profile or unverified policy syntax and does not request weaker isolation.

The launcher owns a finite no-competing-writer/root-replacement and no-competing-
binder interval. If it uses a socket reservation, it must release its own
reservation before the first backend bind and preserve exclusion between the
three sequential services. This source does not pass a listener FD to the backend
or invent a supported FD-startup interface. Any bind collision means HOLD, with
no alternate-port retry, unrelated service inspection or process termination.

Before interpreter exec, the launcher must clear credential/provider/proxy/DYLD/
Python-startup environments; use the exact canonical interpreter with `-I -S`;
close all unrelated descriptors and provide only private reporting stdout/stderr
and inert stdin. It must set a reviewed **finite** descriptor limit no greater
than 1,048,576, permitting source-side closure of descriptors 3 through that
bound. The orchestrator repeats environment clearing, makes stdin `/dev/null`,
sets umask 077, and gives every child `close_fds=True`, empty `pass_fds`, private
pipes, exact cwd and an explicit five-entry HOME/TMPDIR/PATH/LANG/LC_ALL allowlist.
Clearing after startup cannot undo an already loaded library or inherited
policy; parent pre-exec sanitation is essential.

The root is admitted only if canonical, empty, owned, 0700, a directory and equal
to the explicitly supplied device/inode. A retained `O_DIRECTORY|O_NOFOLLOW`
descriptor and named identity/mode checks guard subsequent operations. Sources
must be canonical regular single-link bounded files; symlink components,
writable ancestry and artifact inode aliases are refused. The sole root-owned
sticky `/private/tmp` ancestry allowance is a path-validation rule, **not** a
containment grant or a prefix permission. Generated writes are exclusively under
the exact root, with no production config/store/output path argument. These
checks are application fences; they are not OS containment or proof of policy
inheritance. A fresh empty path alone does not prove host authorization.

The four context arguments are new **Python-only** options:

```text
--fixture-root CANONICAL_NEW_EMPTY_0700_DIRECTORY
--fixture-device EXACT_DEVICE_NUMBER
--fixture-inode EXACT_INODE_NUMBER
--fixture-port ONE_ALLOCATED_UNPRIVILEGED_NUMERIC_PORT
```

They accompany exactly `--case empty|populated|committed-wal`, `--old-binary`,
`--new-binary`, `--old-sha256`, `--new-sha256`, `--python`, `--openssl`, and
`--acknowledge generated-only-after-independent-review`. All twelve are required,
nonrepeating and explicit. There is no `all`, default, environment alias,
top-level helper selector or runtime approval credential. The running interpreter
and helper interpreter must select the same canonical executable inode. No
standalone shell invocation bypassing the separately reviewed launcher is an
execution proposal. The acknowledgement grants no execution authority.

## Assertion-by-assertion parity

The table maps the frozen MJS assertions to Python owners. Every row describes
source intent; no runtime outcome is asserted by this preparation.

| Assertion / invariant from MJS | Python counterpart and any deliberate difference |
| --- | --- |
| Explicit healthy selector; no default/all/negative class | `main`: exactly 12 options and one of the same three cases; extra four specify launcher context |
| Exact old/new hash acknowledgements, lengths and hashes | `main`, `Run.setup`, `Run.launch`: identical pins; copied owned executables rehashed before each invocation |
| Canonical, owner, regular, single-link, nonwritable paths; distinct old/new inodes | `canonical`, `regular`, `read_bytes`, `Run.setup`: same checks plus fd/named size, mode, nlink and nanosecond timestamps |
| Generated private root, no arbitrary live/config/store path | `Run.__init__`, `check`, `fence`: explicit fresh pinned root replaces MJS's private mkdtemp; root descriptor retained; no blanket prefix grant |
| Only owned config, provisioning, TLS, frontend, HOME/TMPDIR | `Run.setup`, `initialize`: create-only 0600 files/0700 dirs, executable copies 0700; fictional UUIDs/password; minimal placeholder frontend |
| Exact loopback binding; conflict stops | Fixed numeric IPv4 port in config, readiness and client; no port allocator, listener probe or retry in Python |
| Bounded child lifetime and immediate idempotent TERM→7-second KILL | `OwnedChild`: independent lifetime and escalation timers; single first termination deadline; repetition never postpones it, including while `finish` waits |
| Only owned ChildProcess handles; closure awaited | Only retained `Popen` objects are signaled/reaped; no PID scan, process group or global kill. `closed` requires `wait()` and pipe closure, not a timeout/TERM return |
| All-child cleanup begins before any close wait | `main` finally: take owned snapshot, mark each incomplete result, request all terminations, then wait on each close event |
| Timer clearing on actual child closure; original first failure preserved | Monitor cancels lifetime/escalation timers at reaped closure; `fail` fills first error only; later forced/interruption cleanup cannot overwrite it |
| Output limit and nonzero/uncertain receipt outcomes | Monitor drains stdout/stderr with selectors and stores at most 4 MiB combined; overflow immediately escalates. Actual code/signal, both streams and first error retained; forced kill cannot PASS |
| Readiness from actual owned stdout before connecting | `serve` requires the exact fixed-port startup marker while the child is alive and without failure |
| Fixture-only CA, no proxy/redirect/external connection | `setup` constructs `SSLContext(PROTOCOL_TLS_CLIENT)` with only generated PEM, certificate verification and hostname checks; `request` uses an AF_INET socket to the literal tuple; no resolver or URL/proxy opener |
| Before credential transmission, establish trusted own listener | Python additionally performs a TLS-only gate after readiness and compares peer DER exactly on **every** connection before encoding/sending HTTP credentials/cookie/CSRF |
| Generated credential creation needed by offline initializer | Password provisioning remains a local create-only file before `initialize`; no fake credential bytes cross TLS until readiness + exact peer admission. Native password startup requires this ordering |
| Bounded HTTP and no blind retry | One monotonic five-second whole-exchange deadline; socket ownership transfers from raw to SSL atomically under the expiry lock. Deadline/interruption checked before handshake; connect/handshake/send use the remaining time, and expiry always closes the published live socket. No redirect/retry; explicit HTTP/1.0/1.1 200, single Content-Length, no Transfer-Encoding |
| Old initializes/serves, logs in once, generates selected state | `execute`, `initialize`: same native CLI and normal fake password session; no library API exposed or assumed CLI invented |
| Empty business state is explicit, Access is not empty | `empty`: zero Atlas records/audits/receipts; exactly one real fake session after login and initializer-created fake user/membership |
| Fresh evidence/identity mutations with required guard | Same two endpoints, mutation IDs/payloads; `replayed is False`, revision 1 and identity's evidence ID matches evidence record. No source or asset enrollment |
| Actual populated history/receipt checks | `reads`: expected exact page, per-record body, exactly one audit matching lastAuditId and actor; SQL asserts exact bodies and audits/receipts count equals the two records |
| Same canonical paged read protocol | Contract 1.0.0, limit 100, nextCursor null, exact expected record set; HomeBox and Network pages explicitly empty; baseline/new/old histories and record ordering remain equal |
| Committed WAL on both stores, not a successful shell exit | Helper owns idle WAL connections before native commits. Freeze while backend is closed and keeper has no writers; both preserved WALs nonempty, correct magic/page/frame bounds and at least one commit marker; observer reads actual committed state |
| Untouched generated baseline and disposable observation/transition siblings | `tree`, `observe`, `install`: baseline main/WAL/SHM retained, never opened directly; all SQL goes to observation copies. Final baseline file hashes/modes must match capture |
| Genuine transition receipt and inode, no receipt rewriting | Old independently initializes transition; main bodies overwritten in place in its own inodes; own original receipt retained. Unexpected companion stops without deletion; only saved WAL copied; SHM rebuilt |
| Candidate then old reopen on the same candidate-touched paths | One transition/config/origin pair in both loop iterations; no restore, receipt migration, second clone substitute or session reinitialization between them |
| Receipt byte preservation and actual clean server close | SHA256 of transition server-state fixed through both reopens; success exit plus final `houseatlas-server-event/1` `graceful-shutdown` event required |
| Read-only inspection scope | Helper `mode=ro`, query_only, BEGIN on observation copies, exactly one database named main; no immutable mode, extension loading or attached scope |
| Actual integrity result and separate FK result | Both stores must return precisely `[("ok",)]` from integrity_check; no integrity result/non-ok/extra rows or SQL exception HOLDs. Foreign_key_check separately expects zero rows; empty rows alone cannot establish that an unknown/unsupported FK PRAGMA was detected. Capability qualification stays open |
| Full catalogue/schema/table comparison | Helper collects entire sqlite_schema, every table/column/row including metadata/migrations, declared FKs, user_version/application_id and journal mode; deep-copy comparisons recurse by JSON category so booleans never equal numbers |
| All SQL body values retained deterministically | Row sorting and BLOB hex encoding match MJS helper; JSON bytes are explicitly decoded as strict UTF-8 rather than auto-detecting UTF-16/32. Original-body strings remain unchanged and their original UTF-8 bytes are compared directly; no floating-point range restriction is imposed on those raw originals |
| Only narrow Access authenticated-read writes admitted | `compare`: one unchanged session, typed millisecond last_seen inside phase; exact unchanged-bucket count delta. Python corrects an inherited MJS gap: a replacement must begin at/after old expiry and inside an observed authentication interval, with its count bounded by those intervals. This tightened boundary check is not identical parity; details below |
| Request counting remains source-based and bounded | One authentication per normal scoped GET, two per manifest/resource Read+Media; TLS-only gate sends no HTTP and adds zero; no new logins between reopens |
| No user/verifier/membership/epoch/source/session exclusion | Only compared last_seen is normalized; rates compared separately with original rows retained; all remaining Access/Atlas columns and rows must equal |
| Honest SQLite housekeeping | Raw file sizes/hashes/modes and journal/page/freelist observations retained; persistent journal mode still exact. Main/WAL/SHM may differ on normal checkpoint/index rebuild/close; no byte-equality or filesystem-no-write claim |
| Closed namespace and empty media vault | Same five required files, optional main WAL/SHM, only logs/media/blobs/staging directories; no unexpected files/media bytes/rollback journal; no cleanup to force admission |
| Mounted original identity export | Candidate only: exact profile, 64-hex snapshot ID, Atlas section complete; every fetched resource must have exactly one descriptor and exact length/SHA256 |
| Empty identity descriptor | Empty case requires absence of retainedIdentityBodies, not an empty fabricated member |
| Full original identity member assertions | One member/no omissions; exact recordType/recordId/workspace/home; revision 1, offset 0 and member/aggregate/resource byte counts are guarded integer-valued JSON numbers excluding bool. Numeric 1.0 remains equivalent to 1; member hash and aggregate resource bytes equal exact original SQL records.body |
| Original documentary source unchanged | Export compared to stored original bytes without reserializing record JSON; no inference that a DTO or aggregate hash supplies missing original provenance |
| Private receipts and retained uncertain state | Numbered create-only root-relative receipts include binary/tool/source/helper hashes, root context, argv, PIDs, timestamps, code/signal, streams, file/SQL results, requests and auth windows; fake session file stays private |
| No retry, deletion or production cleanup | All failure paths preserve generated root and siblings. HTTP error/timeout, interruption or child uncertainty prevents PASS; parent must reconcile uncertain outcomes before any later retry |

The helper source is embedded in the new Python file, written only into the
admitted generated root at future execution, and invoked only by that run as
`-I -S` with root/device/inode and an exact owned store directory. It validates
the explicit context rather than accepting the original helper's broad temporary
prefix. A 30-second progress callback additionally bounds observation SQL work;
process deadlines remain authoritative. Its `hold-wal` action performs normal
healthy setup, commits no extra data, waits for the one explicit close message,
then closes normally. It is not a new top-level fixture/control selector.

## Reviewed comparison corrections

`json_equal` recursively distinguishes JSON null, boolean, number, string, array
and object categories, with exact object keys and ordered array members. Python's
`True == 1` / `False == 0` coercion is never used for JSON structural assertions.
Numeric 1 and 1.0 may compare by value within the number category, matching MJS
Number semantics; exact Python integers are never converted to float. Manifest
revision/offset/byte fields, native record revisions, schema versions, last_seen
and SQL rate timestamps/counts additionally require integer-valued JSON numbers;
booleans and fractional values are refused. Byte/hash assertions on raw
original record strings are retained independently of parsed documentary views.
Every byte-input JSON decode explicitly uses strict UTF-8 first.

No new floating-point/exponent limit is imposed on retained originals: exponent
overflow such as 1e999 is not a lost-MJS-parity finding, since JSON.parse also
produces Infinity. The raw original string/UTF-8 bytes retain the independent
exact comparison. Replayed still requires the actual boolean `False`.

An empty foreign_key_check result is the expected healthy result, but SQLite
also returns no rows for some unknown PRAGMAs. Neither this assertion nor the
frozen MJS helper inherently detects an unsupported FK PRAGMA. The inherited
cases document must not be read as such capability proof. Python SQLite and
native capability/linked-closure qualification remain open; no negative probe,
canary or new execution is introduced to settle them in this preparation.

The rate correction follows `backend/src/access/store.rs::consume_rate` and
`backend/src/access/boundary.rs::authenticate/rate`: times are epoch milliseconds,
the request-user window is exactly 60,000 ms, rows are removed only when
`expires_at <= now`, a new row has `(starts_at=now, expires_at=now+60000, count=1)`,
and conflict updates increment only count. The frozen MJS inherited a gap that
allowed replacement after phase start without requiring old expiration; its
registered bytes remain unchanged and this Python-only correction is explicit.

For the same retained starts_at, require unchanged-window viability and the
exact observed authentication increment. For a replacement, require the new
starts_at at/after phase start **and old expires_at**, its own exact 60-second
expiry, and a recorded successful request interval containing that starts_at.
The count must include all authentications in request intervals strictly after
the reset, may include those in intervals crossing it, and cannot include any
request interval already finished before it. At least one authentication must
support the new bucket. A request with Read+Media has two authentications; the
interval bounds deliberately do not pretend to locate their individual native
timestamps. Missing other rate rows must have expired by an observed request,
rather than merely by the end of shutdown. Raw rows and per-request intervals
remain in receipts. This is bounded healthy-state observation, not a new control
case or proof against an adversarial concurrent writer.

## Lifecycle, budgets and uncertainty details

One-shot child/tool/initializer/observer lifetime is 35 seconds, server lifetime
45 seconds, WAL keeper 90 seconds, readiness 15 seconds, socket exchange five
seconds and whole run 210 seconds. First TERM schedules KILL after seven seconds
on an independent timer thread, so waiting in `finish()` cannot postpone it.
The same idempotent termination path serves lifetime expiry, interruption,
output overflow, normal stop and cleanup. Only the retained process handle is
signaled, and cleanup begins for all children before waiting on any one.
Closing/reaping is not inferred from successful signal delivery. This is not
`subprocess.run(timeout=...)` or a PID-wide cleanup script.

The monitor drains both output pipes concurrently and separately confirms child
exit with `wait()`. If a pipe still lacks EOF two seconds after child exit, it
records uncertainty and closes its local descriptors; such an outcome cannot
PASS. No unknown descendant is killed to force pipe closure. Deadline timers are
cleared at actual closure. First failure remains in the process receipt even if
cleanup/expiry/interruption overlaps. Receipt filesystem writes and process
launch syscalls do not hold the lock needed by the KILL timer.

Stored child output is at most 4 MiB combined; HTTP bodies 4 MiB; requests 4096
bytes; header lines 8192 bytes, headers 64 KiB / 32 fields. Unexpected HTTP
framing/content/status is held, never retried. Files remain at most 64 MiB;
one copied store tree 128 MiB / 256 files. The same tiny fixture limits total
case data. A supplied root need not have a special prefix, but it must be the
one empty pinned root admitted by the launcher and source.

Timers and signals depend on OS scheduling and process availability; source
alone cannot prove a real host can reap promptly after KILL. An unresponsive OS,
executor loss, denied signal, missing EOF or failed receipt write is uncertain,
not a fabricated clean close. The parent launcher must retain private output/
earlier receipts and reconcile exact owned process/root identities before any
further operation. No fallback weaker containment, process-global kill, blind
retry, production restore or user-activity cleanup is available here.

## Coverage and held cases

The same generated Atlas v5 / Access schema 1 empty, populated and committed-WAL
scope applies. There is no claim to run all changed Rust paths. Material/GLB
admission, unmounted administrative validators, the Rust recovery integrity
branch, full-geodata, stock/queue populated histories, assets/documents/media,
private native snapshots, target/protocol/browser/device acceptance, profile
adoption, executable-pointer rollback and production restoration remain outside.
The whole ScopeA/private-result composition remains absent and held.

Structural corruption, FK-negative, crash, omission, denial, concurrent writer,
replay, expiry, revocation and fault cases remain descriptions in the registered
cases document and have no Python selector or proposed execution. Positive
guards do not authorize deliberately exercising them. No live config, secrets,
LaunchAgents, bridge/MCP session, browser handover or external connection is used.

## Source-only checks and review handoff

Allowed preparation validation parses the new file with `ast.parse` and parses
the extracted **literal** SQLITE_TOOL with `ast.parse`, without importing or
executing either source. `git diff --check`, frozen-file SHA256 equality and
source inspection complete the bounded checks. Do not invoke the Python runner,
`--help`, its helper, an executable artifact, a fixture/listener/canary or a target
to validate this preparation. No generated pycache/build/fixture is required.

Handoff provides the exact new commit/parent/tree, two-file diff and hashes,
parity source above, static outcomes, and confirmation that both registered MJS
files match base. Source owner retains independent review and registration.
Interpreter modules/linked closure, exact inherited launcher/profile suitability
and a bounded execution release remain pending; source preparation grants none.
