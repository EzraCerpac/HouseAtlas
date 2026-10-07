# Stock wire3 application inputs

This directory is a sanitized, language-neutral application specification for
stock contract `0.3.0-at34.stock.2`, agent wire3 and source-presence semantics
1.1.0. It contains 164 command/result arms, ten proposed tool families, 21
grouped feature routes and 96 native route dispositions. These are implementation
inputs; their presence does not register routes, grant authority or enable runtime
capabilities. The first Rust read slice uses the frozen Atlas contracts only.

Read [SEMANTICS.md](SEMANTICS.md) and
[PROVIDER-AND-AI-POLICY.md](PROVIDER-AND-AI-POLICY.md) with the JSON files.
`agent/` contains the schema, operation catalog, capabilities, tool families,
feature routes and unqualified engineering profile. `presence/` contains policy,
witness and trusted-qualification schemas. `native/` contains a public upstream
Swagger research snapshot, route dispositions and exact public reference pins.
The resource root for `native/source-reference.json` is this directory.

[resource-map.json](resource-map.json) maps canonical schema identities to
repository-relative files for offline resolution. Register the existing frozen
Atlas schema by its exact `$id`; do not fetch it or copy it into this directory.
Catalog and tool-family input/output fragments resolve against the agent schema,
as declared
in the map. Witness and qualification schemas without `$id` resolve from their
file URLs.
Retain draft2020-12 semantics, Unicode code-point length, exact numeric bounds,
closed properties, union arms and canonical digest rules.

[adoption-manifest.json](adoption-manifest.json) records adopted content digests,
original application-content digests and the limited sanitation/reference
transformations. Private transfer ledgers, coordination identities and original
repository ancestry are absent. Public upstream source pins and historical
contract identifiers remain reference data. Historical wire2 arms do not override
current stock dispositions. Design-selection fields such as `approvedDesign` and
`decisionScope` describe the specification; they confer no runtime qualification
or operational approval.

Engineering numbers are unmeasured fixture limits. Provider writes, presence
witness admission, source registration/cache publication and actual SIWC/AI
remain held pending reviewed native implementation and qualification. The
first read slice supplies none of those capabilities. No application generator,
new behavioral test, provider call, login, grant or credential operation is
introduced by this adoption. Static file/reference/digest inspection only was
performed. Stopped guard, omission/mutation, adversarial/rejection, replay,
expiry/revocation, failure/crash and concurrency controls remain unrun.
