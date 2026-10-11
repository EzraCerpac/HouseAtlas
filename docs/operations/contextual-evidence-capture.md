# Contextual evidence capture

This development donor adds one shared desktop/mobile web flow through the
existing qualified PlaceEditor and multipart upload route. Add evidence opens
for the selected source-bound Atlas place and obtains current admission. It is
unavailable for contexts that the host cannot qualify. It adds no native wrapper,
QR flow, utilities view, service worker, local persistence, OCR or scanner.

## Native Media 0.1.2 policy

One file per explicit submission, nonempty and at most 10 MiB. Native Media now
accepts PNG, JPEG, PDF and UTF-8 text. PNG retains existing validation and optional
stripped preview behavior. JPEG uses pinned zune-jpeg 0.5.15, default features off,
std only: strict full-decode validation, safe code paths, maximum dimension 16384,
25 million pixels, at most 100 scans and at most 75 million requested RGB bytes.
The decoder has internal scratch allocations; the RGB bound is not peak memory.
Its synchronous call has no cancellation callback. WorkBudget checks surround
decoding and can withhold success after a deadline; they cannot interrupt it.
Target memory/CPU and concurrency remain unqualified.

JPEG is an unchanged original for download only. It creates no preview proof,
renderer artifact or inline image. PDF framing and UTF-8 checks remain unchanged;
they do not certify PDF document safety. Existing fixed attachment filenames,
private no-store, sandbox CSP and nosniff delivery remain in effect. The separate
JavaScript Media 0.1.1 reference remains its PNG/PDF/text subset; its APIs and
tests are not widened or claimed to accept JPEG. Older native Media cannot read
new JPEG asset records; an older binary alone is not a post-write rollback plan.
This donor supplies no deployment, migration, rollback or production acceptance.

## Selection and provenance

Take photo uses a native file input with capture=environment. Choose photo uses
an ordinary photo picker; Choose file or PDF uses an ordinary supported-file
picker. Only the user's activation opens a picker. There is no getUserMedia,
automatic camera permission or background capture. The camera setting is a hint,
so a camera-request claim does not prove a fresh camera capture.

EvidenceSelection retains the exact browser-returned File as original. Client
selection checks size, filename, leading format and strict UTF-8 text. Empty,
generic application/octet-stream, or JPEG alias MIME labels may be replaced by
the detected canonical label in a new File wrapper, with identical bytes and
lastModified. Conflicting formats are rejected. Actual Media byte validation
and measurement remain authoritative. No app conversion, resizing, rotation,
EXIF parsing, metadata removal or compression changes the original.

The browser may itself transcode Camera/Photos files before returning File.
Therefore browser-returned-unmodified is a caller claim about app handling,
not proof of a device original. Embedded metadata is retained in the returned
bytes. BrowserSelectionClaim v1 records the requested picker path, local claimed
selection time, original selected filename and reported MIME. The claim creates
no storage identity, capture authenticity, physical fact or authorization.

Legacy multipart metadata1 has no claim. Metadata2 requires a closed claim1.
Both fresh and reused-original builders preserve it as opaque unverified text:
`Browser selection claim v1: {JSON}` in the existing provenance.vantage field.
No authority consumer parses that string. factAt remains null, evidence basis
unknown, and retrievedAt remains the server intake time. The original frozen
Atlas schema, generated DTOs, stock resource pins and numeric validator stay
byte-identical, so an old Atlas reader can read this provenance string.

Picker cancellation preserves the selected File and other form values. Each
successful selection clears the native input so the same file can be selected
again. Unsupported/replaced selection clears the prior upload candidate;
Remove file clears it explicitly. Async selection is discarded on close/unmount.
Only Upload evidence creates a fresh request. Submission is locked synchronously
against a second foreground handler. A lost/aborted result remains unconfirmed;
it never implies rollback or permits an automatic retry. The existing flow
requires reloading saved information before another attempt.

## HEIC and iPhone acceptance still open

