# NAS source handoff — no activation

The sole NAS owner stages and verifies the immutable Library artifact. This
coding task does not generate/enter/transmit a real key, grant access, change
network configuration, compile on Mac/NAS or activate a service. Existing
HouseAtlas, gateway, Mail, Capd and Reminders services remain outside these files.
The original f3aa009 Library archive/source freeze remains unchanged; later
source changes require a new version, hashes, exact-head review and CI record.

## Reviewed target executable contracts

NAS-owner passive observations supply these exact contracts; the cloud did not
read or execute either installed binary:

- Tunnel binary: `/usr/local/Cellar/tunnel-client/0.0.14/bin/tunnel-client`,
  UID502, mode0555, version
  `0.0.14+0f870e50a973fa820d4c409000059e181e8d242b`, SHA256
  `623c42ba3b241938edb05e52d1f451065b5881cbc8f118928e39295019fb446c`.
- Python: `/usr/local/Cellar/python@3.14/3.14.7/Frameworks/Python.framework/Versions/3.14/bin/python3.14`,
  version3.14.7, SHA256
  `b08b055365df6dcd3fff0b805b688428f0f6a01839303f22c0716780155c480d`.
  Use this exact absolute executable; its sys.executable alias is not a source pin.

The wrapper checks canonical paths, regular executable type, bounded size,
non-group/world-writable mode, exact hashes and stable file identity. Tunnel
UID502/mode0555 are exact; an assumed root-owner requirement is intentionally
removed. Version probing precedes reading the runtime key. Ownership or hash
changes require fresh source-owner/NAS review, never a local bypass or fallback.

## Inspectable staging recipe

1. Materialize the exact private Library archive; verify archive SHA256 and every
   manifest member. Inspect source, source commit/tree, independent review and
   exact-head CI. Never patch an older archive locally or compile on Mac/NAS.
2. Stage only into the new owned0700 canonical
   `/Users/server/.local/share/houseatlas-mcp-read-bridge` root, keeping the payload
   layout and public operation catalog. Top-level `key-entry.py` must match its
   exact source bytes for the stable trusted-Terminal command. Do not overwrite
   an existing installation or unrelated service.
3. Prepare new owned0700 canonical config and state roots:
   `/Users/server/.config/houseatlas-mcp-read-bridge` and
   `/Users/server/.local/state/houseatlas-mcp-read-bridge`. Existing parents are
   owner-reported UID502/mode0755; do not change them. Create only a nonsecret
   owned0600 `bridge.json` containing the exact approved native origin and
   workspaceId/homeId, and nonsecret `launch-spec.json` with configured,
   expectedVersion and the existing registration ID. No native cookie file.
4. Qualify genuine normal canonical HTTPS `/auth/proxy` session and scoped
   Editor `/admission` reads through the real gateway. Cookie/CSRF remain only
   in bridge memory. No direct Unix identity headers, fabricated proof, password
   extraction, additional membership or private cookie persistence. A200 auth-mode
   read, source presence or loopback health is not this qualification. No live
   write for testing.
5. The wrapper constructs only the inspected0.0.14 argv: official host root
   `https://api.openai.com` (no /v1/dev path), existing registration, runtime key
   `env:CONTROL_PLANE_API_KEY` reference, exact pinned Python stdio launcher,
   max native concurrency/inflight1, initialized-notification shim, health
   `127.0.0.1:0`, private state `health-url`, info JSON logging. It accepts no
   arbitrary control-plane URL/argv from config. No unadvertised process PID
   flag, mTLS, CA, proxy or cloudflared settings. The example stays configured:false.
6. After separate staging review, the user runs the setter in their own trusted
   Mac Terminal over existing SSH with an allocated TTY (`ssh -tt`, never -n/-T).
   Preserve existing alias/host verification and NAS-owner options BatchMode=yes,
   StrictHostKeyChecking=yes, UpdateHostKeys=no, ControlMaster=no, ControlPath=none.
   Use the exact pinned Python above with `-I -B` and absolute staged top-level
   `key-entry.py`; no secret value appears in the command. User reports only
   “stored”. Nothing in this artifact collects the value through chat.
7. NAS-owner readiness checks examine only key existence/type/UID/link/mode,
   never key bytes or a key-derived fingerprint. Activation, LaunchAgent creation,
   rollback and acceptance remain the NAS owner's separate work. This artifact
   creates no plist or listener. LaunchAgent owns process identity.

Health checks use only a validated owned loopback base URL from `health-url`,
GET `/healthz` and `/readyz`, status only. No UI/metrics call is needed.

## Key and session custody

`key-entry.py` requires UID/EUID502, canonical parents and an owned0700 config
root. Mandatory `/dev/tty` has no stdin/getpass fallback. It switches to bounded
noncanonical noecho input, verifies ECHO/ECHONL/ICANON are disabled, drains any
rejected line through newline while staying noecho, then restores terminal state.
The raw bounded printable key is create-only O_EXCL/O_NOFOLLOW mode0600, one
link, UID502, complete writes and file/directory fsync. No replacement, retry,
partial-file deletion, secret/fingerprint output or service activation.

The wrapper reads raw key bytes with no shell source/eval and passes them only
in the existing tunnel client's CONTROL_PLANE_API_KEY environment. No key belongs
in argv, plist, launch spec, logs or receipts. The stdio launcher drops that
runtime-key environment before executing the bridge with minimal environment.
The bridge itself obtains native sessions normally through the canonical gateway,
checks issued/current actor and scoped authority, reissues only between independent
actions as needed, and attempts normal logout on EOF/termination/hangup. It does
not accept, extract or persist a native cookie. Native logout failure stays
unconfirmed and credentials are discarded from memory.

## Remaining owner qualifications

- Source coordinator retains sole merge ownership. Admit/re-pin only the nine
  isolated bridge rows and exact reviewed bytes; preserve every prior manifest
  row/owner and obtain exact new candidate review/CI. No backend/frontend,
  auth/session policy or workflow ownership is released.
- Actual canonical one-home origin, gateway session/admission and executable
  contracts require NAS verification; no runtime qualification occurred in cloud.
- Binding remap requires a genuine exact-impact confirmation owner. Retained
  reconciliation can establish native commit without proving original HTTP or
  Media delivery/retry safety. Original intents>16KiB remain held after uncertainty.
- Qualified asset upload and scene-association creation remain separate native
  custody integration gaps; no generic write claim or invented receipt fills them.
- Full document semantic parsing and PR198 unified scene features remain separate.

Version-matched reference:
[0.0.14 configuration](https://raw.githubusercontent.com/openai/tunnel-client/v0.0.14/docs/configuration.md).
The NAS owner's inspected installed run-help remains authoritative for flags.
