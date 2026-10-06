# Scenario requirements and verification limits

| Scenario | Required behavior | Qualification |
| --- | --- | --- |
| Authorized source timeout | Retain permitted metadata and original successful times | Provider/target outage checks deferred |
| Revoked principal/source | Withhold unauthorized records/media; preserve recovery identity | Denial/replay checks stopped in ordinary CI |
| Native HomeBox edit | Use only verified scoped route; independent provider rights | Synthetic navigation only; real routes unqualified |
| Source media unavailable | Retain truthful reference; no byte guarantee | Real provider/media qualification deferred |
| NAS/LAN unavailable | No cold-load private-document guarantee | Actual-user acceptance deferred |
| Healthy complete bundle | Recover exact owned bytes/IDs into fresh roots | Core positive model only; target recovery deferred |
| Access/config recovery | Supply current authority, secrets and revocation policy separately | Session/secret/permission recovery unverified |
| Incompatible release | Stop or use approved coherent restore with exact loss scope | Failure/rollback checks deferred |

Retained operations model tests are design source, not CI results. None of their
rejection, tampering, omission, concurrency or failure-injection cases is run
by the ordinary lane. The exact narrow CI coverage is described in README.md.
