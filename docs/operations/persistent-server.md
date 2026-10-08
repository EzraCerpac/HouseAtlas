# Persistent startup source handoff

The persistent server uses explicit operator configuration and an existing native deployment state.

The new entry points separate one-time, offline provisioning from normal reopen:

```
houseatlas initialize --server-config /canonical/private/server.json --provisioning-file /canonical/private/provisioning.json
houseatlas serve --server-config /canonical/private/server.json
```

`initialize` requires a new data directory and explicitly selected accounts, supplied passwords and exact home memberships. It creates no synthetic default users, login sessions, inventory, provider enrollment or historical authority. Failed initialization may leave partial private state; normal startup refuses an absent initialization receipt. There is no automatic cleanup/adoption/retry.

`serve` requires existing private native state and the exact compiled Access and Atlas schemas. It does not provision accounts, reset sessions or apply database migrations. The receipt binds deployment configuration and original database file identities. One descriptor lock owns the data directory until graceful HTTP drain finishes. SIGINT/SIGTERM request a five-second drain. Existing disposable fixture CLI remains separate.

Server configuration is closed JSON with schemaVersion 1, deploymentId, dataDirectory, logDirectory (exact dataDirectory/logs), frontendDirectory, tlsCertificate, tlsPrivateKey, explicit nonzero listen address, exact HTTPS origin matching that port, homes[{workspaceId,homeId,label}], and mcpCommands (`read-only` or `existing-editor-commands`). All paths must be absolute and normal; selected configuration and private key must be canonical regular private files owned by the service user. No TLS material is generated. The frontend directory must use its canonical path.

Provisioning is closed private JSON: schemaVersion 1 and users[{userId,actorId,username,password,memberships[{workspaceId,homeId,role}]}]. Roles use existing viewer/editor values. Passwords are explicit operator input, hashed using the existing Access implementation, then zeroized in the provisioning owner. Do not store real provisioning packets in Git or logs. The provisioning file is not read by normal serve.

Stable state includes access.sqlite, atlas.sqlite, media/, server-state.json, server.lock and logs/server.events.jsonl. Directories are 0700; private files are 0600. Lifecycle logs contain fixed event names and dates, not credentials or requests. Administrators own log retention; no automatic maintenance is added.

The persistent Host mounts existing Atlas functionality using explicitly selected command profile. HomeBox, Network and AI providers remain unconfigured. It does not admit historical Media references or activate quantity writes.

## NAS launch inputs still required

The sole NAS writer must receive the verified new source checkpoint, then explicit approval for the service account, canonical config/data/log paths, selected homes/users/memberships and operator-supplied passwords, existing TLS certificate/key paths, and exact loopback bind/origin. Proposed NAS target remains https://127.0.0.1:48743. No public bind, autostart, real credential creation, grant enrollment or live provider activation is authorized by this source handoff. Do not launch the older fixture binary.

## Validation

Combined actual-peer cargo check and production Clippy with warnings denied pass. Initial compile error was a missing I/O error mapping in the new existing-database opener and was corrected; its diagnostic is retained. One disposable offline provisioning/normal-reopen positive passed: one explicit synthetic user, zero sessions, unchanged initialization receipt and exact configured home. This handoff does not claim an HTTPS launch, restart under a service manager, NAS runtime validation or deployment acceptance.
