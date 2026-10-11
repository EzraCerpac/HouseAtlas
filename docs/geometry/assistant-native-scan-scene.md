# Assistant scene intake

The callable `createNativeScanSceneImporter` is the second phase of the agent's
native scan import. The invoking host owns authentication, the journal, geometry
original/derivative custody and an exclusive operation lane. There is no user
scan-import control, stock grant, new route or browser provenance claim.

The input supplies a genuine building ID, two immutable UTF-8 text files with
measured SHA-256/byte counts, statements/reasons/Unknown licenses, the reviewed
room mappings (source IDs/anchors/targets/unresolved labels only), a deliberate scene review statement and support confirmation.
`sourceFloors` supplies only `sourceFloorKey`, `sourceOriginalSha256` and the
selected actual `nativeGeometryId` during `importScene`. The exported pure
`preflightNativeScanScene(input, signal, expectedScope)` takes the source key/hash
pairs and the manifest workspace/home scope before geometry custody or
authentication. Reviewed PDF support must match that supplied scope exactly. It verifies both immutable files and the
canonical receipt, then uses the actual closed scene reader and native request
schema to check rooms/network/electricity/fixture grammar and room mappings.
Each mapping must preserve exactly the target and unresolved-label unions of
all its reviewed anchors; extra, omitted or duplicated members refuse.
Local validation ports expose only these supplied Blobs; ephemeral parser lease
identifiers never escape and no HTTP, authority, custody or PDF access is claimed.
Malformed or unqualified requested subsets refuse before writes. Actual native
floor selection must cover ALL current native floors
exactly, with no invented floor or room identity. Existing scene association
supports at most three floors; additional floors refuse before writes. The
primary closed v1/v2 scene original contains the canonical room review receipt,
rooms/network/electricity and optional frozen fixture ledger. The historical
original is the unchanged source receipt or closed reviewed documentary support.

Scene preflight counts Unicode code points for its 4096-character review
statement and 1024-character reason, including the exact appended support marker
in the statement total. Production scene preparation also counts code points
for its existing 4096-character statement/reason bounds and support-inclusive
statement. Unpaired surrogates still refuse; serialized UTF-8 byte caps and
closed request validation are unchanged.

`createNativeScanTextImporter` performs the actual first two steps per original:

1. Fresh building and ALL prior evidence reads, complete evidence-list/capacity
   validation and a conservative prospective batch size check before one
   schemaVersion-1 multipart `text/plain` POST to the
   existing Stock `/assets` route. Its server-issued asset ID comes exclusively
   from the production-validated committed result. The original document reader
   freshly checks the asset and all retained original bytes.
2. Fresh identity, asset and ALL existing identity evidence reads, followed by
   the existing guarded `atlas.batch.execute` of `evidence.create` and
   `identity.replace`. The input statement is retained without a browser claim.
   It checks the closed exact batch result and request digest, actual identity
   readback and the production evidence-original reader's complete byte join.

The agent host supplies actual context/admission/subscriptions and transport,
plus `beforeDispatch` and `afterResult` callbacks. `beforeDispatch` must durably
claim the actual request ID/body or metadata before returning. Auth/CSRF/cookies
are never included in those callbacks. Any unvalidated result, failed readback,
abort or journal failure after a claimed write holds the factory. No automatic
retry occurs, including after known asset custody followed by a later failure.
The standalone asset route has no request lookup in this adapter: an absent
response cannot establish rollback or discover its server-issued asset ID.
The host must maintain the same hold across process replacement.

A fully correlated committed receipt is terminal for that request. A later
callback, readback or not-dispatched evidence failure returns `partial` with the
known committed asset/receipt (and evidence if committed), rather than recording
UNKNOWN against that asset request. A not-dispatched evidence request ID is null.
The scene association similarly preserves its validated commit if later source
readback or journaling is incomplete. Partial still holds the operation; it does
not authorize retry or prove complete scene availability.

`reserveTexts` reserves both documentary appends before the first custody POST.
It checks each prospective guard/list and serialized batch, including the second
append, with worst-width revisions. Prior-evidence reads settle sequentially
within the same 60-second abort/deadline budget. Scene preflight accounts for all
prospective floor/document/identity/prior guards and predecessor/version fields.
Every prospective and actual text batch must fit the existing 16 KiB retained
intent lookup limit. Scene commands retain their existing 1 MiB request/schema
bound and reconcile through the current head, not retained-intent lookup. Local
capacity witnesses are never native identities or returned authority. Fresh
guards still govern the actual write. The owner used for scope preflight stays
pinned through the reads, both-document reservation and every custody boundary;
an owner switch cancels the phase before a new context can claim a write.

