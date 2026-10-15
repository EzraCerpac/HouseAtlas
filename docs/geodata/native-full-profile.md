# Explicit full native Document profile

The full profile selects one authoritative SQLite connection for existing native
Atlas and Stock routes plus v2 Documents. Its outer lineage is
`houseatlas-rust-storage/geodata-full/1`, outer schema 1 and Document contract
2.0.0. The inner native metadata, migration ledger 1–5, SQLite user_version 5,
29 predecessor tables and all v1 record/history bytes keep their original meaning.
The separate published fresh Document profile remains original-only and exclusive.

`storage::geodata_full::copy_v5_to_full` accepts a closed private predecessor,
an independently supplied SHA-256 and complete native/Stock/queue/media recovery
peers. It uses SQLite Backup into a new private destination, then adds only outer
metadata/ledger and Document tables. It compares typed values and hidden rowids
of all 29 tables and internal SQLite tables, including sqlite_sequence. It copies
available historical media and preserves unavailable v1 media semantics. Unknown
catalogs, stock-activity/presence extensions and unavailable required peers stop
selection. Commands, old audits and Stock derived rows are never replayed.
The immutable SQL conversion receipt retains source custody, the exact inner
profile and preserved-row digest. The detached returned report additionally pins
that receipt and final target custody; recovery bundles retain the canonical
receipt and its hash. This API performs no startup migration, account provisioning, queue
resume, import of source files or deployment.

`AtlasStore::open_existing_geodata_full` first validates read-only, then validates
the selected writable handle before enabling writes. Native, Stock, queue and
media peers validate the same read snapshot as Document receipts, histories,
references and retained original bytes. Available legacy assets retain their
original native formats and purposes; conversion never promotes them to Documents.
Full capture/verify/restore use a separate exact profile bundle and restore only
to a new private directory. They do not select a service or restore authority.

`Core::with_full_geodata_store` and `Host::with_full_geodata` bind the facet to the
actual Core.store connection, native access and media vault. An opaque store
identity is rechecked on requests. The established Store-then-Access lock order is retained; borrowed
Document methods reuse the held native transaction authorization. Both v1 and v2
SQL writers enforce workspace-wide ID uniqueness across their respective tables.
Existing legacy routes compose with the v2 routes described in
[native-document-persistence-v2.md](native-document-persistence-v2.md).

Persistent selection is explicit. After offline COPY qualification and an owner
controlled atlas/media replacement at the same configured path,
`persistent::bind_full_geodata` validates the complete target and unchanged
original access/configuration receipt, then creates a distinct full-profile
receipt. It does not overwrite the legacy receipt or adopt another access inode,
configuration, authentication mode or origin. Full startup requires this receipt
and the separately hash-pinned trusted source policy; see
[full-document-server-selection.md](full-document-server-selection.md).
This startup peer is expressly queue-free and refuses any populated queue or
independent SafeRendered policy without its owner. The peerful storage API is
required for other capability selections. Default startup remains legacy-only.

The named generated check is:

```sh
cargo run --offline --locked -p houseatlas-backend --example healthy-native-full-geodata-profile
```

It uses a disposable synthetic native dataset with nonempty Stock, batch and
upload history, exact COPY preservation, current native sessions, continued
legacy Stock reads/writes and 76 generated original Documents with 75 unique
hashes, six MIME families and known/unknown licence references. It checks pages
50+26, optional retained Missing bytes, full capture/verify/restore/reopen and
explicit persistent binding/reopen at the unchanged configured path. It uses no private source originals,
production database, provider, deployment or actual populated household restore.
Metadata-only compatibility with an accepted predecessor is separate evidence;
this generated check does not qualify actual household bytes or a release.

Full profile also selects `png-display-v1`. Original PNG intake attempts actual
bounded single-input PNG decoding and RGBA8 re-encoding with metadata stripped.
A successful proof atomically retains a separate preview Asset, derivation
receipt, reference and audit with the original Asset and Document. The original
byte pin and independently reviewed source policy remain authoritative. Supported
optional renderer size/format refusals leave `preview:null`; cancellation or an
expired work budget aborts the operation. JSON, GIS, TIFF and PDF originals do not
gain PNG qualification. PDF-original local display is a consumer choice documented
in [native-document-reader.md](native-document-reader.md).

`GET /api/atlas/documents/v2/workspaces/{workspaceId}/homes/{homeId}/documents/{documentId}/preview?expectedRevision=N`
returns only a retained, rerender-verified qualified PNG under current native and
source authorization. It returns `Content-Type: image/png`, private/no-store and
nosniff framing. `x-atlas-document-frame` is URL-safe unpadded Base64 of canonical
JSON with `mode:"preview"`, the exact Document revision, scope and preview Asset
pin; originals retain `mode:"original"` and their measured source MIME. GET never
creates a preview. List/get use the existing read projection and report preview
availability. Title/lifecycle edits to qualified PNG Documents require both exact
original and preview Asset guards. The create response keeps `{document,asset}`;
the additional immutable output is pinned in `document.payload.preview.asset`.

Historical and tombstoned preview references retain their bytes and derivation
receipts. Recovery reruns the actual renderer against the exact original and
compares every output byte, pin, lineage and canonical receipt. The v1 PNG
verifier pins the checked-in renderer/decoder source and Cargo.lock; changing
that source closure requires a separately selected versioned verifier/profile
or explicit reviewed requalification, never rewriting old history. This profile
makes no claim about GIS conversion, physical placement, source accuracy or
multi-input compositing.

The explicit `full-geodata-backup` command accepts a cleanly quiesced WAL-header
source only when every source sidecar is absent. Under the service lease it pins
both original database files, copies their exact bytes into a retained private
snapshot, and normalizes journal mode only on the copies. Complete profile,
access and media validation then precede capture. Original files are never opened
by SQLite for this capture path and their bytes/identity/sidecar absence are
rechecked afterward. The report separately pins original source custody and the
normalized captured bundle; a live or ambiguous WAL dependency is refused.
