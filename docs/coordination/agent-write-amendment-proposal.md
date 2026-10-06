# Future agent and provider command boundaries

Future agent transports should call the same typed application authorization,
validation, revision, audit and receipt boundary. Derive actor/home from a
verified principal rather than supplied claims. Browser tools must preserve
session/origin controls; remote transports require reviewed authentication,
audience and route scope. No such transport is enabled by this snapshot.

HomeBox is GET-only with verified native navigation in the current core.
Any provider writes require a separately versioned capability contract and
evidence for actual provider preconditions, all-writer concurrency, conflict
detection, idempotence, uncertain outcomes and read-back reconciliation.
GET/merge/full-PUT or an Atlas-only lock cannot prove those properties.
Preserve provider-owned inventory/location/attachment/maintenance fields and
permanent Atlas identities; optional geometry remains optional.

Network remains read-only. Collector demand, diagnostics, imports, source
authority reassignment and shell passthrough are outside that boundary.
Credentials/grants, route exposure and private writes need exact scoped gates.
Reviewed source-claim authority and canonical HTTP corrections are integrated;
new explicit source-presence admission remains blocked. This document supplies
design constraints, not approval,
implemented provider commands or successful stopped-check evidence.
