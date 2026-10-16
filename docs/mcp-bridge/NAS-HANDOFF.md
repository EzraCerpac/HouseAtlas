# NAS installation handoff — not activated

The NAS owner alone stages, verifies and installs the reviewed immutable artifact.
This coding task does not generate, enter, transmit or collect credentials, issue
access grants, change network configuration, compile on Mac/NAS or activate any
service. Existing HouseAtlas, gateway, Mail, Capd and Reminders services are outside
these files and must retain their configuration and process ownership.

NAS prerequisites reported by its owner: UID **502**; existing
`/usr/local/bin/tunnel-client` resolves to
`/usr/local/Cellar/tunnel-client/0.0.14/bin/tunnel-client`, version
`0.0.14+0f870e50a973fa820d4c409000059e181e8d242b`.
These are owner observations, not cloud verification. The expected proposed
share/config/state roots and LaunchAgent were absent at the owner's passive probe.
Strict-TLS canonical HTTPS `/api/atlas/auth/mode` returned `trusted-proxy`; this
alone is not genuine authenticated native session/admission proof.

## Inspectable staging recipe

1. Materialize the exact Library artifact, verify its archive SHA256 and inner
   immutable per-file manifest, then inspect all installer/entry/wrapper code.
   Retain its source commit/tree and independent review/test record privately.
   Do not compile or fetch dependencies on Mac/NAS.
2. The portable artifact keeps the repo-relative bridge path and the exact
   public operation catalog. Stage only into the new canonical owned 0700
   `/Users/server/.local/share/houseatlas-mcp-read-bridge` root, preserving file
   identities. Stage `key-entry.py` at that root's top level too, matching the
   stable user command. Do not overwrite an existing root or service.
3. Prepare owned canonical 0700 state at
   `/Users/server/.local/state/houseatlas-mcp-read-bridge`. Verify metadata only.
   Create trusted nonsecret fixed one-home origin/scope config as 0600 under the
   new canonical 0700 `/Users/server/.config/houseatlas-mcp-read-bridge` root.
   The source archive contains no actual household scope, endpoint or credential.
4. Have the native owner supply the genuine cookie through the inherited pipe
   and demonstrate a strict-TLS canonical HTTPS native session plus scoped
   admission **read only**, without direct Unix identity headers or fabricated
   proxy proof. Confirm one existing Editor membership. No live write for testing.
5. Use the NAS owner's inspected 0.0.14 flags retained in
   `launch-spec.example.json`: control-plane host root `https://api.openai.com`,
   runtime key reference `env:CONTROL_PLANE_API_KEY`, one native request/inflight,
   `127.0.0.1:0` health listener and private `health-url`. The example remains
   `configured:false`; fill only the registration ID and exact inspected Python
   executable before the NAS owner approves a runnable private launch spec.
   The initialized-notification shim is enabled because the adapter requires
   that MCP lifecycle notification; 0.0.14 suppresses duplicates. Do not add
   an unadvertised process PID flag; LaunchAgent owns the process identity.
   Health uses GET `/healthz` and `/readyz` on the validated owned loopback base
   URL from `health-url`, recording status only. Do not use UI or metrics.
   The wrapper refuses the delivered unconfigured spec.
   The registration ID is operational parent context, not runtime authority.
   No public health listener or service activation is provided by this artifact.
6. After independent staging review, the user runs the stable key setter in their
   own trusted Mac Terminal over existing SSH with an allocated TTY (`ssh -tt`,
   never `-n` or `-T`). Retain existing alias/host verification and the NAS owner's
   `BatchMode=yes`, `StrictHostKeyChecking=yes`, `UpdateHostKeys=no`,
   `ControlMaster=no`, `ControlPath=none` settings. Use the owner's exact pinned
   Python 3.14 executable with `-I -B` and the absolute staged `key-entry.py` path.
   The command contains no secret. User reports only “stored”, never the value.
7. The NAS owner checks only existence, UID, type, link count and modes. Activation,
   LaunchAgent creation, read-only health probe, rollback and acceptance require
   the separate operational handoff. This artifact creates no plist or listener.

## Secure key entry and wrapper

`key-entry.py` requires real/effective UID 502, a canonical existing home/config
parent, and an owned mode0700 dedicated config directory. It opens `/dev/tty`
with no stdin/getpass fallback, checks ordinary TTY state, switches to bounded noncanonical input to avoid
canonical-line truncation, disables and verifies ECHO/ECHONL/ICANON, and restores terminal attributes after success, failure or caught
interrupt/hangup/termination. It accepts one bounded printable ASCII key line.
It creates only a new raw `runtime-key` with `O_EXCL|O_NOFOLLOW`, mode0600, one
link, UID502, complete writes and file/directory fsync. It never replaces,
retries, deletes a partial file, logs a value/hash/fingerprint or activates service.
If the file exists or entry/write fails, stop and inspect privately; never blind
retry. A metadata-only readiness check must not read the key.

`tunnel-wrapper.py` reads raw bytes with no shell source/eval and verifies
canonical parent/type/owner/mode/link bounds. It checks the fixed root-owned
canonical 0.0.14 executable/version before reading the key, then places the key
only in child `CONTROL_PLANE_API_KEY` and uses `execve` with trusted nonsecret
argv. No key belongs in a plist, launch spec, argv, log, receipt or derived
fingerprint. The wrapper's expected version check and launch spec need NAS-owner
qualification against the actual CLI; the cloud did not execute that binary.

## Open runtime integration requirements

- Source coordinator path and publication-manifest coordination, exact candidate
  review/CI, acceptance and merge remain the coordinator's sole responsibility.
- Actual canonical origin, one-home scope, native session-pipe custody, gateway
  read admission and Editor grant are not supplied or installed here.
- Tunnel flags/origin/health method are owner-supplied; exact installed Python
  path and accepted native-session custody interface remain unconfigured.
- Runtime key setter/wrapper are reviewable source, not executed or NAS-qualified.
- Exact-impact remap confirmation, generic durable Stock outcome reconciliation,
  dedicated asset upload and scene-association creation need their native owners.
- Full document semantic parsing and PR198 unified scene features are separate.

Version-matched upstream reference, read during implementation:
[0.0.14 configuration](https://raw.githubusercontent.com/openai/tunnel-client/v0.0.14/docs/configuration.md).
The installed NAS `run --help` remains authoritative for its supported flags.
