# Read-only scene association

Authenticated readers can load and reload the current native scene association
when their catalog does not admit association creation. The review inputs and
prepare/submit controls are shown only while creation is admitted. An unknown
submission remains visible after admission is withdrawn; checking its outcome
does not require create permission. Withdrawing create admission clears any
unfinished candidate draft so its evidence IDs cannot appear as saved scene
evidence. Reloading the association also refreshes the displayed native scene.

The named acceptance test mounts the production candidate and association
components in an owned Chromium process with a synthetic client. It checks
read-only read and reload, accurate status with no read binding, absent write
controls, locking during initial head synchronization, and binding invalidation
during listener setup. It checks mount-time synchronization before a newer
association is shown, candidate-draft clearing on admission withdrawal, UNKNOWN
resolution only after exact committed-outcome correlation, and both outcomes
of an asynchronous submission: its own UNKNOWN and committed notifications
preserve the flight, while later evidence invalidation aborts. An
unknown-outcome message appears only while an outcome is pending. If a candidate
or review draft exists, reloading requires confirmation, clears and locks the
draft while the read is pending, and refreshes the displayed scene; canceling
keeps the draft. All browser requests stay on a temporary static loopback server
that serves the built UI. The test covers the two production leaf components,
not full `NativeScanAtlas`/host composition or integrated scene availability.
It does not exercise an application service, account, household data, native
persistence or provider.

After installing the pinned frontend dependencies with the README's `npm ci`
command, run with Node 26.10.0 and the inspected Chromium executable:

```sh
HOUSEATLAS_CHROMIUM='/path/to/chromium' node frontend/lantern-tests/native-scene-readonly-ui.mjs
```

This named local check is not part of ordinary CI.
