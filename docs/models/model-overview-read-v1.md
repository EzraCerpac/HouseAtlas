# Selected model overview read v1

This separate read-only service displays an owner-provided provisional overview.
It does not accept a native geometry scene, establish registration, infer geometry,
create Atlas bindings or grant access. The original remains private.

Authenticated current/scoped ready views include `modelOverviewService`:
`{profile:"houseatlas.model-overview-read.v1",available:boolean,publicationId:UUID|null,manifestSha256:SHA|null}`.
Availability is true only for the exact configured selected home and currently
intact immutable publication. Unavailable views carry null pins.

`GET /api/atlas/models/v1/workspaces/{workspaceId}/homes/{homeId}/overview`
returns `{profile:"houseatlas.model-overview-read.v1",scope:{workspaceId,homeId},publicationId,manifestSha256,label,qualification:"provisional-overview",frame,components,original:{contentType:"model/gltf-binary",sha256,bytes,href}}`.
`href` is the same-origin scoped route
`/api/atlas/models/v1/workspaces/{workspaceId}/homes/{homeId}/overview/{publicationId}/original?expectedSha256={sha256}`.

That original GET returns exact pinned GLB bytes with current native Media
authorization and final authorization recheck. Both routes require the existing
native session and Read authorization. Absent or other scoped selections return
404 after authentication; invalidated selections return 409. No substitution,
upload route, native Asset record, stable token or grant is introduced.
Responses use `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`.
Originals additionally carry `Content-Type: model/gltf-binary`, `Content-Length`,
`Content-Digest: sha-256=:BASE64_DIGEST:` and `x-atlas-model-frame` as unpadded
base64url of canonical JSON (lexicographically sorted object keys, compact UTF-8):
`{profile:"houseatlas.model-overview-bytes.v1",scope,publicationId,manifestSha256,original:{contentType,sha256,bytes}}`.

Unique paired serve-only options `--model-overview-manifest` (absolute canonical
private `publication.json`) and `--model-overview-manifest-sha256` (lowercase
SHA-256) select one immutable startup publication, independently of full geodata.
Both direct TLS and trusted gateway hosts compose it; absent options select none.
The selected home must exist in the unchanged server configuration.

The strict manifest is `{profile:"houseatlas.model-overview-publication.v1",scope:{workspaceId,homeId},publicationId:UUID,label,qualification:"provisional-overview",frame:{linearUnit:"m",upAxis:"Y",placement:"baked-in-asset",physicalRegistration:null},components:[{id,kind:"building"|"plot"|"context",label}],sourceNote:string|null,original:{file:"overview.glb",contentType:"model/gltf-binary",sha256,bytes}}`.
Labels contain 1–128 characters; component IDs are 1–128 ASCII letters, digits,
`-`, `_` or `.`. At most 256 components, unique IDs; sourceNote at most 2048
characters. Source IDs never denote native bindings. No unknown or duplicate
JSON fields, credentials, URLs or external references are accepted.
The separate private directory is owner-only 0700; both fixed files are regular,
single-link, owner-only 0600 files without symlinks. It must be outside native
state/media. Directory/file identities and exact hashes are pinned and rechecked
with bounded reads. Manifest is at most 128 KiB and GLB at most 32 MiB.
GLB v2 framing and self-contained JSON/BIN structure are checked; external URIs,
extensions, animations and skins are refused. This is not renderer or physical
qualification. Frontend GLTFLoader preflight remains separate.
