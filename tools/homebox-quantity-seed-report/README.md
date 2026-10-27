# HomeBox quantity seed report

This standard-library tool produces a bounded, deterministic documentary report
from caller-supplied bytes. It previews only the existing-ID operation
`homebox.entity.quantity.set`. It performs no provider request, scan, seed,
import, native preparation, queue admission, write, retry or authority issuance.
It creates no IDs. Retain the unchanged input file alongside the report.

This is a source preparation increment for #287 and #277, under the isolated
`provider287-quantity-report-source-01` lease. Live single-writer, exact seed,
recovery and device acceptance remain open. No production Rust, existing schema,
dependency, runner or workflow is changed. #285's catalog and #286's recovery
remain separate.

## Run and review

Use repository-pinned Python **3.14.8** (`.python-version`), with no installation
or third-party dependency. After inspecting `report.py`, `cli.py`, `test_report.py`
and `fixtures.json`, the focused synthetic command for Claude's check handling is:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tools/homebox-quantity-seed-report -p test_report.py -v
```

Ordinary CI runs this command in `.github/workflows/ordinary-core.yml` with the
runner's `python3` (the code is stdlib only). Passing tests cover the synthetic
report only, not live provider reads, seeding or apply.

For a synthetic report, the CLI accepts one input path, or `-` for stdin, and
prints one complete JSON report to stdout:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 tools/homebox-quantity-seed-report/cli.py tools/homebox-quantity-seed-report/fixtures.json
```

The input is read-only. The CLI has no output-file, URL, credential or apply
option. Invalid input or report overflow exits 2, emits a fixed error code to
stderr and emits no report bytes. Validation and the output bound finish before
stdout receives the report. Errors contain no supplied path or document content.
Missing or rejected CLI arguments also exit 2 with the fixed `invalid-arguments`
code; parser errors do not echo caller arguments or usage text.

## Closed input

`fixtures.json` is a complete fictional example. Every envelope object has exactly
the properties listed below; missing, unknown and duplicate properties are
rejected. Field ordering in input is free and remains bound by its byte digest.

```text
{
  format: "houseatlas-homebox-quantity-seed-input/1",
  contractVersion: "0.3.0-at34.stock.2",
  context: {workspaceId, homeId},
  partition: {sourceInstanceId, collectionId},
  sourceProfile: {
    owner: "homebox", resourceKind: "entity",
    dialect: "homebox-stock-v0.26.2", providerVersion: "v0.26.2"
  },
  observationSource: {context, partition, sourceProfile},
  rows: [{rowId, resourceId, expected: {updatedAt, quantity}, desired: {quantity}}],
  observations: [{resourceId, originalJsonUtf8, observedAt}]
}
```

`observationSource` declares the supplied observation batch's scope/profile.
Compare it exactly with the manifest declaration. Mismatch blocks proposals and
produces no same-scope observation indexes. Unsupported contract/profile values
also block proposals. These caller declarations do not prove origin, installed
version, freshness, permissions, grants, policy or physical-database ownership.

Only the complete context/partition/entity identity matches. Context IDs and
source instance IDs must be canonical lowercase non-nil UUIDs. Collection IDs
remain opaque text: a value that is not a canonical lowercase non-nil UUID is
preserved but produces `unsupported-target`, because the existing quantity
command requires a UUID collection. Invalid entity UUIDs are also unsupported.
Never normalize or match names, labels, asset IDs, hashes or guessed timestamps.

`originalJsonUtf8` is JSON text containing the supplied native entity facts.
It may be a documentary projection rather than a complete native response.
The matched `id`, `updatedAt` and `quantity` must be present and supported.
Native property names follow the pinned v0.26.2 `repo.EntityOut` research schema
in `contracts/stock-wire3/native/homebox.swagger.json`; their closed property
maps are in `report.py`. Known nested summary/type/template/tag/field/attachment
facts are accepted without rewriting. Expanded `ent` edge graphs are unsupported
and rejected. Unknown/duplicate native properties, nested structural errors,
malformed raw JSON and invalid supplied native timestamps reject the input.
These property maps do not validate every
native field's domain semantics or establish complete observation qualification.

All quantities used in comparisons must be JSON unsigned integer **tokens** in
`0..9_007_199_254_740_991`. Booleans, strings, negative tokens (including `-0`),
fractional and exponent spellings (`1.0`, `1e0`) are unsupported. The parser
retains every numeric spelling and never uses floating point. Quantities are
converted to integers only after token/range checks. Other source numeric facts
remain only in the unchanged original input; they are not coerced or rewritten.

