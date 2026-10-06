# Offline core composition

Storage, HomeBox, Network, web, access and media are composed by
`createCoreService` and `createCoreRouter`. The router receives WHATWG Requests
and returns Responses. Neither module opens a listener or implements an HTTP
client. Trusted configuration supplies access, exact origins, home labels,
database/vault/sidecar destinations and passive source transports.

Core `0.1.1-at13.3` composes storage `0.1.3` / SQLite schema 3, web `0.1.1`
and the additive HTTP `1.1.0` history sidecar. The six frozen v1 operation shapes,
record schema 1 and existing contract constants remain intact. Canonical single
and batch mutations use transaction-derived preconditions and the complete
source-reference closure. Home choices and view home fields use an explicit
three-field DTO. Credential-key filtering applies before browser serialization;
it remains a heuristic, not comprehensive credential-content detection.

New explicit source-presence admissions are blocked before writes. No durable
atomic generation/epoch witness extension is present. An unrelated review-only
revision may retain its earlier observation while requiring current source
authority. See correction-3.md for the exact trigger and scope.

Source refresh captures grants and cache epoch before transport, then revalidates
authority before publication. Complete HomeBox generations retain native links
when trusted navigation configuration is provided. Network's append-only
sidecar stores full generations while the Atlas DB stores the generation pointer
and relations; this is recoverable two-store ordering, not distributed atomic
commit. Configuration, provider write and approval endpoints are absent.

Authorized views use server-side preparation and current media capabilities.
Media digests identify descriptors rather than granting bearer authority.
Protected delivery must resolve the current record/projection, verify authority
and bound actual bytes. Only validated PNG is inline. Private browser persistence
and arbitrary upstream or external-link fetching are outside this core.

Core recovery captures a drained instance and owned DB/media/Network sidecar.
It excludes sessions, credentials, access DB, server configuration and provider
originals. Recovery requires separately supplied current authority/configuration
and this exact compatible core version. The host must quiesce every writer,
including other processes. Hashes verify bytes within trusted owner-controlled
storage; they do not authenticate a replaced whole packet. Power-loss, target
filesystem and retention are unqualified; predecessor recovery results are not
transferred to this successor.

README.md gives the sole ordinary verification lane and coverage limits.
Declaration checks are syntax-only; retained stopped controls are not executed
or certified. The new source manifest describes this standalone snapshot and
does not refresh a historical freeze or expose private intake records.
