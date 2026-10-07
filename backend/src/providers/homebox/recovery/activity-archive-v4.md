# Authorized native archive version four

This bounded codec persists complete native activity `/3` cuts as original-owner
bytes. It is separate from Jobs `/1` and `/2`, and from the SQLite image. The
byte decoder restores evidence data only; no original principal/source grant,
`StockActivityProducer`, session, queued handoff or dispatch authority is revived.
PR78's exact `/3` source remains immutable; this is its explicit successor.

## Dispatcher and archive backend contract

After genuine original-session producer retention and `bind_admitted`, encode
without sealing the capture:

```rust
let packet = NativeActivityArchivePacket::encode(&contracts, &retained)?;
archive_backend.authorize_and_write_exact(original, packet.bytes())?;
// First native I/O may proceed only after authorized durable storage succeeds.
```

The backend line represents the original dispatcher's own authenticated archive
boundary, not an exported default writer. The codec supplies exact bytes and a
read-only `packet.cut()` for that boundary's complete scope/destination decision;
it grants no filesystem, archive or disclosure access and performs no I/O.
`StockActivityRetentionAuthorization` remains mandatory. The dispatcher owns the
actual file/directory sync, atomic publication and any retention-failure latch.

After each fact commit, retain the same original session's exact successor,
then encode and durably archive that complete cut before further I/O:

```rust
let next = session.retain_producer_successor(retained.producer())?;
retained.retain_successor(&contracts, next)?;
let packet = NativeActivityArchivePacket::encode(&contracts, &retained)?;
archive_backend.authorize_and_write_exact(original, packet.bytes())?;
```

The encoder checks quiescent capture, the genuine producer's actor/scope, the
complete sealed record and every captured raw native result. It does not close
capture; `seal` remains the separate final in-memory archive operation. A packet
cannot encode pending/in-flight/unqualified results. The explicit format is
`houseatlas-homebox-stock-activity-archive/4`; limits are 16 MiB and 256 events.
Output writing is capped during serialization. This archive contains private
native/preflight/media metadata and belongs only at its authorized destination.

The packet carries the exact accepted registration, original/final operations,
permit, body acceptance and physical hold, every event's actual sequence,
operation and admission/dispatch/observation facts, and actual captured native
receipt/observation with prior operation/plan/permit/authority. Sequence and
registration counters use canonical decimal strings. Original wire Values,
number tokens, native fields, snapshots, approval, liability, generated targets
and members, remote activity and refreshed readback metadata remain lossless.
Opaque AT11 principals/grants and original session brands are never serialized.

## Independent restoration and recovery qualification

The real archive backend supplies a genuine independent
`NativeActivityArchiveReadAuthorization` binding:

```rust
let decoded = NativeActivityArchivePacket::decode(
    &contracts, actual_archive_bytes, &original_archive_read_binding,
)?;
let archive = RestoredNativeActivityArchive::new(vec![decoded])?;
let evidence = HomeboxRestoredStockActivityEvidence::new(
    &contracts, &archive, &original_provenance_and_media_evidence,
);
```

The required method is:

```rust
fn authorize_archive(
    &self,
    bytes: &[u8],
    cut: &RestoredNativeActivityCut,
) -> storage::Result<()>;
```

It must independently authenticate the actual original archive origin,
destination/generation and exact bytes, the original producer's actor/physical/
operation association and raw native provenance. A public digest, mirrored
image record, caller-supplied ID or arbitrary JSON is not that binding. No
implementation or success default is supplied by this leaf. `cut` is candidate
DATA with read-only getters, not an authentication result. It has no public
constructor, serializer or conversion into a sealed AT07 record or live producer.
The opaque read binding remains borrowed by the restored evidence and is
revalidated on qualification, with no SQL reentry or live grant refresh.

Closed packet decode rejects lossy/aliased encodings by exact reencoding and
uses the original Storage private codecs for native operations, permits,
admission/preflight, dispatch and observation facts. It checks the original
baseline and actual native mapper/schema/timestamp/reducers, complete attempt,
raw correlations, final permit/body acceptance/hold and own historical prefixes.
Archive origin authentication is separate from event effect qualification.
Every image frame must match its own archived prefix/previous/permit/body
acceptance/physical hold; later receipt/readback/end/liability cannot qualify an
earlier cut. Complete-current records reject duplicate operation IDs and global
event sequences; old snapshots of one operation are not separate current records.

