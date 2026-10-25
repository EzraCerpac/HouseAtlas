# HTTP intake correction

This narrow candidate continues the immutable native core checkpoint.
It changes root-owned HTTP
intake, its final healthy loopback assertion, documentation and the central
source integrity manifest. It also consumes the React owner successor:
the existing configured Sign out
action remains available on authenticated non-ready panels while house content
and choices remain withheld. Unavailable/denied panels are reviewed only in source. Media and later feature successors are separate.

The router admits at most 64 active HTTP handlers without queueing admission.
Its owned semaphore permit remains in the response adapter and in every actual
blocking HTTP work closure. Dropping the caller's async future does not free
that work's permit while SQLite/scrypt execution remains active.

Login requires the checked actual request authority, exact trusted Origin and
absent or same-origin fetch-site metadata before collecting body bytes. A
supplementary process-local transport gate permits at most 60 attempts per
minute globally and 10 per client key per five minutes. The client key is the
actual connection's IPv4 address (also for IPv4-mapped IPv6) or its IPv6 /64.
Peers in one /64, including every `fe80::/64` link-local peer, share one budget
and can throttle each other's sign-in. Its map holds
at most 1024 active client buckets, expires only elapsed buckets and denies new
keys at capacity. It uses monotonic time. The actual access boundary still
checks Origin, its persisted global and per-client attempt rates, and
credentials. Only failed verifications count toward its per-client username
rate, so another client cannot lock out a correct password; no cross-client
attempt rate exists per username, and the global rate bounds distributed
guessing. The transport gate issues no principal, session or replacement
capability.

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
