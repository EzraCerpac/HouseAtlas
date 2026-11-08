# Electrical data read contract v1

References #554. This contract supplies data for a future symbol → circuit →
panel trace. It changes no trace UI, endpoint, mutation, native schema, receipt
issuer, provider or installation. The existing documentary ledger remains
`houseatlas.documentary-electrical-fixtures.v1`: its groups still have
`currentCircuitId: null` and `verifiedWiring: false`.

`v1.schema.json` describes `houseatlas.electrical-data.v1`. The deterministic
`packages/contracts/src/electrical-data.mjs` projector joins it to independently
current native records and an already validated documentary ledger. All native
references carry record type, UUID and exact revision, under one workspace/home.
It reuses the canonical [native v2 schema](../../packages/contracts/schemas/atlas.v2.schema.json)
without extending its circuit payload or introducing parallel persisted owners.

## Data and existing owners

- **Panels** reference native `identity` records of kind `item`. `label` is
  explicit text or null. Optional `roomAssociation` references a native location
  identity and its active accepted `location-semantics` record of kind `room`.
  An absent association means not supplied; null means explicitly unknown. The
  exact panel review covers the association. A historical documentary room
  receipt alone does not establish this current panel-to-room assertion.
- **Breakers** are descriptors of native `circuit` records, not another circuit
  identity table. The canonical circuit still owns label, panel endpoint and
  evidence IDs. A supplied panel must exactly match that endpoint and the current
  panel descriptor. Position is a read label plus explicit occupied ways; no
  numbering convention, physical geometry or adjacency is inferred. Rating in
  amperes and literal protection text are supplied only when known. Optional
  fields retain omission, explicit null and value separately. No default rating,
  protection, panel position or safety assessment is invented.
- **Mappings** target either one exact documentary group or one fixture ID from
  the pinned ledger. They retain candidate native circuit revisions, evidence,
  review state, confidence and uncertainty. A group is never retyped as a circuit;
  group membership never creates physical fixture identity or placement.

All rows have `basis: owner-report | label-match | test | unknown`. A review
contains existing-style `{id, sha256}` receipt pins and revision-pinned native
evidence, with `unreviewed | reviewed | ambiguous | conflicting | stale` status,
explicit confidence and nullable uncertainty. The native evidence retains its
original provenance, source/fact/retrieval dates and uncertainty; no field here
rewrites or upgrades it. Unknown basis/confidence withholds a current join.

## Current context and receipts

Create a projector with the two pinned schema objects, then call it with `data`
and a separate `context` containing:

```js
{
  scope: { workspaceId, homeId }, viewKey,
  records, // authorized canonical identity/evidence/circuit/location-semantics
  documentary: { sha256, data: validatedElectricalFixtureData },
  currentReviews: [{ receipt: { id, sha256 }, subject }]
}
```

The source owner must verify retained documentary bytes, validate them through
the existing `tools/electrical_registry/registry.mjs` contract, establish current
authorized native records, and independently verify each review's exact subject.
`electricalReviewSubject(data, kind, row)` defines that subject: workspace/home,
view key, complete documentary-ledger hash, row kind and the entire original row.
The helper constructs comparison data, **not a receipt**. Receipt strings, hashes,
UUIDs, authenticated sessions and the untrusted input's `reviewed` status do not
establish review or authority. No production owner currently supplies this new
read composition; adoption must bind these inputs to the existing real owners.

The host must rebuild/discard this projection whenever source bytes, native
revisions/lifecycle, scope/view, evidence or review currentness changes. There
is no clock, subscription, durable store, signature verification, authorization
or revocation service in this pure helper. A byte-consistent historical room
receipt, matching label or cached projection cannot substitute for currentness.

## Consumer distinction

The projection returns separate `panels`, `breakers` and `mappings`, preserving
their input rows and reasons for withholding. Consumers may follow
`mapping.currentCircuitId` only for `status: reviewed-association`, then the
matching current breaker and its `panelRecordId`; a current panel's
`reviewedRoomId` is only a room association. Original historic groups stay intact.
No UI behavior, glow, automatic resolver, receipt acceptance or native write is
implemented by this contract.

