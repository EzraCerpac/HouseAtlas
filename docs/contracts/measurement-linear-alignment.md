# Linear alignment with the published area candidate

References #281, #279 and #280. Source review: 27 October 2026; main
`789db3faa22439ff34d5a093ab655e1a7aead885`, candidate PR #453 at
`f86631fedfa7bcfba10ee0df0798255c541889e2`. The candidate is published on its
historical base, conflicts with main and is not integrated or qualified by
this review. Claude retains its 41-file scope, CI, corrections and #280 mounting.
The earlier unpublished-input blocker is resolved; native integration is not.

## Actual contract and the isolated alignment increment

The references below are pinned to the inspected candidate, not a moving branch:

- [Domain contract](https://github.com/EzraCerpac/HouseAtlas/blob/f86631fedfa7bcfba10ee0df0798255c541889e2/docs/contracts/measurement-assertions-v1.md)
- [Online contract](https://github.com/EzraCerpac/HouseAtlas/blob/f86631fedfa7bcfba10ee0df0798255c541889e2/docs/contracts/measurement-assertions-online.md)
- [Internal types](https://github.com/EzraCerpac/HouseAtlas/blob/f86631fedfa7bcfba10ee0df0798255c541889e2/backend/src/measurement_assertions/types.rs)
- [Decimal parser and metric quantities](https://github.com/EzraCerpac/HouseAtlas/blob/f86631fedfa7bcfba10ee0df0798255c541889e2/backend/src/measurement_assertions/decimal.rs)
- [Semantic target validation](https://github.com/EzraCerpac/HouseAtlas/blob/f86631fedfa7bcfba10ee0df0798255c541889e2/backend/src/measurement_assertions/validation.rs)
- [Generated wire types](https://github.com/EzraCerpac/HouseAtlas/blob/f86631fedfa7bcfba10ee0df0798255c541889e2/packages/contracts/generated/measurement-assertions.ts)

The isolated proposal previously refused leading zeros and allowed arbitrarily
many fractional digits within its 64-character cap. It now shares the candidate's
positive ASCII fixed-point grammar: 64 characters maximum, at most 18 digits
after the dot, leading/trailing zeros retained, and no exponent, locale syntax,
signs or line terminators. Exact entry is not physical accuracy. Native semantic
validation additionally refuses all-zero dimensions; the proposal retains that
rule and its stricter absolute terminator.

`validateMetricLengthValue` in `packages/contracts/proposals/linear-v1/validate.mjs`
checks only the closed scalar `{decimalToken, unit, quantityKind:"length"}` with
mm/cm/m units. It reuses the proposal decimal schema, mutates nothing and
performs no conversion. This mirrors the internal `ExactQuantity` length family;
it is **not** an online DTO or permission to change `Proposal.property`.
The original proposal's `{decimal,unit}` spelling remains intact. Its ft/in units
remain proposal-only and are refused by the metric scalar checker. A caller
must never relabel an area value, truncate a token or silently convert units.

`validateStraightWallReference` checks a documentary
`{kind:"wall",wallId,endpointIds:[a,b]}` shape against the internal feature-ID
grammar: ASCII alphanumeric or `-_.:$`, 1–128 characters. It requires `a < b`,
the candidate's exact lexicographic canonical order, and never sorts or repairs
caller input. It does not resolve tokens or certify that they are source-owned,
stable, distinct physical points or available in any publication. Even
numeric-looking IDs can pass syntax; format cannot distinguish an ordinal from
an authored ID. The online wire's `SemanticTargetFeature` is still room-only.

## Reuse boundaries for a future linear command

| Concern | Actual candidate contract | Linear alignment requirement |
| --- | --- | --- |
| Property and units | Online `Proposal` and `ExactArea` accept occurrence-area, quantityKind area and mm2/cm2/m2. Internal `ExactQuantity` also has metric length. | Add a separately reviewed linear wire family later. Never send a length to the area route or change an area receipt's interpretation. |
| Scope and target | `SemanticTarget` carries workspace/home scope, producer-publication namespace, building/room/floor/occurrence and semantic feature. | Retain all scope and namespace fields; the proposal's home/logicalTarget/source strings cannot substitute for them. A room or occurrence does not identify a wall. |
| Publication and source | `TargetExpectation` pins publication, source revision/hash, semantics, overview, selection, artifact ID/hash/bytes, target feature hash and source object IDs. `ModelPin` retains lineage, custody and registration. | Preserve every pin; no artifact hash alone supplies the missing lineage. Unknown custody or physical registration stays unknown. Do not mint native Geometry or SceneAssociation IDs for producer objects. |
| Acquisition and evidence | Method is distinct from support, limitations, uncertainty, evidence roles/revisions and inherited input methods. Personally-measured attestation is required iff its method is selected. | No automatic mapping of manual typing to measured, evidence-linked to corroborated, or documentary value to imported qualification. Preserve original evidence references and their revisions through native guards. |
| Corrections and history | Correct names assertion ID, exact expected revision and payload hash. Immutable receipts hold complete prior values/provenance; heads are pointers. | Extend the same service/transaction/history path after integration. The proposal is not a second value store, history or revision allocator. |
| Server-owned fields | Actor, record/audit time, IDs/revisions and result digests are allocated or verified by the server. Mutation receipt key is workspace/home/original actor/mutation UUID. | Clients supply no persisted server fields. Keep proposal, payload, audit and external receipt digests distinct. Unknown outcomes use passive lookup, never blind replay. |
| Replacement and applicability | Old streams keep original artifacts and pending work. Reviewed pairwise association distinguishes applicable/not-applicable; room equality alone gives only candidates. | New publication or endpoint replacement never rewrites an old target. Keep explicit unresolved applicability until independent reviewed correspondence. |
| Saving and model work | Saving/equal values do not close per-version/artifact pending work. No closure endpoint or geometry writer exists. | Preserve all obligations and conflicts. The syntax checks above confer neither eligibility nor physical verification. |

## Straight two-endpoint design for source-owner review

The candidate already defines internal `SemanticFeature::Wall` with stable
source-owned `wall_id` and two `endpoint_ids`; `validate_target` requires their
canonical order. Internal `WallLength` means horizontal straight distance
between those pinned semantic endpoints. This is a specific proposed first
linear family, not a universal meaning for every user request called length.
Curved routes, spatial straight spans, width, depth, opening clearance, height
and perimeter require their own reviewed definitions. Internal enum names for
those categories do not select the user's intended boundary or datum.

Current admitted scene plans provide `featureId`, occurrence, polygons and
coordinate arrays. They do not supply wall endpoint identifiers. Existing
measurement run indexes are presentation addresses only. Do not generate
persistent endpoint IDs from array positions, coordinates, labels, nearest
vertices or numerical equality. Existing generic proposal `endpointRefs`
cannot be cast into the wall feature merely because it has two strings.

A future source-owned reference needs the complete semantic target and model
pins above plus the reviewed wall/endpoint IDs. Its `targetFeatureSha256` must
bind the exact reviewed semantic feature materialization for that source and
artifact; the current occurrence-area feature hash cannot automatically become
an endpoint-feature hash. A later revision keeps the original assertion's pins
and uses reviewed pairwise correspondence, retaining missing/replaced/unresolved
states rather than choosing another similarly named feature.

The source owner can resolve these contract questions using synthetic exports,
without requesting any household dimensions:

1. Choose whether the first admitted non-area family is the existing internal
   horizontal `WallLength` definition. If a different selected straight span is
   intended, define a separate semantic target/property instead of reusing wall.
2. Define the producer's authored wall/endpoint ID allocation and retention
   convention, and its association to existing plan features/source objects.
   Canonical endpoint ordering is already constrained by candidate validation.
3. Specify the exact endpoint-feature digest preimage/domain, coordinate frame,
   transform application and units in the reviewed semantic export. Define the
   resolver inputs and complete coverage rules; the checker here is no resolver.
4. Define split, merge, deletion and replacement correspondence, including an
   explicit no-correspondence result and retained original history. A pairwise
   review must qualify each exact old/new target; room/length equality is insufficient.
5. Review the future wire/context extension with Claude after #453 is integrated
   and qualified. Keep source disclosure, mutation authorization and independent
   correspondence/evidence checks under their original owners.

No wall/endpoint convention, digest domain or mapping is approved by this note.
The scalar and reference checks are ready as isolated syntax only; producer
identity admission and persistence remain gated. Width/depth axes, height datum
and sample/minimum rules, and perimeter's included/excluded boundaries remain
explicitly unspecified for #281. The broader proposal keeps their uncertainty.

## Evidence and remaining acceptance

The optional example check source adds exact formatting/boundary cases, metric
versus area/imperial distinctions, closed scalar fields and canonical endpoint
syntax/order. All six existing proposal fixtures remain byte-identical. The
new checks do not import the unmerged candidate or run a service. Local tests,
build, Clippy and public-tree qualification are NOT RUN under the git-first
workflow. These optional checks are not in the ordinary runner; generic green
CI does not prove their execution. Claude owns manifest integration and CI.

No active backend/schema/API, native persistence, UI, reference resolver,
producer geometry or private evidence changed. #281 stays open for accepted
source identities, integration, immutable native readback/history and deferred
interaction/device acceptance. Publication of #453 resolves access to source;
it supplies no qualification, deployment or acceptance by itself.
