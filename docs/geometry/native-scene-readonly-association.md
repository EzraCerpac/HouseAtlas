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
read-only read and reload, absent write controls, candidate-draft clearing on
admission withdrawal, an unknown submission followed by admission withdrawal,
read-only outcome resolution, and that a pending notification does not abort
the dispatched submission. An unknown-outcome message appears only while an
outcome is pending. If a candidate or review draft exists, reloading first
requires confirmation that the displayed scene will refresh and the unfinished
draft will be discarded; canceling keeps the draft. All browser requests stay on a temporary
static loopback server that serves the built UI. It does not exercise an
application service, account, household data, native persistence or provider.

After installing the pinned frontend dependencies with the README's `npm ci`
command, run with Node 26.10.0 and the inspected Chromium executable:

```sh
HOUSEATLAS_CHROMIUM='/path/to/chromium' node frontend/lantern-tests/native-scene-readonly-ui.mjs
```

This named local check is not part of ordinary CI.
