# Typed presence schema boundaries

`presence.rs` models the published witness schema 1 / semantic amendment 1.1.0
and qualification schema 1 from `contracts/stock-wire3/presence/`. Their source
bytes and frozen Atlas DTOs remain unchanged.

Use `decode_presence_witness` / `decode_presence_qualification` for bytes,
`validate_presence_witness` / `validate_presence_qualification` for typed
values, or the matching `encode_` helpers for validated JSON output. These
boundaries use the native, local schema engine and the existing bounded exact
numeric processing. Direct serde deserialization alone does not enforce
formats, string lengths, integer bounds or conditional correlations.

All declared fields are required. The observation enum preserves HomeBox and
Network arms; `sourceUpdatedAt` and `sourceSnapshotAt` preserve a required null
separately from a missing field. Integral tokens use the existing `JsonInteger`.
The source uses the frozen `SourceKey` shape; the presence schemas additionally
restrict source kinds to HomeBox entities and Network devices/groups, correlate
observation kinds, and correlate witness operations with triggers. The
witness's `scope()` and `source_ref()` methods are representation conversions.

Successful validation establishes JSON shape only. The cache `fresh` literal
does not verify cache age or publication state, and authority/version/digest
fields do not establish actual grants, enabled registrations or saved members.
No helper qualifies source availability, derives triggers, assigns timestamps,
stamps committed linkage, persists a durable witness or changes held runtime
capabilities. Transactional admission, authority and recovery remain owned by
the reviewed domain/storage composition.

Qualification intentionally carries only binding ID, source, observation time,
cache, authority and observation facts. It adds no actor, scope, mutation,
committed binding revision, audit or admission stamp. Its schema is not a
browser authority boundary.
