# Local capture drafts: staging and UI integration contract

## Approved scope

This amendment defines the Ezra-approved narrow staging exception to the
general offline expectations in `media-and-offline.md`: a desktop or mobile
web page may let a signed-in user explicitly save a browser-returned file and
its evidence form as a local, unsent capture draft, then explicitly review it
and hand it to the existing foreground Atlas editing owner for one upload
attempt. This is local browser staging for a later online action. It does not
add disconnected editing or an offline mutation queue.

The exception applies only to the foreground web page and the capture-drafts
controller and IndexedDB store described below. It does not authorize a wrapper
or QR utility, service worker, background mutation, automatic submission, retry,
sync, or a promise of offline operation. The existing general offline and media
expectations remain in force outside this narrowly stated exception.

The controller/store contract is integrated into the shared contextual Add
evidence interface. The UI supports explicit local save, review, confirmed
foreground upload, unknown-outcome inspection, and consented sign-out cleanup.
No target browser or physical device has yet been qualified for this feature.

## Ownership and local storage

The feature uses the origin's IndexedDB database
`houseatlas-local-unsent-captures-v1`, object store `drafts`. Each row is scoped
to the exact owner tuple `actorId`, `workspaceId`, and `homeId`. The controller
also binds each in-memory operation to the current host-provided `sessionEpoch`
object. That epoch is memory-only and is never persisted. Synchronous
`current()` exposes only the latest canonical state maintained by the host; it
returns `null` while a session read is pending or unavailable.

List and resume actions expose only drafts whose full owner tuple matches the
current actor, workspace, and selected home. A different account or home must
not display another tuple's draft. Switching account/home/session invalidates
pending review handles immediately; switching accounts does not itself delete,
send, or transfer any stored draft. On sign-out, the host must explicitly call
`clearAccount({ loseLocalCaptures: true })` while the current session boundary
still exists, before ending that session. That operation removes the current
actor's rows in all homes in this database and invalidates controller handles.
If sign-out cleanup cannot complete, do not claim that local files were erased.

Saving requires foreground, per-save opt-in. Installation, a prior save, or a
prior session is not consent for a later save. The UI mints one UUID `localId`
for each capture selection and reuses that ID only when retrying the exact same
save operation. Repeating a save with the same ID and identical fields returns
the existing ID without staging another copy or extending expiry. Reusing an ID
with changed values, or for a row whose outcome is unknown, is rejected. The
controller stores only a snapshot of the explicitly allowed selection, form,
target and owner fields; it has no credentials or upload/fetch/reconnect/
timer-submission capability.

## Host APIs and lifecycle

The integration uses the concrete exported contracts in
`frontend/src/capture-drafts/types.ts`, `controller.ts`, and `indexeddb.ts`:

```ts
const store = openDraftStore();
const drafts = createCaptureDrafts(store, host);

await drafts.save({ localId, selection, form, targetSourceRef, recordId, optedIn: true });
const rows = await drafts.list();
const review = await drafts.review(draftId, signal);
const submission = await drafts.beginAttempt(review.token, { confirmed: true }, signal);
const intent = submission.takeForForegroundSubmit();
try {
  const result = await editingClient.uploadPlaceEvidence!(intent, signal);
  const completion = await drafts.acknowledge(submission, result);
  // Report the known commit separately from completion.localCleanup.
  // 'unconfirmed' leaves any retained local attempt locked; never upload again.
} catch {
  // If the row remains outcome-unknown, inspect later with a current signal.
  // const unknown = await drafts.inspectUnknown(draftId, currentSignal);
  // Only after separate user confirmation: await drafts.discard(draftId, { loseUnknownOutcome: true });
}

// Before ending the current session, after explicit cleanup consent:
// await drafts.clearAccount({ loseLocalCaptures: true });
// On identity/session change or unmount: drafts.invalidate(); drafts.close();
```

