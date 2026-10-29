# Standalone maintenance

The publication coordinator serializes this snapshot and later accepted module
deltas. Preserve private development history and active paths. Its external
ledger records accepted original inputs, preimages, exclusions, adaptations
and publication file mappings; private records never enter this repository.

For a later accepted module delta, pin the exact private accepted origin and
changed-file preimages. Audit every changed/new file. Compare the publication
preimage with the current source manifest. Unchanged executable/fixture paths
can receive their audited bytes; sanitized documentation/configuration requires
an explicit reviewed adaptation. Apply the safe delta to a disposable copy,
run affected authorized ordinary checks and audit the exact resulting tree.
Record the new origin-to-publication mapping privately before any coordinated
publication commit. Never import private ancestry or provisional acceptance.

The repository, its `main` history and hosted CI now exist; scoped PRs target
`main`. The history coordinator alone commits accepted sanitized trees using a
verified nonprivate identity, without private ancestry. Publish only the exact
reviewed main ref with push.followTags=false; no tags, mirrors or deployments.
