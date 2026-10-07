# Read slice corrections

This narrow candidate starts from immutable first-slice commit
fde9586f41c32924543fe7066fb0481b02744b8c, tree
ee701b32ab4725aaf85154d989a151ad7d365f88. The larger core continuation
is on a separate branch and introduces no changes here. Exact correction review
is required before acceptance or main merge.

The outer HTTP response adapter emits the actual generated frozen `ApiError`
DTO with schemaVersion, sanitized code/message, server requestId and nullable
currentRevision. It handles application, metadata, extractor and method failures
through the same response boundary, preserving the trusted routing Allow header.
All responses receive private, no-store,
no-cache, nosniff, same-origin referrer policy and Cookie/Origin/fetch-site Vary.
Underlying SQL, credential, path and provider details do not enter the body.
The listener initializes an OS-random private identifier seed before serving;
request UUIDs derive from that seed and a sequence, without empty fallback IDs.

Host, Origin, Referer, Sec-Fetch-Site, Authorization and X-Atlas-CSRF values are
checked for multiplicity and ASCII encoding before constructing access evidence.
Malformed values remain errors rather than becoming absent metadata. Actual
HTTP/2 authority remains checked against the bound HTTPS origin. Multiple Cookie
fields are accepted only on HTTP/2 and joined in order with semicolon-space as
specified by [RFC 9113 section 8.2.3](https://www.rfc-editor.org/rfc/rfc9113.html#section-8.2.3).
The complete Cookie value retains the existing bound, and duplicate Atlas
session-cookie names are rejected before token parsing. No first-header fallback
is used for access metadata.

React owner commit 0f250a94d09386744aba124d8b6823f1e374b6eb changes exactly
one client line above f491bf1bc2c8ac2af2f004f9aac99b9368dda7d6: a generic
403 produces denied rather than asserting source revocation. Explicit revoked
view states remain unchanged. Integration makes no UI-owned source rewrite.

Verification remains the inspected source runner and actual positive loopback
browser flow. The smoke checks all canonical private headers and supplies a second ordinary
browser cookie alongside the actual session. No denied,
malformed-header, rejection, exploit, replay, expiry, revocation, fault, crash or
concurrency request is issued. No negative aggregate or hidden control is added.
These source corrections and positive results do not qualify wider security,
provider, recovery, target or production behavior.

The ready-for-review checkpoint 46047d0193fbce720bba7a1d209b5428c51dba94
received three further HTTP adapter corrections before landing. Session HEAD
and other unsupported session methods return 405 with Allow: GET without
calling the CSRF-rotating access GET method. Axum calculates representation
Content-Length and suppresses HEAD bodies after the canonical response layer.
Caller-selected malformed scope IDs
map to the established 404 boundary, without changing internal access parsing.
Rooms and items now reuse the same compact source-key and explicit extension
field projection as bootstrap/scoped browser views. Their ordinary successful
GET results are compared with the corresponding entries from the real view.
No rejected method or malformed selector request is exercised; those fixes
receive source review only. Broader core adapters remain a separate continuation.
