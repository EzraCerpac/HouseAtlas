# Format before publishing

Run these repository tasks in saved cloud checkouts and Mac checkouts with
mise, Node and the rustup-managed toolchain from `rust-toolchain.toml` available.
Review `mise.toml` and `tools/rust-integration/format.mjs` before trusting the
repository's mise configuration when prompted. The wrapper reads that existing
Rust version pin and invokes that toolchain's `cargo-fmt` directly through
`rustup run`, bypassing `fmt` aliases in Cargo configuration or `CARGO_ALIAS_FMT`.
It removes `CARGO` only from a copied child environment so the metadata helper
does not select an inherited executable. mise declares no second Rust version
and installs no tools through these tasks.
Unset `RUSTFMT` before either task. The wrapper rejects this override, including
an empty value, before starting rustup; it never changes your environment.

## Writer sequence

1. Use one writer per checkout. Before formatting, inspect `git status` and
   `git diff`. Use an isolated checkout containing only your owned changes;
   `fmt` formats **all Rust workspace sources**, including unstaged edits.
   If a checkout contains another writer's work, use a separate checkout
   rather than formatting their changes.
2. Run `mise run fmt`. This changes source formatting only.
3. Review `git diff --stat` and the exact `git diff`. Include only intended
   formatting in your change. If unrelated formatting appears, stop and
   coordinate its disposition before publishing.
4. Refresh the publication manifest for the final reviewed files after
   formatting with `node tools/publication/refresh-manifest.mjs` (see
   [Publication manifest](#publication-manifest)). Formatting after this
   refresh would invalidate its entries.
5. Run `mise run fmt:check`. It reports formatting differences without changing
   source. It does not refresh the publication manifest.
6. Deliberately stage only owned paths and review `git diff --cached` before
   committing and pushing the scoped branch through the usual PR workflow.
   With jj, review the intended change and diff before bookmarking/pushing.
   Neither task stages, commits, pushes or changes Git/jj configuration.

Formatting parses Rust source but does not compile it or establish type,
Clippy or test success. Keep compilation, strict Clippy and tests in the existing
CI lanes; do not run blanket Clippy fixes as part of publication.

## Publication manifest

`docs/publication/source-manifest.json` lists every source file's path, Git
mode, byte count, SHA-256 and logical owner, plus one aggregate digest over all
rows. Regenerate the rows and digest from the working tree with pinned Node
26.10.0, then check the result:

```sh
node tools/publication/refresh-manifest.mjs --owner path/to/new-file.mjs=core-integration
node tools/publication/refresh-manifest.mjs --check
npm run verify:publication
```

The regenerator walks the tree with the rules of
`tools/publication/verify-source.mjs`: it skips only `.git`, `node_modules` and
`dist` entries, refuses symlinks and other non-regular files, takes the mode from
the executable bits and sorts rows by path. It rewrites only the manifest.
Existing rows keep their owner; files no longer present drop out. A file without
a row needs `--owner PATH=OWNER` naming one of the manifest's `owners` (for a
moved file, its old owner); otherwise it refuses and lists the paths. Because
the walk includes untracked files, build output such as `target/` and other
stray files also make it refuse: run it from a clean checkout, such as a
separate `git worktree`, or remove them first. `--check` writes nothing and
exits 1 when a refresh would change the manifest; refusals and unexpected
errors exit 2. It runs no controls and does not check the deployment template,
which `verify:publication` still does. After a merge, see
[Merge conflicts suppress PR CI](ci-path-selection.md#merge-conflicts-suppress-pr-ci).

## CI and adoption

`mise run fmt:check` is also usable in CI where mise is available. Existing CI
already uses the same `rust-toolchain.toml` pin and runs
`cargo fmt --all --check` through `tools/rust-integration/check-source.mjs`
before strict Clippy. That read-only check remains in place; no workflow
installation dependency or additional build gate is needed. An environment
without mise can call `node tools/rust-integration/format.mjs --check` with
the same installed prerequisites.

These tasks require explicit writer use before publication. They are not a
Git hook, and jj does not use Git hooks. Instructions cannot guarantee automatic
adoption in every checkout or enforce every commit. CI remains the backstop for
writers that bypass the step; it reports failures and never reformats or commits
source automatically.
