# Native scan intake UI

The normal Atlas scan view exposes **Import scans** through the existing native
geometry provider. The original Lantern shell and Rooms & places remain in
place. The host creates stable custody and association clients from its actual
canonical session object, completed authorized view scope, Stock admission and
the same synchronous change events as the native read client. This creates no
session, credential, grant or provider route.

## Deliberate custody and association

Choose USDZ or IFC, select the original file, supply its source license status
and custody reason, then select **Prepare original**. Preparation hashes an
immutable copy and displays its filename, explicit MIME, byte size, SHA-256,
license and metadata. **Confirm original custody once** calls the existing
one-shot owner. A correlated receipt establishes only original asset custody.

Select that actual committed receipt and the paired authored mesh JSON, license
and derivative reason. **Prepare derivative** uses the genuine original receipt
from the same client. Its separate confirmation creates derivative custody.
The backend checks exact original/derivative lineage and its authored profile;
the UI does not convert files, trust package IDs or infer physical facts. Original
files are limited to 10 MiB and derivatives to 8 MiB by the existing client.
Derivative custody currently requires USDZ; IFC custody remains separate.

Select a building offered by the actual Topology read. The association selection
uses that building's one accepted active building-classification record ID and
the selected committed original/paired derivative asset IDs. **Read current
association records** calls the existing association client's fresh Stock reads.
After reviewing those records, enter a reviewed association statement and reason,
then prepare and explicitly confirm the exact three-command batch once. The
request preserves original custody references, pre-existing identity fields and
exact revision guards. Coordinate units, scale, transform and room mappings
remain unknown or empty. A correlated commit triggers a fresh scan/topology read;
it does not itself assert that a scene can be displayed.

Original and derivative custody are never rolled back when association is
unavailable or fails. Complete retained custody metadata, correlated raw receipt
bodies, association request bodies and lossless association results are visible
under separate disclosures. No numeric receipt or revision is converted through
ordinary JSON number parsing for display.

## Admission and currentness

Custody is enabled only by the existing client's `canPrepare` and actual
`atlas.asset.create` admission. Association receives context only when the
published catalog admits all eight existing read/batch/child commands used by
the association client. Building rename capability supplies no intake authority.
The clients still independently enforce current session, expiry, scope, CSRF,
branding, source lineage, native validation and result correlation.

The form fences local state by actual view allocation, client binding and session
expiry. Synchronous host notifications withdraw the surface and abort owned work
before React's queued updates. Expiry timers and foreground checks do the same.
Changed building/classification/selected receipts fence association work and
hide its former review before paint. Scope/session changes and unmount abort
owned work; no old completion publishes a prepared input or refresh callback.
File selection and metadata editing are local; every read or POST requires its
own deliberate visible action. Editing unsubmitted input discards only that
local preparation, never a submitted client ledger row.

Any unknown custody row or confirmed association intent disables further intake
for the current home context and remains inspectable. The private host records
each genuine, deliberate association confirmation before invoking the unchanged
owner, retaining its exact prepared request and only marking it committed when
the owner returns a correlated receipt. A thrown, aborted or pre-dispatch failure
therefore conservatively leaves that confirmation unknown; it is not a claim
that a POST occurred. There is no resend, retry, ledger reset or inference that an aborted request was not committed. Missing
association command admission never masks these confirmations or releases their
shared custody hold. Retention uses the actual canonical session object, actor,
CSRF marker, expiry and full workspace/home scope; its opaque owner is not command
authority. Session, scope or expiry changes synchronously hide former-owner rows,
and restoration of the same session/home restores its hold. Retained rows remain
visible even when custody admission is also absent, with all actions disabled.
New association still requires all eight commands and fresh owner reads.
The host retains at most 16 confirmations, without eviction or reset. The existing
clients retain at most 16 submitted rows each and own their 30-second bounded
exchanges. This UI adds no recovery or request-ID inspection authority.

Immutable submitted blobs remain in the existing client memory ledgers. The
host additionally retains immutable association confirmations and correlated
receipts. They survive form/view remounts while the same host client and
session/scope epoch remain. They do not survive a full page reload or client
replacement, and this UI is not a picker for older unassociated assets. Lost
responses still require explicit owner reconciliation; reloading is not proof
of safe resubmission.

## Qualification

This isolated source change mounts an intake route in the normal UI. It changes
no backend, contracts, clients, source manifest, styles or original App/sidebar.
Only the existing README TypeScript and Vite source commands are authorized for
this preparation. No browser, listener, real file import, native mutation,
private household data, room mapping, physical calibration, populated recovery
or target deployment is exercised or qualified by source compilation.
