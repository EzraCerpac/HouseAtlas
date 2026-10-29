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
archive. The public-shell service workers of the
[root offline entry](../offline/root-offline-entry.md) verify only public bytes;
no general persisted private media/document cache is promised.
No automatic hard purge of original assets, tombstones, binding reservations,
audit or reconciliation journals is authorized. Uncommitted staging cleanup is
distinct from deleting committed or retained bytes.

The separately authorized scan-cache amendment permits only verified native
scan derivative bytes in bounded origin storage. Reuse requires a freshly
authorized descriptor for the current authenticated actor, workspace and home,
and an exact match of the offered derivative identity, version, content digest,
type and permission. Session tokens, credentials, descriptors, other API
responses, documents and capture drafts are outside this cache. Explicit refresh
reads the derivative again. Storage eviction or quota failure must fall back to
an authorized server read; browser storage is not a backup or offline access.
The candidate's synthetic reopen counts are documented in
[verification](../contributing/verification.md); browser/PWA acceptance remains
pending and those counts do not establish installed-iOS behavior.

## Opt-in documentary home read packs

The explicitly authorized [home read pack v1](../offline/home-read-pack-v1.md)
adds a bounded saved copy for whole-home reading. Existing authenticated Read,
Media and source scopes authorize capture and every online continuation. The
consumer deliberately retains verified section JSON, permitted originals and
previews, and the complete selected model. Its saved-at date, source freshness,
coverage exclusions and incomplete bytes stay visible. This narrow opt-in
amendment permits documentary retained copies beyond the earlier scan cache;
it does not change the default `private, no-store` server response policy.

A retained copy is readable documentary material, never a session, grant,
authorization cache, native record or disconnected edit. It contains no token,
cookie, CSRF value, owner configuration or native vault path. Already saved
bytes cannot reliably be recalled remotely; device storage and deletion belong
to the explicit local-save choice. External HomeBox attachment references are
not backed-up bytes. This amendment adds no upstream fetch, background
mirroring, outbox, automatic replay, new account, permission screen or
access-window mechanism.
The earlier disconnected guarantee limitations continue for an unsaved home;
a complete local save requires every listed resource verified by digest, type
and size. A fully downloaded partial pack still has partial coverage. Explicit model v2
frontend presentation support, browser and device acceptance remain separate;
the exporter alone does not establish full offline viewing.

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

The promise is server-side read-only outage browsing. The offline outbox
(`frontend/src/outbox/`) is the only disconnected edit path: it keeps Atlas
place name, classification and create edits on the device and sends them when
the server is reachable (automatically or when the person asks). It posts the
stored request unchanged; a refusal such as a changed record waits for the
person. No multi-source synchronization or media mirroring is added. Native
HomeBox edits require its service, a verified route and the user's actual native
rights. Do not offer a fake local edit to a cached inventory field.

The bounded [local capture-draft amendment](local-capture-drafts.md) adds only
explicit opt-in staging of browser-returned originals and evidence form values.
These are local unsent drafts, not cached server media or saved Atlas records.
Submission requires a separate user-confirmed foreground action with current
session, home and fresh place information. Browser-managed storage is not a
durable backup; this amendment adds no worker, automatic replay or
disconnected record edit.

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