The optional `uploadPlaceEvidence` callback is owned by the current editing
client. The host adapter passed to `createCaptureDrafts` must implement
`DraftHost.current()`, `refreshBoundary(signal)`, `foreground()`,
`loadPlace(source, signal)`, and `validateAcknowledgement(result, intent)`.
Synchronous `current()` returns the latest canonical actor/workspace/home and
memory-only `sessionEpoch`, or `null` when that state is pending/unavailable.
`refreshBoundary(signal)` performs a fresh canonical session GET, updates
`current()`, then returns the fresh boundary or `null`. Preserve the exact same
in-memory epoch object only when the GET verifies the same session; a changed
or unverifiable session must use a different epoch or return `null`. No
credential, cookie, CSRF token, or session secret is passed into or stored by
the drafts module. `foreground()` must reflect the actual visible page.
`loadPlace` must perform a genuine fresh editing-client read and never reuse a
cached or persisted admission. `validateAcknowledgement` must run the actual
closed schema and correlation checks for the returned upload result.

`current()` must expose the host's latest verified state, without closing over
an earlier session snapshot. It must fail closed while a canonical session read
is pending or unavailable; the asynchronous GET belongs to `refreshBoundary`.
The host must subscribe to
cross-tab/session notifications and synchronously call `invalidate()` on every
affected controller when account, workspace, home or session changes. This
clears review and submission capabilities in that controller. `review`,
`beginAttempt`, and `inspectUnknown` must each call `refreshBoundary(signal)`
before their fresh `loadPlace`; they compare the returned owner and epoch with
the captured values, then check synchronous `current()` again before proceeding.
Operation checks still call `current()` afresh; a notification is not a
replacement for that check.

The UI must call `invalidate()` synchronously on logout, identity/home/session
change, cross-tab notification, and component unmount. It must also abort active
`AbortController`s and close the feature store when its owning page/session is
torn down. Immediately before the one upload invocation, the UI synchronously
calls `submission.takeForForegroundSubmit()` and passes that returned frozen
`DraftUploadIntent` value directly to the existing upload callback. This
one-use handoff is not itself a send. The UI must not retain, copy, defer, or
retry the returned intent, and the drafts layer does not invoke the upload
callback. The controller checks current boundary, owner, session epoch and
foreground state at each stage; a stale check rejects the action.

The required user flow is:

1. For each save, obtain explicit foreground consent and pass
   `optedIn: true` with the current browser selection and completed form.
2. Resume only by an explicit user action. `review(id, signal)` refreshes the
   canonical session boundary, verifies its owner/epoch are unchanged, then
   freshly loads the place. Show the returned file and form for review; do not
   treat saved admission as current.
3. On explicit user confirmation, call `beginAttempt(review.token,
   { confirmed: true }, signal)`. This refreshes the canonical session
   boundary, verifies the same owner/epoch, then performs a second fresh
   `loadPlace`, rechecks current attachment policy and revision/guards, and
   atomically persists `outcome-unknown` plus a new request/idempotency identity
   before it yields the one-use submission capability. The UI then calls its
   synchronous `takeForForegroundSubmit()` method exactly once to obtain the
   frozen intent.
4. Pass that intent directly to the existing upload callback once in the
   foreground. Do not loop, retry, replay, or manufacture a second intent.
   `beginAttempt` has consumed the review token even if dispatch does not start.
5. Call `acknowledge(submission, result)` only with the actual callback result.
   The adapter validates its real schema; the controller checks the request ID,
   command, resolved workspace/home and matching local attempt. Only then does
   it attempt local removal and return `server-acknowledged` with a separate
   `localCleanup` result (`removed` or `unconfirmed`).

`acknowledge` requires the original in-memory submission capability after its
one-use handoff. The trusted host upload callback's actual result is then
validated against its closed schema and correlation fields. Only after that
validated, correlated result does the controller remove the local original.
Validation failure rejects the acknowledgement and keeps the outcome unknown.
After successful validation, local transaction or boundary failure returns
`localCleanup: 'unconfirmed'` without turning the known commit into a server
uncertainty. The acknowledgement capability is consumed; this is no cleanup or
upload retry permission. Any retained row stays locked as `outcome-unknown`.
Receipt validation is scoped to this call and attempt, rather than remembered
by response-object identity across submissions. Reusing an earlier response
object with its earlier request ID cannot certify a later attempt.
Matching outer request/scope fields alone also cannot certify an attachment.
Before cleanup, the draft controller requires the existing upload contract's
active evidence and identity records, corresponding audit count, and the exact
admitted location identity at its guarded successor revision. That identity
must include the returned new evidence ID. The evidence must retain the saved
statement, one Atlas original reference, unknown fact/source provenance and
the exact opaque browser selection claim. A returned new asset must match
that reference and the saved original hash, size, MIME, licence and JPEG
download-only policy. The admitted identity is held only in memory; no guard,
admission or receipt is added to stored drafts.

