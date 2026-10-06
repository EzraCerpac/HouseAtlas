//! Trusted source registration and atomic generation publication, never public
//! record commands or a source-presence admission/witness implementation.
use super::super::{cache_repository as cache_repo, repository as repo, *};
use super::{AtlasStore, authorize, read_request, shape};
use rusqlite::TransactionBehavior;
use serde_json::{Value, json};

impl<C: Contract, A: Authorization, R: Runtime> AtlasStore<C, A, R> {
    pub fn register_source(
        &mut self,
        principal: &A::Principal,
        registration: &SourceRegistration,
    ) -> Result<SourceRegistration> {
        shape(&self.contract, "sourceRegistration", registration)?;
        let scope = registration.scope();
        let input = serde_json::to_value(registration)?;
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let actor = trusted_authorize(
            &self.contract,
            &self.authorization,
            principal,
            &scope,
            Capability::ConfigureSource,
            &input,
        )?;
        let mut candidate = repo::snapshot(&tx)?;
        let partition = registration.partition();
        let existing = candidate
            .sources
            .iter()
            .map(|r| Ok((repo::partition(r)?, r)))
            .collect::<Result<Vec<_>>>()?
            .into_iter()
            .find(|(p, _)| *p == partition)
            .map(|(_, r)| r);
        let response = if let Some(existing) = existing {
            if self.contract.canonical_json(existing)? != self.contract.canonical_json(&input)? {
                return Err(Error::new(
                    "identity-conflict",
                    "Source registration is immutable",
                ));
            }
            serde_json::from_value(existing.clone())?
        } else {
            candidate.sources.push(input.clone());
            self.contract.validate_snapshot(&candidate)?;
            cache_repo::write_source(&tx, &self.contract, &input)?;
            registration.clone()
        };
        revalidate(
            &self.contract,
            &self.authorization,
            principal,
            &scope,
            Capability::ConfigureSource,
            &input,
            &actor,
        )?;
        tx.commit()?;
        Ok(response)
    }
    pub fn register_source_json(
        &mut self,
        principal: &A::Principal,
        registration: &Value,
    ) -> Result<SourceRegistration> {
        self.contract
            .validate_shape("sourceRegistration", registration)?;
        self.register_source(principal, &serde_json::from_value(registration.clone())?)
    }

    /// Trusted server-only pre-fetch read. Retained quarantine rows are included;
    /// the result confers no entity permission or source enablement.
    pub fn read_cache_for_publication(
        &mut self,
        principal: &A::Principal,
        scope: &Scope,
        partition: &SourcePartition,
    ) -> Result<CachePublicationState> {
        validate_partition(&self.contract, partition)?;
        let source = serde_json::to_value(partition)?;
        let tx = self.db.transaction()?;
        trusted_authorize(
            &self.contract,
            &self.authorization,
            principal,
            scope,
            Capability::PublishCache,
            &source,
        )?;
        if partition.scope() != *scope {
            return Err(Error::new("not-found", "Source unavailable"));
        }
        let response = cache_repo::publication_state(&tx, partition)?;
        tx.commit()?;
        Ok(response)
    }

