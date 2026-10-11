# Read-only scene association

Authenticated readers can load and reload the current native scene association
when their catalog does not admit association creation. The review inputs and
prepare/submit controls are shown only while creation is admitted. An unknown
submission remains visible after admission is withdrawn; checking its outcome
does not require create permission.

The named acceptance test mounts the production candidate and association
components in an owned Chromium process with a synthetic client. It checks
read-only read and reload, absent write controls, an unknown submission followed
by admission withdrawal, and read-only outcome resolution. All browser requests
stay on the test's temporary loopback server. It does not exercise a service,
account, household data, native persistence or provider.

After installing the pinned frontend dependencies with the README's `npm ci`
command, run with Node 26.10.0 and the inspected Chromium executable:

```sh
HOUSEATLAS_CHROMIUM='/path/to/chromium' node frontend/lantern-tests/native-scene-readonly-ui.mjs
```

This named local check is not part of ordinary CI.
