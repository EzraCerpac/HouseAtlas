# Native scan succession

The custody and three-child association endpoints retain their existing HTTP,
Stock and one-shot contracts. A new original and derivative remain independent
custody records; the association appends evidence and geometry, then appends the
new evidence to the existing building identity using its exact revision guard.
No existing geometry, asset, place or scene record is replaced.

An initial floor has geometryVersion 1 and previousGeometryId null. An update
explicitly names a current qualified native geometry head in the same building
and uses exactly its version plus one. The route requalifies this selection under
the native core lock, including retained predecessor evidence and both assets.
Root and geometry-child guards pin those actual records. Building/semantics and
existing evidence guards remain required. A stale predecessor, foreign building,
unqualified predecessor or fork cannot be adopted by this route.

Current floors are heads of explicit predecessor chains. Every participating row
must independently qualify its original/derivative custody and building evidence.
Version links must be exact increments, and each predecessor has at most one
successor. A nonqualified successor cannot silently hide a qualified predecessor.
Labels, UUID ordering and import dates never establish succession. Old records,
original bytes, derivatives, receipts and audit history remain retained and
available through their existing authenticated owners.

Metadata preflight bounds accepted profile-shaped history to 64 versions across
all floor chains before any retained-byte qualification. Each original/derivative
pair stays unique across the complete history, including retired versions. A
64-version history remains eligible for bounded reads; it cannot append a 65th
version. This count is conservative: an invalid retained version cannot evade
the bound by failing its subsequent content qualification. The existing ten-second
work budget and all byte limits remain unchanged.

The profile still requires unknown coordinate units, null scale and transform,
and no room mappings. Scan replacement supplies no physical registration or
semantic room inference. Existing stable place, elevation, device and circuit
identities do not move when the geometry changes. New frame-specific room or
fixture associations require a separate review against current source evidence.

The production TypeScript client accepts an optional previousGeometryId. It
reads the actual geometry, evidence and asset records with the closed canonical
geometry.get arm, then uses the existing native descriptor reader to qualify
same-building current-head membership. Revisions remain ExactDecimal values.
Version arithmetic converts only schema-bounded safe integers and emits an exact
numeric node. The existing one-shot intent ledger marks unknown before POST;
an absent or uncorrelated response does not authorize another submission.

The assistant-managed caller uses the production client directly: read current
native floor descriptors, select the exact same-building geometry head, then
call `load(binding, { buildingId, semanticsId, originalAssetId, derivativeAssetId,
previousGeometryId }, signal)`, `prepare(current, input)` and one-shot
`commit(prepared, signal)`. Omitting the predecessor keeps initial version-one
behavior. The TypeScript positive at `frontend/lantern-tests/native-scan-succession.mjs`
executes both initial loads and the explicit predecessor load with actual
production clients and schemas. It verifies the successor body, exact predecessor
guards and refreshed descriptors. PR #158 removed the Import Scans mount;
`NativeGeometryIntake` has no runtime caller, and its remaining imports in the
host and native scan context are types. This change supplies no end-user import UI.

Every floor descriptor key includes current building identity and semantics.
Appending evidence changes keys for untouched floors as well as the updated
floor. A caller must re-read all current descriptors after commit, clear old
frame-specific selections and use fresh keys and record guards for scene
adoption. Existing scene qualification checks actual current floor membership;
old keys remain historical and do not become current through label matching.
The source client does not automatically accept a new scene association or reuse
its predecessor's physical mappings.

The two README-named successful checks use synthetic data only. The native case
uses actual in-process Axum, native Editor sessions, SQLite, Media custody/vault,
Stock correlation, two floor roots, partial v2 adoption, retained original bytes,
fresh two-floor scene bindings and strict authenticated reopen. It compares
stable native room/elevation/device/circuit records and old geometry and scene
history. The TypeScript case uses actual production clients/schema with local
fake responses and an exponent-form integer token; its fake descriptors are
fixtures, not independent native custody or browser evidence. Neither case opens
a socket, executes a converter, accesses household media or establishes live
installation, visual acceptance, physical placement or operational recovery.
Guard reversal, omission, adversarial, replay, crash and private intake remain held.
The separately named metadata unit case uses only small synthetic snapshots and
an empty disposable vault to check capacity, retired-pair reservation and read
ordering. It uses in-memory snapshots only, with no persistent native writes or
authentication qualification.
