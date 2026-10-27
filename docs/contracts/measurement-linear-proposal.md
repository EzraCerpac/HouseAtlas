# Linear measurement contract preparation (#281)

Unadopted proposal, inspected 25 October 2026 against public main
`b7abc9d87b90d3a6eab9efb386edf252f72daf60`. This is independent source preparation
for #281, indexed by #277. It adds no active API, native storage, generated DTO,
UI, geometry producer or new CI lane. Claude owns #279/#280; their published
candidate is now inspected in the
[alignment and endpoint design](measurement-linear-alignment.md). Its integration,
qualification and accepted consumer contract remain separate.

## Existing support and the missing seam

`frontend/src/lantern/unified-atlas/measurements.ts` already calculates approximate
occurrence areas and straight outer-ring runs from admitted source outlines.
It excludes estimated pick proxies, merges collinear runs, omits spans below
0.8 m and marks multi-part area as partial. Preserve that display behavior.
`EdgeSpan.key` is an occurrence/polygon/run index for presentation, not an
approved persistent edge identity. Summing visible labels would omit short
runs and holes. Neither a bounding box nor a room label defines width or height.

The missing piece here is an explicit inventory and a closed proposal shape
for discussing targets and definitions before extending area persistence.
[Schema](../../packages/contracts/proposals/linear-v1/schema.json),
[synthetic examples](../../packages/contracts/proposals/linear-v1/examples.json)
and [example checks](../../packages/contracts/proposals/linear-v1/examples.test.mjs)
are isolated from the active Atlas schemas, exports and DTO generator.

## Proposed inventory; all editing/integration remains unavailable

| Quantity | Dimension and original units | Required target/definition | Current derivability and input |
| --- | --- | --- | --- |
| Area | L²; owned by #279 | Existing reviewed occurrence/area contract | Existing approximate display; editable increment remains with #279/#280 |
| Length, width, depth | L; m, cm, mm, ft, in | Reviewed logical feature, exact occurrence/revision, two distinct endpoint refs, planar or spatial straight metric and source frame | Existing displayed spans are estimates; a span can be proposed only after its endpoints are chosen. Width/depth do not select an axis automatically. Manual or documentary input preserves that definition. |
| Height | L; same units | Reviewed logical feature, lower/upper datums, direction and sample location | No inference from bounds, storey names or sloped ceilings. Unknown datum/direction/location leaves the definition unresolved and value null. |
| Perimeter | L; same units | Explicit outer-ring, included hole-ring and excluded-boundary lists, metric and source frame, for one occurrence | No sum of display spans, assumed outer-only convention, cross-part union or inferred closure. A consumer must resolve and review every boundary. Manual/documentary values must state the same intended boundary. |
| Other quantities | Undecided | Owner-approved physical meaning and target | Unavailable; no catch-all quantity or geometric query language. |

These are proposed descriptors, not approval of a physical convention. In
particular, the fixture's inclusion of a hole is a declared example, not a
default for all perimeter measurements. A wall finish, opening clear width,
ceiling range, surface-following route, construction tolerance or survey claim
needs a separate definition and review. Do not reinterpret existing area or
inventory quantity records as these linear quantities.

## Identity and replacement

The proposal separates `logicalTargetId` from `sourceId`, `artifactSha256` and
`occurrenceId`. `observedArtifactSha256` can record a newer model while retaining
the entry's original pinned artifact; it never rebinds the entry. These opaque, home-scoped tokens are declarations for review;
the schema does not allocate or authorize stable producer feature IDs. Span
endpoints, boundary components and height datums need source-owned references
within that pinned revision. Ring indexes, mesh indexes, similar labels, equal
coordinates and numerical equality cannot establish correspondence.

A multi-part room has separate occurrence scope. `complete-for-definition`
means only the stated definition is covered, never automatically the whole room.
`partial` lists missing coverage. A replaced or missing target preserves the old
entry, source revision and history; correspondence remains `replaced`, `missing`
or `unresolved` until the model/source owner reviews it. Even a
`same-target-reviewed` declaration is data requiring authoritative verification.
Do not copy an old entry onto a new edge or clear reconciliation when saving.

## Value and provenance

A positive ASCII decimal string (at most 64 characters and 18 fractional
digits) retains leading and trailing zeroes, aligned with the published #453
candidate parser. A closed unit list prevents area units on linear proposals.
No JavaScript float or display rounding is the stored entry. The proposal carries original units
only and performs no conversion. Future conversions must retain original
text/unit, deliberate conversion method and exact factors, without assigning
extra physical precision. Original input with unsupported syntax remains an
unsubmitted UI draft until the accepted area-entry conventions are reconciled.

Origin, user testimony, evidence links, uncertainty and target correspondence
are separate fields. Manual typing alone stays `not-declared`/`unverified`;
explicit testimony may say `user-reported-measured`. A document value retains
its evidence reference. A model-derived value requires a method reference and
`approximate` uncertainty. Dates can remain null; recording time does not supply
a missing source date. `evidence-linked` establishes no independent accuracy or
accepted image registration. Multiple evidence refs do not resolve conflicts
or overwrite separate competing assertions. Unknown origin or an unresolved
physical definition cannot carry a number.

The schema validates bounded structure, compatible definition/quantity pairs,
units and those provenance rules, with an absolute decimal terminator that
rejects trailing LF, CR and CRLF. The pure `validateLinearProposal` checker in
`packages/contracts/proposals/linear-v1/validate.mjs` first validates that shape,
then rejects equal lower/upper datum tokens and each pairwise token overlap
among outer, hole and excluded boundary lists. It preserves its input and
compares opaque tokens exactly, without resolving or inferring physical identity.
It does **not** validate reference existence, same-home graph closure, physically
distinct datums or boundaries behind different tokens, topology, holes,
discontinuity, source admission, unit/frame truth, mathematical accuracy,
current authorization or truthful testimony. Those require reviewed source
resolvers and the native contract; passing this checker must never grant write
eligibility or promote a proposal into an accepted measurement.

## Synthetic cases and handoff

The fictional L-shaped outline has perimeter 22 m; its declared 1 m square
hole contributes 4 m to the explicit outer-plus-hole example, giving 26 m.
A disconnected 2 m square part remains separate (8 m); the 22 m occurrence-only
example explicitly excludes the hole with a reason and lists missing room coverage. The span entry retains
`300.00 cm`, the documentary point-height retains `2.400 m`, and an unspecified
sloped ceiling has no numeric height. A second artifact revision marks a target
replaced while retaining the old proposal. These examples are not persistence,
history, readback/reopen or physical calibration evidence.

The optional pure example checks use the already locked contracts-package Ajv:
`node --test packages/contracts/proposals/linear-v1/examples.test.mjs`.
They are not registered in an ordinary CI runner. No local check was run under
the owner's git-first workflow; existing CI validates its existing scope only.
No new browser, native, provider or operational execution is requested here.

Before native implementation, #279/#280 must integrate and qualify the published
exact-entry/history candidate and supply the accepted UI contract. The owner must
select a bounded quantity and physical definition, and the model/source owner must approve stable feature references and replacement
rules. Then add a versioned native contract through existing persistence and
readback with exact source/CI evidence. Offline/export consumers must retain
original units, provenance and unresolved/partial qualifiers or report the kind
unsupported. Interactive browser/device acceptance remains deferred. #281's
integration and acceptance checklist stays open.
