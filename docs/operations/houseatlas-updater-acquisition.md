# GitHub release acquisition source contract

`tools/houseatlas-updater-adapters/github_release.py` implements the updater's
`model.Acquisition` using an injected bounded `Http` interface. It returns the
existing `Acquired`, `Selection` and independently observed `Producer` types.
It includes no HTTP client, credentials, runtime entrypoint or installation.
No caller selects a URL, filesystem path, shell command or transport option.

The fixed policy is public, nonfork `EzraCerpac/HouseAtlas`, workflow
`.github/workflows/release-bundle.yml`, source ref `refs/heads/main`, and contract
`houseatlas.release-bundle.v1`. The exact caller selection supplies version,
commit/tree, release ID, archive asset ID/name and independently approved archive
and manifest SHA256. Approval of those digests remains an external owner action;
this adapter does not discover an approved release from a latest pointer.

Acquisition checks the published release ID and exact `v{version}` tag, draft
and prerelease state, and all three uploaded assets: the exact versioned Intel
Darwin archive, `manifest.json` and `SHA256SUMS`. Asset IDs must be unique, their
sizes bounded, and GitHub's asset digests must match every downloaded byte.
The checksum file must contain exactly the packaging owner's two lines. Release
and asset identity are read again after acquisition; the tag is resolved again
then as well. These observations do not lock mutable upstream metadata.

Lightweight tags and bounded annotated tags resolve to the selected source
commit. The Git commit API must independently confirm the exact tree. The
workflow API, current run and exact attempt must agree on repository identities,
workflow path/ID, main branch, dispatch event, source commit, successful completed
run and attempt. The exact attempt's complete bounded job list must also include
one successfully completed `build` job for that run/attempt/commit. A successful
validation or promotion run alone does not establish that a build occurred.
The producer evidence comes from these API observations. Manifest self-report,
release notes, browser URLs, latest pointers and target-commitish are not proofs.

## Packaging and compatibility

The adapter requires the existing `ReleaseBundleV1` verifier in its normal
`github-actions` mode, with owner-reviewed native-profile pin and unchanged
storage-contract mappings. It uses that verifier's pinned schema and parser,
then calls its full verification before returning `Acquired`. Unknown/null
compatibility mappings fail closed; synthetic-only verifier mode is ineligible.
The controller still owns archive extraction, actual installed/runtime state,
platform/ABI admission and the transaction. Acquisition performs none of these
runtime actions and does not assert target compatibility from a manifest alone.

Contract ACK: updater parent `971d7e26b3396b459c0783dfc388bd7966990977`,
protocol SHA256
`ca2d214b3d0659efdd4c0397ffbfffc020e51bcc3614fdc8e6cd43af47d257e4`;
packaging PR229 input `a8d247a6acc285a37863a1d3469370b5ef43da49`, preserving
the acknowledged packaging schema SHA256
`421ce99daf71e45df1580cafcc1eb146be1561023059075825fc6b77b2700a0f`
and fixture SHA256
`8073e8a088c9976e50659bd7828881d4898da81a47f6e5b8777320de3b193635`.
The independently read packaging helper and generated fixture helper are pinned
in the tests to SHA256
`e195ec5f4857e52e0bc8ac96300b4a22b3e7f2538b6fe186828ee052695abde6` and
`73cb43a2e183a5c6137d068cda43b24c471e2df2e38ade7a7089a12c7a8be8dc`.
These match the earlier acknowledged packaging donor
`6be0a4d9fe16859794ffe3587e6ad8ddb6080bc2` without a schema change.

The updater's separately owned strict-JSON correction must be composed before
final adapter freeze/acceptance. This donor changes no updater/parser bytes.

## HTTP owner boundary

`Http.open` and `Response.read` are required owner interfaces, not implemented
network operations. A future transport must enforce TLS certificate/hostname
verification and the absolute monotonic deadline during DNS, connect, TLS,
header reading and each bounded body read. It must allocate at most the requested
read size and raw header budget, disable automatic redirects/decompression and
retries, and send exactly the supplied headers without ambient credentials,
cookies or proxy authentication. Response context exit must close the stream.
An arbitrary client that ignores these requirements is not a qualified port.

One acquisition has a shared 60-second deadline, at most 32 GETs including
redirects, 16 KiB response headers, 512 KiB per API object, 256 KiB manifest,
1 KiB checksum file and at most 64 MiB archive (or a smaller policy limit).
Metadata and asset sizes are checked before body allocation; reads request at
most 64 KiB and enforce the remaining bound before appending. Content-Length,
when present, must fit and agree with actual bytes. Encoded bodies are refused.
Returned manifest/archive bytes remain in memory; nothing is persisted here.

Only constructed `https://api.github.com/repos/EzraCerpac/HouseAtlas` routes are
initial requests. API metadata redirects are unsupported. Each asset may follow
at most two explicit HTTPS redirects to the exact
`release-assets.githubusercontent.com` origin, without userinfo, ports,
fragments, control characters or backslashes. New headers are built for each
request; only origin-neutral Accept, Accept-Encoding and User-Agent headers go
to the asset host. Signed locations and raw transport/body errors never enter
status output. Other asset hosts or response media types require source review.

## Exact generated checks

Read this adapter, focused tests, imported updater schema/parser modules and
the pinned packaging `bundle.py`/`fixtures.py` before running these two named
positives from `tools/houseatlas-updater-adapters`:

```sh
HOUSEATLAS_PACKAGING_SOURCE=/absolute/reviewed-packaging-checkout/tools/release PYTHONPATH=../houseatlas-updater PYTHONDONTWRITEBYTECODE=1 python3 -m unittest tests.test_github_release_happy.GitHubReleaseHappyPaths.test_published_release_exact_build_and_bytes tests.test_github_release_happy.GitHubReleaseHappyPaths.test_annotated_prerelease_bounded_asset_redirects -v
```

The optional packaging source selects an immutable test input only. The tests
check exact schema/fixture/helper pins before loading those helpers. They create
software-shaped, nonexecutable generated payloads in fresh temporary roots and
fake all API responses, including reviewed-profile declarations. One case uses
a stable version and lightweight tag; the other an annotated prerelease and
three ordinary signed-asset redirect responses. Both use successful exact
attempt 2, finite partial body reads, the pinned verifier and exact returned
bytes/producer identities. They check shared deadline/read/header arguments,
response closure and absence of staging/publication/journal writes.

These are source/in-process positives, without real GitHub requests, sockets,
credentials, actual builds, native binaries, controller activation or services.
No malformed, denial, adversarial, failure, rollback or crash cases are added
or executed. No broad suite, ordinary CI registration, shared verification
guide, publication manifest or workflow changes are included. The parent owns
focused-command registration and source resealing after serialized composition.
Real acquisition transport, approved profiles, target binding, installed-layout
mapping, launch/publication/health qualification and all G1–G5 gates remain open.
The donor is for source review and recovery; it must not be merged or deployed
without the respective owners' acceptance.
