# Format before publishing

Run these repository tasks in saved cloud checkouts and Mac checkouts with
mise, Node and the rustup-managed toolchain from `rust-toolchain.toml` available.
Review `mise.toml` and `tools/rust-integration/format.mjs` before trusting the
repository's mise configuration when prompted. The wrapper reads that existing
Rust version pin and explicitly selects it with `rustup run`; mise does not
declare another Rust version or install tools through these tasks.

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
4. Refresh the publication manifest's byte counts and SHA-256 entries for the
   final reviewed files, and its aggregate source digest, after formatting.
   Formatting after this refresh would invalidate those entries.
5. Run `mise run fmt:check`. It reports formatting differences without changing
   source. It does not refresh the publication manifest.
6. Deliberately stage only owned paths and review `git diff --cached` before
   committing and pushing the scoped branch through the usual PR workflow.
   With jj, review the intended change and diff before bookmarking/pushing.
   Neither task stages, commits, pushes or changes Git/jj configuration.

Formatting parses Rust source but does not compile it or establish type,
Clippy or test success. Keep compilation, strict Clippy and tests in the existing
CI lanes; do not run blanket Clippy fixes as part of publication.

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
