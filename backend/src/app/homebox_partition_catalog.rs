//! Bounded native metadata catalog shared by retained and HTTP Read issuance.
use super::{Core, OriginalPrincipal, RequestPrincipal};
use crate::{access as a, catalog_budget as b, domain as d, storage as s};
use serde::Serialize;
use std::sync::{Arc, Mutex};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Catalog {
    schema_version: u8,
    scope: d::Scope,
    partitions: Vec<Partition>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Partition {
    owner: &'static str,
    source_instance_id: String,
    collection_id: String,
}

/// Only borrows the actual held Access guard. Never relocks/reconstructs Access.
struct Held<'a, 'g> {
    guard: &'a a::TransactionAuthorization<'g>,
    budget: &'a b::Budget,
}
impl s::Authorization for Held<'_, '_> {
    type Principal = RequestPrincipal;
    fn authorize(
        &self,
        p: &RequestPrincipal,
        request: s::AuthorizationRequest<'_>,
    ) -> s::Result<s::VerifiedActor> {
        let fail = || s::Error::new("unavailable", "Catalog unavailable");
        self.budget.check().map_err(|_| fail())?;
        if !std::ptr::eq(self.guard.principal(), p.principal.principal())
            || !matches!(request.capability, s::Capability::Read)
            || request.source.is_some()
            || request.source_partition.is_some()
            || request.mutation.is_some()
            || !request.targets.is_empty()
        {
            return Err(fail());
        }
        let scope = super::access_scope(&d::Scope {
            workspace_id: request.scope.workspace_id.clone(),
            home_id: request.scope.home_id.clone(),
        })
        .map_err(|_| fail())?;
        self.guard
            .authorize(&scope, a::Capability::Read)
            .map_err(|_| fail())?;
        self.budget.check().map_err(|_| fail())?;
        Ok(s::VerifiedActor {
            workspace_id: scope.workspace_id.as_str().into(),
            home_id: scope.home_id.as_str().into(),
            actor_id: p.principal.actor_id().as_str().into(),
        })
    }
}

impl RequestPrincipal {
    fn capture_catalog(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        partition: &a::SourcePartition,
        budget: &b::Budget,
    ) -> a::AccessResult<a::PartitionGrant> {
        budget.check().map_err(|_| a::AccessError::Unavailable)?;
        if !std::ptr::eq(guard.principal(), self.principal.principal())
            || self.source_capture_sealed.get()
        {
            return Err(a::AccessError::Unavailable);
        }
        if let Some(existing) = self
            .partitions
            .borrow()
            .iter()
            .find(|g| g.partition() == partition)
        {
            guard.catalog_source_metadata(existing, budget)?;
            return Ok(existing.clone());
        }
        let grant = guard.capture_catalog_partition(partition, budget)?;
        self.partitions.borrow_mut().push(grant.clone());
        budget.check().map_err(|_| a::AccessError::Unavailable)?;
        Ok(grant)
    }
    fn release_catalog(
        &self,
        guard: &a::TransactionAuthorization<'_>,
        budget: &b::Budget,
        retained: &[(a::PartitionGrant, a::SourceAuthorityMetadata)],
    ) -> b::Result<()> {
        budget.check()?;
        if !std::ptr::eq(guard.principal(), self.principal.principal())
            || !self.sources.borrow().is_empty()
            || !self.network_links.borrow().is_empty()
            || !self.home_choices.is_empty()
        {
            return Err(b::Unavailable);
        }
        guard
            .authorize(self.principal.scope(), a::Capability::Read)
            .map_err(|_| b::Unavailable)?;
        let grants = self.partitions.borrow();
        if grants.len() != retained.len() {
            return Err(b::Unavailable);
        }
        for (grant, (expected, before)) in grants.iter().zip(retained) {
            budget.check()?;
            if grant.partition() != expected.partition()
                || &guard
                    .catalog_source_metadata(grant, budget)
                    .map_err(|_| b::Unavailable)?
                    != before
            {
                return Err(b::Unavailable);
            }
            budget.check()?;
        }
        budget.check()
    }
}

/// The future owns sticky cancellation before scheduling. Dropping it cannot
/// stop a running spawn_blocking closure: the worker must finish native cleanup.
/// The caller supplies the original selected-home issuance, not public actor IDs.
#[allow(dead_code)] // Retained-principal entry; HTTP owns its separate issuance handoff.
pub(crate) async fn read(
    core: Arc<Mutex<Core>>,
    original: OriginalPrincipal,
    admission: Arc<tokio::sync::OwnedSemaphorePermit>,
) -> b::Result<Vec<u8>> {
    let budget = b::Budget::start();
    let _cancel = b::CancelOnDrop(budget.clone());
    budget.check()?;
    let worker_budget = budget.clone();
    let result = tokio::task::spawn_blocking(move || {
        // This is the caller's existing native admission permit, retained even
        // if its future is dropped while the worker is cleaning up.
        let _admission = admission;
        worker(core, original, &worker_budget)
    })
    .await
    .map_err(|_| b::Unavailable)?;
    budget.check()?;
    result
}

fn worker(
    core_owner: Arc<Mutex<Core>>,
    original: OriginalPrincipal,
    budget: &b::Budget,
) -> b::Result<Vec<u8>> {
    read_with_issuance(core_owner, budget, |_, _| {
        Ok(RequestPrincipal::from_retained(original.retained().clone()))
    })?.map_err(|_| b::Unavailable)
}

/// Called inside the HTTP handler's single blocking worker, using its budget.
/// The issuance closure uses only the held original Access owner after BOTH
/// policies are installed. Authentication errors remain distinct from catalog
/// unavailability and are returned only after mandatory owner cleanup.
pub(crate) fn read_with_issuance(
    core_owner: Arc<Mutex<Core>>,
    budget: &b::Budget,
    issue: impl FnOnce(&mut a::AccessBoundary, &b::Budget) -> a::AccessResult<RequestPrincipal>,
) -> b::Result<a::AccessResult<Vec<u8>>> {
    if !cfg!(panic = "unwind") {
        return Err(b::Unavailable);
    }
    budget.check()?;
    let core = core_owner.try_lock().map_err(|_| b::Unavailable)?;
    budget.check()?;
    let store_owner = Arc::clone(&core.store);
    let access_owner = Arc::clone(&core.access);
    let mut store_guard = Some(store_owner.try_lock().map_err(|_| b::Unavailable)?);
    budget.check()?;
    let mut access_guard = Some(access_owner.try_lock().map_err(|_| b::Unavailable)?);
    budget.check()?;
    let store = store_guard.as_mut().ok_or(b::Unavailable)?;
    if !Arc::ptr_eq(&store.configured_authorization().0, &access_owner) {
        return Err(b::Unavailable);
    }
    let mut access_bad = false;
    let outcome = store.with_partition_catalog(budget, |read| {
        let access = access_guard.as_mut().ok_or(b::Unavailable)?;
        let checked = access.with_partition_catalog_policy(budget, |access| {
            budget.check()?;
            let p = match issue(access, budget) {
                Ok(p) => p,
                Err(error) => return Ok(Err(error)),
            };
            budget.check()?;
            let scope = d::Scope {
                workspace_id: p.principal.scope().workspace_id.as_str().into(),
                home_id: p.principal.scope().home_id.as_str().into(),
            };
            if !core.homes.iter().any(|home| home.scope == scope) {
                return Ok(Err(a::AccessError::NotFound));
            }
            let native_scope = s::Scope {
                workspace_id: scope.workspace_id.clone(),
                home_id: scope.home_id.clone(),
            };
            // Authentication's committed bookkeeping precedes this transaction.
            access.partition_catalog_fence(p.principal.principal(), budget, |guard| {
                let authority = Held { guard, budget };
                budget.check()?;
                read.begin()?;
                let cut = read.cut(&authority, &p, &native_scope)?;
                let mut partitions = Vec::new();
                let mut retained = Vec::new();
                for registration in &cut {
                    budget.check()?;
                    if registration.owner != s::SourceOwner::Homebox {
                        continue;
                    }
                    let access_registration: a::SourceRegistration = serde_json::from_value(
                        serde_json::to_value(registration).map_err(|_| b::Unavailable)?,
                    )
                    .map_err(|_| b::Unavailable)?;
                    budget.check()?;
                    let grant = match p.capture_catalog(guard, &access_registration.partition(), budget)
                    {
                        Ok(grant) => grant,
                        Err(a::AccessError::NotFound | a::AccessError::Forbidden) => continue,
                        Err(_) => return Err(b::Unavailable),
                    };
                    let metadata = guard
                        .catalog_source_metadata(&grant, budget)
                        .map_err(|_| b::Unavailable)?;
                    budget.check()?;
                    if metadata.registration() != &access_registration
                        || partitions.len() == b::MAX_RESULTS
                    {
                        return Err(b::Unavailable);
                    }
                    retained.push((grant, metadata));
                    partitions.push(Partition {
                        owner: "homebox",
                        source_instance_id: registration.source_instance_id.clone(),
                        collection_id: registration.collection_id.clone(),
                    });
                }
                p.seal_source_capture();
                budget.check()?;
                if read.cut(&authority, &p, &native_scope)? != cut {
                    return Err(b::Unavailable);
                }
                budget.check()?;
                for (grant, before) in &retained {
                    budget.check()?;
                    if &guard
                        .catalog_source_metadata(grant, budget)
                        .map_err(|_| b::Unavailable)?
                        != before
                    {
                        return Err(b::Unavailable);
                    }
                    budget.check()?;
                }
                p.release_catalog(guard, budget, &retained)?;
                let bytes = b::encode(
                    &Catalog {
                        schema_version: 1,
                        scope,
                        partitions,
                    },
                    budget,
                )?;
                // Encoding cannot turn a prior check into a later disclosure grant.
                if read.cut(&authority, &p, &native_scope)? != cut {
                    return Err(b::Unavailable);
                }
                p.release_catalog(guard, budget, &retained)?;
                read.finish()?;
                p.release_catalog(guard, budget, &retained)?;
                budget.check()?;
                Ok(bytes)
            }).map(Ok)
        });
        access_bad = !checked.clean;
        checked.result
    });
    // Helpers have removed callbacks and completed/rolled back their native
    // transactions before quarantine. Other guards stay outside each unwind.
    let mut quarantine_ok = true;
    if access_bad {
        quarantine_ok &= b::quarantine(&access_owner, &mut access_guard).is_ok();
    }
    if !outcome.clean {
        quarantine_ok &= b::quarantine(&store_owner, &mut store_guard).is_ok();
    }
    budget.check()?;
    if !quarantine_ok || access_bad || !outcome.clean {
        return Err(b::Unavailable);
    }
    budget.check()?;
    outcome.result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn closed_catalog_contains_selectors_only_and_preserves_opaque_collection() {
        let catalog = Catalog {
            schema_version: 1,
            scope: d::Scope {
                workspace_id: "10000000-0000-4000-8000-000000000001".into(),
                home_id: "10000000-0000-4000-8000-000000000002".into(),
            },
            partitions: vec![Partition {
                owner: "homebox",
                source_instance_id: "10000000-0000-4000-8000-000000000008".into(),
                collection_id: "Synthetic / α + %".into(),
            }],
        };
        let value: serde_json::Value =
            serde_json::from_slice(&b::encode(&catalog, &b::Budget::start()).unwrap()).unwrap();
        assert_eq!(value.as_object().unwrap().len(), 3);
        assert_eq!(value["partitions"][0].as_object().unwrap().len(), 3);
        assert_eq!(value["partitions"][0]["collectionId"], "Synthetic / α + %");
        assert_eq!(value["partitions"][0]["owner"], "homebox");
    }
}
