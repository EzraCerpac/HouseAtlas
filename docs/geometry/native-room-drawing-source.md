# Room drawing source action

A room's electrical sheet can open a verified reference PDF through the current
native evidence-document owner. PDF policy remains download-only. The dialog
labels the sheet's reference page and offers **Download reference PDF**; it
does not embed the PDF or imply that a browser has rendered that page.

The normal production association constructor supplies these references from a
separately retained, reviewed `text/plain` support original. It uses the existing
two-document native scene-association v1 contract: primary scene text and the
historical documentary support original. Primary scene v1/v2 remains compatible;
ordinary historical text and associations without the drawing-review marker
retain the legacy PNG path.

The new closed `houseatlas.documentary-scene-support.v1` original has exactly
`schema`, `roomMapping`, `fixtureLedger`, `crosswalk`, and `review`. Each of the
last four is a closed `{json, sha256}` pair. Room mapping and fixture ledger retain
their exact original JSON bytes and digests. The parsed room mapping's `receiptId`
must equal the frozen ledger's `roomMappingReceipt.id`; its digest must equal that
ledger receipt's SHA. Original bytes, photo hashes and old receipts stay unchanged.

The crosswalk JSON is canonical, closed and bounded to 128 unique sheet rows:
`profile: houseatlas.documentary-sheet-pdf-correlation.v1`, `correlationId`,
`fixtureLedgerSha256`, `pdf`, and `references`. The PDF pins are workspace, home,
building, evidence ID/revision, asset ID/revision, SHA-256 and byte size. Each row
contains exact sheet ID, PDF page, original-photo SHA, rendered-photo SHA and
embedded-image SHA. Every row must match a unique sheet in the preserved ledger.
The independent review JSON is canonical and closed: `profile:
houseatlas.documentary-sheet-pdf-review.v1`, `reviewId`, `crosswalkSha256`,
`roomMappingSha256`, `sourceReviewJson`, and `sourceReviewSha256`. The last two
retain the original independent review data and its exact digest. These objects
are reviewed evidence data; their fields do not issue a grant or prove approval.
All declared JSON digests are computed from their exact UTF-8 bytes, duplicate
keys are rejected, and the complete support original is bounded to 8 MiB.

A new canonical native room-review receipt refers to the support original SHA.
It does not overwrite the original room-mapping receipt. Preparation freshly
opens the primary/support originals, verifies the unchanged embedded ledger
against the preserved ledger with lossless semantic equality, checks the PDF's
current building evidence membership, and admits the real PDF through a separate
native document owner. The review surface displays the exact support, crosswalk,
review, PDF and sheet/page pins. It requires a deliberate checkbox before
submission, and the client refuses support-bearing commands without explicit
confirmation. Existing room-only submit callers remain compatible.

Preparation adds a deterministic bounded suffix to the native review statement:
`[HouseAtlas drawing review v1 support:<SHA> crosswalk:<SHA> review:<SHA>]`.
The full statement must remain within 4096 characters; it is never truncated.
The current constructor only issues PDF references when the accepted native
statement ends with the exact verified marker. It freshly reads the pinned
support original and current building identity, then decorates the exact rows
with actual current primary scene and view pins. A factory provides independent
document owners; an association read cannot replace an active scene or review
lease. The source reader freshly reads and retains its own support lease, checks
the current primary's unchanged ledger, and withdraws on support invalidation.
Only this verified bridge permits the historical ledger receipt during parsing;
the view projection retains an explicit historical receipt and unchanged ledger-digest
sidecar alongside the current native room review used by room filters. The drawing
source disclosure labels both receipts separately; it never describes the projected
room-filter receipt as a rewrite of the frozen ledger.

The v1 backend attests the support bytes and accepted native association review.
It does not establish a new semantic PDF-correlation guard. The independent
review establishes photo/page semantics; fresh native document access establishes
current PDF custody. Missing, unreadable, unreviewed or stale support grants no
PDF action. No MIME/page-only search, stored source-v3 carrier, physical floor
assignment, native room creation or replacement receipt is introduced.

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

The named synthetic checks below compile the actual production association constructor, source reader and React
association review/drawing surfaces against generated scene data and fake native-shaped current records and document/geometry ports. The PDF case
verifies the new native review receipt with an unchanged old ledger, missing
review-marker withholding, explicit preparation confirmation, and one local fake
POST retaining UNKNOWN after a deliberate synthetic transport stop.
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