`capturePriorScene(buildingId, signal)` captures a genuine qualified current
head or genuine absence before geometry/text identity changes. The same importer
retains the production client's owner-bound opaque token; the host receives safe
status/record ID/revision metadata only. Before preparing a successor the client
revalidates the prior record by authenticated Stock GET and adds its guard. The
same owner reads the existing Stock scene list with `pageSize=100` and
`includeArchived=true`. Only a complete first page with `nextCursor: null`, current
source status, exact scope and production-validated records is accepted. A
continuation or more than 100 scoped scene rows refuses; pages are not combined
from separate snapshots. All records for the selected building must be active
and form one complete version-1 root through unique predecessor/child links,
with exact version increments, no missing parent, cycle, fork or disconnected
row. The linked tail must equal the captured ID/revision/payload. A captured
genuine absence requires zero records for that building. Dates, UUID order and
largest version never select a head; an active retained row alone is insufficient.
This fresh stored-chain proof runs before documentary custody and inspection.
Unchanged descriptor keys also require the qualified current route to agree.
Changed keys use the stored-chain proof instead: the qualified route can return
409 for an old `nativeFloorKey`, while `current-source-unavailable` can refer to
a competing successor and cannot prove that the captured head is still current.
The retained token supplies successor provenance and the server's atomic
predecessor guard still applies. These GETs provide proof at their read points,
not a lease: a later competing write remains subject to the atomic commit guard.
The server's atomic current-head/predecessor/version check remains final authority;
a GET of a historical record does not establish it as today's head. Direct
`importScene` callers self-capture before text if no prior was supplied.

After both text batches the adapter reloads ALL native floors: identity appends
change descriptor/view keys. It requires the same selected geometry identities
and derives new native keys, revisions and original-asset pins from that fresh
frame. It freshly reads scene guards, calls the actual scene association
prepare/submit client exactly once, adding the two genuinely committed documentary
evidence IDs to each reviewed mapping, explicitly leaves native room IDs null,
and requires its closed correlated receipt
and exact current-head readback. Reviewed support additionally requires explicit
`confirmDrawingSupport: true`. The production scene reader then reopens the
actual selected primary (and support if present) under current document owners.
It proves retained source interpretation, not browser/GPU or household acceptance.

`reconcileScene` is GET-only for the same factory's owned UNKNOWN or acknowledged
partial attempt. Unknown uses the production client's retained-attempt resolve;
acknowledged partial reads the fresh current head. Both require the exact target
and payload followed by source readback. It cannot reconstruct an attempt, resend, or accept a
different current head as rollback. Temporary document leases are released,
source selection is withdrawn and `dispose()` retires all readers. Existing
client budgets remain unchanged; each text phase has a 60-second settlement
bound and the complete scene phase has a 240-second bound, with caller aborts.
Same-instance reconciliation has a 60-second bound. Genuine admission must include
`atlas.asset.create`, `atlas.evidence.create`, `atlas.identity.replace`,
`atlas.batch.execute` and `atlas.scene-association.create`.

`inspectCurrentScene(input, signal, expected?)` performs GET-only reuse or restart
inspection with a 60-second bound. It first validates the snapshotted closed
local input, before any HTTP or mismatch return. It loads fresh ALL native geometry and the
actual current association, compares both text original hashes, source-floor
pairs/actual geometry identities, canonical receipt and complete room mappings,
then freshly reads both document owners, building membership/guards and source
subsets. Optional `expected` pins the exact original journal record ID and payload.
It returns that genuine current record or null for valid absent/different data.
Only `no-current-association` counts as absence; `current-source-unavailable`
throws and keeps the invoking host held before any text write. Transport,
parsing, context and abort errors also throw. It claims no request, emits no
replacement receipt, makes no POST and never clears an existing UNKNOWN hold.
A previously qualified available head with changed descriptor keys is known
successor provenance only after its owner token and complete stored chain are
revalidated. Inspection then returns null for that retained successor input;
any stored successor, incomplete chain or archived selected row refuses, even
if that successor's qualified source is unavailable.
The retained prior is passed to prepare, rather than selecting a missing head
after key-changing custody. The invoking host must record reuse distinctly and
keep unmatched recovery held.

