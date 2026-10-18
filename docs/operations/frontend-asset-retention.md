# Producer-side frontend asset retention

`tools/release/frontend_retention.py` prepares a new software frontend **before**
the existing `bundle.pack(payload, metadata, output)` call. The backend serves
only its selected frontend root; retaining an older release directory elsewhere
does not make its `/assets/*` URLs available. This helper builds an explicit union
inside the new replacement frontend, so the existing manifest and archive can
declare its complete file closure. It performs no runtime merge or installation.

The current `bundle.pack` already accepts this prepared payload: it hashes all
frontend rows, derives the new frontend closure, and declares frontend `replace`.
`retain` means keeping the entire prior frontend component with no frontend
archive members; it cannot represent a current entrypoint plus old assets.
No schema, updater, archive admission or HTTP change is needed for the union's
file closure. The existing workflow still stages only fresh `frontend/dist`;
this donor does not wire the helper into that workflow or create a release.

## Exact owner interface

```python
ApprovedProducer(repository, commit, tree, workflow, ref, run_id, run_attempt,
                 release_id, asset_id, archive_sha256, evidence_sha256)
PriorClosure(bundle_directory, expected_manifest_sha256,
             expected_frontend_closure_sha256, approved_producer)
assemble_frontend(new_frontend, priors, destination, *, current_metadata)
# -> UnionResult(frontend_directory, closure_sha256, provenance_receipt)
```

All paths are canonical absolute paths supplied by the trusted producer owner.
`priors` is an explicit tuple of one to four prior public release closures. The
owner must already authenticate their real public repository, exact source
commit/tree, workflow/ref, successful build run/attempt, published release and
asset identities. It supplies independent expected manifest/frontend digests,
archive digest and the SHA256 of its public producer/approval evidence. Matching
strings or constructing `ApprovedProducer` confers no authenticity. No network
fetch, latest pointer, local installed-tree adoption, private provenance inference
or authentication callback is hidden inside the assembler.

The helper requires the actual existing `bundle.verify_bundle` for every prior,
under its independent expected manifest SHA256. It also checks the declared
frontend replacement closure and exact source/build/archive agreement with the
owner's record. A prior `retain` frontend is outside this interface: the owner
must supply the actual immutable published replacement closure that contains
those assets. Runtime paths and retained component records are not substitutes.

The required `current_metadata` is the same producer metadata supplied to the
subsequent current `pack` call. The bounded returned receipt records the current
entrypoint build source separately from every old public source/build, release /
asset identity, evidence pin and full contributed asset rows. It includes the
current input and union closure digests and contains no local paths. It does not
assert stale-client/backend compatibility or authenticate its own inputs.

The producer must bind the exact receipt SHA256 and contents into trusted public
build/run and approval evidence, and review the current manifest source/build
and frontend closure against it before promotion. Keep the existing three release
assets unchanged; the receipt is separate producer evidence, not an unrecognized
fourth release asset, a private side channel, a frontend JSON file, or material
disguised as a license. This donor publishes none of that evidence.

The existing `same-source` declaration describes the newly built active backend
and entrypoints. Historical compatibility bytes have distinct public origins;
the producer owner must explicitly review that policy and disclose those inputs
in the new release approval. Do not describe all union bytes as freshly compiled
from the current commit. This helper does not silently change the meaning or
qualification of the existing compatibility declaration.

## Closure, collisions and limits

All current frontend files are copied unchanged into a create-only destination.
Every prior `frontend/assets/**` regular file is then included at its exact URL
path. Identical overlapping path/mode/size/SHA256 tuples are deduplicated; any
different tuple at the same path is refused. Case-fold collisions across every
path prefix and file/directory collisions are refused before output creation.
Current `index.html`, `saved/index.html`, `saved/service-worker.js`, webmanifest,
icons and other non-assets paths always come from the current build.

The actual `offline-shell-plugin.mjs` table selects `/assets/**` and exactly
`/saved/index.html`; current saved/live hashed chunks are emitted under `/assets`.
No current nested saved-asset class is emitted or referenced, so this interface
does not broaden retention to arbitrary `/saved/**` paths. The current shell
marker/worker remain the freshly built pair, while the whole union receives a
new complete frontend closure digest. Additional old assets need not enter the
new saved worker's fresh cache table to be addressable by existing live clients.

`pdfjs-binary-data-plugin.mjs` currently emits fixed decoder filenames
`assets/pdfjs/openjpeg_nowasm_fallback.js` and
`assets/pdfjs/jbig2_nowasm_fallback.js`. Two approved releases with different
bytes at one of these paths cannot be represented as one URL union. The helper
refuses that case; it never chooses a winner. Supporting such versions requires
a separately reviewed frontend URL-versioning change or a smaller explicitly
supported prior-release window. Asset availability alone does not prove old
JavaScript remains compatible with a new backend or preserve old HTML/SW URLs.

Paths/extensions, 4,000,000-byte per-frontend-file admission, 512 files and total
payload bounds remain the existing packaging limits. The provenance receipt is
at most 256 KiB. Current input reads and strict prior-member copies use at most
64 KiB per chunk with descriptor/named-path rechecks. The required existing
verifier retains its own bounded whole-archive verification allocation; this
helper does not claim that verification is streaming. Prior archives are checked
again after copying, and final/current closure scans must match. A partial
create-only destination is never adopted, overwritten or automatically removed.

The final software payload still needs `bin/houseatlas` and the applicable complete
license/notice closure. Historical dependency licenses must be reviewed with the
retained software; current notices must not silently omit their obligations.
The existing packer and actual updater's stricter configured compressed/payload
limits still apply to the whole final bundle. Bounded retention is not permission
to increase those limits or silently prune prior assets.

The helper guards unchanged `bundle.py` SHA256
`b215dac5ef4ef37607d2883cfb38c82f94d7cab3f6007e96679902ae35a535c4`
and `bundle.schema.json` SHA256
`421ce99daf71e45df1580cafcc1eb146be1561023059075825fc6b77b2700a0f`.
Different packaging bytes require a new owner review before changing these pins.

## Exact generated positive

Inspect this helper, `tests/test_frontend_retention_happy.py`, existing
`bundle.py`, `bundle.schema.json` and `fixtures.py` before the integration owner's
registered exact command from the repository root:

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=tools/release python3 tools/release/tests/test_frontend_retention_happy.py FrontendRetentionHappyPaths.test_generated_prior_assets_union_pack_and_verify -v
```

One fresh temporary directory holds a generated prior bundle, a distinct current
frontend, an identical common asset, prior-only nested assets and current-only
assets. The single healthy case calls the actual prior verifier, creates the
union, and uses the unchanged real `pack` and `verify_bundle` on a new software
payload. It checks exact resulting closure, unchanged inputs, current mutable
entries, prior asset bytes, distinct public source declarations and receipt
bounds. All producer/evidence declarations are synthetic; no actual GitHub
evidence is authenticated. No network, native binary, target, process, workflow,
credential or installed tree is used. No malformed, collision-denial, omission,
mutation, failure, replay, crash, rollback or broad check runs.
