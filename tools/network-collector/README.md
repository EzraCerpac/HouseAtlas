# Network collector, stage 0

One independent Node 26.10.0 process owns collection and a fresh SQLite store.
The HouseAtlas backend remains a passive reader.
Collection runs on a fixed schedule even with no viewers;
HTTP reads never reload files, prune, probe or start work.
This is G0 source work only, releasing none of G1–G5.
There is no installation or launchd configuration.
Do not run the commands below against household configuration before operational approval.

Runtime dependencies: Node built-ins only, using native TypeScript stripping.
For an approved future operation:

```sh
node tools/network-collector/main.ts --config /absolute/private/config.json
node tools/network-collector/main.ts --config /absolute/private/config.json --once
```

`--once` collects one cycle without opening a listener.
Normal mode opens only the configured exact loopback endpoint,
collects immediately, then follows monotonic interval slots.
Missed slots are skipped, with no catch-up after sleep or restart.
Only one cycle runs at a time.
SIGTERM/SIGINT abort commands, drain the current cycle, close HTTP and SQLite.
Commands receive TERM then KILL after 250 ms;
each has a 2.5-second deadline and 64 KiB combined output bound.
No shell or inherited command environment is used.
The current command adapter targets macOS `route`, `arp` and `ping`;
Linux CI uses injected fakes, not host networking tools.

## Private files

Config and inventory are JSON, never committed.
Each must be a single-link regular file owned by the current effective user,
mode 0600 in an owned mode-0700 directory.
Absolute normalized paths and no symlink ancestors are required.
Prepare directories privately outside this repository.
The store parent must already meet the same directory rule;
a new store is created mode 0600, and existing files are checked before opening.
The process sets umask 077 before SQLite opens.
SQLite holds an exclusive lock for its lifetime;
a second process refuses access rather than becoming another writer.
Do not share this store with another application or manipulate it while running.
Old history is archived separately; no importer is provided.

Invented configuration (replace paths outside Git):

```json
{
  "listen": { "address": "127.0.0.1", "port": 42001 },
  "home": {
    "gateway": "192.0.2.1",
    "routerMac": "02:00:00:00:00:01",
    "interface": "en0",
    "subnet": "192.0.2.0/24"
  },
  "intervalMs": 60000,
  "rawDays": 30,
  "hourlyMonths": 13,
  "storePath": "/absolute/private/collector.sqlite",
  "inventoryPath": "/absolute/private/inventory.json"
}
```

Only exact `127.0.0.1` or `::1` and port 1–65535 are accepted;
there is no hostname resolution, wildcard binding, TLS or authentication.
Any local process able to connect can read this private topology and history.
Config is at most 16 KiB, with closed required fields as above;
the three schedule/retention fields are optional with the illustrated defaults.
`intervalMs` is an integer 60000–86400000;
`rawDays` is 1–30 and `hourlyMonths` is 3–13.
The IPv4 subnet prefix is 1–30 and must contain the gateway.
The interface is a 1–32-character alphanumeric name starting with a letter.
MACs use six two-digit hexadecimal components.
No router credentials or configurable executable paths exist.
JSON duplicate keys, nonfinite numbers and nesting over 100 are refused.
Validation errors use fixed messages without input values;
unexpected startup errors are reported without exception details or private paths.

## Inventory contract

`GET /api/inventory` serves exactly `{revision, inventory}`,
where `inventory` has `rooms`, `devices`, `interfaces`, `segments`, `links`
and `positions`.
It deliberately has no version field to preserve the existing passive envelope.
Example, with invented documentary values:

```json
{
  "revision": 1,
  "inventory": {
    "rooms": [{ "id": "room-example", "name": "Example room" }],
    "devices": [{ "id": "device-example", "name": "Example device", "kind": "computer", "roomId": "room-example" }],
    "interfaces": [{ "id": "interface-example", "deviceId": "device-example", "name": "Example interface", "addresses": ["192.0.2.10"] }],
    "segments": [],
    "links": [],
    "positions": {}
  }
}
```

This is a bounded subset of `backend/src/providers/network/projection.rs`:

