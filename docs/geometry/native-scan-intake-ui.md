# Native scan intake

Scan intake is assistant-managed. The normal Atlas view has no **Import scans**
control. It reads retained building scans and provides **Refresh scans**, scene
candidate review, evidence and drawing access, and **Rooms & places**. The native
geometry provider and its custody, association and read-client contracts remain
available to their owners; removing the form creates no new assistant tool,
session, credential, grant or provider route.

## Original and derivative custody

The assistant retains the exact original USDZ or IFC, its source license status,
hash, byte size and custody reason. Preparation uses an immutable copy; one-shot
submission must return a correlated native receipt before original custody is
acknowledged. That receipt establishes an asset, not a building association.
Originals are limited to 10 MiB by the current client.

Authored mesh JSON has separate derivative custody, with its own source license,
reason and genuine original-asset lineage. The current derivative owner accepts
USDZ lineage and limits derivatives to 8 MiB; IFC custody is separate. The backend
validates the authored profile and exact lineage. A derivative is not an exact
binary original, and custody does not establish physical scale, alignment or
room identity. Conversion and source review remain separate obligations.

## Reviewed association and replacement limits

Association requires the actual accepted building-classification record and the
committed original and derivative asset IDs. The existing owner performs fresh
Stock reads, retains evidence and identity fields, and prepares a reviewed
statement and reason with exact revision guards. Its one-shot three-command batch
creates evidence and geometry and updates the building's evidence references.
A correlated result must be followed by a fresh native scan/topology read;
custody or association alone does not prove that a scene can be displayed.

The current association preparation creates `geometryVersion: 1` with
`previousGeometryId: null`, unknown coordinate units, null scale and transform,
and empty room mappings. It does not implement a reviewed successor geometry
version or replacement of existing native room mappings. Retaining a new export
or derivative is not durable native replacement completion. A replacement needs
its own reviewed version/association path and genuine retained readback while
preserving stable place identities and prior source history.

## Admission, unknown outcomes and retention

Custody still requires the current client's `canPrepare` and actual
`atlas.asset.create` admission. Association requires all eight catalog commands
used by its read/batch/child operations. Rename authority supplies neither.
Owners independently enforce the canonical session, expiry, scope, CSRF, source
lineage, native validation and request/result correlation. Changing the view,
session or scope withdraws old visibility and aborts owned work; it creates no
authority to publish a stale completion.

An unknown custody row or confirmed association intent holds further intake for
that home context. A confirmation without a correlated result remains unknown,
including an aborted or pre-dispatch failure; the hold does not prove that a POST
occurred. Missing admission, a failed read, reload or client replacement does not
establish rollback or safe resubmission. The assistant must reconcile the genuine
retained intent with its owner before another mutation. No automatic resend,
retry or ledger reset is introduced by removal of the form.

Immutable submitted blobs, exact requests, lossless numeric receipts and host
association confirmations remain in the existing bounded memory ledgers. The
host retains at most 16 confirmations and each client at most 16 submitted rows;
the clients keep their existing 30-second bounded exchanges. Rows are fenced by
the actual canonical session owner, actor, CSRF marker, expiry and complete home
scope. A temporary admission gap masks visibility without releasing the hold;
restoring that same owner/context restores its retained hold. Memory retention
survives form/view remounts with the same clients, but does not provide durable
recovery across full page reload or client replacement. This change adds no
request-ID inspection authority or historical-asset picker.

## Source qualification

This two-file change removes only the normal Atlas intake mount and updates this
operations note. Native read/refresh, the provider/client contracts, scene
candidate review, room navigation and evidence/document capture remain in place.
The inspected README TypeScript and Vite commands verify source compilation;
they qualify no browser behavior, real intake, native replacement, room mapping,
physical calibration or deployment.