    /// The service captures access-registry authority separately. This storage
    /// fence binds only the actual pre-fetch cache state and selected candidate
    /// UUID; permanent generation reservation still occurs on successful commit.
    pub fn prepare_cache_publication(
        &mut self,
        principal: &A::Principal,
        scope: &Scope,
        partition: &SourcePartition,
    ) -> Result<PreparedCachePublication> {
        validate_partition(&self.contract, partition)?;
        let input = serde_json::to_value(partition)?;
        let tx = self.db.transaction()?;
        trusted_authorize(
            &self.contract,
            &self.authorization,
            principal,
            scope,
            Capability::PublishCache,
            &input,
        )?;
        if partition.scope() != *scope {
            return Err(Error::new("not-found", "Source unavailable"));
        }
        let state = cache_repo::publication_state(&tx, partition)?;
        let reserved_generation_id = self.runtime.new_id()?;
        shape(
            &self.contract,
            "recordRef",
            &RecordRef {
                record_type: RecordType::Identity,
                record_id: reserved_generation_id.clone(),
            },
        )?;
        if cache_repo::generation_reserved(&tx, partition, &reserved_generation_id)? {
            return Err(Error::new(
                "idempotency-conflict",
                "Cache generation ID is already reserved",
            ));
        }
        let fence = CachePublicationFence {
            issuer: self.instance.clone(),
            partition: partition.clone(),
            baseline_generation_id: state.cache.as_ref().and_then(|c| c.generation_id.clone()),
            baseline_cache_epoch: CacheEpoch(state.cache_epoch),
            reserved_generation_id,
        };
        tx.commit()?;
        Ok(PreparedCachePublication { state, fence })
    }
    /// Trusted internal wrapper: the provider/service adapter must first prove
    /// completeness with its own opaque complete-generation type. Storage binds
    /// these exact cache/row values to this store's pre-fetch fence and selected
    /// generation ID; raw row slices alone are not evidence of a complete fetch.
    pub fn publish_prepared_generation(
        &mut self,
        principal: &A::Principal,
        fence: CachePublicationFence,
        cache: &CacheStatus,
        homebox_entities: &[Value],
        network_relations: &[Value],
    ) -> Result<CacheStatus> {
        if !std::sync::Arc::ptr_eq(&self.instance, &fence.issuer)
            || cache.partition() != fence.partition
            || cache.generation_id.as_deref() != Some(fence.reserved_generation_id.as_str())
        {
            return Err(Error::new(
                "guard-conflict",
                "Staged generation does not match its pre-fetch fence",
            ));
        }
        self.replace_cache_generation(
            principal,
            &fence.partition.scope(),
            &CacheGeneration {
                cache: cache.clone(),
                homebox_entities: homebox_entities.to_vec(),
                network_relations: network_relations.to_vec(),
                complete: true,
                expected_generation_id: fence.baseline_generation_id.clone(),
                expected_cache_epoch: fence.baseline_cache_epoch.value(),
            },
        )
    }

