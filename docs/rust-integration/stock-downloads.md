# Managed stock asset downloads

The HTTP host admits `atlas.asset.download` through its existing scoped wire3
`invoke` route. The exact caller envelope passes the canonical download codec
and normal native stock preparation/dispatch. The original AT11 principal,
actual SQLite snapshot, captured source closure, exact target disclosure and
final authorization remain mandatory.

Root forwards that retained principal to the existing NativeMediaAccess and
uses NativeMediaStorage over the same Store, MediaService and original vault.
NativeAtlasAssetDownloads verifies managed HEAD delivery before issuing metadata.
Output authorization calls its `validate_issued`, recomputes the complete exact
canonical wire response through the same codec, and revalidates the graph before
release. Root supplies no replacement grant, renderer, bytes or receipt.

One Host-owned AtlasDownloadHandles cache is shared by issuance and redemption.
GET/HEAD `/api/atlas/media/downloads/{workspaceId}/{homeId}/{token}` authenticates
the current request at the exact configured scope, captures and seals its actual
source graph, and calls the original owner's `redeem`. The token provides no
authority. The owner checks current Access session binding, asset/manifest and
record digest before and after managed delivery; root releases the original
request principal before returning its Media response. All work remains within
the existing admission and ten-second cancellation/budget bounds.

The owner retains at most 1000 five-minute process-local handles. Restart loses
them; no recovery, retention release or expiry control is qualified here.
HTTP advertises 35 reads. Mounted MCP now uses that same host-owned handle
manager and original download owner; issuance delegates to the existing stock
executor and authenticated HTTP GET/HEAD remains redemption. Core-only MCP
remains at 34 and has no download owner. The original UI
owner still needs to bind download links; displayed metadata is not a byte
transfer receipt or a completed user download.

The inspected stock-write loopback runner commits the existing healthy synthetic
PNG/text originals, issues a PNG handle through actual native WebMCP with visible
React metadata before tool return, issues the text handle through exact HTTP,
and compares both authenticated GET bodies and HEAD lengths to the original
bytes. No synthetic business peer, provider, rejected request, stopped control
or expiry/revocation/replay case is introduced.
