# Native Document reader boundary

The v2 Document API supplies a dedicated native source-document reader. It does
not use the fictional Library sheets, HomeBox attachment identities or the
scene-evidence lookup contract. The actual routes and byte frame are specified
in `native-document-persistence-v2.md`; a full-app host must explicitly select
the compatible dataset before those routes exist beside the legacy app.

This document defines the consumer boundary. The frontend implementation is
`frontend/integration/native-source-document-reader.ts` with the
`SourceDocuments` view in `frontend/src/lantern/source-documents/`. The PNG
`/preview` route is mounted only beside a selected full geodata identity.

## Read ports

A host-injected consumer should provide bounded list/get and a leased byte read:

```text
list(cursor?, signal)
get(documentId, signal)
openOriginal(documentId, expectedDocumentRevision, signal)
isCurrent(frame)
getBlob(frame)
subscribeInvalidation(frame, callback)
release(frame)
dispose()
```

`openOriginal` uses the authenticated native original route. Validate the closed
`houseatlas.geodata-document-bytes.v2` frame, exact home/workspace, Document ID
and revision, `mode: "original"`, complete original Asset pin, measured MIME,
Content-Digest, actual SHA256 and measured byte length. Retain exact numeric
parsing and the inclusive 10 MiB bound. Use same-origin credentials, no-store,
redirect rejection, a bounded deadline and before/after Document correlation.
The original pin in list/get does not itself contain MIME: choose a reader only
after authenticating the measured type in the byte frame.

Every displayed frame is leased to the current session, scope, Document revision
and source pins. Subscribe to invalidation before exposing it. On invalidation,
scope/session change, reader replacement, close or unmount, synchronously hide
the displayed payload, cancel owned work, release its frame, destroy PDF tasks
and revoke object URLs. An older asynchronous completion must never republish a
frame. A missing port or unavailable source produces a truthful unavailable
state while preserving independently available operations.

## Viewing a PDF original

The user-authorized document reader may locally render an authenticated PDF
original with the app's existing bundled PDF.js machinery. Name this capability
`original-pdf`; retain the original byte frame and attachment/download delivery.
The Document still has `preview: null` and preview availability `not-qualified`.
Rendering the original locally does not establish a SafeRendered derivative,
server-side PDF safety qualification, source geometry or registration.

Use the existing local worker, decoder, CMaps and standard-font resources. Keep
the reader in lazy chunks and preserve the 4,000,000-byte individual-asset limit.
Disable XFA and worker URL fetching as the existing native drawing viewer does;
do not add external resource fetches, browser plugins, source URL navigation or
automatic link/action execution. Rendering failure leaves the original download
available. This viewer reuses PDF rendering mechanics, not evidence IDs or Stock
client assumptions.

## Images and other source formats

Inline PNG display uses a separately qualified, stripped PNG derivative from
the actual bounded native renderer. The original remains byte-exact and
downloadable. The selected backend must persist the exact input/output pins,
renderer/configuration, qualification receipt and source association, and
revalidate them with native source authority before issuing preview bytes.
A MIME label, PNG upload or receipt digest alone cannot issue that capability.
Do not advertise a preview route before this implementation is installed.

A supplied visualization PNG can be retained as its own original Document and
have that single PNG stripped for display. This proves the image-to-image
derivation only. It does not certify a multi-source GIS conversion or establish
physical geometry, elevations, frames or placements depicted by that image.

JSON, GeoJSON, CityJSON and TIFF originals retain original downloads. A future
visualization requires its actual prepared derivative, trusted renderer and
retained source lineage. Missing derivatives stay unavailable; do not infer them
from a title, file extension, source URL, catalogue screenshot or nearby file.
Display the preserved attribution, licence scope, source/retrieval dates and
declared CRS/axes/units without inventing missing values.
