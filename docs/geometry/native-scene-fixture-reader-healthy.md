# Synthetic fixture reader and drawing browser example

This standalone example checks the retained electrical fixture reader added at
published dev commit `12044d16f80a65050392d34b15c93a955adba4b2`. It exercises
the actual `createNativeSceneSourceClient`, `ElectricityFixtureDiagram` and
`ElectricityDrawingViewer`, with their unchanged production CSS. It is separate
from ordinary CI. Its exact entrypoint is
`frontend/lantern-tests/native-scene-fixture-reader-healthy.mjs`.

The generated v2 text source contains three synthetic rooms, two distinct
drawings and two socket symbols. A fake current document port supplies its Blob,
evidence/asset identity and exact revision `9007199254740993`. An independent
synthetic selection supplies accepted room anchors, room mappings, both current
scene-document evidence pins, receipt pins and a matching fake geometry frame.
The production reader checks the exact room, full ordered anchor membership,
source-document pair and package key/UUID before projecting a nullable native
Atlas ID. It keeps a null target package-only, rejects a wrong package target,
reordered anchors and mismatched evidence IDs, and preserves the legacy
package-only selection shape. The fixtures include two accepted anchors for one
room. A production topology resolver is exercised against synthetic current
membership: current reviewed membership resolves the ID, while stale reads,
another building, missing membership and unmatched rooms expose no native
action. The source reader preserves the Atlas schema's full 512-character
source-anchor identifier bound. The actual details component is server-rendered
to check its visible current Atlas label, ID, classification and selection
control. Normal disposal releases all three original leases and removes all
subscriptions.

The browser fixture provides a small room selector and an explicit test-host
resolver from `(sheetId, page)` to generated Alpha/Beta SVG images. These are
test ports, not a production media grant or durable association implementation.
Documentary photo names and hashes never become URLs. Source-reader output has
no diagram registration, physical coordinate, wire route or verified current
circuit; these historical qualifications are asserted.

At widths 1280, 390 and 312 pixels, the browser runs the same named positive
flow. It checks Alpha's associated region, selects Beta through the room
control, selects its actual SVG fixture by keyboard and changes/fits the
diagram viewBox. It opens Beta's source through the production source button,
checks the exact callback and loaded image, and exercises viewer zoom in/out
and Fit. Escape and the close button both return focus to the connected source
opener. Tab and Shift+Tab wrap within the viewer. The production region selector
also permits deliberate Alpha documentary browsing while Beta remains the host
room. Selecting Unmatched afterward displays the explicit no-associated-region
state, with no fixture, source-opening action, modal or default first drawing.
Horizontal document/dialog overflow and listed controls' bounds within the
viewport and dialog are checked. Vertical image/content clipping is unqualified.

## Exact local commands

Inspect the complete runner and its listed production imports before executing.
Use Node 26.10.0, npm 11.19.1 and the locked frontend installation. No new
dependency, alias, workflow or production file change is required:

```sh
npm ci --prefix frontend --ignore-scripts --no-audit --no-fund
node --check frontend/lantern-tests/native-scene-fixture-reader-healthy.mjs
HOUSEATLAS_CHROMIUM=/absolute/inspected/chromium \
HOUSEATLAS_FIXTURE_EVIDENCE=/absolute/private/fixture-reader-result \
node frontend/lantern-tests/native-scene-fixture-reader-healthy.mjs
```

`HOUSEATLAS_CHROMIUM` selects the explicitly inspected browser executable.
The runner uses an owned headless Chromium profile, numeric loopback HTTP on an
ephemeral port, static built source and locally generated images. It uses no
TLS bypass or existing browser profile. Chromium runs with `--no-sandbox`, as
the existing isolated browser runners do; this qualifies only disposable
synthetic content. Background networking is disabled, and observed application
requests must remain on the owned loopback origin. No provider transport or
external fallback exists in the fixture. Runtime exceptions fail the check.

The optional evidence directory must be outside the source checkout; select an
owned private directory because existing directory permissions are not verified.
It receives
`result.json` and diagram/viewer/unmatched screenshots for all three widths.
The report records the current Git HEAD, original dev base, runner digest,
production module digests, Node/browser versions, assertions and cleanup.
These are observed provenance, not automatic acceptance of a later source pin.
Keep the report and screenshots outside Git. Browser, listener, generated
modules and scratch profile are owned and removed after success or failure;
the execution budget is 120 seconds. Existing processes and state are untouched.

If browser execution is unavailable, explicitly select the narrower check:

```sh
HOUSEATLAS_FIXTURE_EVIDENCE=/absolute/private/fixture-reader-only \
node frontend/lantern-tests/native-scene-fixture-reader-healthy.mjs --reader-only
```

That mode reports `reader-only`, runs the actual reader through its fake ports,
resolves synthetic current topology membership and server-renders the actual
native room details component. It performs no browser, interactive DOM,
screenshot, keyboard or responsive qualification. Never describe it as browser
coverage.

## Qualification and integration handoff

The inspected cloud run used Node 26.10.0 and Chromium 151.0.7922.173 on Linux.
The retained-reader positive and all three browser widths passed; the screenshots
include the actual rendered drawing at 312 pixels. One earlier harness attempt
omitted Enter's character payload and stopped before the source callback. Adding
the complete CDP key payload made the native button activation pass. No production
reader, diagram, viewer or stylesheet was changed to obtain that result.

Unavailable here: the real application's complete room/node navigation mount,
native evidence-to-asset resolution, durable backend associations and their
readback, actual media authorization/delivery, retained household originals,
PDF iframe/browser controls, physical iPhone/Safari, real-device touch, NAS
availability, Mac continuation, deployment and user acceptance. The test host
resolves generated SVG images, so its success cannot establish that the reported
household drawings now open. It supplies focused regression coverage for the
reader/component seams the integrator must compose with those owner APIs.

The isolated projection donor updates the association/source read projection,
native scene details UI, this named synthetic reader, README command
registration and only its own publication-manifest rows plus aggregate digest.
It does not move dev/main refs, merge, deploy, change credentials/access, ingest
household data or execute recovery.
