# Encrypted credential boundary

This namespace implements `CredentialBoundary<C>` as
`FileCredentialBoundary<C, A>`. Production uses an existing native Linux Secret
Service key and authenticated complete-record ciphertext on a private local
filesystem. The application authority `A: CredentialAuthority<C>` must delegate
to its original enrollment/session/cancellation owner; this module issues no
application authority and cannot use the receipt-only capture. The application
mount, root declarations, exact dependency lock and publication manifest remain
integrator-owned. This source is not an operational credential-runtime approval.

## Storage and authority

`new_existing` accepts an existing canonical absolute directory owned by the
current effective UID with mode 0700, a trusted non-whitespace stable host ID, and the original
owner Arc. It does not create directories, change permissions, provision keys,
unlock stores, enroll accounts, or create an initial registration record.
The explicit `enroll_atomic(context, binding, initial_record)` creates only an
absent record for the actual original authority and returns its held lease.
Initial binding/host must match exactly; state is Disconnected and revocation
NotRequested, with no issued client ID, identity, credentials, pending
authorization or checkpoint. App name must contain non-whitespace text. Native
key availability is required; no key is provisioned. First publication uses
atomic Linux NOREPLACE, preserving a racing file without replacement. Metadata
initializes only after the fenced commit succeeds. The original host owns
trusted startup configuration and enrollment permission.

For IssuedWebsite, the host then explicitly calls
`initialize_website_client(context, &mut lease, preprovisioned_public_id)` before
OAuth begin. It revalidates the same original active context/proof, authenticates
the exact-binding pristine disconnected website record, and sets only the public
client ID through existing fenced persistence. It does not create an account,
client, grant, callback configuration or key. The initial no-ID enrollment shape
is unchanged; the host must wire this separate trusted startup call. The ID must
be 1-200 ASCII alphanumeric/underscore/hyphen bytes and exclude the dynamic-client
marker. A successful write freezes it. LocalPublicClient uses the core's dynamic
client path and needs no website initialization.

A known subject must remain present and unchanged in every persisted record,
including terminal bookkeeping; clearing it cannot discard the account anchor.
A stopped lease may not introduce client or identity metadata.
Missing or corrupt ciphertext is preserved; ordinary persistence requires a
successful authenticated load and its exact ciphertext preimage.

A non-cloneable `Send + Sync` lease retains the original opaque authority proof
and an exclusive nonblocking advisory file lock until Drop. Internally derived
SHA-256 selectors include host, registration, actor, workspace and home; epochs,
subject, email and display labels do not select another file or lock. The AAD
also binds the original authority epoch. Cancellation rotation retains the
original file/lease. An active lease may persist the exact currently captured
binding to adopt a trusted reconnect cancellation epoch; actor/home/registration
and authority cannot change. The captured lease proof never changes, and a
stopped lease cannot adopt an epoch. Core must explicitly perform the trusted
record transition; storage does not mint or recapture a proof. Cooperative
processes and aliases share the same persistent lock file. This is local-filesystem coordination, not a NAS/distributed protocol.

The owner must revalidate the original context and proof, stop local use and
advance cancellation, and fence the final preimage check/rename/sync against
current authority changes. Its narrow stopped capability allows only terminal
bookkeeping under that original lease: existing token/checkpoint/authorization
material can be preserved or cleared, never introduced or changed. Ordinary
revalidation rejects stopped leases. Local stop does not depend on native key
availability or readable ciphertext; encrypted persistence still does. No fresh
receipt proof or epoch rebase is used. The operational clock comes from the host
SystemTime and rejects values outside the finite positive safe-integer range.

The key is freshly read for each encryption, decryption and revalidation call;
only its SHA-256 fingerprint is retained in the lease. Linux lookup requires
exact HouseAtlas/application-purpose/registration attributes, exactly one
unlocked item and no locked matches, an unlocked default collection distinct
from the session collection, and the same unique item in that default collection.
Missing aliases or foreign/session-only matches remain unavailable. A 32-byte
key and a five-second async bound are required. It uses DH-encrypted Secret Service transport, never an unlock, prompt,
creation or deletion API. Missing, locked, ambiguous, changed or inaccessible
keys remain unavailable without cached-key, plaintext or mock fallback. Every
non-Linux target returns unavailable.

AES-256-GCM encrypts one versioned frame with a fresh OS-random 96-bit nonce and
registration-bound AAD. Random nonces have a collision risk; this source does not
establish a per-key encryption budget or rotation qualification. Authentication
completes before any record/checkpoint decoding. Ciphertext replacements use
owner-only regular single-link files, descriptor-relative no-follow operations,
exclusive staging, preimage checks, atomic rename and file/directory barriers.
Rename is the commit point; a subsequent barrier failure returns unavailable
without asserting rollback or automatically retrying.