### Room identity join

`reviewedRoomId` is the native location identity's `recordId`, **not** the
publication's Atlas `roomId`. `AtlasRoom` carries separate `roomId` and nullable
`nativePlaceId` fields; `RuntimeRecords.rooms` is keyed by `roomId`. Equality of
labels, UUID-shaped text or producer `nativeBinding` is not a qualified join.

The existing owner is
[`createUnifiedAtlasReviewedOverlays`](../../frontend/integration/unified-atlas-room-links-host.ts).
Its independently authenticated `UnifiedAtlasOverlayReviewedRoomLinks` carries
`{roomId,nativePlaceId,packagePlaceKey,packagePlaceUuid}` under exact
workspace/home/publication/semantics pins. The
[overlay source](../../frontend/integration/unified-atlas-overlay-source.ts)
correlates those links with accepted source-room mappings and receipt anchors
before issuing `frame.roomBindings`. While that actual owner says the frame is
current, match this projection's native `reviewedRoomId` to the qualified
binding's `nativePlaceId`, then use its `roomId`. Preserve the exact scene/native
identity, package/receipt membership, building and selectable-room checks in
`runtime-overlays.ts`. Reverse native-ID uniqueness is not guaranteed: preserve
qualified bindings as such, never select the first or infer another from a name.
Missing or ambiguous qualified linkage keeps the room endpoint unplaced; known
panel/circuit documentary metadata can still be shown without a room anchor.
This contract adds no second mapping, geometry authority or production host.

### Stable withholding codes

`reasons[]` already consists of nonlocalized machine codes, not source text.
`ELECTRICAL_WITHHOLD_REASONS` exports the frozen v1 registry from the projector;
existing codes are not renamed or reused within v1. It contains:

- `basis-unknown`, `confidence-unknown`;
- `review-unreviewed`, `review-ambiguous`, `review-conflicting`, `review-stale`,
  `exact-review-not-current`, `evidence-not-current`;
- `panel-item-not-current`, `reviewed-room-not-current`,
  `native-circuit-not-current`, `native-circuit-evidence-not-current`,
  `native-panel-link-not-current`, `native-panel-descriptor-missing`,
  `position-without-panel`, `conflicting-panel-position`;
- `documentary-target-unavailable`, `circuit-not-unique`,
  `circuit-descriptor-not-current`, `test-not-confirmed-for-exact-target`,
  `conflicting-fixture-circuit-candidates`, `contradictory-fixture-circuit-tests`.

Consumers map codes to their own plain sentences. Reason ordering is not a UI
priority contract. An unrecognized code should retain an unavailable state,
never become raw interface text. Thrown `TypeError` validation diagnostics are
not this code API and should not be rendered as user-facing reasons. No code
value or withholding behavior changes when importing the registry.

### Offline factual snapshots

The plain JSON projection has no declared session, CSRF, capability, lease,
reader or issued-URL fields. It can contain private labels/free text, complete
native circuit records, evidence/receipt identity pins and withheld rows. It is
**not a sanitizer**. Only factual data the actual account/home/device storage
owner authorizes may be retained; hiding a row does not remove it from storage.
Do not serialize live context, `currentReviews` as fresh authority, sessions,
admissions, leased readers, opaque live frames or issued document/download URLs.
Retained receipt references/bytes, where independently authorized, remain facts
about a captured review rather than a newly current approval or capability.

The existing
[`stored-overlays.ts`](../../frontend/src/lantern/unified-atlas/stored-overlays.ts)
is display-only and does not yet serialize this projection. Its documented
`RuntimeRecords` shape-change rule requires matching codec work and a profile
bump. Consumer storage integration owns that decision, the account partition,
workspace/home and publication/revision/semantics fences, capture time, resource
digests and source/native-record/review/ledger pins. These electrical data changes
do not extend `houseatlas.stored-overlays.v1` or the Saved pack.