## Focused synthetic checks

Inspect the runner and production imports before executing. These individually
selected cases use only generated text/records and fake HTTPS transport, with no
listener, browser, credentials, provider, original household bytes or native DB:

```sh
node frontend/lantern-tests/native-scan-import-scene.mjs committed
node frontend/lantern-tests/native-scan-import-scene.mjs asset-unknown
node frontend/lantern-tests/native-scan-import-scene.mjs evidence-unknown
node frontend/lantern-tests/native-scan-import-scene.mjs association-unknown
node frontend/lantern-tests/native-scan-import-scene.mjs floor-selection
node frontend/lantern-tests/native-scan-import-scene.mjs literal-labels
node frontend/lantern-tests/native-scan-import-scene.mjs scene-reuse
node frontend/lantern-tests/native-scan-import-scene.mjs scene-replacement
node frontend/lantern-tests/native-scan-import-scene.mjs stale-current-scene
node frontend/lantern-tests/native-scan-import-scene.mjs changed-frame-current-scene
node frontend/lantern-tests/native-scan-import-scene.mjs supplementary-unicode
```

The committed case follows the actual standalone asset result, native original
readers, guarded evidence batches, fresh changed descriptor keys, scene
constructor/current readback and retained source reader. UNKNOWN cases assert
one wire dispatch, held subsequent invocation and no synthetic success. The
association case installs the exact submitted synthetic head only for GET-only
reconciliation and preserves its committed journal result if the callback fails,
then reconciles that acknowledged partial by fresh GET without another POST.
Evidence-unknown also covers known asset/evidence commits followed by a failed
journal callback or not-dispatched next step, with no UNKNOWN downgrade.
Floor-selection proves the pure source-pair preflight has zero HTTP calls,
refuses extra closed fields in every scene subset and mapping, and that an
incomplete selected floor set causes zero writes. These are local protocol
checks, not server persistence, current
household custody, HTTP authentication, physical placement or live UI evidence.
The separate `literal-labels` case supplies a generated healthy available fixture
ledger with blank and nonblank literal labels. The actual preflight parser must
accept it without changing the original bytes or making any HTTP call.
`scene-reuse` first saves the generated scene, then uses a fresh factory to
inspect the same current record with zero additional POSTs or journal claims.
A valid changed source-floor candidate and wrong expected record IDs cannot
qualify reuse. Malformed selected mappings throw before any inspection HTTP. The same case
distinguishes valid association absence from unavailable current source data,
which throws with no additional POST or journal claim.

The `scene-replacement` case captures the actual generated prior, changes a
geometry revision/descriptor key and the selected primary bytes, then saves a
version-2 successor with exact previous ID/guard and fresh bindings. Floor
selection also verifies target/unresolved unions, 16 KiB/list text reservation
refusals and changed-owner refusal before custody. It separately confirms the
scene accepts a valid request above the text lookup cap within its own bound.
Literal-labels includes a closed reviewed support
carrier: matching scope passes, other workspace/home scopes refuse with zero HTTP.

`stale-current-scene` first seeds an actual generated committed scene, captures
its prior, then advances the fake current head through another valid stored
record while leaving the old row and geometry descriptor keys unchanged. Both
inspection and import must throw before any additional custody POST or journal
claim. It proves the current-head check is separate from retained-row validation.

`changed-frame-current-scene` captures a prior, advances the geometry frame and
installs a different fully available successor with the actual new floor keys.
Both inspection and import hold before additional documentary POSTs or claims,
including when the competing successor's qualified source is unavailable. The
actual production current reader refuses a fake409 response for an old floor
key with unchanged geometry revision; a complete unchanged stored chain still
permits inspection of the retained successor input without interpreting409 as
absence. Continuation, overflow, archival, missing parent, fork, disconnected
root and missing captured row refuse before custody. The existing replacement
case still saves a version-2 successor with the exact previous guard and fresh
floor keys. These tests are generated protocol fixtures, not a native backend
replacement or persistence test.

`supplementary-unicode` uses generated supplementary characters, reviewed
support and a fake PDF owner to exercise preflight and the actual production
prepare/submit/readback chain. The support-inclusive statement is exactly 4096
code points and the importer reason 1024. Additional GET-only production
preparation checks a 4096-code-point reason (8192 UTF-16 units), while one extra
statement/support or reason code point and an unpaired surrogate refuse. This
is source/custody protocol validation, not PDF rendering or native persistence.
