# Scoped wire3 reads

Call `houseatlas_capabilities` first. It returns `scope` and `admittedReads`.
Use a command only when it is currently admitted. `houseatlas_read` takes one
`requestJson` **string containing the complete wire3 request**, not a JSON-RPC
message or a nested `request` object. Serialize the DTO below into that string.

The [checked-in example](read-examples.json) is wholly synthetic:

```json
{
  "schemaVersion": 3,
  "commandId": "atlas.evidence.list",
  "requestId": "00000000-0000-4000-8000-000000000101",
  "context": {
    "workspaceId": "00000000-0000-4000-8000-000000000001",
    "homeId": "00000000-0000-4000-8000-000000000002"
  },
  "target": {"authority": "atlas", "recordType": "evidence"},
  "payload": {"cursor": null, "pageSize": 1, "includeArchived": false}
}
```

For actual authorized use, replace `context` with the exact capabilities `scope`
object, containing only `workspaceId` and `homeId`, and generate a fresh canonical
UUID for `requestId`. Never copy the synthetic IDs or infer resource IDs from
names. Evidence listing needs no building identity: its closed `target` has no
`buildingId` or `recordId`. The bridge's `Wire3 scope differs` preflight also
checks that the DTO is an object and `schemaVersion` is exactly 3. Do not rename
`context` to `scope`, wrap it, or add keys.

Start with `cursor: null` and `pageSize: 1`. The bridge permits page sizes 1–8,
although the canonical schema permits 1–100. `includeArchived` is required;
optional `q` is a string of at most 255 characters. For each subsequent page,
carry the returned `data.nextCursor` unchanged, keep the same scope/target/query
and page size, and use a fresh request UUID. Stop at `nextCursor: null`; an empty
record array does not establish that an earlier incomplete scan was complete.
Cursor tokens are owner-issued correlation, not authority; do not fabricate a
token or assume it survives a changed snapshot/session or restart.

Correlate `schemaVersion`, `requestId`, `commandId`, `resolvedScope`, `status:
"read"` and `replayed: false`. These fields are checked by the bridge. Domain
validation and cursor/snapshot matching remain with the native owner; the bridge
does not independently validate every DTO target or enforce cursor lineage.
Responses are bounded to 2 MiB, with JSON node/depth and envelope/query bounds.
An oversized single record has no qualified chunked read owner through this
generic tool; reducing page size cannot split that record. Do not infer completed
download, media custody or retry-safe writes from a successful list.

If building identity is needed for a separate admitted scene/evidence tool,
discover it through admitted `atlas.location-semantics.list` (same envelope,
`target.recordType: "location-semantics"`). Active accepted rows with
`payload.semanticKind: "building"` reference the identity in `payload.atlasId`,
not the semantics row's `target.recordId`. Confirm that ID with admitted
`atlas.identity.get`, target `{authority:"atlas",recordType:"identity",recordId:...}`
and payload `{}`: it must be active with `payload.kind: "location"`. Ambiguous
accepted semantics remain a conflict. If either command is unadmitted, stop that
discovery step; evidence listing itself does not require those commands.

## Synthetic regression lane

The existing explicit bridge selections now consume `read-examples.json`:

```sh
python3 tools/houseatlas-mcp-bridge/test_bridge.py healthy_large_read_page
python3 tools/houseatlas-mcp-bridge/test_bridge.py denial_read_profile_bounds
python3 tools/houseatlas-mcp-bridge/test_bridge.py denial_read_correlation
```

They use fake GET/session/admission owners and disposable synthetic journal
state, with no provider or native service. They check raw envelope forwarding,
returned cursor reuse, closed scope, page bounds and result correlation. These exact three selections now run in the existing ordinary-core job under
the owner's finite 28 October 2026 exception. All other bridge controls remain
separately selected and excluded from that exception. The assertions are unrun
locally at publication; hosted case logs must establish actual execution. No live capability probe,
credential, grant, connector deployment or browser/device acceptance follows.

See the native [versioned source matrix](../../backend/src/transports/mcp/README.md#catalog-to-admission-parity-version-3)
for static catalog versus actual admission/dispatch boundaries.