- IDs are nonempty strings up to 4096 UTF-16 units, unique across all five arrays.
  There are at most 1024 total records and 64 devices, within a 1 MiB file.
- Rooms have `id`, `name`.
  Devices have `id`, `name`, `kind`, optionally `role` (infrastructure/client),
  `mobility` (fixed/mobile), `roomId`, `notes`.
  Mobile devices cannot have a room.
- Interfaces have `id`, `deviceId`, `name`, `addresses` (at most 16 strings,
  each at most 200 UTF-16 units), optionally `mac`.
  Names, kinds and notes are at most 2000 UTF-16 units.
- Segments have `id`, `name`, `kind` (lan/powerline/unknown), optionally `roomId`.
  Room and device references must resolve.
- Links have `id`, `from`, `to`, `medium` (ethernet/wifi/powerline/unknown),
  `confidence` (confirmed/reported/inferred/unknown), optionally `observedAt`,
  `notes`, `reportedRate`.
  Endpoints resolve to devices, interfaces or segments.
  Rates have `kind: negotiated-port`, finite positive `mbps` up to 1000000,
  nonempty `source` (up to 4096 units), and `observedAt`.
  Timestamps are RFC3339-shaped parseable strings.
- Positions map arbitrary source keys to finite `{x,y}` pairs.
  They establish no physical placement.
  All objects are closed; absent optional fields are allowed, explicit null is refused.

Inventory is read completely and validated at startup and each scheduled cycle.
Owners publish replacements using atomic rename of a fully written private file.
A bad replacement retains the previous accepted copy and emits a fixed refusal;
a bad initial file prevents startup.
The revision is a nonnegative safe integer supplied by the reviewed file.
It may increase only with changed canonical inventory content,
may never regress, and must retain identical content when repeated.
These rules persist across restart in SQLite.
Canonicalization sorts object keys recursively and preserves array order;
GET bytes remain stable for an accepted revision, regardless of input whitespace.
No HTTP inventory mutation route exists.

For each device, the first reviewed interface address that is a numeric IPv4
inside the configured subnet is selected, in interface/address array order.
Hostnames, IPv6 and out-of-subnet addresses remain documentary and are not probed.
No eligible address means `not-measured` with `no-target`.
There are no config-supplied ping targets, sweeps or DNS lookups.

## Measurements contract, version 1

All timestamps below are UTC ISO8601 strings; missing timestamps are null.
`GET /api/health` returns `{version:1, ok:true, collector}`.
`ok` means the read process answered, not that the home guard passed,
a cycle is fresh or any device is reachable.
`collector` is `{lastCycleAt, guardOutcome, schemaVersion:1}`.
`lastCycleAt` is the last committed cycle's start time or null;
`guardOutcome` is `home`, `not-at-home` or `unknown` (including no cycle yet).
Status survives process restart and is not a claim of present collection activity.

`GET /api/measurements` returns:

```text
{
  version: 1,
  inventoryRevision: <current accepted revision>,
  generatedAt: <read time>,
  collector: { lastCycleAt, guardOutcome, schemaVersion: 1 },
  devices: {
    <inventory device ID>: {
      latest: <fact>,
      series24h: [<fact>, ...],
      series24hTruncated: <boolean>,
      hourly7d: [<hour>, ...],
      hourly90d: [<hour>, ...]
    }
  }
}
```

A fact has `state`, `latencyMs`, `loss`, `measuredAt`, `recordedAt`, `reason`.
States are `reachable`, `no-reply`, `not-measured`.
Reachable has the one-packet RTT mean and loss 0;
a valid one-packet ping summary reporting zero replies has null latency and loss 1.
Both have a measurement completion timestamp and null reason.
Missing or malformed summaries, process timeout/abort or command failure are
`not-measured`, with null latency, loss and measuredAt.
`recordedAt` identifies the attempted observation time.
Reasons are `not-at-home`, `no-target`, `command-unavailable`, `shutdown`,
or `no-history` (the initial latest placeholder, also with null recordedAt).
No-reply is never substituted for missing collection.

