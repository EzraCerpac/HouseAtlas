# Operations design policy

This package contains a proposed generic policy and illustrative recovery
envelope/decision model. It is not imported by the live core and implements
no service startup, authorization, backup scheduling, deployment or migration.
Target/audience/operator/recovery identities are explicitly unconfigured.

src/check_package.py now checks generic policy/template consistency and syntax
only. src/acceptance.py and test/test_scenarios.py remain retained model source;
their rejection, guard, failure and concurrency cases are stopped and excluded
from ordinary CI. The incomplete recovery-envelope fixture is a template,
never a valid recovery point. Historical evidence remains privately preserved.

README.md at the repository root defines the ordinary lane. Actual target
auth/session/secret recovery, all-writer drain, provider backup, filesystem/
power-loss durability, rollback and measured objectives remain unverified.
