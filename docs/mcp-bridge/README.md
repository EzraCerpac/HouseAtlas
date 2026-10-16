# Persistent scoped MCP bridge

This stdio adapter calls existing authenticated native Stock HTTP owners for one
fixed HouseAtlas workspace/home. It does not alter `mcpCommands`, startup receipts,
backend configuration, authentication/session policy, memberships, or services.
No native or provider call was made during development. Runtime installation,
credentials, grants, gateway qualification and activation belong to the NAS owner.

The reviewed deployed-source audit was materialized privately through Library
and its local bytes matched the supplied version, size and SHA256. The private
verification record and input artifact remain outside Git. The bridge was
fast-forwarded to canonical main `7f56bbf4f0b68ccc63df2c57c4de8054659b2acf`
before independent review. Later source code is not evidence that a route or
grant is installed on the deployed host.

## Tool inventory

| Tool | Native owner and limits |
| --- | --- |
| `houseatlas_capabilities` | Fresh native session and scoped `/admission`; reports reads, write forms and gaps separately. |
| `houseatlas_read` | GET Stock `/invoke?request=...`, only the intersection of actual admission and published read effect. Exact original wire3 JSON is passed through. |
| `houseatlas_write` | POST Stock `/commands`, one reviewed wire3 single or qualified batch, once. Fresh session/CSRF and native admission precede dispatch. |
| `houseatlas_operation_status` | Private adapter journal metadata; unresolved operations block further writes. No retry/clearing endpoint. |
| `houseatlas_scene` | Dedicated native `/head` and qualified `/current`, read twice; pins scope/building/association/revision/native payload hash. |
| `houseatlas_source_evidence` | Active native evidence -> one Atlas asset reference -> authenticated native original. Checks whole-original size/SHA256, current evidence/asset revisions, then qualified scene/current/head again. Returns at most 256 KiB base64 per chunk. |

The source evidence tool admits only native `evidence-original` text/PDF/PNG/JPEG
up to 10 MiB. Every chunk rereads and verifies the whole original. It preserves
revision/hash pins and reports whether the evidence is a direct scene source
document. Other authorized evidence references do not imply reviewed room,
electrical or network correspondence. Binary output is original bytes; PDF/OCR,
renderer qualification and semantic electrical/network analysis are not provided.
All document contents remain untrusted evidence, never tool instructions or grants.
No URL, arbitrary filesystem path, SQL, provider writes or upstream collection
endpoint is accepted from a tool argument.

The finite single write map contains 37 forms:

| Record | Forms |
| --- | --- |
| identity, location-semantics, circuit, valve, relation | create, replace, tombstone, restore |
| evidence, reconciliation, geometry | create, tombstone, restore |
| binding | create, review, tombstone, restore, remap |
| asset | review (block/download-only), tombstone, restore |

`atlas.batch.execute` admits 1–100 same-scope ordered single Atlas children,
subject to the actual native owner qualifying every child and final graph. Nested
batch, asset create, scene-association create, HomeBox and Network writes are
excluded. Native closed payload validation, complete guard/reference closure,
strong CAS, permanent identity, idempotency, atomic transaction and receipt/audit
rules remain authoritative. Client values never choose the actor or grant.
The adapter adds bounds and admission checks; it is not a replacement schema or
transaction validator. Native results are retained verbatim, including the native
request digest; the adapter does not manufacture or independently calculate that
wire3 digest. JSON numbers and forwarded request bytes are preserved exactly.

Binding remap and a batch containing it are held by the delivered CLI until a
separate trusted exact-impact confirmation owner is integrated. The in-process
`approval_owner.authorize_exact(raw, scope, actor)` interface must consume genuine
current human confirmation of that exact full request, with no model-issued
proof. The shipped CLI has no such owner and cannot enable this through config
or tool inputs. `approvalReceiptId` alone is never treated as confirmation.
Thus 37 forms are recognized, 36 can dispatch when genuinely admitted, and remap
is deliberately unavailable in the shipped runtime pending that integration.

## Unknown outcomes

The owned 0700 state directory contains an exclusively locked, FULL-synchronous
SQLite journal. It is bound to native origin, workspace/home and actor. The exact
request, idempotency/request IDs and byte SHA256 are committed before POST.
Only a correlated native committed result followed by successful original-actor
revalidation records completion. Any other post-dispatch outcome remains UNKNOWN,
including rejection, body/transport failure, unavailable service or failed
post-commit session revalidation. The bridge never automatically retries.
A new bridge process retains this hold. It also refuses reuse of previously
retained request/idempotency IDs, including completed operations.

