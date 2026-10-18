# Optional MCP maintenance composition

The existing bridge's `Stdio` and `serve` accept an optional in-process
`maintenance` owner. Only an explicitly injected `MaintenanceOwner` advertises
the three fixed `houseatlas_update_check`, `houseatlas_update_apply` and
`houseatlas_update_status` tools. The existing installed `main` and its origin /
native-scope configuration still create no such owner. This source does not
install a command or grant maintenance authority to an Atlas Editor.

The trusted host composes the same updater `Controller`, acquisition/verifier,
runtime/publication/health adapters and journal used by other callers. It then
constructs `MaintenanceOwner(controller, authorize=...)` and passes it to
`serve(..., maintenance=owner)`. The separate maintenance authorizer must bind
the exact command, request bytes, selected release, target and action-time
approval. It cannot infer this authority from native read/write admission.
The public request accepts no URL, path, command, service, account or config.
No dynamic adapter import or subprocess is added to the bridge.

MCP handshake and native session custody remain separate from maintenance. A
maintenance call does not log into, refresh or log out the native session.
The tool result retains the updater result: `ok` means handled, while
`status.phase`, `healthVerified` and `recoveryNeeded` describe the update outcome.
Caller timeouts do not authorize resending an apply. Use its original operation
ID for status; a historical success is not a fresh target-binding observation.
The host must qualify an invocation budget covering acquisition, stop/start,
health and any recovery attempt before installing this synchronous adapter.

## Exact generated positive

Inspect `bridge.py`, `test_maintenance_happy.py`, the imported updater controller,
CLI, maintenance owner/dispatcher and existing `tests/synthetic.py`. From
`tools/houseatlas-mcp-bridge`, run:

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=../houseatlas-updater:../houseatlas-updater-adapters python3 -m unittest test_maintenance_happy.MaintenanceHappyPath.test_mcp_generated_check_apply_and_retained_status -v
```

One generated in-process MCP stream initializes, lists the optional tools,
checks a generated bundle, applies it once through the real controller, then
reads its durable result. The fake native/world owner creates only disposable
local files and a nonexecutable Mach-O header specimen. Assertions cover exact
authorization bytes, the existing default capability boundary, a single
stop/publish/start/health sequence, unchanged native fixtures and prior code.
No socket, external request, real build/native binary, NAS, native login, service,
credential, denial/failure/replay/crash/rollback control or broad suite runs.

Real installation still requires a trusted native-build/storage mapping, an
approved immutable release, bounded address/trust preparation, canonical legacy
onboarding, real read-only native peers and existing process/lease/launch/CAS /
readiness bindings. Persistent maintenance authority or new access needs its
specific action-time approval. This source and generated check establish none
of those runtime gates and perform no update.