## Complete record and dependencies

`record` preserves every original `RegistrationRecord` field in one bounded
version-1 envelope, including previous credentials, pending authorization and
all four checkpoints together. It uses the original host checkpoint codec
unchanged and requires its complete canonical frame, including explicit nullable
reply fields. The plaintext wrapper has no Debug, Display, Clone or Serialize.
Successful outer plaintext buffers, native key bytes and AEAD scratch buffers
are zeroized on Drop. Peer ProtectedValue Strings, intermediate checkpoint/serde
allocations and ring's internal key representation are not promised erased.
The size limit does not bound peak serialization memory. Plaintext must never
reach files, logs, browser/model DTOs or exports.

The proposed root dependency pins are `ring =0.17.14` (defaults false,
`alloc,std`), `zeroize =1.9.1` (defaults false, `alloc`) and Linux-only
`secret-service =5.2.0` (defaults false, `rt-tokio-crypto-rust`). Existing exact
rustix fs/process, SHA2, getrandom, Tokio and tempfile support the remaining
code. Root must adopt/reconcile these dependencies before mounting the module.
The external compiler harness retains all 283 original registry version/checksum
rows and adds the direct Secret Service graph. Keyring3.6.3 is not used because
its native implementation automatically unlocks locked matches.

The Secret Service5.2.0 registry checksum is
`5107b24b91445dd2aa449a258a1807b63240942157292354dc5bfdbeb8bc6db8`, with
[release source 1fe4fbe4](https://github.com/open-source-cooperative/secret-service-rs/tree/1fe4fbe405b152bc969deb5de417847e1e4e4c7b).
The existing lock checksums for ring and zeroize remain authoritative. No new
system package, OS permission, live credential or provider operation is needed
for the source-only compiler checks.

## Healthy evidence and remaining integration

`healthy.rs` covers 252 positive complete-record codec round trips across both
registration kinds/authentication choices, lifecycle/revocation metadata and
all checkpoints. `encrypted_healthy.rs` uses the actual file/AEAD/boundary code
with explicitly synthetic key/authority peers and disposable private files. It
covers all four checkpoints with old credentials and pending authorization,
checks token markers are absent from ciphertext, persists, drops its lease, and
verifies full-record equality through a fresh adapter reopen. Production native
key lookup is compiled but never called by these fixtures.

The original host separately owns synchronous infallible metadata-only
`LifecycleEnvironment::cached_display`; no I/O or credential lease belongs in
that method. Original owner implementation, trusted startup enrollment
configuration, mount, root pin adoption, composed review/CI and operational
qualification remain integration requirements. The separate regression lane
below covers only its named synthetic enrollment cases. Other negative, fault, replay, expiry, revocation, omission, adversarial
and aggregate controls remain held and unrun.
Healthy success does not qualify OS service behavior, deployment or paid use.

## Separate enrollment regression lane

Policy commit `8f4065a3ee831df0b30d14f597c25a7bbcc7f212` permits exact reviewed
synthetic concurrency/denial/failure cases outside ordinary CI. The explicit
allowlist in `enrollment_regression.rs` is `empty-enrollment`,
`existing-enrollment-denied`, `racing-enrollment`,
`blank-app-enrollment-denied`, `blank-host-construction-denied`,
`invalid-issued-client-transition-denied`, `known-subject-clear-denied`, and
`configured-website-client-initialization`. The positive website case verifies
that only the supplied synthetic public client ID changes and survives reopen. The
metadata cases use only fixed synthetic public identifiers; they assert denied
writes preserve ciphertext and metadata after reopen. The blank-host
case checks constructor rejection before directory acquisition and then enrolls
and reopens a valid LocalPublicClient record. The blank-app denial occurs before
key/authority or file acquisition and then proves a valid enrollment remains possible. Owners
review the pinned source and all imported helpers before execution. Each case
uses a fresh private temporary root, a fixed synthetic key and synthetic authority; no native lookup,
network socket, provider, real credential, user data or deployment is involved.
The racing case starts two independent adapters for the same registration, holds
the successful lease until both attempts finish, and checks a single intact
record survives. Every case removes its disposable state on completion.

The separate external entrypoint is selected explicitly with `--case NAME`;
there is no broad discovery, ordinary-CI alias or workflow change. Its run is
bounded by an external timeout and the fixture's bounded synchronization. Record
exact source, command, named case and outcome in the review handoff. Success
establishes only these isolated synthetic regressions and releases no G1-G5 or
native/provider/recovery qualification. Other held classes remain held.
