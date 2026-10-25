//! Internal bounded registration cut; the caller supplies held borrowed authority.
use super::*;
use crate::catalog_budget::{Budget, PolicyOutcome, Result as CatalogResult, Unavailable, sqlite_policy};

pub(crate) struct PartitionCatalogRead<'a, C> {
    db: &'a mut Connection,
    contract: &'a C,
    budget: &'a Budget,
}
impl<C: Contract> PartitionCatalogRead<'_, C> {
    pub(crate) fn begin(&mut self) -> CatalogResult<()> {
        self.budget.check()?;
        self.db.execute_batch("BEGIN").map_err(|_| Unavailable)?;
        self.budget.check()
    }
    pub(crate) fn cut<A: Authorization>(
        &mut self,
        authority: &A,
        original: &A::Principal,
        scope: &Scope,
    ) -> CatalogResult<Vec<SourceRegistration>> {
        self.budget.check()?;
        let actor = authorize(self.contract, authority, original, read_request(scope, Capability::Read, &[]))
            .map_err(|_| Unavailable)?;
        self.budget.check()?;
        let rows = super::super::cache_repository::catalog_registrations(self.db, self.contract, scope, self.budget)?;
        self.budget.check()?;
        if authorize(self.contract, authority, original, read_request(scope, Capability::Read, &[]))
            .map_err(|_| Unavailable)? != actor
        { return Err(Unavailable); }
        self.budget.check()?;
        Ok(rows)
    }
    pub(crate) fn finish(&mut self) -> CatalogResult<()> {
        self.budget.check()?;
        self.db.execute_batch("COMMIT").map_err(|_| Unavailable)?;
        self.budget.check()
    }
}
impl<C: Contract, A: Authorization, R: Runtime> AtlasStore<C, A, R> {
    pub(crate) fn with_partition_catalog<T>(
        &mut self,
        budget: &Budget,
        operation: impl FnOnce(&mut PartitionCatalogRead<'_, C>) -> CatalogResult<T>,
    ) -> PolicyOutcome<T> {
        let contract = &self.contract;
        sqlite_policy(&mut self.db, budget, self.options.busy_timeout_ms, |db| {
            let mut read = PartitionCatalogRead { db, contract, budget };
            operation(&mut read)
        })
    }
}
