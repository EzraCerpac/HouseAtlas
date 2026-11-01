# Publication-input disposition claims v1

References #497; broader acceptance remains open.

`disposition.py` is a Python stdlib-only, pure documentary module. It has no CLI,
file access, transport, receipt writer, deletion candidate enumeration, retention
policy or consumer invocation. `parse(bytes)` validates UTF-8 JSON;
`validate(object)` returns a detached snapshot; `classify([snapshots], as_of=...)`
reconciles retained claims; `format_evidence` returns deterministic JSON with
original and release identities, retained event claims and independent summaries.
Import it from this directory using the ordinary Python module search path.
No installer or orchestration lane is introduced.

Validated receipts are claims requiring authoritative evidence. Schema validity
proves neither custody, authorization, backup, recovery, physical acceptance nor
operational completion. Referenced evidence is never opened or verified here.
`stored-readback` is itself a caller claim, never a persistence guarantee.
Every classification has `authority: unverified`; `claimed-complete` cannot be
used as a verified completion or a permission to act.

## Closed wire contract

All fields listed below are required; unknown fields at every level are rejected.
JSON null is permitted only for `release`. No arbitrary metadata, paths, URLs,
hosts, account identifiers, credentials or evidence bodies are accepted.

| Object | Fields |
| --- | --- |
| Document | `version` (integer 1), `profile` (`publication-input-claims-v1`), `label` (token), `original` (source identity), `release` (source identity or null), `events` (array) |
| Source identity | `manifest` (blob), `payloads` (nonempty array of named blobs) |
| Blob | `sha256` (64 lowercase hexadecimal characters), `bytes` (integer 0 through 9007199254740991; booleans refused) |
| Named blob | Blob fields plus `name` (unique token); array sorted by name |
| Event | `id`, `operation` (tokens), `original` (original source identity hash), `kind`, `state`, `phase`, `recorded`, `expires`, `persistence`, `evidence` |
| Evidence reference | `id` (token), `sha256` (evidence content hash), `binding` (source identity hash), `role` (`outcome`, `persistence` or `readback`) |

Tokens match `[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}`. They are opaque labels, never
filesystem locators. Hashes and counts describe the exact original manifest and
payload bytes; a transformed release has its own separate manifest and payloads.
An original source identity is SHA-256 of its ASCII JSON serialization with
sorted object keys, no separator whitespace and the sorted payload array.
`identity(source)` provides that spelling; labels are deliberately excluded.
Exact byte hashes must be obtained by the future authoritative caller; this
module does not compute hashes of or inspect publication inputs.

| Kind | State | Evidence binding |
| --- | --- | --- |
| `disposition` | `present` or `removed` | Original identity |
| `recovery` | `recoverable` or `unavailable` | Original identity |
| `qualification` | `qualified` or `unqualified` | Transformed release identity |
| `selection` | `selected` or `unselected` | Transformed release identity |

`phase` is one of `intent`, `complete`, `failed`, `interrupted`, `unknown`.
`persistence` is `unknown`, `failed` or `stored-readback`. Timestamps are valid
calendar times in exact UTC `YYYY-MM-DDTHH:MM:SSZ` form. `recorded < expires` is
mandatory. Classification requires an explicit `as_of` time; it does not consult
a machine clock. Future or expired claims leave the relevant dimension unknown.
The expiry window is a documentary freshness declaration, not granted authority.

Limits: 256 KiB per JSON input and canonical document, nesting depth 12 for JSON,
128 payloads per identity, 256 events per document and reconciled set, eight
references per event, 32 snapshots and 256 KiB aggregate canonical snapshots.
Duplicate JSON keys are refused before validation, as are nonfinite numbers,
unknown versions/profiles, malformed hashes/counts and unsafe path-like tokens.
Malformed documents fail with fixed diagnostic codes without echoing input.
Object entry points are for already decoded values; use `parse` on original
JSON bytes so duplicate keys cannot be lost by an upstream decoder.

## Reconciliation and history

Retain all original snapshots outside this module. Nothing overwrites them.
Repeated identical event IDs are idempotent. Reusing an event/reference ID for
different content is an error, including across snapshots. A label bound to
different original content is an error. A batch must describe one exact original;
use separate calls for independent inputs. Operation IDs correlate one original,
one dimension and, for qualification/selection, one release. A changed phase
requires a new event ID under the same operation; changing an existing event is
rejected. Operation IDs do not confer lock, hold, approval or concurrency rights.

A dimension can report `claimed-complete` only with a `complete` phase,
`stored-readback`, and outcome/persistence/readback references bound to the proper
identity. Missing references or failed/unconfirmed persistence remain unknown.
Intent without completion, failure, interruption, unknown outcome, expired/future
claims, or contradictory state/release claims remain explicit unknowns. Each
intent requires a supported completion for its own operation with a strictly
later recorded timestamp. A different operation's completion, an earlier
completion or an equal timestamp cannot resolve it; input array order supplies
no chronology. Repeated intents require completion after the latest intent.
A failure/interruption cannot be silently superseded by another completion. No last-write-wins behavior or
implicit reconciliation is provided. Even opposed claims at different times stay
conflicting until the operational owner establishes a reconciliation protocol.
This intentionally conservative v1 contract does not infer current custody from a
sequence of transitions or resolve legitimate repeated selection cycles.

An absent payload or historical missing folder is unknown without retained
authoritative transition evidence. Never manufacture retroactive success.
A release selected or qualified says nothing about original recovery; original
recovery says nothing about a consumer's qualification or selected publication.
The formatter preserves evidence claims and identities for inspection and adds
no acceptance, retention recommendation, removal instruction or verified state.
It cannot be used to emit an authoritative production disposition receipt.

## Qualification and operational handoff

The generated in-memory tests are registered in the existing ordinary-core job:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tools/model-input-disposition -p test_disposition.py -v
```

These tests exercise parsing, bounds, identity binding, conflicting/repeated
claims, interrupted/failed persistence, independent dimensions and deterministic
formatting. They use no production data, payload operations, network, browser,
consumer, credentials or services. Local tests were not run for this source
handoff under the owner's git-first workflow; hosted CI must establish results.

Operational adoption remains pending the existing sole storage-operation owner's
protocol, authoritative evidence route, concurrency model and independently
verified emission/readback/reconciliation. Actual adoption requires separately
established evidence authority and retained history; source and CI completion do
not satisfy it. If that owner's caller is in dotfiles/tooling, integration stays
there with its existing writer and a cross-link. This module changes no claims,
holds, loader/bake implementation, deployment pruning, active releases, services,
retention or access. Consumer qualification and publication selection remain with
their existing owner. References #277 and #304; operational acceptance stays open.
