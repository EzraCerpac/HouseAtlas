# Operations decisions

operations-policy is a generic proposed design, not a target authorization or
backup/service implementation. Deployment identities and destinations are null.
No gate is released and target readiness is unknown/unqualified.

Decisions still needed include exact audience/roles and access reach; actual
host/runtime/filesystem/service owner and routing/TLS; provider version/instance/
collection/native routes and least-authority access; private secret recovery;
compatible release/schema; recovery owner, encrypted off-host destination,
retention/capacity and measured RPO/RTO. Policy defaults of 24-hour RPO, 4-hour
RTO, 30 daily and 12 weekly points are proposed and unmeasured.

Read-only authorized cached metadata can retain original ages during source
outages. No mandatory floorplan, disconnected edits, byte mirroring or NAS-down
cold-load guarantee follows. Emergency exports require separate content/device/
privacy scope. Future agent/provider writes require separate reviewed semantics
and shared application authority; Network remains passive.

Historical design checks and private decision evidence remain outside publication.
Stopped denial/failure/concurrency controls are unrun in ordinary verification.
