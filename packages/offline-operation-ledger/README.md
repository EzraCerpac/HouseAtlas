# Offline operation ledger core

Preparatory `offline-06` bookkeeping, isolated from the mounted Rust service.
Nothing imports this package in an active server, endpoint, exporter or browser.
Node 26.10.0 and built-in SQLite are the only runtime requirements. There are no
dependency installs, listeners, transports, credentials or permission adapters.

Allocate `createOperationId()` once when creating an intent and retain it with
that intent. A key contains exact `workspaceId`, `homeId`, `actorId` and
`operationId` strings. The caller supplies trusted scope; these fields confer no
access. Each field is nonempty, well-formed Unicode without NUL and at most 512
UTF-8 bytes. Request and outcome carriers are `Uint8Array`, each at most 1 MiB.

```js
import { OperationLedger, createOperationId } from './src/operation-ledger.mjs';

// Use a new, dedicated database in a caller-provisioned private directory.
const ledger = new OperationLedger({ path: '/tmp/synthetic-intent-ledger.sqlite' });
const intent = {
  workspaceId: 'synthetic-workspace', homeId: 'synthetic-home',
  actorId: 'synthetic-actor', operationId: createOperationId(),
  payload: new TextEncoder().encode('synthetic command envelope'),
};
try {
  ledger.reserve(intent); // reserved: durable intent, not execution permission
  ledger.inspect(intent); // pending, outcome: null
  // Only after an independent owner establishes an outcome:
  ledger.complete(intent, new TextEncoder().encode('synthetic canonical receipt'));
  ledger.reserve(intent); // completed: returns the same retained receipt
} finally { ledger.close(); }
```

`reserve` returns `reserved`, `pending` or `completed`, together with detached
record bytes. Identical repeated requests never create another record. A changed
payload under the same key throws `LedgerError` with code `payload-conflict`.
Comparison is byte-for-byte: reordered JSON, different encodings and changed
preconditions are distinct unless a future agreed contract canonicalizes them
before storage. Include all command-defining context in those retained bytes;
this module neither invents nor normalizes that contract.

`complete` requires an existing matching reservation. It returns `recorded` on
the sole transition to completed, or `duplicate` for identical outcome bytes.
A changed outcome throws `outcome-conflict`; an absent key throws
`unknown-operation`. An empty outcome is completed, distinct from pending/null.
`inspect` returns a detached record or null. No API forgets or resets IDs, lists
other partitions, executes work, supplies authorization or retries requests.

The dedicated database has its own application ID and version 1 schema. The
constructor rejects other database identities/versions rather than migrating an
Atlas database. Writes use SQLite `BEGIN IMMEDIATE`, WAL and `synchronous=FULL`;
the record becomes visible only after commit. SQLite arbitrates writers. Pending
reservations and outcomes survive clean process exit and reopen. Retain the WAL
alongside its database while open; copying the main file alone is not a backup.
The caller owns private directory provisioning, access, capacity and backup.

A pending entry after restart is **unresolved**, even if the original caller
believes execution never began. It cannot authorize a second execution. A
terminal entry is only an opaque caller-supplied outcome. This database cannot
atomically commit an external domain mutation, certify that mutation occurred,
authenticate receipts or resolve a commit with an uncertain result. On any I/O
or commit error preserve the ID and reconcile with the eventual domain owner.
There is no automatic retry or expiry.

## Focused synthetic verification

The delegated offline-06 scope explicitly requests duplicate, restart and
conflicting-payload checks. Inspect this package's source and named test bodies
before this separate local command, from the repository root with Node 26.10.0:

```sh
node --test --test-concurrency=1 --test-name-pattern='^(duplicate pending requests retain the original reservation|conflicting payloads preserve pending and completed records|terminal outcomes are retained once and duplicate completion is stable|operation IDs are partitioned by workspace home and actor|restart recovers pending reservations and completed outcomes in fresh processes|exact byte identity and detached results survive caller mutation)$' packages/offline-operation-ledger/test/operation-ledger.test.mjs
```

These exact six tests use fresh disposable synthetic databases, sequential
handles and two real child processes with bounded ten-second timeouts. All
temporary state is removed. The restart test exits cleanly; it does not kill a
process, inject storage faults or prove power-loss durability. The tests add no
ordinary CI entrypoint. Concurrency, crash/fault recovery, production durability
and native-service acceptance are unqualified.

Mounted Rust persistence, the agreed write-envelope contract, transactional
coupling with domain mutations, retained lookup authorization, HTTP lookup,
server replay and offline edit/sync integration remain dependent work. Existing
native queue/upload outcome mechanisms keep their owners and contracts. This
package replaces none of them and releases no deployment or product gate.