The server's existing-original path legitimately returns two records
(evidence and identity), without an asset-create row. That path remains
supported without fabricating an asset row or adding a read; authorization
and exact existing-asset resolution remain with the server. A local receipt
check is not an independent download/readback of that existing original.
An empty or unrelated committed batch, inconsistent returned records or
different original/provenance fields leave the local original locked and do
not establish a known attachment commit or permission to replay.
The server acknowledgement is a result from one explicit online action. It is
not evidence of an offline queue, later sync, or eventual delivery guarantee.

## Attempt outcomes and native reconciliation

Persisting `outcome-unknown` happens before the submission capability leaves
the controller. This is deliberately conservative: if handoff is lost after
the marker commits, a draft that was in fact never sent can remain unknown.
The browser has no definitive way to establish non-effect from that local fact.
An unknown draft cannot be reviewed for another submission. A timeout, abort,
logout, tab close, navigation, host loss, or missing response after handoff
leaves the server effect unknown. Removing that local draft does not cancel or
undo a server operation. `discard` therefore requires explicit confirmation to
lose an unknown local outcome; it must not be presented as cancellation.

`inspectUnknown(id, signal)` is read-only assistance for an explicit user
action. It refreshes and verifies the current session boundary, then performs a
fresh `loadPlace` and returns the persistent attempt
request/idempotency IDs, local hash, and observed saved-place information (or
`null`), while keeping `outcome: 'unknown'` and
`retrySafety: 'not-established'`. The saved-place observation is not proof of
this attempt's effect, non-effect, or retry safety. It does not dispatch a
recovery request. Present the observation as such; the user may resolve the
question manually or explicitly remove the local draft after considering that
the server effect can remain unknown.

Do not construct or fabricate a stock `StockRequestEnvelope` from
`UploadPlaceEvidence`, the form, a response, or a draft. The capture upload
intent is not proof of the exact serialized native batch. If the current upload
path genuinely retains the exact original compatible native place request
bytes, reconciliation may reuse the existing
`readSerializedNativePlace(originalBody, current, signal)` API on those bytes.
The API validates the original batch and its scope; reconstructed or newly
serialized bytes are not a substitute. This draft contract does not persist
such a native request, and it adds no recovery dispatch. If no exact compatible
original request is retained by the existing owner, reconciliation is
unavailable and retry safety remains `not-established`. Fresh saved-state reads
may inform a person's manual resolution, but cannot by themselves prove this
attempt's non-effect, duplicate identity or retry safety. Never automatically
retry or claim no effect from a timeout, abort, failed read, missing receipt or
unchanged snapshot.

## Selection seam and provenance limits

`CaptureSelection` matches the pinned `capture-evidence/EvidenceSelection`
shape structurally: `{ original: File, file: File, capture }`. `capture` has
`schemaVersion: 1`, `selectionMethod` (`camera-request`, `photo-picker`, or
`file-picker`), `selectedAt`, `filename`, `reportedContentType`, and
`byteOrigin: 'browser-returned-unmodified'`. The draft contract currently keeps
this structural seam without importing a shared frontend type; shared imports
and UI hookup remain for coordinated composition by the separate capture owner.

The wrapper may normalize MIME labels only; it must not transform bytes. Before
staging, the core requires both `original` and `file` to be `File`s, checks
equal size, filename and `lastModified`, checks an allowed normalized
`file.type` (`image/png`, `image/jpeg`, `application/pdf`, or `text/plain`), and
verifies SHA-256 equality of both byte streams. It stores the
exact bytes from `original`, records normalized `file.type` separately as its
content type, and retains `capture.reportedContentType` as the browser-reported
label; that label may be empty. `takeForForegroundSubmit()` returns a frozen
`DraftUploadIntent`, structurally `UploadPlaceEvidence` plus the `capture`
object. The picker method names are local claims about the requested selection
path, not independently verified provenance.

The browser may return bytes that a camera/photo picker has already transcoded
or otherwise transformed. “Browser-returned unmodified” means only that this
feature does not transform the bytes it receives before staging; it is not a
claim about device-original bytes. The stored SHA-256 supports local byte
integrity checking only. It does not establish source authenticity, device
origin, capture time, or truth of the statement.

