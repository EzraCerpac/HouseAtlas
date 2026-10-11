# Drawing evidence lookup

Issue #150 removes the whole-list rejection for building evidence lists longer
than 64 references. `NativeSceneDrawing` checks up to 64 references sequentially
under a ten-second deadline. If that page has no matching PNG, the dialog reports
how many references remain and offers **Check next references**. Only exhaustion
of the final page reports no matching current PNG. An unreadable reference stays
qualified as unreadable across continuation; it does not become a missing match.

Every candidate still goes through the native evidence document owner. The
component requires a current frame, the requested original asset SHA256,
`inline-png` mode and PNG asset/Blob MIME before displaying its object URL. No
hash, document path or continuation supplies authorization. The owner still
performs its original verification, preview selection and current-record checks.
This change adds no client interface, route, association or access capability.

Each continuation releases the previous page's resources. Close, replacement
selection and late completion release their exact frame, unsubscribe and revoke
the owned object URL. A selection change resets pagination even if the earlier
selection objects later return. Timeout reports an incomplete read; closing and
reopening starts a fresh lookup. There is no automatic continuation or retry.

## Synthetic browser acceptance

`frontend/lantern-tests/native-scene-drawing-150.mjs` compiles the actual React
component with a deterministic fake document client. Its explicitly selected
cases use generated UUIDs and the checked-in synthetic PNG. They exercise actual
Chrome pointer actions, PNG rendering, page continuation and resource counters.
The first, middle and last cases match positions 0, 64 and 128 of 129 references.
Missing exhausts all three pages; page-bound stops after 64 of 5,000 references
until explicit continuation. Close and selection cases check owned lease, URL
and subscription cleanup, including a deliberately late fake read completion.
Blob read failure also releases the already-opened frame without creating a URL.

Inspect the complete runner and its production imports before the exact command
registered in the root README. Use pinned Node 26.10.0 and the locked frontend
installation. Supply an inspected Chrome executable and an owned private output
directory outside the checkout. The runner serves static built synthetic content
only on numeric loopback, with an ephemeral port and fresh browser profile. It
has a 120-second budget and removes owned browser, listener and scratch state.
It contains no external transport fallback or real credentials.

These named checks stay outside ordinary CI. Selection races and Blob read failure
are component-level synthetic concurrency/failure checks in the separate regression
lane. They do not test
native grant revocation, crash, replay, expiry, providers or an installed service.
Fake document frames establish component pagination and cleanup only; they do
not qualify native evidence authorization, original-byte verification, household
media, physical devices, deployment or user acceptance.