Timestamp syntax is bounded RFC3339: four-digit valid Gregorian date, `T`/`t`,
hours/minutes/seconds, optional fractional digits and `Z`/`z` or `±HH:MM`.
Leap-second `60` is retained. Values remain lexical: equal instants with different
fractional precision or offsets do not satisfy the same `updatedAt` baseline.
The report checks neither elapsed freshness nor a trusted clock.

## Report decisions and digests

Each row has exactly `rowId`, `target`, `outcome`, `reasons`,
`observationIndexes` and `proposal`, retaining input row order. Target contains
`context`, `authority:"homebox"`, source instance, collection, resource kind and
resource UUID. It is descriptive; it is not a command target/envelope by itself.
Indexes are zero-based into the retained input's observation array.

Duplicate row IDs reject the complete input. Duplicate manifest targets block
every affected row with `duplicate-manifest-target`. Multiple exact observations
produce `ambiguous-observation`, even with identical bytes, retaining every
matching index. Missing observations produce `missing-observation`, never a
provider-absence conclusion or a create proposal. Raw native ID disagreement
produces `observation-identity-mismatch`. Missing native timestamps and unsupported
native quantity values block the row. The fixed reason codes are in `report.py`.

After identity and supported-value validation, compare original lexical
`updatedAt` and expected quantity **before** desired quantity. A mismatch produces
`baseline-conflict`; no rebase occurs even if desired equals the observed value.
Otherwise equal desired quantity produces `unchanged` with no proposal. A
different supported quantity produces `proposed-update`, whose proposal contains
only `operation`, exact descriptive `target` and `desired:{quantity}`. Every
blocked/unchanged row has `proposal:null`. A row can retain multiple fixed reasons.

The report has exactly `format:"houseatlas-homebox-quantity-seed-report/1"`,
`inputDigest`, `execution:"report-only"`, `rows` and `reportDigest`.
`inputDigest` is SHA-256 of the exact complete input bytes, including whitespace.
For `reportDigest`, exclude **only** the root `reportDigest` field, then serialize
with sorted object keys, ordered arrays, ASCII JSON escaping, compact separators
and one terminal LF. Hash those bytes with SHA-256. The complete report uses
that same serialization with `reportDigest` included. This is documentary report
serialization, not command canonicalization, `requestDigest`, identity proof,
preview approval, admission evidence or provider CAS.

## Bounds and source integration limits

- Input UTF-8 bytes: 8 MiB; rows and observations: 100 each.
- Each original JSON string: 64 KiB after UTF-8 encoding.
- JSON nesting: 32 containers, independently for input and each original document.
- Row ID: 1–64 ASCII characters, `[A-Za-z0-9][A-Za-z0-9._:-]*`.
- Collection text: 1–4096 Unicode code points; other strings: at most 4096.
- Compared/retrieval timestamps: at most 64 ASCII characters.
- Numeric tokens: at most 4096 characters; supported quantity tokens: at most 16.
- Complete encoded report: 256 KiB. Overflow rejects; no truncated report is emitted.

Invalid UTF-8, lone surrogate strings, non-finite constants and malformed outer
structure reject the input. Raw source bytes and supplied source/retrieval times
stay in the retained input; report rows do not repeat them. Mixed outcomes are
documentary only and perform no partial execution.

The existing operation is declared by `request_homebox_entity_quantity_set` in
`contracts/stock-wire3/agent/agent.schema.json` (`urn:houseatlas:agent:stock:3`).
Its schema accepts broader nonnegative numbers; this report uses the narrower
safe unsigned-integer form supported by the composed quantity profile.
`backend/src/providers/homebox/write/stock/entity.rs` maps it to a narrow PATCH;
`backend/src/app/homebox_quantity_graph.rs` and the existing quantity
profile/observation/source owners require genuine original authority and fresh
captured evidence. This report instantiates none of those handles and constructs
no `StockCommand`, observation handle, approval receipt, request/idempotency key,
returned identity or native plan.

Future apply, creates, external seed-key bindings, fractional quantities, new
operation families and runtime integration require separate decisions. Missing
observations cannot establish whether a create is safe, and new provider IDs
cannot be known in this dry-run. Later application must return through existing
fresh-observation, authority, approval and single-writer ownership; documentary
baseline equality does not prevent a later native edit or settle unknown effects.