`selectedAt` is the local selection time, not a camera timestamp, source date,
`capturedAt`, or evidence `factAt`. Do not use it as evidence provenance.
Browser `lastModified`, file name, normalized `file.type`, reported MIME label,
and selection method are also unverified browser/file metadata. The adapter
must create any server evidence provenance only according to the existing host
contract; this draft schema does not add capture facts.

Do not persist derived previews or derivatives, authentication/session
material, admission/authorization decisions, guards, revisions, or a server
receipt. Fresh place/admission information is loaded for review and again
before handoff. The draft records only the target reference and editable
evidence fields needed to request that future read and foreground action.

## Bounds, expiry and loss

The current validated limits are 10 MiB per file, 4 drafts, 32 MiB combined
original bytes, and 64 KiB serialized metadata. An unsent draft is eligible for
submission for seven days from local creation. At or after expiry it is shown
as expired and cannot be submitted; it remains stored until the user explicitly
removes it. Unknown-outcome rows are not silently expired or eligible for
resubmission. Capacity checks reject a save that would exceed a limit. They do
not evict another row, including an unknown-outcome row.

IndexedDB is browser-managed storage. The browser, user, profile reset, device
loss or storage pressure may clear or evict it; users can also lose access by
clearing site data. There is no backup, cross-device copy, browser-managed
storage durability, or durable-retention guarantee. The interface must describe
this as a local unsent draft and must not promise durable storage or recovery.
Storage open/transaction failures must be reported as unavailable rather than
silently claiming that a draft was saved.

An empty reopened database cannot establish that a draft never existed or was
submitted. Unsupported versions, corrupt rows, blocked opens and failed writes
are unavailable states; this donor performs no automatic migration or partial
salvage. A quota failure rejects the entire atomic change and leaves earlier
rows intact. The feature performs no silent eviction or truncation.

Owner filtering is an application boundary, not encryption. Same-origin code,
browser-profile access and developer tools can access IndexedDB. Private drafts
remain in that profile when an account switch only locks them. The host must
explain local loss and cleanup before opt-in and must report failed sign-out
cleanup honestly; it may still end the session and immediately hide all drafts.

## Verification boundary

The prepared `reused-receipt-object-keeps-unknown` case in
`frontend/capture-drafts-tests/combined-host.mjs` uses two deliberately separate
synthetic saves and fake foreground handoffs. It returns the identical first
receipt object for the second attempt and requires rejection, retained exact
bytes, no second cleanup, and no redispatch from inspection or the consumed
review. The controller regression fixture also separates a correlated commit
with failed local cleanup from missing/noncommitted statuses. The separately
selected controller suite is not part of the bounded registration below.
The additional prepared `receipt-record-closure-keeps-original` case checks
schema-valid empty/mismatched receipts against the real closed schema and
requires retained exact bytes, zero cleanup and no redispatch. The prepared
`existing-original-receipt-commit` case preserves the two-record server path.
Both share generated receipt data with the controller fixtures. The exact
commands below now run through the existing healthy list; preparation and
registration are not execution results.

The bounded registration on 27 October 2026 selects only these existing
fake-port commands in `run-healthy.mjs`, using Node 26.10.0 and locked frontend
dependencies:

```sh
node frontend/capture-drafts-tests/combined-host.mjs --case healthy-save-review-commit
node frontend/capture-drafts-tests/combined-host.mjs --case existing-original-receipt-commit
node frontend/capture-drafts-tests/combined-host.mjs --case receipt-record-closure-keeps-original
node frontend/capture-drafts-tests/combined-host.mjs --case cleanup-failure-known-commit
node frontend/capture-drafts-tests/combined-host.mjs --case reused-receipt-object-keeps-unknown
```

They cover the new/existing asset positives, eighteen schema-valid record
mismatches, known-commit cleanup failure and reuse of an earlier receipt object.
Each uses generated Files, a deterministic memory store, injected session/editing
ports and a global fetch trap. No listener, browser, native service or real
IndexedDB runs. The thirteen-case controller regression suite and all other
named draft cases remain separately selected; no test alias, whole-suite
discovery or new workflow is added. This exact registration supersedes the
earlier no-ordinary-entrypoint handoff only for these five commands. Passing
them establishes only their reported behavior, not target storage durability,
browser/UI integration, household acceptance, recovery or deployment.
