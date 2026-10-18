# Established application readiness reader

`houseatlas_updater_runtime.application_readiness` supplies a concrete typed
reader over `EstablishedNativeReadTransport`. Imports and construction perform
no I/O. This separate leaf installs no runtime binding and changes no bridge,
exports, controller, manifest, shared guide, workflow or running service.

The owner composes it explicitly:

```python
documents = PinnedApplicationDocuments(overview_raw, semantics_raw, room_links_raw)
reader = EstablishedApplicationReadiness(established_bridge, transport, documents)
application = reader.read(original_readiness_request, absolute_monotonic_deadline)
```

Each raw document is `bytes` or explicit `None`. Bounds are 128 KiB for the raw
overview, 12 MiB for raw semantics and 1 MiB for raw room links. Semantics require
an overview; room links require semantics. These must be the exact already
owner-qualified documents admitted by the actual compiled configuration loaders
`backend/src/config/{model_overview,atlas_scene,atlas_room_links}.rs`, with their
actual selected artifact custody and producer approval. The helper checks exact
raw digests against the original `ApplicationExpectations`; caller-supplied bytes
and matching hash strings cannot confer authenticity, compiled GLB/geometry
admission, native identity or producer/source authority.

The transport must be the concrete `EstablishedNativeReadTransport`, constructed
with that same already established bridge. The explicit source seam checks its
private `_bridge` identity and reads its snapshotted `_scope`, `_actor`, `_csrf`
and `_expiry`; those names are part of this reviewed composition, with no new
bridge API or generic exchange provider. Every actual exchange remains in that
transport's fixed route table and single attempt. No URL, header, HTTP method,
path, provider, login, renewal, logout or journal option is accepted here.

The fully configured sequence is ten GETs under one absolute monotonic budget:
session, scoped view, overview descriptor, scene descriptor, selected scene
model, room links, scene descriptor, overview descriptor, scoped view, session.
With no scene the selected model uses the overview-original route instead;
unconfigured owner companions are omitted. The transport retains its 12-request,
72 MiB aggregate and per-route bounds; this reader streams the model in at most
64 KiB chunks and never retains its full body. The worst configured ten-read
sequence fits those bounds. Each JSON response is additionally bounded before
append; duplicate keys, nonfinite numbers, excessive numeric representation,
unpaired Unicode, nesting above 48 and more than 500,000 structural tokens are
refused. Exact decimal comparison avoids float rounding and boolean/integer
equivalence. Checks surround bounded parsing, hashing and structural validation;
Python/OS scheduling and an individual parser/hash operation are not preempted,
and a result observed after the deadline is refused.

The source contracts are the current backend `http/auth.rs`,
`http/mod.rs::browser_view/browser_entry`, `domain/model.rs`,
`domain/projection.rs`, `http/model_overview.rs`, `http/atlas_scene.rs` and
`http/atlas_room_links.rs`, together with `runtime.py::HealthProbe`, inspected
at base commit `d6415aa6e5c60c178b888c15f3cfddcfa8602558`. Contract changes require
reviewing this closed reader against the new source.

The reader checks:

- Actual session schema version, actor, CSRF and expiry against unchanged established
  custody before and after the reads. It adopts no response credential.
- The complete closed current-view DTO, including source keys, native-link
  scopes, retained number tokens, attachments, maintenance, cache partitions,
  dates, errors and unknown/absent extension qualifiers. Scope must match and
  be listed among authorized homes. Current view contents can change naturally;
  the second view must retain the same exact model-selection facet. A ready
  native view can contain stale/error caches; these remain source qualifiers,
  never a claim that upstream inventory or network facts became fresh.
- The entire overview descriptor projection, including its exact fixed href,
  against the raw overview pin and observed view facet.
- Every scene descriptor field against the exact raw companion projection:
  publication/source declarations, frame, buildings, levels, rooms,
  occurrences, mesh bindings, plans, overlays and coverage. Closed structural
  checks supplement this equality; the compiled graph/GLB/footprint validator
  remains required rather than being replaced by a second Python admission
  implementation. Selection/header revisions, overview header and optional
  entry-building reference must agree before and after the model/map reads.
- Actual model length, exact content type, Content-Digest and streamed SHA256.
  Scene models must carry the same selection revision. Overview-only models
  must carry the exact canonical base64url `x-atlas-model-frame` JCS subset.
- Optional room-map exact raw bytes, hash, content length/digest, scope,
  publication, semantics pin, selection revision, closed link fields, unique
  room/triple keys and documentary joins to the pinned scene rooms.

Configured flags are the owner's explicitly pinned obligations: successful
configured reads supply their positive evidence. `None` companions are not
discovered or probed; the HTTP API exposes no scene/map absence facet. Their
configuration absence still requires the native owner's exact argument/config
validation. This reader cannot prove by GET that an unrequested optional
companion is absent. The model availability facet is observed directly.

Returned `NativeReadiness` retains the original `ReadinessRequest` by identity,
including its process object and nonce. Fields come from the actual validated
view/descriptors, streamed bytes and map response. `source_selection_revision`
is the actual scene descriptor's source declaration under its selection; there
is no independent raw source-file/semantics HTTP route, and this is no new source
freshness or source-byte GET proof. Room-map declarations convey no native
binding or maintenance authority. All errors become the fixed updater
`health-failed` result without body, credential, endpoint or exception text.

`PlatformOperations.readiness` still needs owner composition returning `Readiness`
with actual served frontend/saved-index responses and the actual process. This
reader supplies its `application` member only. Existing `HealthProbe` performs
the surrounding installed/native/process checks. Numeric peer and TLS trust
qualification, route-to-process custody, existing native Read/Media permission,
compiled original-Core/full-profile validation, coherent WAL/socket cuts,
maintenance action-time approval and runtime installation remain owner facts.
Actual authenticated GET/session reads can update Access `last_seen`; this is
separate from the SELECT-only compiled native validator. No target action is
authorized by this source.

## Proposed generated check, pending independent review

The integration owner must inspect the full three-file checkpoint, its imported
runtime/core sources and the actual source contracts above before releasing
this exact single ordinary positive. This leaf does not register or execute it.
From the repository root:

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=tools/houseatlas-updater:tools/houseatlas-updater-runtime python3 tools/houseatlas-updater-runtime/tests/test_application_readiness_happy.py ApplicationReadinessHappyPaths.test_established_scope_model_scene_and_room_links -v
```

The generated case uses the actual typed reader and concrete transport with
finite in-process socket/clock/TLS-wrap fixtures. All documents, GLB bytes,
identities, process metadata and session facts are synthetic. It checks the ten
exact requests, full descriptor projections, historical documentary room link,
retained stale-view qualifiers, model/map digests, identity/nonce retention,
unchanged owner fields and decreasing deadline. It also calls the existing
`HealthProbe` typed-evidence check, without its platform/native verification.
The TLS context is a policy object only; no TLS socket/trust query occurs.

The case does not compile or establish native admission, real application
health, process custody, credentials/grants, a runtime binding or deployment.
It adds no malformed, denial, expiry, mutation, omission, concurrency, retry,
failure-injection, replay, crash, rollback, server, network, native, session,
MCP, maintenance, target or broad-suite execution.
