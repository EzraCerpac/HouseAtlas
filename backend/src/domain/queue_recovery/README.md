# Queue recovery validation bindings

`NativeQueueDiscovery` implements the actual storage `QueueDiscovery` trait.
It freezes the complete trusted `QueueConfig` registry, including empty queues,
validates full configuration/alias equality, reparses the immutable original
through the configured stock schema peer, compares its typed HomeBox mutation
route, root idempotency key, context, source/collection, command and digest, and
requires the original owner's complete enqueue derivation. Full original
envelope comparison uses the existing canonical JSON implementation, including
request ID, approval receipt and provider observation; none are excluded here.
Ordered impact keys, actor, target metadata and pending bytes must match exactly.

`NativeQueueRecoveryEvidence` implements storage `QueueRecoveryEvidence` using
the same discovery/original/media peers. Every attempt must equal an independently
retained original-owner `LeasedJob`, including job ID, physical identity,
configuration digest, dispatcher, fence, expiry, scope and byte reservation.
Prepared native/media bytes must match their retained SHA256 digests and
liability. The required native owner qualifies actual prepared bytes and each
retained step. Unknown codec versions return unavailable. Outcome callbacks get
only their own step/liability prefixes, prior outcome and newly added steps;
later termination/readback evidence cannot qualify an earlier outcome. Media
qualification runs for the complete frame and every individual outcome.

Storage retains responsibility for SQL snapshot coherence, complete image
registry equality, journal-envelope digests, state/fence progression and aggregate
liability accounting. These adapters do not duplicate that persistence layer.
An absent journal supplies no evidence of noninvocation, termination or zero
bytes. Validation changes no queue status, liability or invocation authority.

## Required owner construction

The constructor requires all of these inputs, with no production defaults:

- The trusted live enqueue `stock_contract_id` and exact stock schema peer.
- `RecoveryDiscoveryAuthority` and its independently issued opaque grant,
  revalidated against the complete registry before/after retained facts. The
  grant must remain independently valid after the recovery host resets sessions.
- `OriginalEnqueueOwner`: retained original actor/approval/ordered-impact/native
  preparation provenance and exact admitted/claimed attempts. Queue rows and
  actor IDs cannot create those proofs; reuse the live enqueue derivation.
- `QueuedMediaRecovery`: actual original admission/reservation and prepared
  media/liability proofs. Unknown accounting cannot be converted to zero.
- `NativeRetainedEvidence`: an owner wrapper for exact retained codecs, native
  route/body, response/readback, positive no-effect, remote-end and reconciliation
  facts. A response failure or digest carrier cannot prove no-effect/termination.

At the inspected published pins (host `66df612`, storage `2643ece`, media
`8eca841`, access `4a0cd4d`, contracts `49d4a0a`, domain checkpoint `d9e2b59`,
root stock reads `f290da2`), production recovery authority, queued-original media
proof APIs and persisted native evidence codecs are not exported. AT11 ordinary
source capabilities do not expressly authorize discovery/recovery. The host's
existing native route/effect helpers need an owner wrapper with retained original
preparation and actual evidence bytes; they are not copied here. Those producers
remain integration requirements, not qualified by this adapter or by an image.

All callbacks are synchronous and receive no SQL handle. They must perform no
provider I/O, storage reentry or opposing access/vault locking, and retain no
source-core handles that would prevent strict close. Opaque proofs are borrowed
data and are not serialized or reconstructed during image validation.

## Scoped healthy example

`../../jobs/examples/recovery_fresh_populated.rs` uses actual stock schemas, native Atlas
semantics, SQLite storage, these D/E implementations and the actual PR34 peer
constructor. Its explicit synthetic authority/provenance/no-media/native owners
are fixture qualification only. It registers two home-scoped physical queues
with the same workspace/source/collection strings (one queue is empty),
enqueues one fresh quantity-zero intent, claims it, validates a claimed image,
journals exact fixture native/media bytes, then validates a journaled image.
No transport or recovered dispatch is constructed. Unsupported step/outcome,
termination and reconciliation proofs remain unavailable in this fixture.

The task-owned compiler harness lives outside the checkout; manifests/locks and
host/storage/access/media sources remain under their original owners. Ordinary
healthy success does not run deferred rejection, mutation, fault, adversarial,
concurrency, replay or negative-consumer controls.