HEIC/HEIF is unsupported in this donor, including a misleading image/jpeg label
on HEIF bytes. It is not silently uploaded or relabeled. Export JPEG/PNG is an
explicit user workaround, not completion of normal iPhone Photos acceptance.
[HTML file upload](https://html.spec.whatwg.org/multipage/input.html#file-upload-state-(type=file))
and [HTML Media Capture](https://w3c.github.io/html-media-capture/) specify hints,
not returned representations. [Apple's HEIF guidance](https://support.apple.com/en-us/116944)
documents High Efficiency and Most Compatible camera settings, not Safari picker
conversion guarantees. WebKit's picker implementation varies its representation
preference; this is implementation evidence, not a public Safari format contract.

Genuine iPhone Safari and standalone acceptance must record returned file type,
name, signature and byte digest for Camera, Photos and Files, with High Efficiency
and Most Compatible, on the intended iOS/Safari versions. No device test or private
capture was performed for this donor. A browser scanner enhancement remains staged.
VisionKit is a native API, not a web API exposed by this flow.

A future HEIC path needs reviewed container/decode bounds and immutable source
byte custody. Any converted rendition needs a separate artifact identity, parent
original reference/hash, explicit transform/version and provenance. Browser Canvas
is not a server validation boundary. No cloud converter or external OCR is added.

## Draft interface

Capture owns selection and foreground upload only. The separate draft owner owns
opt-in storage, account/session/home isolation, eviction, explicit foreground
review and conservative unknown-attempt persistence. Its structural selection
seam is EvidenceSelection; its foreground result is UploadPlaceEvidence with the
same optional claim. It never invokes upload. Fresh loadPlace and current session
review are mandatory, then beginAttempt persists immutable fresh IDs and unknown
outcome before the UI invokes upload once. Capture does not serialize guards,
admission, CSRF, cookies, session objects or an automatic retry. Coupled draft/UI
integration requires both independently reviewed donor pins; it is not included.

## Exact synthetic verification lanes

Inspect every runner and imported helper before use. These named cases stay
outside ordinary CI. Use a dedicated Cargo target, fresh disposable state and
synthetic fixtures only; no provider, private file, real camera or recovery.

Healthy source examples:

```sh
cargo run --offline --locked -p houseatlas-backend --example healthy-contextual-evidence-capture
node frontend/capture-evidence-tests/selection.mjs
HOUSEATLAS_BINARY=/absolute/isolated/houseatlas HOUSEATLAS_CHROMIUM=/absolute/chrome node tools/rust-integration/healthy-contextual-capture-loopback.mjs
```

The native example validates five generated originals and actual vault identities.
The browser runner uses actual disposable loopback TLS/React/native upload,
explicit editor login and one foreground POST per intent. It checks original
download bytes and opaque provenance for JPEG/progressive JPEG/PNG/PDF/text, then
a second fresh JPEG evidence intent with original reuse. Off-origin page requests
are blocked; camera input receives synthetic files without opening a camera.

Separately reviewed denial/failure cases, each invoked individually:

```sh
cargo run --offline --locked -p houseatlas-backend --example healthy-contextual-evidence-capture -- --case reject-unsupported-heic
cargo run --offline --locked -p houseatlas-backend --example healthy-contextual-evidence-capture -- --case reject-malformed-jpeg
cargo run --offline --locked -p houseatlas-backend --example healthy-contextual-evidence-capture -- --case reject-malformed-png
cargo run --offline --locked -p houseatlas-backend --example healthy-contextual-evidence-capture -- --case reject-malformed-pdf
cargo run --offline --locked -p houseatlas-backend --example healthy-contextual-evidence-capture -- --case reject-malformed-text
cargo run --offline --locked -p houseatlas-backend --example healthy-contextual-evidence-capture -- --case reject-oversized-file
cargo run --offline --locked -p houseatlas-backend --example healthy-contextual-evidence-capture -- --case reject-pre-cancelled-budget
node frontend/capture-evidence-tests/selection.mjs --case reject-heic
node frontend/capture-evidence-tests/selection.mjs --case reject-conflicting-mime
node frontend/capture-evidence-tests/selection.mjs --case reject-malformed-text
node frontend/capture-evidence-tests/selection.mjs --case reject-oversized-file
node frontend/capture-evidence-tests/selection.mjs --case reject-empty-file
node frontend/capture-evidence-tests/selection.mjs --case selection-abort
HOUSEATLAS_BINARY=/absolute/isolated/houseatlas HOUSEATLAS_CHROMIUM=/absolute/chrome node tools/rust-integration/healthy-contextual-capture-loopback.mjs --case picker-cancel-and-repeat
```

No aggregate test discovery, held adversarial/private-intake/omission controls,
replay, expiry, revocation, crash, recovery or deployment case is executed. The
picker case uses cancellation events and a narrow mobile viewport in Chromium;
it is synthetic mobile-emulation evidence, not an iPhone interruption result.
Root retains README/CI/publication-manifest ownership and must qualify composition.
