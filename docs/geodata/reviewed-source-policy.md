# Reviewed original-source policy

`storage::geodata_policy::PinnedGeodataSourcePolicy` implements the existing
`GeodataSourcePolicy` port with an exact, immutable private allowlist. A trusted
host selects the approvals. No HTTP request supplies them and no route edits
them. The policy issues no native grants, credentials, source registrations,
physical bindings or permission to fetch a URL.

Each approval pins the native home scope, allocated Document ID, complete
original Asset pin, one of the six supported MIME types and exact provenance.
The constructor independently derives the same canonical custody receipt hash
as native original intake. It validates the v2 Asset pin and provenance shapes.
On every callback it uses the borrowed native guard to require current Read or
Mutate authority, then compares the exact Document, scope, original pin and
provenance. It performs no independent filesystem/network work or Access/Store
lock reentry.

The source manifest digest records the reviewed input's custody. A digest does
not authenticate its origin, establish a licence or confer source authority.
The selecting operator must retain the reviewed manifest and the approval that
binds it to the exact home and source files. Recovery does not reconstruct that
operator configuration or any native session or grant.

## Trusted configuration shape

`ReviewedSourceManifest` has exactly these fields:

```text
profile: "houseatlas.reviewed-document-source-policy.v1"
scope: {workspaceId, homeId}
sourceManifestSha256: reviewed input's exact lowercase SHA256
documents: [
  {
    documentId: allocated native Document UUID,
    original: {assetId, revision, sha256, bytes},
    contentType: declared original MIME,
    provenance: native intake provenance without custodyReceiptSha256
  }
]
```

`from_reviewed` accepts the typed value. `decode_reviewed` accepts bounded JSON
from trusted host configuration and rejects duplicate keys before typed decode.
Both refuse unknown fields and invalid shapes. Configuration is bounded to 512
approvals, 4 MiB total and 32 KiB per provenance value. The final full-profile
host must explicitly select this policy; there is no permissive default.

Allocate Document and Asset IDs in the private intake plan before policy
selection. Do not substitute a building, room, geometry-package or source-file
identifier for a native home or Document ID. This policy does not infer any
physical association. Original bytes and measured MIME still pass the existing
native intake validators and are retained through the original vault.

## Licence and provenance qualification

Retain the source's declared licence at its actual scope. An upstream dataset
claim may accompany a retained original response from that dataset. It does not
independently license local provenance JSON, a wrapper, a composite derivative,
catalogue or prepared image. Preserve those files and their recorded input
claims without assigning them a standalone licence by analogy. Use explicit
unknown/null where no standalone licence is established. Do not downgrade a
known upstream claim merely because legacy assets used unknown licences.

This is a metadata qualification performed from the authorized source manifest,
per-file hashes, recorded response metadata and private custody. It requires no
new user choice when those facts are already established. Missing facts remain
unknown. This implementation makes no legal determination or geometric claim.

MIME follows validated bytes and recorded response type; a filename or nested
CityJSON object does not turn a JSON response wrapper into top-level CityJSON.
Preserve original source dates, retrieval dates, CRS, axis and unit declarations.
Do not invent missing dates, transforms, frames or elevations.

## Deliberate limits

This policy qualifies original source authority. It cannot qualify a derivative
or issue an inline preview capability. The selected Document profile separately
checks every preview's shape, exact bytes and retained derivation proof. The
fresh profile still requires `preview: null`; a full profile can enable a native
renderer only through its independently verified preview implementation.
The source policy permits title and lifecycle edits and explicitly approved
original associations. Provenance is
frozen to the reviewed value. A later correction workflow must explicitly retain
approval for both the before and after provenance; replacing this allowlist with
only a corrected value cannot authorize the old record required by CAS.

A revised source file has a new original pin and uses new native identities.
The policy does not transform old custom mesh, USDZ or evidence Assets into
Documents and does not change their purposes, preview policy or licence claims.
Changing a policy requires a new reviewed host selection; it is not a native
record mutation or an automatic consequence of an uploaded manifest.
