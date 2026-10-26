# PR check selection

References #402, #302 and #310. Main pushes run the full existing suite. PRs
always run ordinary-core: source publication verification, six ordinary module
builds, schema/basic checks, and existing synthetic tooling checks. Its stdlib
selector regressions use only disposable Git histories.

| Added/modified paths (plus optional Markdown docs and source manifest) | Backend source/unit jobs | Standalone frontend suite | Existing cross-stack loopbacks |
| --- | --- | --- | --- |
| `frontend/src/lantern/unified-atlas/`, `frontend/src/lantern/styles/`, `frontend/src/styles/`, `frontend/src/numeric/`, `frontend/src/offline/`; `frontend/lantern-tests/` | Omitted | All | Shard 1 |
| `backend/src/`, `backend/examples/`, `backend/tests/`, excluding `backend/src/contracts/` | Both platforms and unit tests | Omitted | All three shards |
| `README.md`, `docs/**/*.md` only | Omitted | Omitted | Omitted |
| Both stacks, shared contracts, root/dependency/build configuration, workflow/tooling, other paths | All | All | All |
| Rename, deletion, type change, empty diff, missing/ambiguous history or detection failure | All | All | All |

The frontend prefixes are literal. Other frontend
code (including `lantern/Host.tsx`, native geometry write/UI boundaries, API,
host composition, agent, draft and mutation boundaries) is
conservatively full. This explicit allowlist is intentionally not dependency
inference. Unknown future paths remain full until reviewed here and in tests.

Frontend PRs retain shard 1's five existing flows: TLS reads, auth/fresh local
writes, stock singles/atomic batches, stock history, and standalone assets.
These build and exercise the real backend and production React app together.
Backend PRs retain all cross-stack shards, so they still build React there;
they omit the separate full frontend suite and the redundant macOS React build.
The small existing healthy-read check remains in selected source jobs.
There is no claim that skipping a standalone suite removes all opposite-stack
build cost, or that synthetic CI establishes installed/device acceptance.

`docs/publication/source-manifest.json` is ignored only for *lane selection*
when accompanied by classified files. The always-run publication verifier still
checks every listed digest and the complete file set. Manifest-only changes run
every lane. This avoids metadata regeneration turning every ordinary PR into
full coverage without weakening source integrity.

The selector checks out the event merge commit with full history, then compares
`merge-base(event base SHA, event head SHA)` to the head with NUL-delimited Git
name/status output. Comparing the two tips directly would incorrectly include
changes added only on main. The PR merge graph includes the fork head without a
fork remote or additional credentials. If the event commits/history cannot be
resolved, selection falls back to full; no guessed base or API list is used.
The existing test jobs still check out the exact candidate head, while
ordinary-core checks the event merge tree. This preserves their prior behavior.

Both workflows always trigger. Existing matrix/check names remain present:
unselected jobs run a short selection/summary step and omit their expensive
checkout/setup/build/test steps. Keeping those jobs avoids required matrix checks
remaining pending. Even an unselected macOS check briefly allocates its existing
runner; no new runner type, action, permission or external service is introduced.
A failed/missing selector job makes dependent jobs run full (unless the workflow
was cancelled). Main pushes always select full. Each job summary records omitted
coverage; the selector summary records the decision. Real durations depend on
runner queues/caches and should be measured after adoption.

Changes to this selector/workflow are themselves full-suite changes. Focused
regression cases run in ordinary-core, covering the matrix, generated metadata,
shared/unknown paths, rename/deletion, failure fallback, and a divergent target
branch plus fork-like head checked out as a synthetic merge commit.
