# Inspecting a native evidence request

The native place evidence panel can make a read-only observation of a historical
request when its caller supplies the request UUID. The panel first loads fresh
native admission for the selected place, verifies that its identity still
matches the selected topology row, and then reads the exact request endpoint
through the existing same-origin native adapter. The response must match the
request, place and home and, for a committed result, pass the existing closed
`atlas.batch.execute` result validator and the evidence/identity/asset target
closure checks.

This read is independent of the upload form and remains available when another
attempt has unknown completion. It does not acknowledge or alter that other
tab's attempt, release its lock, update the in-memory submission ledger, retry
the upload, or prove that the original selected bytes were stored. The
lossless response is shown as an observation. An unknown response, missing
request, unavailable response, or invalid response leaves completion unknown;
it is not evidence of rollback and does not authorize a retry. No original-file
download behavior is implied by this request inspection.

Changing the request UUID clears the prior observation. Changing client,
binding, or selected record clears the request UUID and observation. There is
no automatic refresh; submit another explicit read to obtain a new observation.

The source-only synthetic acceptance cases are individually selected:

```sh
node frontend/lantern-tests/native-evidence-request-read.mjs healthy-committed-observation
node frontend/lantern-tests/native-evidence-request-read.mjs healthy-unknown-observation
```

Both exercise the production client against synthetic GET `Response` objects,
including the admission read. They require no POST, no pending-ledger change,
and no ledger notification. The separate `binding-change-denies-read` case is
only a proposed synthetic regression scenario; it is not an implemented or
accepted case in this source harness.
