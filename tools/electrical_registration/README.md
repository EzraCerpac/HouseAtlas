# Electrical source registration

Pure offline affine registration and inventory projection. The input adapter owns
source parsing and independently supplied artifact/room/frame observations. This
module reads no files, runs no service and creates no native receipt. Real plans,
point ledgers, room mappings, evidence documents and output stay outside Git.
It does not replace `tools/electrical_registry` or the native source reader.

Inspect `registration.mjs` and `healthy.test.mjs`, then use Node 26.10.0:

```sh
node --test --test-concurrency=1 tools/electrical_registration/healthy.test.mjs
```

These four generated healthy examples exercise a known affine transform,
overdetermined approximate residuals, property-wide inventory with selection
highlighting, and a legitimate documentary-only input awaiting controls. No
malformed, denial, omission, expiry, replay or crash cases are included. This
local task-specific command changes no shared ordinary CI or runtime gate.

`fitAffine(controls)` accepts explicit `id`, `sourcePoint: [u,v]` and
`targetPoint: [X,Z]` pairs. Source coordinates are normalized upright image
coordinates, origin top-left. The returned matrix uses the DOM/PDF convention
`[a,b,c,d,e,f]`: `X=a*u+c*v+e`, `Z=b*u+d*v+f`. Modified Gram-Schmidt QR
fits at least three spanning controls. The result reports every fitted residual,
RMS, maximum, determinant, reflection, singular scales (metres per normalized
source unit), anisotropy and the source control hull. A numerical fit is evidence
about supplied pairs; it establishes neither correspondence nor review.

`assessRegistration(proposal, context)` returns a withheld result with explicit
missing evidence or a reviewed approximate scene alignment. Both retain null
physical registration and false native qualification. The proposal contains:

- `source`: exact `sheetId`, `regionId`, original and rendered photo SHA-256 pins.
- `target`: workspace/home/publication, semantics/model SHA-256, coordinate-frame
  ID, units `m`, horizontal axes `['X','Z']`, room/occurrence/building/level/plan IDs.
- `controls` and `checks`: explicit finite pairs, unique landmark IDs,
  `targetFeatureId`, `reviewStatus: 'reviewed-correspondence'`, and
  `sourceEvidence`, `targetEvidence`, `reviewEvidence` (`sha256` and `locator`).
  At least two held-out checks must use independent identities and locations.
- `reviewStatus: 'reviewed-approximate'`, pinned `reviewEvidence` and nonempty
  dated `layoutQualification` describing historical changes and source limitations.
- `uncertainty`: source normalized `sourceXY`, `targetMetres`,
  `layoutAllowanceMetres`, `residualLimitMetres` and explanatory `basis`.

The independent context supplies `frame` with the same publication/frame pins,
`sources` with exact source tuples, and `occurrences` with the exact target tuple
and `featureIds`. It must come from verified retained bytes. A matching hash
string alone does not verify bytes. The source reader/adapter remains responsible
for artifact digest checking, landmark evidence review and contextual truth;
this pure helper is not an adversarial or native authorization boundary.

`projectInventory(records, assessments, selection)` consumes those assessments
in the same offline context. Each input row has `fixtureId`, the source tuple,
`sourcePoint`, optional `sourceToleranceXY`, and explicit `bindings` containing
room/occurrence IDs plus optional building/level IDs. Additional documentary
fields are retained. Only reviewed approximate alignments whose exact source
and occurrence tuples match can supply `scenePointXZ`. Points outside the
fitted control hull remain unsupported. There is no room-centre fallback.

Tolerance uses absolute affine coefficients times the larger source/row axis
tolerances, plus maximum fitted/held-out residual, target tolerance and declared
layout allowance. These conservative annotation tolerances are not statistical
confidence intervals or physical accuracy. Freehand sketch proportions can make
any global affine fit inappropriate; adequate landmark coverage, held-out checks
and review are still required. PDF image placement and paper perspective
rectification alone do not establish metric wall or fixture distances.

The complete inventory is always returned. Selection adds `highlighted` only;
it cannot remove records or change availability/placements. Counts distinguish
inventory, approximate scene alignment and surveyed placement. Circuit, height,
physical-coordinate and wire-route outputs remain explicit unknowns.
An input carrying known physical/circuit/height/route facts needs a separate
contract; the helper rejects it instead of replacing those facts with unknowns.

Integration must retain the existing native source/current-frame ownership checks.
Historical room UUID equality or proposed cross-namespace links do not create
current native qualification. The existing `ProjectedElectricalFixture` contract
uses SVG display coordinates; `scenePointXZ` cannot be passed to it directly.
The host must explicitly project scene XZ through its current plan/display frame,
carry evidence qualifications, and withdraw stale publication/model bindings.
No reusable source mapper, historical association promotion, source media URL,
accepted registration receipt, physical placement or circuit colour is created.