    pub fn replace_cache_generation(
        &mut self,
        principal: &A::Principal,
        scope: &Scope,
        generation: &CacheGeneration,
    ) -> Result<CacheStatus> {
        let input = serde_json::to_value(&generation.cache)?;
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let actor = trusted_authorize(
            &self.contract,
            &self.authorization,
            principal,
            scope,
            Capability::PublishCache,
            &input,
        )?;
        let original = repo::snapshot(&tx)?;
        shape(&self.contract, "cacheStatus", &generation.cache)?;
        let partition = generation.cache.partition();
        let source = cache_repo::source(&tx, &partition)?;
        if partition.scope() != *scope
            || !generation.complete
            || generation.cache.status != CacheState::Fresh
            || generation.cache.last_attempt_at.is_none()
            || timestamp_after(
                &self.contract,
                generation.cache.last_attempt_at.as_deref(),
                generation.cache.last_successful_fetch_at.as_deref(),
            )?
        {
            return Err(Error::new(
                "invalid-contract",
                "A complete authorized fresh generation and prior generation are required",
            ));
        }
        let prior = cache_repo::cache(&tx, &partition)?;
        if prior.as_ref().and_then(|c| c.generation_id.as_ref())
            != generation.expected_generation_id.as_ref()
        {
            return Err(Error::new(
                "guard-conflict",
                "Cache generation changed during fetch",
            ));
        }
        if generation.expected_cache_epoch > MAX_REVISION {
            return Err(Error::new(
                "invalid-contract",
                "The cache epoch captured before fetching is required",
            ));
        }
        if cache_repo::epoch(&tx, &partition)? != generation.expected_cache_epoch {
            return Err(Error::new(
                "guard-conflict",
                "Cache publication or source failure changed during fetch",
            ));
        }
        if timestamp_after(
            &self.contract,
            prior
                .as_ref()
                .and_then(|c| c.last_successful_fetch_at.as_deref()),
            generation.cache.last_successful_fetch_at.as_deref(),
        )? {
            return Err(Error::new(
                "guard-conflict",
                "Cache generation cannot move successful time backward",
            ));
        }
        if (source.owner != SourceOwner::Homebox && !generation.homebox_entities.is_empty())
            || (source.owner != SourceOwner::Network && !generation.network_relations.is_empty())
        {
            return Err(Error::new(
                "forbidden",
                "Projection owner does not match registered source",
            ));
        }
        for projection in &generation.homebox_entities {
            self.contract
                .validate_shape("homeboxProjection", projection)?;
            if homebox_partition(projection)? != partition {
                return Err(Error::new(
                    "forbidden",
                    "Projection source does not match generation",
                ));
            }
        }
        for relation in &generation.network_relations {
            self.contract.validate_shape("networkRelation", relation)?;
            if repo::partition(relation)? != partition
                || timestamp_after(
                    &self.contract,
                    relation["retrievedAt"].as_str(),
                    generation.cache.last_successful_fetch_at.as_deref(),
                )?
            {
                return Err(Error::new(
                    "forbidden",
                    "Relation source or retrieval time does not match generation",
                ));
            }
        }
        let mut candidate = original;
        candidate.homebox_entities =
            select_partition(candidate.homebox_entities, &partition, true, false)?;
        candidate
            .homebox_entities
            .extend(generation.homebox_entities.clone());
        candidate.network_relations =
            select_partition(candidate.network_relations, &partition, false, false)?;
        candidate
            .network_relations
            .extend(generation.network_relations.clone());
        candidate.caches = select_partition(candidate.caches, &partition, false, false)?;
        candidate.caches.push(input.clone());
        self.contract.validate_snapshot(&candidate)?;
        let generation_id = generation.cache.generation_id.as_deref().ok_or(Error::new(
            "invalid-contract",
            "Fresh generation ID is required",
        ))?;
        if cache_repo::generation_reserved(&tx, &partition, generation_id)? {
            return Err(Error::new(
                "idempotency-conflict",
                "Cache generation ID is already reserved",
            ));
        }
        cache_repo::replace_projections(
            &tx,
            &self.contract,
            &partition,
            &generation.homebox_entities,
            &generation.network_relations,
        )?;
        cache_repo::write_cache(&tx, &self.contract, &input)?;
        cache_repo::reserve_generation(&tx, &partition, generation_id)?;
        cache_repo::advance_epoch(&tx, &partition)?;
        revalidate(
            &self.contract,
            &self.authorization,
            principal,
            scope,
            Capability::PublishCache,
            &input,
            &actor,
        )?;
        tx.commit()?;
        Ok(generation.cache.clone())
    }
    /// This is an internal envelope, not a new client mutation language. Its
    /// serde carrier requires every field, including the nullable predecessor.
    pub fn replace_cache_generation_json(
        &mut self,
        principal: &A::Principal,
        scope: &Scope,
        generation: &Value,
    ) -> Result<CacheStatus> {
        let generation = serde_json::from_value(generation.clone()).map_err(|_| {
            Error::new(
                "invalid-contract",
                "Complete cache publication envelope is required",
            )
        })?;
        self.replace_cache_generation(principal, scope, &generation)
    }
    pub fn record_cache_failure(
        &mut self,
        principal: &A::Principal,
        scope: &Scope,
        partition: &SourcePartition,
        failure: &CacheFailure,
    ) -> Result<CacheStatus> {
        validate_partition(&self.contract, partition)?;
        let input = serde_json::to_value(partition)?;
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let actor = trusted_authorize(
            &self.contract,
            &self.authorization,
            principal,
            scope,
            Capability::PublishCache,
            &input,
        )?;
        if partition.scope() != *scope {
            return Err(Error::new("not-found", "Source unavailable"));
        }
        cache_repo::source(&tx, partition)?;
        let mut candidate = repo::snapshot(&tx)?;
        let prior = cache_repo::cache(&tx, partition)?;
        let at = self.runtime.now()?;
        let quarantined = prior
            .as_ref()
            .is_some_and(|c| c.status == CacheState::AccessRevoked)
            || failure.code.quarantines();
        let row = CacheStatus {
            schema_version: 1,
            workspace_id: scope.workspace_id.clone(),
            home_id: scope.home_id.clone(),
            source_instance_id: partition.source_instance_id.clone(),
            collection_id: partition.collection_id.clone(),
            status: if quarantined {
                CacheState::AccessRevoked
            } else {
                failure.status.unwrap_or(FailureStatus::Error).into()
            },
            last_successful_fetch_at: prior
                .as_ref()
                .and_then(|c| c.last_successful_fetch_at.clone()),
            generation_id: prior.and_then(|c| c.generation_id),
            last_attempt_at: Some(at.clone()),
            consistency: "non-transactional-offset-pages".into(),
            error: Some(CacheError {
                code: failure.code,
                at,
                message: failure.code.message().into(),
            }),
        };
        let value = serde_json::to_value(&row)?;
        candidate.caches = select_partition(candidate.caches, partition, false, false)?;
        candidate.caches.push(value.clone());
        self.contract.validate_snapshot(&candidate)?;
        cache_repo::write_cache(&tx, &self.contract, &value)?;
        cache_repo::advance_epoch(&tx, partition)?;
        revalidate(
            &self.contract,
            &self.authorization,
            principal,
            scope,
            Capability::PublishCache,
            &input,
            &actor,
        )?;
        tx.commit()?;
        Ok(row)
    }
}
fn validate_partition<C: Contract>(contract: &C, partition: &SourcePartition) -> Result<()> {
    shape(contract, "scope", &partition.scope())?;
    shape(
        contract,
        "recordRef",
        &RecordRef {
            record_type: RecordType::Identity,
            record_id: partition.source_instance_id.clone(),
        },
    )?;
    if partition.collection_id.is_empty() || partition.collection_id.chars().count() > 4096 {
        return Err(Error::new(
            "invalid-contract",
            "Invalid source collection selector",
        ));
    }
    Ok(())
}
fn trusted_authorize<C: Contract, A: Authorization>(
    contract: &C,
    authorization: &A,
    principal: &A::Principal,
    scope: &Scope,
    capability: Capability,
    source: &Value,
) -> Result<VerifiedActor> {
    let mut request = read_request(scope, capability, &[]);
    request.source = Some(source);
    authorize(contract, authorization, principal, request)
}
fn revalidate<C: Contract, A: Authorization>(
    contract: &C,
    authorization: &A,
    principal: &A::Principal,
    scope: &Scope,
    capability: Capability,
    source: &Value,
    actor: &VerifiedActor,
) -> Result<()> {
    let current = trusted_authorize(
        contract,
        authorization,
        principal,
        scope,
        capability,
        source,
    )?;
    if current.actor_id != actor.actor_id {
        return Err(Error::new(
            "unauthenticated",
            "Verified principal changed during transaction",
        ));
    }
    Ok(())
}
fn homebox_partition(row: &Value) -> Result<SourcePartition> {
    repo::partition(
        &json!({"workspaceId":row["workspaceId"],"homeId":row["homeId"],"sourceInstanceId":row["source"]["sourceInstanceId"],"collectionId":row["source"]["collectionId"]}),
    )
}
fn select_partition(
    rows: Vec<Value>,
    partition: &SourcePartition,
    homebox: bool,
    keep_matching: bool,
) -> Result<Vec<Value>> {
    rows.into_iter()
        .map(|row| {
            let key = if homebox {
                homebox_partition(&row)?
            } else {
                repo::partition(&row)?
            };
            Ok((row, (key == *partition) == keep_matching))
        })
        .collect::<Result<Vec<_>>>()
        .map(|rows| {
            rows.into_iter()
                .filter_map(|(row, keep)| keep.then_some(row))
                .collect()
        })
}
fn timestamp_after<C: Contract>(
    contract: &C,
    left: Option<&str>,
    right: Option<&str>,
) -> Result<bool> {
    let left = left
        .map(|s| contract.timestamp_millis(s))
        .transpose()?
        .flatten();
    let right = right
        .map(|s| contract.timestamp_millis(s))
        .transpose()?
        .flatten();
    Ok(matches!((left,right),(Some(left),Some(right)) if left > right))
}
