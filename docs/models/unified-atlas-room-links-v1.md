# Reviewed unified Atlas room links

The source owner may select an independent documentary identity map for the
selected overview and semantic companion. This map is separate from producer
native IDs or historical binding status. It grants no native authority.

Use paired optional server arguments:

```text
--atlas-room-links-manifest /canonical/private/publication/reviewed-room-links.json
--atlas-room-links-manifest-sha256 <exact SHA256>
```

The map is a bounded owned regular single-link file, mode 0600, sharing the
canonical 0700 parent of the selected scene and overview. Its closed JSON is:

```text
{profile:"houseatlas.unified-atlas-room-links.v1",
 workspaceId,homeId,publicationId,semanticsSha256,
 links:[{roomId,nativePlaceId,packagePlaceKey,packagePlaceUuid}]}
```

The limit is 1 MiB and 2,048 links. Room IDs are unique and native/package
triples are unique. IDs are bounded source ASCII; native/package UUIDs and
digests use canonical forms. Scope, publication and semantic digest must match
the selected scene. Each linked room/native ID must occur in that scene. These
are consistency checks; the host still selects the map from an independent
source-identity review, never by copying producer IDs, labels or coordinates.
Keep populated household maps outside Git.

The existing same-origin authenticated native Read boundary serves:

```text
GET /api/atlas/models/v1/workspaces/{workspaceId}/homes/{homeId}/atlas/{publicationId}/room-links?expectedSemanticsSha256={sha256}&expectedSelectionRevision={revision}
```

Query order is exact. A missing selected map yields authenticated 404; changed
or mismatched source/selection yields 409. The response is the exact pinned JSON
with content type/length, `Content-Digest: sha-256=:base64:`,
`x-atlas-selection-revision`, private/no-store and nosniff headers. Read
authorization and selected source identities are checked before delivery and
again after response preparation. The overview, ReadyView and scene descriptor
closed shapes are unchanged.

The source-only publication validator also accepts paired optional
`--atlas-room-links-manifest` and `--atlas-room-links-manifest-sha256` arguments
beside its four required overview/scene options. It checks pinned artifact
membership and identity consistency, with no server, account, session,
database or provider access. This cannot establish current native membership.

The actual host supplies a successful owned read as
`getContext().reviewedRoomLinks` to `createUnifiedAtlasOverlaySource`. It reuses
the canonical native session/view/admission and dedicated native document
owners. Keep the captured scene-selection and publication-room allocations
stable. Scope/session/selection/map changes withdraw the old frame before a
replacement. Missing linkage stays unavailable.

Only the adapter's actual current association, exact reviewed room/package/native
join and retained original document owners can qualify runtime room summaries.
The current-head monitor and `isCurrent`/invalidation fences remain required.
Producer status is immutable; no occurrence placement, physical registration,
live telemetry or current native authority follows from this map alone.
