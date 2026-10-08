# Persistent startup source handoff

The persistent server uses explicit operator configuration and an existing native deployment state.

The new entry points separate one-time, offline provisioning from normal reopen:

```
houseatlas initialize --server-config /canonical/private/server.json --provisioning-file /canonical/private/provisioning.json
houseatlas serve --server-config /canonical/private/server.json
```

`initialize` requires a new data directory and explicitly selected accounts, supplied passwords and exact home memberships. It creates no synthetic default users, login sessions, inventory, provider enrollment or historical authority. Failed initialization may leave partial private state; normal startup refuses an absent initialization receipt. There is no automatic cleanup/adoption/retry.

`serve` requires existing private native state and the exact compiled Access and Atlas schemas. It does not provision accounts, reset sessions or apply database migrations. The receipt binds deployment configuration and original database file identities. One descriptor lock owns the data directory until graceful HTTP drain finishes. SIGINT/SIGTERM request a five-second drain. Existing disposable fixture CLI remains separate.

The configuration digest format `houseatlas-server-state/2` also binds the exact
listener and MCP command selection. Earlier format-1 receipts fail strict reopen,
including the previous-configuration check in `rebind-origin`. This source adds
no receipt migration or automatic adoption; upgrading an existing installation
requires a separately implemented and reviewed transition. Do not reinitialize
an existing data directory to bypass that requirement.

Server configuration is closed JSON with schemaVersion 1, deploymentId, dataDirectory, logDirectory (exact dataDirectory/logs), frontendDirectory, tlsCertificate, tlsPrivateKey, explicit nonzero listen address, exact HTTPS origin matching that port, homes[{workspaceId,homeId,label}], and mcpCommands (`read-only` or `existing-editor-commands`). All paths must be absolute and normal; selected configuration and private key must be canonical regular private files owned by the service user. No TLS material is generated. The frontend directory must use its canonical path.

Provisioning is closed private JSON: schemaVersion 1 and users[{userId,actorId,username,password,memberships[{workspaceId,homeId,role}]}]. Roles use existing viewer/editor values. Passwords are explicit operator input, hashed using the existing Access implementation, then zeroized in the provisioning owner. Do not store real provisioning packets in Git or logs. The provisioning file is not read by normal serve.

Stable state includes access.sqlite, atlas.sqlite, media/, server-state.json, server.lock and logs/server.events.jsonl. Directories are 0700; private files are 0600. Lifecycle logs contain fixed event names and dates, not credentials or requests. Administrators own log retention; no automatic maintenance is added.

The persistent Host mounts existing Atlas functionality using explicitly selected command profile. HomeBox, Network and AI providers remain unconfigured. It does not admit historical Media references or activate quantity writes.

## NAS launch inputs still required

The sole NAS writer must receive the verified new source checkpoint, then explicit approval for the service account, canonical config/data/log paths, selected homes/users/memberships and operator-supplied passwords, existing TLS certificate/key paths, and exact loopback bind/origin. Proposed NAS target remains https://127.0.0.1:48743. No public bind, autostart, real credential creation, grant enrollment or live provider activation is authorized by this source handoff. Do not launch the older fixture binary.

## Validation

Combined actual-peer cargo check and production Clippy with warnings denied pass. Initial compile error was a missing I/O error mapping in the new existing-database opener and was corrected; its diagnostic is retained. One disposable offline provisioning/normal-reopen positive passed: one explicit synthetic user, zero sessions, unchanged initialization receipt and exact configured home. This handoff does not claim an HTTPS launch, restart under a service manager, NAS runtime validation or deployment acceptance.


## Explicit password-free loopback mode

The default remains password authentication. The opt-in `authentication` object
is `{ "mode": "loopback-local", "identity": { "userId": "…", "actorId": "…",
"username": "ezra", "scope": { "workspaceId": "…", "homeId": "…" } } }`.
Select exactly one matching configured home, listen `127.0.0.1:48743` and origin
`https://127.0.0.1:48743`. Initialization requires fresh absent data and no
provisioning file:

```sh
houseatlas initialize --server-config /canonical/private/server.json
houseatlas serve --server-config /canonical/private/server.json
```

