# Room drawing source action

A room's electrical sheet can open a verified reference PDF through the current
native evidence-document owner. PDF policy remains download-only. The dialog
labels the sheet's reference page and offers **Download reference PDF**; it
does not embed the PDF or imply that a browser has rendered that page.

The host supplies an optional NativeSceneSourceSelection.drawingReferences
array, independently reviewed outside the retained scene text. Each entry has
a bounded correlation ID and SHA-256; current workspace, home, building and
view key; exact scene evidence/asset IDs, revisions and original SHA-256; exact
sheet ID, page and original/rendered photo SHA-256; and expected native PDF
evidence/asset IDs, revisions, original SHA-256 and byte size. Revisions and
size use ExactDecimal where the native asset contract does.

The existing v1/v2 retained scene formats and documentary ledger stay unchanged.
The source reader stamps every new host pin for currentness. It projects only
references matching the current selection and parsed fixture sheet, rejects
ambiguous duplicate sheet joins, and bounds originals to 10 MiB. Missing or
stale qualification gives no PDF action. Names, MIME, page numbers and matching
photo hashes alone cannot select a PDF. The correlation digest identifies a
separately reviewed host proof; it is not an authorization grant or a new native
receipt. The host must obtain that proof from actual custody/readback and
maintain the selection's owner fence.

On the room source action, the UI requires the pinned evidence ID in the current
building's evidence list. Its fresh NativeEvidenceDocumentClient.open resolves
the genuine evidence/asset join and verifies original bytes under existing
HTTP/media policy. Before exposing a Blob URL, the dialog checks the returned
evidence/asset IDs and revisions, PDF hash and size, PDF MIME, original purpose,
download-only mode/policy, and Blob MIME/size against the host reference. Wrong
or unreadable correlation shows an unavailable state. There is no upload,
fallback to an arbitrary PDF, page URL, raw storage key or alternate access path.

Without a PDF reference, the existing bounded PNG lookup remains usable:
only a current inline PNG matching the unchanged sheet's rendered-photo hash
can paint. This does not equate a JPEG's hash with a separately derived PNG.

Close, Escape, selection changes, document/source withdrawal and unmount retire
the action, unsubscribe and revoke its object URL, and release the exact frame.
The dialog's focus loop includes the PDF download link or PNG scroll viewport;
closing returns focus to the original source-action control. A stale download
click is prevented even before React's next paint.

The named synthetic checks below compile the actual source reader and React
drawing surface against generated scene data and fake document/geometry ports.
They use the repository's synthetic PDF/PNG and a fresh sandboxed browser with
an owned loopback listener/profile/download directory. The 1280/312 CSS-width
checks cover the dialog/action seam, not the full native room/mesh presentation,
physical registration, real native custody, browser PDF readability or device
acceptance. The PDF check confirms downloaded bytes, rather than claiming an
inline preview. The current native media owner and deployed host still need
their ordinary integration/readback qualification.

Inspect the runner, production dependencies and selected browser executable.
Select exactly one registered case using Node 26.10.0 and cached locked
dependencies:

~~~sh
export HOUSEATLAS_CHROMIUM=/absolute/path/to/inspected/Chromium
export HOUSEATLAS_FIXTURE_EVIDENCE=/absolute/private/NEW-room-drawing-result
node frontend/lantern-tests/native-room-drawing-source.mjs pdf-download
node frontend/lantern-tests/native-room-drawing-source.mjs png-legacy
node frontend/lantern-tests/native-room-drawing-source.mjs missing-correlation
node frontend/lantern-tests/native-room-drawing-source.mjs stale-correlation
node frontend/lantern-tests/native-room-drawing-source.mjs wrong-correlation
node frontend/lantern-tests/native-room-drawing-source.mjs lifecycle
~~~

The last four cases remain in the explicitly scoped synthetic regression lane.
They do not release provider calls, household imports, retries of old UNKNOWN
requests, security bypass, deployment or native data mutation.