The guard requires the configured default gateway and interface,
a local address in the configured subnet, and the matching router MAC
in that interface's neighbor table before any ping.
A failed or unknown guard yields `not-at-home` reasons for all devices;
the collector outcome distinguishes an identity mismatch from unavailable checks.
Neighbor reads never populate the table by probing.
A cold/missing neighbor entry conservatively skips collection.
A cycle uses one preflight guard; it does not certify route stability during pings.

`latest` is the newest retained attempted fact, which can be old;
consumers must compare its timestamp with their freshness policy.
Series cover recorded facts in the inclusive trailing 24 hours,
sorted ascending, at most the newest 1441 facts per device.
`series24hTruncated` explicitly reports excess samples (e.g. repeated manual once runs).
An empty series or a time gap means unknown/unmeasured time, never zero loss.
No fabricated observations fill gaps during process downtime.

An hour has `hour` (UTC hour start), `state` (measured/not-measured),
`reachable`, `noReply`, `notMeasured` (sample counts),
`minMs`, `meanMs`, `maxMs` and `loss`.
Latency statistics use reachable samples only;
loss averages only measured attempts, excluding unknowns.
An all-unknown hour has null latency statistics and loss.
An all-no-reply hour has null latency statistics and loss 1.
Counts preserve mixed measured/unknown hours.
Windows include rows with hour starts in the inclusive trailing 7 or 90 days,
sorted ascending, at most 169 or 2161 rows per device;
the current partial hour is included.
Missing hours mean unknown time; rollups are not uptime percentages.
History follows stable device IDs across inventory edits;
removed IDs are withheld, and IDs must not be reused for another physical device.
Inventory revisions do not assert historical target equivalence.

Hourly aggregates are updated transactionally with every raw sample,
so recent rollups do not wait for raw expiry.
Every committed cycle prunes raw samples older than `rawDays`
and hourly rows older than `hourlyMonths` calendar months.
Retention runs without readers, but not while the process is stopped.
A `schema_version` table refuses unknown versions;
future independent speed/diagnostic/scan tables can use forward-only migrations
without expanding ping rows or interpreting archived stores.

## HTTP limits and refusals

Routes are exact paths without queries.
GET only: other methods, including HEAD, receive 405 with `Allow: GET`.
Unknown paths receive 404; unavailable inventory/read or an oversized response
receives 503.
Successful JSON responses use `Cache-Control: no-store`.
Inventory responses are at most 1 MiB; all responses are capped at 64 MiB.
There are at most 16 connections and 16 requests per socket,
8 KiB headers, 5-second request/header/socket timeouts and 1-second keepalive.
Both local and peer socket addresses must equal the configured loopback address.
There is no forwarded-header trust, proxy feature, CORS, SSE or write API.

The existing backend's HTTPS-only `ReviewedNetworkOrigin` cannot consume this
HTTP endpoint yet.
The next backend stage must explicitly add trusted exact-loopback transport,
measurements decoding, freshness/unknown handling and source/review authority.
No backend authority or mounted integration is changed here.

## Deliberately absent

No AP/router client adapters or their credentials, discovery/inbox, inventory
editing/import, remote collectors, viewer leases/demand, ingest/attestation,
auth/sessions, SSE, UI, Bonjour or TLS listener.
Nightly speed runs, on-demand diagnostics, Wi-Fi scans and browser throughput
are future stages, with separate tables and explicit action contracts.
No scheduled or on-demand version of those actions is implemented now.
Logic was adapted from the owner's earlier private tool;
only parameterized guard, bounded command execution and ping parsing were retained.
Remote home verification and radio-based guard overrides were omitted because
this single local collector needs no remote authority or Wi-Fi helper dependency.
The old parser's default of one lost packet for malformed output was replaced
with an explicit unknown result.

## Synthetic verification

```sh
node --test --test-concurrency=1 tools/network-collector/core.test.ts
node frontend/node_modules/typescript/bin/tsc -p tools/network-collector/tsconfig.json
```

The typecheck uses the repository's existing frontend TypeScript/Node declarations;
no new runtime or development dependency is added.
The 14 node:test cases use fake runners, disposable private SQLite files,
controlled clocks and direct handler calls only.
No listener, real command, live source, credential, private fixture, deployment,
performance measurement or installed acceptance is exercised.
