# Software release bundles

`houseatlas.release-bundle.v1` packages one exact Intel macOS backend and its
matching production React output. The source contract is
[`bundle.schema.json`](../../tools/release/bundle.schema.json); the generated
[`bundle.manifest.json`](../../tools/release/fixtures/bundle.manifest.json) is a
nonexecutable synthetic example. A bundle supplies software bytes and build
provenance. Target installation, service activation and runtime qualification
remain with the runtime owner.

The in-repo updater that was meant to install these bundles was retired in
#284; deploys go through [`tools/deploy-nas`](../../tools/deploy-nas/README.md),
which builds from source on the NAS and consumes no bundle.

## Native profile qualification

The current [native profile](../../tools/release/release-profile.json) adopts
the reviewed 898-input qualification of product source
`d36a48546a92b58cb3c515d8034272dfa1d92e5a`, tree
`9567e8f9da5c81a8b9b9e4d088b09b269a5bdd8a`, from
[run 39849910196, attempt 1](https://github.com/EzraCerpac/HouseAtlas/actions/runs/39849910196).
The frozen recipe head is `6e725d2e26bff3ca0deefadc22b1391bdf171437`;
GitHub executed workflow merge `b1c8ad1c4739f8903b51d3b2ab766fa401bf9e3f`.
The exact native-input digest is
`2061368ea3e6d6620451d8542dc111226721ea6fd599ea8b3f841f2e9457586b`.
The accepted main source manifest still describes the same 898 native inputs.

The existing independent artifact review cleared archive/member closure,
binary ABI, source/tree/lock and executed-workflow provenance, and the four
named generated healthy examples. This adoption records that review; it does
not rebuild or execute artifact code. Generic x86_64, minimum macOS 15.0,
the standard Intel runner image, SDK 15.5, Xcode build 16F6 and the four allowed
system libraries retain the existing profile. Only
`native.sourceInputsSha256` changes.

Recorded public evidence:

- [GitHub artifact 12457409985](https://github.com/EzraCerpac/HouseAtlas/actions/runs/39849910196/artifacts/12457409985):
  13,272,791 bytes, SHA-256
  `57a88ea38e9bbdf5d23d1cb80a2f86c214d52c26f30840efbd00bdeb7cd5ff3e`.
- Native archive: 13,243,486 bytes, SHA-256
  `67baf821a19fc168591e828e2ea5a8074499600784b73778e32d3ded3d594304`.
- Archived binary SHA-256:
  `107770cea136e5f1042e8433d068fb1578e61f7d21e724f24554a4805e2cd941`.
- Build receipt SHA-256:
  `621b1aa2e5d9364a50826e795fb53df59a71623609d7772d016a1e73faa7d26f`.

The recipe branch and prior qualifications remain preserved. No workflow,
qualification source, AGENTS exception, backend, dependency or storage input
changes as part of this profile/history adoption. Storage remains unqualified,
both contract pins remain null, and code rollback remains disabled. Native
maintenance, installed-service identity, target compatibility, promotion and
deployment are separate gates. Browser or device acceptance is not inferred.

### Retained 893-input qualification

The previous [native profile](../../tools/release/release-profile.json) adopted
the independently reviewed qualification of product source
`7cae5db05389cb5ca5cc97403975fa60d8f4cbcb`, tree
`015320ded4947bc5c5100804ac6c521ce94c56e6`, from
[run 39668402224, attempt 1](https://github.com/EzraCerpac/HouseAtlas/actions/runs/39668402224).
The reviewed recipe is `f7855face19d7adaaf9bc07da8559dbb5e42ecaf`; its
workflow and support bytes remain unchanged in policy child
`17ba1b4a7b38c6b7e682fb5ccb49c985e3a380e1`.
The later automatic [run 39675962945](https://github.com/EzraCerpac/HouseAtlas/actions/runs/39675962945)
is separate evidence, not a replacement for this recorded qualification.

The exact 893-row native-input digest is
`5ed82d0bc529d968929bb336c6aaad0002e1a90de8457eb7e868e5c5d521d4c1`.
Independent static inspection checked ZIP/TAR closure, evidence and receipt
hashes, actual generic x86_64 Mach-O commands, minimum macOS 15.0, SDK 15.5,
no RPATH, the four allowed system libraries, four generated PASS logs and
run/source/tree/lock/recipe provenance. It did not execute artifact code or
rebuild the binary. The standard Intel image `20260824.0482.1`, Xcode build
`16F6`, SDK `15.5`, target and library closure match the prior profile;
only `native.sourceInputsSha256` changes. The unsigned binary's codesign
inspections are informational, as explicitly permitted by the recipe.

Recorded public evidence:

- [GitHub artifact 12379904071](https://github.com/EzraCerpac/HouseAtlas/actions/runs/39668402224/artifacts/12379904071):
  13,243,645 bytes, SHA-256
  `bc4f7e2ed6174e1260fb578f1630503fd84e231e8453772e2c27d7993aa46dfe`.
- Native archive: 13,215,436 bytes, SHA-256
  `a79cf97cc68cd9d33825b6d48269b56aa15bd5ba16616877d69badd61290af94`.
- Archived binary SHA-256:
  `8ff5d03e282248a7aa0398a15265e9020d1eee073d6d230ea8ce6161831fad4d`.
- Build receipt SHA-256:
  `38c0acc801e16434c6f0a352d48948ad2363a35f41948f06a0d762cbd2cd869f`.

This qualifies the recorded native input/builder/ABI combination only.
Storage compatibility remains unqualified with null contract pins and code
rollback disabled. Native/runtime maintenance bindings, NAS compatibility,
installed-service preservation, promotion and deployment need separate owner
evidence. No signing, notarization, household validation or target acceptance
is inferred, and no actual release build or promotion is performed here.

### Retained historical qualification

The previous native profile recorded the reviewed qualification of product source
`978651fe1e4527b7e0836d2a843bc60c76a7f0d3` in run `39205023226`, attempt 1:
standard `macos-15-intel` image `20260824.0482.1`, Xcode build `16F6`, SDK `15.5`,
minimum macOS `15.0`, exact 891-row native source-input digest and four system
dynamic libraries. Qualification remains attributed to that source; later
composition must preserve every native input. Preflight rejects builder or input
drift before dependency installation. No older macOS support, signing or NAS
compatibility is inferred. Storage compatibility remains **unqualified**;
required/resulting contract hashes stay null and rollback stays disabled.
The updater's inert source mappings do not qualify a target or release. Actual
build and promotion remain separately gated manual operations; this adoption
performs neither.

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

The 180-byte ASCII path limit also requires a USTAR-encodable split: a name
field of at most 100 bytes and, when needed, a prefix of at most 155 bytes at
a slash boundary. Producer scans and manifest validation use the USTAR encoder
to check this before creating any output. A valid long prefix remains supported;
the total path-length bound alone does not make a long filename encodable.

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

Artifact acquisition, asset upload and release roundtrip download use a
600-second subprocess ceiling rather than the 120-second inspection-command
timeout. The existing ten-minute promotion job remains the shared deadline for
the entire operation, including all three transfers and verification; these
per-transfer ceilings do not extend it or add retries.

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
declarations, the checked-in profile's explicit qualification, positive producer identity and a
fully fake local draft/upload/download/publish sequence preserving built bytes.
It performs no actual GH write or hosted build. Existing held adversarial,
crash, replay, expiry, rollback, real target, household and provider cases are
outside this command. The source owner retains shared publication-manifest
resealing and registration in the main verification guide.

The two review repairs have a separate, explicitly selected regression command:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 tools/release/test_bundle.py --repair-regressions
```

It checks all three transfer calls through fake subprocesses with simulated
150-second durations and no waits or network, retains the short inspection
timeout, roundtrips generated USTAR boundary paths, and rejects two generated
unencodable paths during both payload and manifest validation. Rejected payloads
create no output directory. These named cases are excluded from ordinary test
discovery and add no workflow step or broader regression permission.

For an independently reviewed artifact, offline inspection is:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 tools/release/bundle.py verify --bundle /absolute/review/bundle --manifest-sha256 APPROVED_SHA256
```

This reads only the selected software bundle. It installs and activates nothing.
