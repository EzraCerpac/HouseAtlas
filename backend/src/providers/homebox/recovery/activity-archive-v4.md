# Authorized native archive version four

This bounded codec persists complete native activity `/3` cuts as original-owner
bytes. It is separate from Jobs `/1` and `/2`, and from the SQLite image. The
byte decoder restores evidence data only; no original principal/source grant,
`StockActivityProducer`, session, queued handoff or dispatch authority is revived.
PR78's exact `/3` source remains immutable; this is its explicit successor.

## Dispatcher and archive backend contract

Before admission, encode the genuine original-session reserve/queued producer:

```rust
let producer = session.retain_producer(operation_id)?;
let packet = NativeActivityArchivePacket::encode_producer(
    &contracts, &producer, max_frame_bytes,
)?;
archive_backend.authorize_and_write_exact(original, packet.bytes())?;
```

`encode_producer` accepts only actual pre-admission reserve/queued cuts, with no
permit, accepted body, physical hold or captured native result. It borrows the
sealed original-session producer; no admitted carrier or recovered producer is
manufactured. The original authority backend must authorize this complete
historical cut and its destination just as it does the admitted cut.

After genuine admission, original-session successor retention and `bind_admitted`,
encode without sealing the capture:

```rust
let packet = NativeActivityArchivePacket::encode(&contracts, &retained, max_frame_bytes)?;
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
let packet = NativeActivityArchivePacket::encode(&contracts, &retained, max_frame_bytes)?;
archive_backend.authorize_and_write_exact(original, packet.bytes())?;
```

The encoder holds the original capture mutex from its quiescent-state check
through complete validation, serialization and final exact source comparison.
The capture's `begin()` cannot start inner I/O during encoding. This addresses
PR88 discussion 4209603558 in source; the concurrency control remains unrun.
The encoder checks the genuine producer's actor/scope, the complete sealed
record and every captured raw native result. It does not close
capture; `seal` remains the separate final in-memory archive operation. A packet
cannot encode pending/in-flight/unqualified results. The explicit format is
`houseatlas-homebox-stock-activity-archive/4`; limits are 16 MiB and 256 events.
Both encoding methods require the caller's explicit `max_frame_bytes`; the
actual limit is its minimum with the 16 MiB codec ceiling. A nonallocating pass
bounds borrowed variable-size source data before validation, peer String codecs
or native row conversions allocate. The encoder streams individual original
codec strings/events/native rows into an output writer enforcing that same cap
on every write; it never constructs a complete unbounded output row first.
Zero capacity cannot encode a packet. Encoding smaller than the required frame
returns an error without a partial packet. These refusal paths are source logic,
not runtime-qualified held controls. This archive contains private
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
Every embedded Storage string is also explicitly re-encoded with its original
owner codec and compared byte-for-byte before the decoded value is accepted:
original/final/event/native-prior operations, current/captured permits and all
admission/dispatch/observation facts. This closes PR88 discussion 4209218048 at
the owned data bridge, independent of what equivalent encodings the underlying
peer decoder may accept. The outer packet check alone cannot establish nested
string canonicality. Positive fresh packet composition exercises all five
checked codec families; held noncanonical/corruption probes remain unrun.
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

Both in-memory and restored adapters implement the required
`queued_reservation_jobs(registration, queued_cut) -> Result<jobs::LeasedJob>`
on that actual Storage trait. They require an initially Queued Reserve or later
Queued event, exact registration/event correspondence and a validated own
historical prefix before calling the mandatory original evidence owner. The
restored adapter reauthenticates the original archive binding first. That owner
must independently correlate the original producer/history, physical identity
and actually observed Jobs occupancy at this exact cut, returning its original
retained attempt. No image-derived occupancy, final Jobs state, public lease DTO
or success default is supplied. Storage independently checks the returned
immutable attempt and registry/job closure in the already validated image.
This callback grants no recovery, disclosure or dispatch authority.

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
`48e856068f8351b9256ef7912fc93619c259e79f`, actual writer
`c784be5776b614f8f0bb225fcb5355ecb9e90e0d`, main dependencies/media/schema/lock
`87ad201140edb7b3afdb4396095a320c2926eafe`, and original-owner corrected domain
`fd72542686112e594d9a6f63b4782a62b5d9e6ef`. The original Storage6e54/8a171a/2befc971 sources and earlier codec inputs
remain separately retained outside Git. The codec, baseline and retention blobs
are unchanged from 2befc971; recovery now requires the queued Jobs callback.
The archive source marker selects 48e8560 explicitly. Earlier packets and their
source-specific validation records are preserved, not relabeled as this input.

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
`providers::homebox::recovery::healthy_activity_v3::healthy_profile6_configured_producer_archive_roundtrip`.
It uses actual AT11/AT51, SQLite profile6 and accepted native data/evidence codecs,
with inspected synthetic original authority, positive zero media and archive/
administrative peers. Five freshly produced reserve/admission/dispatch/observation/queued packets
are written with create-new mode 0600, file sync and directory sync, read unchanged,
and decoded against independently retained synthetic original archive receipts.
A healthy refreshed authority is preserved. The configured limit is 256 KiB;
producer and admitted encoders also succeed at their exact positive byte bound.
The queued reservation is fresh sequential metadata under the existing unproven
physical hold, with no second admission, native I/O or concurrency/control probe.
Storage does not invoke the cross-lane Jobs callback for this native-held cut;
that callback is compiled and source-inspected only. The fixture original owner
returns unavailable if asked for unretained Jobs occupancy, never a fabricated
lease or default success. Only the current final native cut and independent queued cut are placed
in the restored archive; their five own-prefix image events qualify through the
actual restored evidence adapter. Closed-image bytes remain unchanged, confirmed
effects retain false causal/provider-CAS claims and the unproven physical hold.

Twenty other tests, including earlier examples, remain filtered. No runtime
busy/concurrency/rejection/omission/replay/corruption/expiry/revocation/crash/fault
control, restore/reopen, recovered execution or real provider/account/credential/
grant/deployment/money action runs. File sync success is not a crash qualification.
Private input manifests, source archives, actual packets and validation logs stay
outside Git; no optional repeated hosted CI or manual reviewer is requested.


The original `ea510dbc0f796d79122c48edbf8ddab4cc679d0e` implementation and its
verified one-commit bundle remain preserved outside the resumed delta. This
successor explicitly completes PR78 comments 6040104469 and 6040972234 rather
than asking the dispatcher to serialize pre-admission data or enforce the only
encoding bound after allocation. Final compilation and selected healthy evidence
are recorded against the exact resumed source outside Git.
