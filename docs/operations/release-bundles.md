# Software release bundles

`houseatlas.release-bundle.v1` packages one exact Intel macOS backend and its
matching production React output. The source contract is
[`bundle.schema.json`](../../tools/release/bundle.schema.json); the generated
[`bundle.manifest.json`](../../tools/release/fixtures/bundle.manifest.json) is a
nonexecutable synthetic example. A bundle supplies software bytes and build
provenance. Target installation, service activation and runtime qualification
remain with the updater and runtime owners.

The checked-in [`release-profile.json`](../../tools/release/release-profile.json)
is explicitly **unqualified**. The build stops before dependency installation
until the native-build owner supplies reviewed minimum macOS, exact standard
Intel runner image, Xcode build, SDK, native source-input digest and system
dynamic-library closure. No older macOS support or NAS compatibility is inferred
from source compilation. Storage compatibility is also unqualified; promotion
requires a reviewed required/resulting storage-contract pin. This source slice
performs no hosted build or release publication.

## Payload and identity

The three release assets are `houseatlas-VERSION-x86_64-apple-darwin.tar.gz`,
`manifest.json`, and `SHA256SUMS`. The manifest stays outside the archive to
avoid a circular archive hash. It pins the compressed size/hash, unpacked byte
count and the complete sorted list of regular files, sizes, modes and hashes.
Archive members have no enclosing directory:

| Path | Content | Mode |
| --- | --- | --- |
| `bin/houseatlas` | Inspected Intel Mach-O from the locked source build | `0755` |
| `frontend/**` | Fresh Vite production assets accepted by the backend | `0644` |
| `licenses/**.txt` | Checked-in frontend dependency license/notice closure | `0644` |

The workflow copies only the built binary, fresh `frontend/dist` and
`frontend/licenses`. It includes no source tree, dependency cache, model
package, native database, configuration, TLS material, credential, private
evidence or operational record. The manifest names updater, configuration,
database, access state, media, models and saved copies as preserved components
outside this payload. Replacing code must preserve the current runtime's
configuration/argv, original data and saved-shell identities.

The normal producer replaces backend and frontend together from one commit and
tree. The contract also represents an explicit retained component: `action`
is `retain`, its exact installed identity is repeated in
`requiredInstalledSha256`, and it has no archive members. A replaced component
can optionally require an exact previous identity; `null` declares no specific
previous component dependency. The updater must still compare-and-swap its
separately supplied expected installed revision. A frontend identity is its
complete file-closure digest; a backend identity is its executable SHA-256.

Storage policy is `preserve-no-migration`. An unqualified declaration contains
null storage-contract pins and cannot claim rollback compatibility. A reviewed
declaration supplies exact required and resulting contract SHA-256 values; code
rollback compatibility can be true only for equal pins. These are owner-reviewed
declarations, not a schema migration, data inspection or restore capability.
The frontend/backend protocol requirement is `same-source`; the bundle consumer
version is the manifest format itself. `runtimeQualification` remains
`not-established` even after a successful native build.

## Encoding and verification

Manifest bytes are UTF-8 JSON with ASCII escaping, lexicographically sorted
object keys, two-space indentation, no non-finite numbers and one final newline
(`bundle.canonical`). Duplicate JSON keys are rejected. The local schema is a
trusted input: consumers pin its exact bytes and require `schemaSha256` to match.
JSON Schema validation alone is insufficient; implement the cross-field checks
in `validate_manifest` and the byte checks in `verify_bundle` as well.

For a sorted list of file records, its closure SHA-256 hashes the concatenation
of UTF-8 lines `path<TAB>mode<TAB>decimal bytes<TAB>sha256<LF>`. The frontend
closure uses archive-relative paths beginning `frontend/`. The saved shell
identity is the one matching 64-character build ID in both the saved entry's
`houseatlas-saved-shell-build` meta element and its service worker's `BUILD`
constant. It is distinct from the complete frontend closure digest.

