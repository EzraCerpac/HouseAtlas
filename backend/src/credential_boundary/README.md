# Encrypted credential boundary

This isolated namespace owns the complete private registration-record codec.
It is an implementation prerequisite, not a concrete `CredentialBoundary`,
encrypted store, runtime configuration, or sign-in grant. The application does
not mount this module. Root module declarations, dependency/lock reconciliation,
publication manifests and final integration remain with the integrator.

`record::encode` preserves every original `RegistrationRecord` field in one
bounded versioned plaintext envelope, including previous credentials, the pending
authorization and all four refresh/exchange checkpoint variants together.
`record::decode` is solely for already authenticated/decrypted bytes belonging to
the original leased registration. The original `ai::host::checkpoint` codec is
used unchanged. Version 1 requires its complete canonical checkpoint frame,
including explicit nullable reply fields. The output-size limit does not bound
peak serialization memory. These buffers must never reach files, logs, browser/model DTOs or
an ordinary export. The plaintext wrapper intentionally has no Debug, Display,
Clone or Serialize implementation. This wrapper does not zeroize memory.

## Required backend input

Source inspection of the public AI integration and main found only synthetic
credential peers and the `BoundExchange` delegator. `access::credentials` hashes
passwords; it does not encrypt OAuth records. Existing direct Rust dependencies
provide no concrete OS credential-store adapter or authenticated-encryption
credential implementation. A usable backend source pin, or a separately agreed
maintained backend dependency choice, is required before implementation of the
concrete adapter. A generic injected port or synthetic ciphertext slot cannot
clear this missing-runtime requirement.

The official DevKit pin
[`f723814abdccec135b519c451fb6e1992ee5e933`](https://github.com/openai/sign-in-with-chatgpt-devkit/tree/f723814abdccec135b519c451fb6e1992ee5e933)
requires a host-supplied `CredentialEncryption` in its local `ConnectionStore`.
Its
[Electron example](https://github.com/openai/sign-in-with-chatgpt-devkit/blob/f723814abdccec135b519c451fb6e1992ee5e933/examples/paste-perfect/electron/credential-encryption.ts)
uses Electron main-process `safeStorage`, requires readiness/availability and
refuses Linux's hardcoded-key `basic_text` backend. That external example is not
an existing HouseAtlas Rust backend. Reusing it would require an explicitly
selected companion runtime and private transport; it cannot silently establish
server or NAS eligibility. The DevKit store has its own profile format and is
not a complete codec for HouseAtlas's original `RegistrationRecord`.

The concrete adapter must retain an exclusive original-registration lease
across processes and aliases and release it on Drop. It must require an absolute,
owner-protected storage location; authenticate/decrypt before complete-record
or checkpoint decoding; atomically encrypt and persist the complete record;
check the original binding/current authority without rebasing it; stop local use
through the original cancellation-epoch owner; and use a trusted finite clock.
Unavailable OS encryption remains unavailable. Inaccessible or corrupt ciphertext
must be preserved without plaintext or in-memory credential fallback. A
`LifecycleEnvironment::cached_display` implementation separately returns cached
credential-free metadata synchronously and infallibly with no I/O or credential
lease. The credential codec supplies none of those owners or authorities.

## Healthy evidence

`healthy.rs` is a positive synthetic full-record codec example for all four
checkpoint variants and both registration kinds. It imports the actual AI types
and original checkpoint codec. An external compilation manifest may select it
without editing integrator-owned application manifests. Its values are fixed
synthetic strings. It proves byte-preserving encoding/decoding only, with no
ciphertext, OS credential access, storage, OAuth callback, provider or inference.
The accepted AI-host healthy example remains separate.

All runtime/control gates remain held. No corruption, rejection, fault, expiry,
replay, revocation, concurrency, adversarial, mutation/omission or broad aggregate
control is authorized by this positive codec fixture. Actual OS encryption,
complete-boundary interface execution, trusted enrollment/stop-use, cached-display
host composition, root mounting and exact integrated review/CI remain pending.
