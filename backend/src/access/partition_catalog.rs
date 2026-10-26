//! Catalog-only held read policy. Ordinary source reads keep their own limits.
use super::boundary::CurrentAuthority;
use super::{AccessBoundary, AccessError, Capability, Principal, TransactionAuthorization};
use crate::catalog_budget::{Budget, PolicyOutcome, Result, Unavailable};

impl AccessBoundary {
    /// Install once, before authentication SQL. Authentication keeps its normal
    /// committed rate transaction and autocommit last_seen bookkeeping.
    pub(crate) fn with_partition_catalog_policy<T>(
        &mut self,
        budget: &Budget,
        operation: impl FnOnce(&mut Self) -> Result<T>,
    ) -> PolicyOutcome<T> {
        crate::catalog_budget::sqlite_owner_policy(
            self, |owner| &mut owner.store.db, budget, 5_000, operation,
        )
    }

    #[cfg(test)]
    pub(crate) fn with_partition_catalog<T>(
        &mut self,
        original: &Principal,
        budget: &Budget,
        operation: impl FnOnce(&TransactionAuthorization<'_>) -> Result<T>,
    ) -> PolicyOutcome<T> {
        self.with_partition_catalog_policy(budget, |owner| {
            owner.partition_catalog_fence(original, budget, operation)
        })
    }

    /// Requires the caller's held policy. No callback install, relock or issuance.
    /// BEGIN happens after authentication has completed in autocommit mode.
    pub(crate) fn partition_catalog_fence<T>(
        &mut self,
        original: &Principal,
        budget: &Budget,
        operation: impl FnOnce(&TransactionAuthorization<'_>) -> Result<T>,
    ) -> Result<T> {
        budget.check()?;
        let db = &mut self.store.db;
        if !db.is_autocommit() || db.is_busy() {
            return Err(Unavailable);
        }
        db.execute_batch("BEGIN IMMEDIATE").map_err(|_| Unavailable)?;
        budget.check()?;
        let guard = TransactionAuthorization {
            authority: CurrentAuthority {
                db, config: &self.config, instance: &self.instance,
            },
            principal: original,
        };
        guard.authorize(original.scope(), Capability::Read).map_err(|_| Unavailable)?;
        budget.check()?;
        let result = operation(&guard)?;
        budget.check()?;
        guard.revalidate().map_err(|_| Unavailable)?;
        budget.check()?;
        db.execute_batch("COMMIT").map_err(|_| Unavailable)?;
        budget.check()?;
        Ok(result)
    }
}

pub(super) fn check(budget: &Budget) -> super::AccessResult<()> {
    budget.check().map_err(|_| AccessError::Unavailable)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::access::*;
    use serde_json::json;

    fn id(n: u32) -> CanonicalId {
        CanonicalId::parse(format!("10000000-0000-4000-8000-{n:012}")).unwrap()
    }
    #[test]
    fn held_catalog_metadata_keeps_original_grant_and_checks_every_lookup() {
        let scope = Scope {
            workspace_id: id(1),
            home_id: id(2),
        };
        let registration = SourceRegistration {
            workspace_id: id(1),
            home_id: id(2),
            source_instance_id: id(8),
            collection_id: "Synthetic / α + %".into(),
            owner: SourceOwner::Homebox,
            partition_mode: PartitionMode::ReviewedEntityAllowlist,
            allowed_external_ids: vec![id(9).as_str().into(), id(10).as_str().into()],
        };
        let config = AccessConfig::new(vec!["https://catalog.synthetic.invalid".into()])
            .unwrap()
            .with_clock(|| 1_800_000_000_000);
        let mut access = AccessBoundary::in_memory(config).unwrap();
        access
            .provision_user(
                &id(6),
                &id(7),
                "synthetic-reader",
                &hash_password("Synthetic-catalog-test-only!").unwrap(),
                None,
            )
            .unwrap();
        access
            .set_membership(&id(6), &scope, Role::Viewer, true)
            .unwrap();
        access.put_source(&registration, None).unwrap();
        let mut request = RequestEvidence {
            method: Method::Post,
            url: "https://catalog.synthetic.invalid/api/atlas/auth/login",
            origin: Some("https://catalog.synthetic.invalid"),
            sec_fetch_site: Some("same-origin"),
            referer: None,
            cookie: None,
            authorization: None,
            csrf: None,
        };
        let session = access
            .login(
                &request,
                &serde_json::to_vec(&json!({
                    "username":"synthetic-reader", "password":"Synthetic-catalog-test-only!"
                }))
                .unwrap(),
                "synthetic-catalog",
            )
            .unwrap();
        request.method = Method::Get;
        request.cookie = Some(session.set_cookie().split(';').next().unwrap());
        let principal = access.authorize(&request, &scope, Action::Read).unwrap();
        let budget = Budget::start();
        let changes = access.store.db.total_changes();
        let checked = access.with_partition_catalog(&principal, &budget, |guard| {
            assert!(std::ptr::eq(guard.principal(), &principal));
            let grant = guard
                .capture_catalog_partition(&registration.partition(), &budget)
                .unwrap();
            let before = guard.catalog_source_metadata(&grant, &budget).unwrap();
            assert_eq!(before.registration(), &registration);
            let mut reversed = registration.clone();
            reversed.allowed_external_ids.reverse();
            assert_ne!(before.registration(), &reversed);
            assert_eq!(
                guard.catalog_source_metadata(&grant, &budget).unwrap(),
                before
            );
            Ok(())
        });
        assert!(checked.clean);
        assert_eq!(checked.result, Ok(()));
        assert_eq!(access.store.db.total_changes(), changes);
        // Only the disposable synthetic private Access row is changed. Exercise
        // both initial capture and a previously captured handle against the gate.
        let grant = access
            .authorize_source_partition(&principal, &registration.partition())
            .unwrap();
        access
            .store
            .db
            .execute(
                "UPDATE access_sources SET registration=?1",
                ["x".repeat(crate::catalog_budget::MAX_REGISTRATION_BYTES + 1)],
            )
            .unwrap();
        let second_budget = Budget::start();
        let checked = access.with_partition_catalog(&principal, &second_budget, |guard| {
            assert!(matches!(
                guard.capture_catalog_partition(&registration.partition(), &second_budget),
                Err(AccessError::Unavailable)
            ));
            assert!(matches!(
                guard.catalog_source_metadata(&grant, &second_budget),
                Err(AccessError::Unavailable)
            ));
            Ok(())
        });
        assert!(checked.clean);
        assert_eq!(checked.result, Ok(()));
    }
}
