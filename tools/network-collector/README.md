# Network collector, stage 1

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

`--once` collects one ping cycle and evaluates periodic work once,
without opening a listener.
Normal mode opens only the configured exact loopback endpoint,
collects immediately, then follows monotonic interval slots.
Missed slots are skipped, with no catch-up after sleep or restart.
Only one ping cycle runs at a time.
Speed actions reserve probe exclusion immediately and wait for an active ping
cycle to drain before starting the speed command.
During that reservation, routine cycles send no probes and record every device
as `not-measured` with reason `speed-test-in-progress`, null latency and null loss.
Those samples retain the ordinary unknown-count rollup behavior.
SIGTERM/SIGINT abort commands, drain the current cycle, close HTTP and SQLite.
Commands receive TERM then KILL after 250 ms.
If close/error still has not arrived after another 250 ms,
the runner settles with null exit code and `interrupted:true`,
destroys its owned stdout/stderr pipes and drops its listeners.
This is an explicit failed/unknown observation, not proof of process exit.
The caller reservation is released so later pings and actions can resume;
ping/guard/port commands have a 2.5-second deadline;
speed runs have a 65-second deadline.
All commands have a 64 KiB combined output bound.
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
the schedule/retention fields are optional with the illustrated defaults.
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
`speed-test-in-progress`, or `no-history`
(the initial latest placeholder, also with null recordedAt).
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

Raw sample indexes and hourly buckets use each fact's `recordedAt`,
including when a cycle crosses an hour boundary;
`lastCycleAt` separately retains the cycle-start timestamp.
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
Existing routes remain GET only: other methods, including HEAD,
receive 405 with `Allow: GET`.
The new exact `/api/actions` path also accepts POST as described below.
Unknown paths receive 404; unavailable inventory/read or an oversized response
receives 503.
Successful JSON responses use `Cache-Control: no-store`.
Inventory responses are at most 1 MiB; all responses are capped at 64 MiB.
There are at most 16 connections and 16 requests per socket,
8 KiB headers, 5-second request/header/socket timeouts and 1-second keepalive.
Both local and peer socket addresses must equal the configured loopback address.
Before any store access, `Host` must exactly equal the configured literal
loopback authority with its port (`127.0.0.1:42001` or `[::1]:42001`).
An absent `Origin` is allowed for ordinary clients;
a present `Origin` must exactly equal `http://` plus that same authority.
Missing/foreign Host or foreign Origin receives 403 with the fixed body
`{"error":"request-refused"}`.
Hostnames, alternate ports, opaque origins and trailing slashes are refused.
There is no forwarded-header trust, proxy feature, CORS, SSE or inventory write API.

