# Private upload diagnostics

After actual POST authorization, native evidence uploads with a canonical
correlation header emit `houseatlas.private-upload-diagnostic.v1` JSON lines to
the selected service's private stderr log. Correlation contains only the exact
request, workspace, home and target UUIDs. Before authentication, invalid IDs and
requests without the correlation header emit no diagnostic record. This changes
no HTTP DTO, receipt, authority, multipart limit, timeout or retry rule.

Records contain a fixed phase and event, elapsed milliseconds, observation time,
process ID, bounded metadata/file payload-byte counts, optional numeric HTTP
status, and a fixed failure category. They contain no file or field content,
filename, statement, reason, original exception, header, cookie or credential.
Payload counts exclude multipart boundaries/headers and are capped at the field
limit plus one; that last value means the counter saturated, not exact total
transfer size. The clock starts after authentication and is not browser dispatch
time. Fixed phases separate metadata/file/trailer intake from queued continuation,
waiting for Core, qualification, measurement, existing-original resolution,
staging, Stock dispatch and result release. Intake categories distinguish idle
and total deadlines, multipart read errors, size and shape rejection.

In the fresh staged path, `releasing` covers post-dispatch metadata retirement
and output release. The phase label establishes no commit outcome.

`observer-ended` means the HTTP observer was dropped before a response was ready.
It does not cancel or settle a queued/running blocking continuation. That worker
has a separate guard and may later emit `worker-returned` or `worker-abandoned`.
`response-ready` reports the handler result/status before the outer adapter's
final mapping and delivery; it does not mean the browser received a response.
`worker-returned` reports the original handler result/status and is
not an independent commit witness. `worker-abandoned` means its guard ended
without a normal result, including a panic or a dropped queued closure. A failure
after Stock dispatch may follow a committed write. All outcome decisions still
use genuine retained receipt inspection and, where required, owner-controlled
process retirement and closed-store reconciliation. No diagnostic miss, category
or counter establishes rollback or retry safety.

Each attempt emits at most 32 records of at most 1,024 bytes. A single dedicated
process writer accepts at most 128 queued records. Request/worker code calls only
`try_send`; it never waits for log I/O or queue space. Queue/write/encoding errors
drop diagnostics, preserve the original handler result, and increment the
process-wide `droppedLogRecords` counter included in later records. The sequence
is per attempt. Concurrent observer/worker enqueues can reach the writer out of
sequence; use that sequence to order the same attempt's records. Saturation,
process shutdown, log rotation or I/O failure can
leave incomplete evidence. Existing owner-selected private service-log custody,
permissions, disk retention and operational read procedures remain required.
No new database, file path, listener, diagnostics endpoint or process-wide
shutdown hook is added. This cannot reconstruct historical failures.

The focused synthetic module test checks the exact allowlisted JSON keys,
canonical-ID rejection, byte/event/record bounds, a local one-slot channel's
nonblocking full-queue behavior, and separate observer/worker event meaning.
That assertion does not fill the production 128-slot queue or test log I/O.
The separate parser case checks actual generated multipart bytes/counts and
unchanged size and missing-boundary rejection statuses. Both create no native state, original
media, login session, listener or provider traffic. Root must register its exact
command in README before execution:

```sh
cargo test --offline --locked -p houseatlas-backend --lib http::upload::diagnostics::tests::bounded_private_schema_counts_and_worker_observer_separation -- --exact --test-threads=1
cargo test --offline --locked -p houseatlas-backend --lib http::upload::diagnostics::tests::actual_multipart_progress_preserves_bytes_and_failure_status -- --exact --test-threads=1
```

Use Rust 1.99.0 and a private disposable build target. Existing README-named
backend build and formatting commands remain applicable. Diagnostic tests prove
the synthetic mechanics only; actual log selection, operational privacy,
real-upload transport and readable-original acceptance require separate checks.
