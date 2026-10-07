# Credential platform source composition

The selected source platform is Linux Secret Service with exact keyring 3.6.3,
ring 0.17.14 and zeroize 1.9.1 dependencies. Keyring defaults are disabled;
sync-secret-service, crypto-rust and vendored features select its persistent
Linux backend and bundled transport dependency. The adapter must explicitly
select that backend and never fall back to a mock or volatile credential store.
Other platforms remain unavailable compile paths until separately implemented.

The original credential owner must authenticate the complete private record
with AES-256-GCM, a fresh securely generated nonce and original registration
binding as associated data. It must preserve exclusive original-registration
leases, protected absolute storage, atomic whole-record persistence, original
binding revalidation, original cancellation ownership and a trusted finite clock.
Missing, locked or corrupt storage remains unavailable with ciphertext preserved.
Buffer zeroization does not establish complete process-memory erasure.

The currently composed record codec produces private plaintext only. It is not
an encrypted store or a concrete CredentialBoundary. Dependency compilation
does not provision keys or credentials, call an OS service, enroll a registration,
mount an operational AI host or qualify inference. Those implementations and
original lifecycle adapters remain pending. AI UI per-scope retry-capacity
review is also unresolved; this development checkpoint is not final acceptance.