The backend can explicitly select this exact-loopback HTTP origin and enable
`collectorMeasurements` on its trusted Network settings.
It reads health and version-1 measurements during an existing inventory refresh;
ordinary browsing and cached-only startup initiate no refresh or collector work.
Measurements join by device ID within the same source instance and inventory revision.
The reviewed scene-device manifest still controls documentary scene enrichment.
See [the optional backend frame extension](../../docs/geometry/native-scene-source.md#optional-collector-measurements)
for freshness, response bounds and process-local cache limits.
No configuration, installation or operational authority is supplied here.

## Deliberately absent

No AP/router client adapters or their credentials, discovery/inbox, inventory
editing/import, remote collectors, viewer leases/demand, ingest/attestation,
auth/sessions, SSE, UI, Bonjour or TLS listener.
Browser throughput is absent.
Collector actions are explicit backend requests, never browsing-triggered demand.
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
The 40 node:test cases use fake runners/children, disposable private SQLite files,
controlled clocks and direct handler calls only.
No listener, real command, live source, credential, private fixture, deployment,
performance measurement or installed acceptance is exercised.

## Speed, Wi-Fi and actions

The HouseAtlas backend is the only intended HTTP client.
There is still no backend integration or operational approval in this stage.
Any local process that can connect can also request these bounded diagnostics;
there is no token or credential.

Optional private configuration fields are `speedTime` (local `HH:MM`, default
`03:00`), `wifiIntervalMs` (60000–86400000, default 900000),
and `actionPorts` (at most 16 distinct integer ports 1–65535,
default `[22,80,443]`; `[]` disables port checks).
Nulls and unknown fields are refused.
There are no configurable executable paths, arguments, endpoints or hosts,
matching stage 0's fixed command policy.

A separate monotonic 60-second scheduler evaluates periodic work independently
of the ping interval, even with no readers.
The first evaluation at or after `speedTime` claims that local calendar date
before invoking `/usr/bin/networkQuality -c -M 60` through the bounded runner.
This uses the tool's default internet service and can consume substantial data.
It is a host internet measurement, not an inventory-device throughput test.
`dl_throughput` and `ul_throughput` are bits/second;
`base_rtt` is idle milliseconds, never responsiveness/RPM.
These mappings and flags follow Apple's installed `networkQuality(8)` manual.
No real invocation was used to develop or verify this stage.
The adapter accepts extra tool metadata but persists only the three metrics.
Duplicate JSON keys, invalid types, negative/nonfinite or excessive values
(throughput over 10 trillion bps or latency over 120000 ms) are refused.
Missing metrics remain null with `unknown`/`missing-fields`;
command failure/interruption is `failed`/`command-unavailable`,
tool error metadata is `failed`/`tool-error`,
and invalid JSON/metrics is `unknown`/`malformed-output`.
Partial valid metrics are retained without inventing missing values.
All three valid metrics produce `measured` with null reason.
`recordedAt` is the collector's UTC completion timestamp, not a parsed tool date.

There is no prior-day catch-up or retry of a claimed night after restart.
A persistent high-water calendar date prevents repeated runs after clock rollback
or the repeated DST hour; a skipped DST time runs at the first later evaluation.
An action already running delays the nightly claim to the next evaluation.
A crash after claiming can leave that night without a result;
the claim establishes at-most-once dispatch, not successful collection.
On-demand speed runs do not consume the nightly claim.
SIGTERM/SIGINT abort and drain both schedulers and the active action.

### Wi-Fi availability

This stage intentionally implements an `unavailable` scan interface.
No dependable unprivileged stock CLI contract has been qualified for current macOS.
Apple retired the old `airport` scan CLI;
[Apple DTS recommends CoreWLAN and requires Location privilege for useful results](https://developer.apple.com/forums/thread/748161).
`wdutil` is a privileged diagnostics route, not a replacement used here.
`system_profiler SPAirPortDataType` is a possible diagnostic snapshot,
but its version-dependent/redacted report is not treated as a dependable scan contract.
No helper compilation, permission prompt, credentials, sudo or copied legacy binary
is introduced.
This is a conservative adapter choice, not a claim that macOS cannot scan Wi-Fi.
Every Wi-Fi interval records `{state:"unavailable", recordedAt,
networks:null, reason:"no-dependable-unprivileged-scanner"}`.
Network name, channel, band and signal are all unknown;
null visibility never means zero visible networks.
There is no fabricated network row or guessed name, band or signal.
The latest result and 24 most recent evaluations are retained in SQLite.

### Route contracts

`POST /api/actions` accepts exactly one of these JSON objects:

```json
{"kind":"ping","deviceId":"device-example"}
{"kind":"port","deviceId":"device-example","port":443}
{"kind":"speed"}
```

Objects are closed; duplicate keys, invalid UTF-8, free-form targets and
non-allowlisted ports are refused.
The body is at most 8192 bytes and `Content-Type` must equal `application/json`.
Both socket endpoints and Host must pass the existing exact-loopback fence;
**any** Origin header is refused, including the matching origin and empty value.
Fences run before body reading or owner access.
Only one action (including a nightly speed run) executes at a time;
a concurrent request receives 409 `busy`.
Upload timeout remains 5 seconds; accepted execution gets a 125-second socket bound
to cover an active routine cycle draining (at most about 54 seconds including forced teardown),
then the bounded 65-second speed command plus teardown.
Ping and TCP checks use the current inventory's selected IPv4 only,
after the same live home guard used by scheduled pings.
Unknown device IDs receive 400 without command execution.
Missing target or failed home guard records an unknown result with a reason.
TCP uses `/usr/bin/nc -n -z -w 2 <inventory-address> <allowed-port>`;
only exit 0 without interruption means `open`.
Every failed connect remains `unknown`/`command-unavailable`, never guessed closed.
Ping results use the unchanged stage 0 fact shape.
Actions do not add samples to routine ping history.

Success is 200 `{version:1, kind, deviceId?, port?, recordedAt, result}`.
The latest 200 completed action entries are retained, including nightly speed work.
Rejected/busy requests do not create action entries.
Other refusals use fixed errors: 403 `request-refused`, 415 `content-type`,
413 `body-limit`, 400 `invalid-action` or `unknown-device`, and 503 `shutdown`.

`GET /api/results` uses the existing GET Host/Origin fences and returns
`{version:1, speed:{latest,recent}, wifi:{latest}, actions}`.
Speed results contain `state`, `recordedAt`,
`downloadBitsPerSecond`, `uploadBitsPerSecond`,
`latencyMs` and `reason`.
Latest values are null before any record; arrays are newest first.
Speed history is bounded at 400 runs, actions at 200, Wi-Fi storage at 24;
pruning happens transactionally on insertion without needing a reader.
Results can be stale; timestamps do not assert present connectivity.
The existing `/api/health`, `/api/inventory` and `/api/measurements` envelopes
remain unchanged, including their published version/schemaVersion fields.
The internal SQLite schema migrates forward from 1 or 2 to 3 transactionally,
preserving inventory and ping tables and refusing unknown newer versions.
The schema-2 migration renames the stored speed metrics and their action-log copies
to `downloadBitsPerSecond` and `uploadBitsPerSecond`, preserving their values.
It must not subsequently be opened by the stage 0 writer.

The 40 synthetic cases additionally cover good/partial/malformed speed output,
local-time nightly claims and restart/rollback, Wi-Fi unavailability/intervals,
POST fences/body limits, busy ownership, target/port restrictions, shutdown,
forward migration and bounded histories, speed/ping exclusion in both start orders,
controlled-timezone skipped/repeated DST hours, detached-upload response cleanup
persisted speed metric renaming and missing-close recovery for deadline,
output overflow and abort, including resumed routine pings and actions.
No actual command, service, socket or scan runs in these tests.
