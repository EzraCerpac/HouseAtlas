# HTTP intake correction

This narrow candidate starts at the immutable PR16 checkpoint
`915d9baae6710d23e29f34da488df1de493a2c0c`. It changes root-owned HTTP
intake, its final healthy loopback assertion, documentation and the central
source integrity manifest. It also consumes the exact React owner successor
`0ddd0bf42a91d6ccf179dbd5bdb6735459d28f0c`: the existing configured Sign out
action remains available on authenticated non-ready panels while house content
and choices remain withheld. Unavailable/denied panels are reviewed only in source. Media and later feature successors are separate.

The router admits at most 64 active HTTP handlers without queueing admission.
Its owned semaphore permit remains in the response adapter and in every actual
blocking HTTP work closure. Dropping the caller's async future does not free
that work's permit while SQLite/scrypt execution remains active.

Login requires the checked actual request authority, exact trusted Origin and
absent or same-origin fetch-site metadata before collecting body bytes. A
supplementary process-local transport gate permits at most 60 attempts per
minute globally and 10 per actual connection IP per five minutes. Its map holds
at most 1024 active client buckets, expires only elapsed buckets and denies new
keys at capacity. It uses monotonic time. The actual access boundary still
checks Origin and its persisted global/client/username rates and credentials;
the transport gate issues no principal, session or replacement capability.

Login and mutation streams retain their 4096-byte and 1 MiB actual byte caps.
A ten-second timeout covers each complete body collection. Timeout uses the
existing sanitized private API error response. Original mutation authorization
and CSRF still precede mutation body collection, and transaction authorization
still revalidates the original principal/grants before commit.

The healthy core runner now checks that every observed URL remains on loopback
after all session/login/logout, canonical reads, fresh circuit create and atomic
identity batch flows. Existing successful assertions remain intact.

Verification is actual locked Rust/TS source compilation, rustfmt, warnings-denied
Clippy, the three named healthy examples and inspected successful loopback flows.
No slow-body, saturation, rate-denial, rejection, replay, expiry, revocation,
guard mutation/reversal, fault, crash or concurrency probe is executed. These
are body/admission bounds; they do not provide a total execution deadline,
preempt running synchronous work or qualify target/production availability.
The permit bounds handlers through response construction; open TLS connections
and buffered network response delivery are outside this handler bound.