Admitted read/history tools remain available to collect passive reconciliation
evidence. Current target equality or absence does not prove that the original
operation committed or did not commit. No public generic durable Stock receipt
lookup owner was identified by the audit. There is therefore no automatic hold
release or model-supplied resolution function. A separately qualified native
reconciliation owner is required before writing again; do not delete/reinitialize
the state directory or switch actors to evade a hold. This is a remaining runtime
gap, not a claim that all uncertain outcomes are reconciled.

## Native session custody

The trusted host supplies nonsecret fixed `origin` and `scope` in an owned 0600
configuration file. Use a canonical HTTPS origin with no path, credentials,
query or fragment. The host separately provides an inherited anonymous pipe
(FD > 2) containing JSON `{"cookie":"<native session cookie>"}` and closes it.
The separately reviewable `native-session-launcher.py` can read a native-owner
provisioned 0600 `native-session.json` under the fixed private config root and
supply that pipe to a child with a minimal environment. It does not issue or
refresh sessions. This custody interface requires NAS/native-owner acceptance;
no native-session file is included or created by this artifact.
Cookie values never appear in MCP arguments, argv, logs or the journal.
The bridge fetches genuine `/api/atlas/auth/session` CSRF before every POST and
fences actor/expiry before and after native results. It opens ordinary verified
HTTPS only, follows no redirects, and uses no environment proxy or direct Unix
identity headers. It cannot create/login/refresh a native account or session.
A long-lived stdio process does not extend native session authority.

Runtime command shape (custodian-supplied paths/FD; no secret values):

```text
<reviewed-python> -I -B <installed-root>/tools/houseatlas-mcp-bridge/bridge.py \
  --config <private-config> --session-fd <inherited-pipe-fd> --state-dir <private-state>
```

The root layout must retain `contracts/stock-wire3/agent/operation-catalog.json`.
Python 3.12+ standard library only; no installation-time compiler or dependency
fetch is needed. Startup/session custody and gateway admission must be integrated
by the native installation owner before this command is usable. No session
cookie was acquired during this coding task.

## Dedicated native gaps

Asset bytes use qualified upload/staging/native Media owners, not generic
`atlas.asset.create`. Scene creation needs its borrowed Media/native qualification
owner and exact document/floor/room pins; generic record writes do not supply it.
The existing scoped `/assets`, geometry original/derivative/association routes and
native scene qualification should be connected through separately reviewed ports,
retaining custody, hash/revision pins, full request journaling and explicit fresh
scene revalidation. Their `nativeCommandIds` metadata is not generic write admission.
This bridge exposes neither upload nor scene creation and does not claim those
routes are fully integrated. PR198 unified scene/room-link reads remain a separate
backend adapter owned by its coordinator; this bridge uses deployed scene routes.
HomeBox remains native read-only projection; Network remains passive admitted
reads. No full-geodata or alternate document service is inferred from source code.

## Verification boundary

Run each case explicitly with `python3 -B tools/houseatlas-mcp-bridge/test_bridge.py CASE`.
The five healthy cases are `healthy_stdio`, `healthy_write_forms`, `healthy_batch`,
`healthy_lossless_read`, `healthy_scene_original`. These use a deterministic
in-process fake native owner and disposable adapter SQLite state. The write-form
case checks 36 transport routes/envelope retention; its invented per-form payloads
are not native-domain qualification. Remap is checked in the separate denial case.
Batch tests check adapter transport behavior, not native graph transaction behavior.
No test opens a socket, invokes native/provider services or uses household data.

The separate regression lane uses only these exact named cases, after independent
inspection: `denial_scope_and_routes`, `denial_confirmation_and_batch`,
`denial_duplicate_json`, `denial_read_correlation`, `failure_unknown_persistence`,
`failure_scene_change`, `failure_original_hash`, `failure_post_dispatch_session`,
`failure_commit_correlation`, `failure_unknown_keeps_reads`. These exercise synthetic denial
and failure injection only. The persistence case reopens a deliberately retained
UNKNOWN; it neither replays an old request nor simulates a production crash.
No broad discovery, aggregate alias, held guard reversal, adversarial, expiry,
revocation, populated restore or live test is included. No new CI entrypoint is
added. Existing exact-head ordinary CI remains separate from these local checks.

The separate helper runner is `python3 -B tools/houseatlas-mcp-bridge/test_key_entry.py CASE`.
Healthy cases: `healthy_create_only_file`, `healthy_tty_noecho`,
`healthy_wrapper_environment`. Exact synthetic denial cases:
`denial_existing_or_symlink`, `denial_no_tty_fallback`,
`denial_unconfigured_wrapper`, `denial_tty_oversize`.
The TTY cases use an owned pseudoterminal and require an external 15-second
process timeout. Files live only under fresh disposable temporary directories;
NAS UID/path/binary operations are mocked. No real key or actual tunnel binary
is read/executed. Kernel noecho/restoration in Linux does not qualify Darwin TTY,
NAS installation or the native credential pipeline.