`HomeboxRestoredStockActivityEvidence` implements the actual accepted
`StockActivityRecoveryEvidence`. The independent original provenance/media
peer, trusted complete physical registry and offline administrative discovery
remain mandatory and separately owner-bound. Keep base `RecoveryValidationPeers`
for native/stock/upload/Jobs separate. Image validation cannot create a producer
brand or authorize recovered invocation. Genuine original opaque identity and
permission provenance stay with their original owners, not inside decoded DTOs.

## Required integrator declarations and exact source

The owned `activity_storage_bridge.rs` calls original accepted data encoders and
pure baseline checking only. The integrator declares it inside
`storage::stock_activity`:

```rust
#[path = "../../providers/homebox/recovery/activity_storage_bridge.rs"]
pub(crate) mod retained_native_codec_bridge;
```

At storage root, expose the module alias to the owned recovery leaf:

```rust
pub(crate) use stock_activity::retained_native_codec_bridge;
```

No root/storage/shared schema/router/dependency/module declaration is edited by
this leaf. The external harness makes these declarations, plus the previously
required writer bridge/recovery/domain declarations. No private retained-record
constructor, live producer constructor, SQL or copied storage codec is exposed.
This exact seam was sent to the original Storage owner and parent handoff.

Final source composition pins original-owner Storage71
`2befc971bd8b5590ab6b139b1163fbcd82256c66`, actual writer
`c784be5776b614f8f0bb225fcb5355ecb9e90e0d`, main dependencies/media/schema/lock
`87ad201140edb7b3afdb4396095a320c2926eafe`, and original-owner corrected domain
`fd72542686112e594d9a6f63b4782a62b5d9e6ef`. The original Storage6e54/8a171a sources
and earlier codec inputs remain separately retained outside Git. The codec,
baseline, retention and recovery blobs are identical between Storage6e54 and
2befc97; the final composition uses the original owner's reservation corrections.

## PR78 review and selected healthy evidence

PR78 automatic findings 4207869490 and 4207869506 are addressed in the successor.
An ambiguous capture cannot return the positive `NeverInvoked` claim. The
accepted native dispatch enum has no unavailable variant, so the gate returns
an explicitly uncorrelated response-less end-unproven signal; it is not captured
or qualified as native proof. The native reducer preserves the unproven physical
hold, or the original evidence owner refuses its unqualified fact commit. No
receipt, cleanup or noninvocation proof is inferred from contention/cancellation.

Readback compatibility now follows the accepted workflow's actor/physical
binding rule. The actual refreshed authority is captured and encoded unchanged;
the genuine original inner port independently authorizes its GET. Archive and
native-prefix validation use the same compatibility rule, without minting
access/source/dispatcher permission from metadata.

The sole new healthy selection is
`providers::homebox::recovery::healthy_activity_v3::healthy_profile6_authorized_archive_roundtrip`.
It uses actual AT11/AT51, SQLite profile6 and accepted native data/evidence codecs,
with inspected synthetic original authority, positive zero media and archive/
administrative peers. Three freshly produced pre-I/O/dispatch/observation packets
are written with create-new mode 0600, file sync and directory sync, read unchanged,
and decoded against independently retained synthetic original archive receipts.
A healthy refreshed authority is preserved. Only the current final cut is placed
in the restored archive; its four own-prefix image events qualify through the
actual restored evidence adapter. Closed-image bytes remain unchanged, confirmed
effects retain false causal/provider-CAS claims and the unproven physical hold.

Twenty other tests, including earlier examples, remain filtered. No runtime
busy/concurrency/rejection/omission/replay/corruption/expiry/revocation/crash/fault
control, restore/reopen, recovered execution or real provider/account/credential/
grant/deployment/money action runs. File sync success is not a crash qualification.
Private input manifests, source archives, actual packets and validation logs stay
outside Git; no optional repeated hosted CI or manual reviewer is requested.
