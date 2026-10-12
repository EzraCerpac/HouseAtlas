# Assistant-managed native place intake

`NativePlaceClient.prepareCreate` composes a source-free evidence record, native
location identity, accepted Atlas location classification and optional reviewed
membership into the existing `atlas.batch.execute` request. The client allocates
the native identity, semantics, evidence and relation UUIDs. A package UUID stays
with package input and is not a native target or relationship endpoint.

The accepted create classifications are `floor`, `room` and `other`. The existing
building/room editor remains compatible with its `building` input. Assistant
intake supplies a reviewed `parent` consisting of the actual active Atlas
identity and accepted location-semantics records. The records must refer to the
same location; only `building` or `floor` classifications can be parents. The
parent identity and classification revisions guard both the batch and membership
command. A building parent produces `membershipKind: building`; a floor parent
produces `membershipKind: level`. These relations preserve the reviewed claim;
they do not infer position or elevation. Floors may belong to buildings; the
existing topology rules do not allow a floor to be a member of another floor.

New floor classifications omit `elevation`, which leaves elevation unknown.
Other created classifications also omit elevation. This seam does not create
physical alignment, floor height, scale or geometry. It adds no backend routes,
schema variants, permission grants or native admission commands. The existing
client admission check and one-shot `commit` flow remain responsible for the
current session, batch validation, exact request retention and unknown-outcome
inspection.

The focused fixture is `frontend/lantern-tests/native-place-levels-intake.mjs`.
It composes synthetic records through the actual frontend client and an
in-memory fake transport; it does not establish live persistence or household
acceptance.