Native Access stores an explicit password-disabled credential kind, not a blank
or generated password. It creates one Editor membership and zero sessions.
The initialization digest binds the selected mode and full identity. Normal
serve strictly reopens existing state and revalidates the singleton; it does not
migrate, reset, adopt or reprovision a password installation.

GET `/api/atlas/auth/mode` is informational. The explicit Open Home action POSTs
`{}` to `/api/atlas/auth/local`; actual loopback connection, selected origin and
native login admission issue the existing cookie/CSRF session receipt. Subsequent
reads and mutations use the ordinary native session, membership, epoch and CSRF
checks. Password login is absent in this mode. This opt-in trusts local access
through the selected listener/SSH route; it activates no household provider or AI,
and changes no LAN/proxy/autostart configuration.

## Explicit trusted Tailscale gateway mode

`authentication.mode` may explicitly select `trusted-proxy`. Its closed fields
are the same complete `identity`, a `policy` object containing `userLogin`,
`nodeTag` and `peerUid`, and `socket` equal to `dataDirectory/gateway.sock`.
The selected origin is one canonical HTTPS DNS origin under `.ts.net`. Identity,
user, tag, UID and actual hostname are private operator configuration; none is
inferred from requests. Exactly one matching home remains configured. The
existing loopback listen selection is retained as configuration, but this mode
opens only the private Unix listener. External HTTPS termination and native
WhoIs authentication belong to the separately registered gateway.

The gateway must authenticate each accepted remote connection through native
WhoIs and enforce the approved exact user or native node tag before forwarding.
It removes all client copies of `x-houseatlas-gateway-identity` and sets one
bounded JSON value `{schemaVersion:1,kind:"user"|"tag",value:"…"}`. External
Host and Origin are preserved. Network reachability and asserted forwarded
identity/address headers are not application authorization.

HouseAtlas checks the actual Unix peer UID, selected private parent and socket
inode, and the strict selected identity on every proxied request. Session
issuance rechecks that channel against the actual native request evidence and
consumes the resulting private proof. Mode GET returns `trusted-proxy`;
explicit Open Home POSTs `{}` to `/api/atlas/auth/proxy`. Password and local
bootstrap routes do not issue sessions in this mode. Existing native session
cookies, current singleton membership/version/epoch, same-origin and mutation
CSRF remain mandatory. Gateway admission is checked per request; this does not
claim synchronous remote tailnet-policy revocation of already running work.

Use a dedicated gateway hostname so its host-only cookie is not shared with
other services on the same DNS host. The channel trusts processes running as
the selected service user and the native gateway daemon. It adds no provider,
AI, recovery or stock-write capability beyond the configured scoped Editor.

## Explicit offline origin rebind

Changing origin/mode on initialized state requires the separate command:

```sh
houseatlas rebind-origin --previous-server-config /canonical/private/previous.json --server-config /canonical/private/candidate.json
```

Stop the old server gracefully first. The existing exclusive lease and strict
old receipt/native database identities are required. Only transitions between
loopback-local and trusted-proxy are accepted, preserving the complete selected
identity, deployment, data/log paths, homes and command policy. No database,
schema, account, membership, Atlas row or media is reset or reprovisioned.
The actual native Access transaction rotates the epoch and clears old sessions
and login-rate rows. Users must open a new session at the selected origin.

A private exact previous receipt and exclusive pending receipt are synced before
revocation. Publication replaces the selected receipt atomically and syncs its
directory. Failures after the native transaction do not imply rollback. Any
pending receipt makes normal reopen unavailable, before opening native databases;
there is no automatic adoption, removal, retry or recovery. Preserve diagnostics
for reviewed recovery. Use only the compatible candidate binary, not an older
binary unaware of this pending fence. Rollback is a separate explicit reverse
rebind under the same lease and identity, and also revokes sessions.

The source healthy example uses fresh synthetic state, preserves both database
inodes, then performs native session/read/mutation-guard checks over an actual
private Unix socket and OS peer with a simulated selected gateway header. It
does not qualify native Tailscale WhoIs, deployment, populated migration,
old-cookie denial, failure recovery or autostart.
