# Maintenance calendar dates

Only `maintenance.scheduledDate` and `maintenance.completedDate` gain the
wire owner's `date` / `^[0-9]{4}-[0-9]{2}-[0-9]{2}$` alternative. Existing
date-time and explicit null alternatives remain. Source/retrieval/cache/audit
timestamps retain their existing date-time contracts. Original date strings are
serialized unchanged; no time, timezone, epoch or current clock is supplied.

The native boundary registers the already reviewed Gregorian date predicate.
The generator maps string-only `anyOf` alternatives to one string DTO type,
retaining Rust `Option<String>` and TypeScript `string | null`. JSON Schema
enforces formats at decode/validate/encode boundaries; serde/static TypeScript
alone do not validate date formats.

The published wire proposal is `9eaab4bc39216de486fd8274e1503e3e9df86fad`;
the consuming reader is `3e3608ba000f7984b111c829e1fbef1513ebdb26`. Its
`Option<wire::MaintenanceDate>` fields serialize to these exact date/null shapes.
This lane copies no reader or wire implementation. The three explicit synthetic
rows derive from that wire's published healthy maintenance fixture: scheduled,
completed, and unknown dates. Native core checks cover standalone maintenance,
a projection and snapshot, plus the existing timestamp-based HomeBox fixture.

The amended Atlas schema is 80,374 bytes with SHA-256
`ba73d972c87391fe06cd41d68e73bc2d73fc3fcac322889cfb3b8d909c3f3f72`.
Root must reconcile the Atlas pin in `contracts/stock-wire3/resource-map.json`
and `contracts/stock-wire3/adoption-manifest.json`, then update publication file
integrity metadata. These composition files remain untouched here. Stock runtime
validation is not invoked against known stale pins.

An external pinned/locked manifest at
`/tmp/houseatlas-calendar-contracts/Cargo.toml` compiles the actual contracts
source through a path declaration. Rust 1.99.0 source check and Clippy select
only its library and three explicit examples. The calendar example, existing
`healthy-contracts`, and existing `healthy-native-semantics` pass. Node 26.10.0
generation and `--check` are deterministic; TypeScript 7.0.2 strict checking
covers the actual generated types and existing healthy consumer. No root
manifest/lock, composition, authority, provider, listener, publication operation
or held rejection/adversarial/fault/concurrency control is executed by these
checks. Durable reader integration remains root-owned.