On restore, display any `current`/`verifiedWiring` values as **captured assertions**
at the saved time, including the actual test observation time and uncertainty.
They establish neither current source freshness, present wiring, fresh authority
nor electrical isolation safety. The projector has no lease, TTL or invalidation
subscription; the overlay owner's read deadlines/head-age checks are not a
projector TTL. Account/home, scene, source, record or review changes must retire
the corresponding live view through the existing owners; reconnect requires new
genuine current inputs, not replay of saved review objects. Offline data cannot
observe intervening changes or revocation. The existing
[Saved overlay reader](../../frontend/src/offline/saved-atlas-overlays.ts) uses
`captured-room-identity-join`, not reconstructed `current-native-room-join`
authority; missing captured closure remains unplaced/unavailable. This is an
interface boundary for the existing offline/trace writers, not another storage
owner or an implementation of saved electrical tracing.

An owner report or label match can yield a reviewed documentary association,
with `verifiedWiring: false`. High confidence does not change that rule. Only a
current exact **test** mapping can yield true: a confirmed result with a nonempty
method, exact fixture coverage (all members for a group), observed time matching
the pinned native physical-survey evidence's fact time, supported evidence
uncertainty, and independently current review of that full assertion. Partial,
inconclusive, contradicted or stale tests withhold. This is an assertion about
the tested fixture/circuit membership only, never cable routing, installation
safety, all sockets in a room, or an untested group member.

Malformed or cross-home inputs throw. Missing/stale/tombstoned native references,
unavailable/disputed/withdrawn/superseded evidence, absent exact reviews and
nonunique candidates retain rows but withhold joins. Overlapping group/fixture
candidates that disagree withhold all affected joins; no first-row or label
fallback exists. A separately current, exactly reviewed test with a contradicted
outcome also withholds every overlapping association, even when confirmed and
contradicted assertions name the same circuit. Group/fixture overlap is checked
through exact documentary membership. Both assertions stay visible; row order,
timestamp or label cannot select a winner. An unreviewed, unknown-confidence or
inconclusive assertion does not become a current negative test. Releasing the
hold requires explicit reconciliation of current review/evidence by the existing
host owners, not a new override, synthetic authority or automatic time ordering.
Duplicate occupied panel ways similarly withhold affected
breaker/mapping joins. Even a conflicting proposal requires explicit
reconciliation; source ordering cannot silently override it. Absent known
metadata remains absent, rather than being converted into a guessed value.
Outputs always retain null wire routes/cable coordinates and false
`nativeQualified`; those concepts are outside this read contract.

## Generated source fixture and qualification

`generated.fixture.json` contains only invented native snapshots, a compatible
documentary ledger and generated review context. It includes a panel, one room,
three breakers and three mappings: low-confidence owner report, medium-confidence
label match and an explicitly **GENERATED tested-state example**. The last
demonstrates the contract branch; no electrical test was performed and none of
these records or receipts describes an installed house.

The existing eight-top-level electrical registration selection contains four
new explicit subtests in `healthy documentary-only intake and separate reviewed
electrical data contract`: canonical/schema joins and provenance, withheld
unknown/stale/conflicting cases, same-circuit contradictory tests in both row
orders and all group/fixture overlap combinations, and exact scope/receipt/test
limitations. The contradictory-test subtest derives a separate generated native
evidence record and independent review subject from the existing fixture; it
preserves both original assertions and checks unrelated report/label mappings.
Every emitted reason across these generated cases is also asserted to belong
to the frozen machine-code registry; malformed-input diagnostics stay separate.
Its previous documentary assertions are preserved. The existing command is:

```sh
node --test --test-concurrency=1 tools/electrical_registration/healthy.test.mjs
```

It uses the already pinned Ajv/ajv-formats under `packages/contracts`, with no
new dependency, runner, workflow, browser or native operation. These source
assertions have not been executed locally. Hosted logs alone establish their
execution; source publication and a synthetic tested-state example establish no
CI pass, merge, installation or household wiring acceptance.
