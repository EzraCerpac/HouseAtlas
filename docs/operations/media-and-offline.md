# HouseAtlas media and offline expectations

HomeBox remains the owner of inventory photos, attachments and item maintenance
files. Atlas retains scoped references and proxies permitted bytes; it does not
copy those into a competing editable archive. Atlas stores only its own evidence
and optional original geometry assets, separately from the HomeBox backend.

## Storage and content defaults

Prefer immutable, digest-addressed Atlas-owned blobs on a dedicated local
filesystem beside the dedicated Atlas state root. Keep opaque storage keys in
the manifest and authorize access through the server; a browser sees neither
host paths nor source credentials. Retain the original bytes and separate any
safe preview derivative. Commit availability, manifest, record, audit and
receipt coherently after verifying staged bytes. Staged failures are invisible
and cleanup removes only that transaction's bytes.

For a new approved HomeBox instance prefer an explicit local blob directory.
For an existing S3 backend retain it until its recovery capability is established.
Local storage simplifies the proposed LAN-without-Internet expectation; this
is a design inference, not a measured target result. The tagged backend options
are documented in [HomeBox storage](https://raw.githubusercontent.com/sysadminsmedia/homebox/v0.26.2/docs/src/content/docs/en/quick-start/configure/storage.mdx).
An S3 DB plus a bucket prefix copy is insufficient recovery evidence. See the
capture requirements in `recovery-and-rollback.md`.

| Content | Proposed first-release treatment |
| --- | --- |
| JPEG, PNG, WebP | Authenticated proxy; MIME and magic-byte validation; safe decoding/re-encoding in a tested renderer; 25 megapixel decoded ceiling; strip metadata from derivative while retaining original privately |
| SVG or HTML | No inline preview or active pass-through. Original may be an authorized attachment download with safe disposition; SVG rasterization is a later reviewed renderer choice |
| PDF | Authenticated attachment download by default, no inline executable/plugin preview. AT-12 may add a sandboxed, bounded raster preview after review/tests |
| Other stored document | Explicit authorized download only, safe filename and attachment disposition; no arbitrary content execution |
| External URL | Label as external and unarchived; user opens it. Never server-fetch, claim recovery or proxy arbitrary attachment URLs |

The initial size ceiling is 10 MiB per proxied/downloaded or newly Atlas-owned
asset, matching the conservative contract response limit. Stream with enforced
byte/time limits; do not trust Content-Length alone. Existing larger HomeBox
documents stay visible as references with native navigation. Do not drop or
truncate them. AT-12 may propose a bounded configuration adjustment after
target sizing. Keep zero redirects, exact registered source origins, instance/
collection/entity/attachment checks, home authorization and no keys in URLs.
Sniffing and decoded-image bounds complement declared MIME. Unreviewed or
blocked content cannot render. Rendering is an AT-12 choice, not code in AT-05.

Use `Cache-Control: private, no-store` for authenticated private responses and
downloads in the first release. Browser-held in-memory content is not an offline
archive. No service worker or persisted private media/document cache is promised.
No automatic hard purge of original assets, tombstones, binding reservations,
audit or reconciliation journals is authorized. Uncommitted staging cleanup is
distinct from deleting committed or retained bytes.

## Availability cases

| Case | First-release expectation | Acceptance evidence |
| --- | --- | --- |
| LAN works; Internet unavailable | Atlas cold load, local login and previously available local records/media work when NAS and local source services work; external URLs and remote S3 may fail honestly | New browser session, no WAN, bundled assets, local auth, local media and external-link failure checked separately |
| HomeBox unavailable; NAS/Atlas works | Cold load of last complete permitted location/item projections with true last-success and record timestamps; Atlas-owned documents remain available | Restart Atlas and open a new browser; verify persistent cache, no source calls needed to browse and no invented fresh timestamps |
| Network unavailable; NAS/Atlas works | Rooms/items/docs still work. Network facet reports its own stale/unavailable state; stale is not device-off evidence | Fail only Network adapter; no demand/diagnostics, no blocked room pages |
| HomeBox media unavailable | Metadata/references may be cached; bytes are unavailable unless source actually serves them | Clear media placeholder; no promise that metadata cache backs up photos or manuals |
| First run; no successful generation | Explicit empty/unavailable source state with next action | No fabricated house tree, media or successful-cache timestamp |
| Principal revoked or session expired | Login/denial; private cache/media not available to that principal | Direct URL and stale cache denial tests |
| NAS or LAN unavailable; phone disconnected | No cold-start Atlas or private-document guarantee in version one | State the limitation in family acceptance; an already-open page is not evidence of offline support |

The promise is server-side read-only outage browsing. No disconnected editing,
mutation queue, multi-source synchronization or media mirroring is added. Native
HomeBox edits require its service, a verified route and the user's actual native
rights. Do not offer a fake local edit to a cached inventory field.

Proposed refresh is every five minutes while the server is running, with one
non-overlapping generation per source partition and backoff after errors.
Show age always; label cached source data stale after 15 minutes without success
and unavailable on known failure, without changing prior successful timestamps.
This is freshness guidance, not an upstream consistency guarantee. Complete
authorized validated generations replace the cache atomically. Failed pages,
limits, conflicts or tenant mismatch preserve the previous generation. A record
missing from successful offset pages remains unresolved until a targeted
authorized check and review; it is not automatically deleted.

## Optional emergency references

Do not make emergency access depend on an untested NAS recovery. If the household
later needs specific shutoff instructions/manuals when NAS is down, prepare a
small dated export after actual evidence and content/privacy review. Name its
recipient/device, encryption/unlock method, refresh owner and revocation limits.
An exported copy cannot be remotely recalled reliably. This is optional and
does not block the plan-free slice; no valve/circuit fact is invented now.
