# Publication workspace policy

Use one writer per checkout. The coordinator serializes shared contract/router/
migration changes, source mappings and publication history. Module maintainers
retain their owned namespace; application fixes need original-owner review.
Keep plans and release decisions with their assigned owners.

Private development checkouts and active worktrees remain in place. Do not move,
reset, clean or rewrite them; never use a provider repository as the Atlas base.
The publication repository starts with separately reviewed sanitized bytes and
imports no private Git ancestry. Its external private ledger records original
preimages and publication adaptations. Do not copy private source/intake, state,
credentials, media, recovery bundles, approval records or raw review evidence.

Pin every reviewed delta, compare exact preimages and coordinate documentation
sanitation before applying it. Use a disposable artifact copy for rehearsal.
Reseal the current source manifest and obtain independent exact-tree review
before a coordinated publication commit/remote release. A changed tree needs
a new audit disposition. Initial history and final release remain held here.

Host, source credential/grant, private-data import, restore, route and production
actions require their corresponding scoped gates and a serialized live-state
owner. Repository preparation supplies none of those actions or qualifications.