The deterministic archive uses canonical USTAR regular-file headers in manifest
order, zero uid/gid/mtime, empty owner/group names, fixed modes, zero padding
and a zero end trailer. Its gzip stream has no filename and an mtime of zero.
The verifier compares complete canonical headers and hashes every body without
extracting or executing. There are at most 512 files, 256 MiB compressed,
512 MiB of file bodies and 256 KiB of manifest JSON. Each frontend asset is at
most 4,000,000 bytes and uses the backend's supported static extensions. The
expanded tar read is separately bounded for headers/padding. Paths have safe
relative components; links, special files, PAX/GNU extensions and extra archive
members are excluded. `SHA256SUMS` contains exactly the archive pin followed
by the manifest pin. No checksum file authenticates itself.

An expected manifest digest must come from independent release review. Hash
verification establishes integrity. Producer authorization additionally requires
the allowlisted repository, exact workflow path, successful main manual run and
attempt, source commit and independently resolved Git tree. The updater must
verify those using a trusted acquisition policy, then match native ABI/minimum
OS, retained component identities and installed storage contract before it can
consider activation. Tags and `latest` pointers alone are insufficient. This
workflow uses GitHub run metadata and an approved manifest digest; it does not
claim signed attestations or immutable-release enforcement.

## Workflow and bounds

[`release-bundle.yml`](../../.github/workflows/release-bundle.yml) validates only
the scoped packaging PR paths, using one five-minute Ubuntu job. It runs the
generated happy-path checks without a server, native process, credentials or
network transport. Main manual dispatch defaults to `validate`. The other
operations are explicit and serialized:

1. **Build:** select a version and confirm available artifact storage allowance.
   The reviewed native profile must match the exact native source-input digest,
   runner image, SDK and Xcode. Existing Rust/React ordinary main CI must already
   have succeeded at this exact commit. The source allowlist is checked before
   and after the locked Cargo/Vite build; the existing frontend typecheck and
   backend/frontend compatibility check run. `lipo`/`otool` inspect actual
   architecture, minimum OS and exact system-library closure. One 35-minute
   standard `macos-15-intel` job produces one artifact named
   `release-bundle-RUN_ID-ATTEMPT`, retained for one day with no caches or matrix.
   Inspect and retain the exact artifact plus manifest digest for review.
2. **Promote:** select the exact successful build run/attempt, version and
   independently approved manifest digest. An already reviewed tag `vVERSION`
   must target the built commit; this workflow never creates a tag. One
   ten-minute Ubuntu job acquires the same bounded artifact, verifies its
   producer/commit/tree/closure and current reviewed profile, creates a draft,
   uploads the three exact assets, verifies GitHub asset sizes/digests and a
   download roundtrip, rechecks the tag, then publishes last. It never rebuilds
   and does not mark the release as latest.

The default token scope is `contents:read`. Building adds `actions:read` to
inspect prior CI; promotion uses `actions:read` and `contents:write` only in its
separate job, with the built-in short-lived token supplied to the publication
step. Checkout never persists credentials. No PAT, signing key, OIDC/attestation
permission, security/immutability setting, billing setting or runtime grant is
created. Actual dispatch/publication still requires the source owner's final
review and action-time release. Partial promotion failures leave a draft for
owner reconciliation; there is no clobber, automatic retry or replacement path.

The repository was observed public on 2026-10-18. GitHub documents free standard
hosted runners for public repositories; larger runners and artifact storage are
separate billing considerations. Account usage reads were unavailable (403),
so no private-account allowance is inferred. Builds require an explicit storage
allowance acknowledgment and are blocked if the repository is private. Recheck
visibility and available storage before a first run without changing settings.
See [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
and the [standard runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

## Focused local checks

Inspect `bundle.py`, `fixtures.py`, `workflow.py` and `test_bundle.py` before this
explicit generated local command:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tools/release -p test_bundle.py -v
```

It checks exact fixture bytes, roundtrip verification, reproducibility across
roots/mtimes/input modes, explicit retained backend and reviewed storage
declarations, the unqualified native profile, positive producer identity and a
fully fake local draft/upload/download/publish sequence preserving built bytes.
It performs no actual GH write or hosted build. Existing held adversarial,
crash, replay, expiry, rollback, real target, household and provider cases are
outside this command. The source owner retains shared publication-manifest
resealing and registration in the main verification guide.

For an independently reviewed artifact, offline inspection is:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 tools/release/bundle.py verify --bundle /absolute/review/bundle --manifest-sha256 APPROVED_SHA256
```

This reads only the selected software bundle. It installs and activates nothing.
