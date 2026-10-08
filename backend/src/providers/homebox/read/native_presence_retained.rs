//! Reproduce a retained normalization from its exact original native allocation.
//! This checks source DATA and correlation, not current authority or elapsed
//! network deadlines. Missing IDs and quarantine require the independently
//! retained predecessor history; raw responses cannot establish those facts.
use super::decode::{self, WireEntity};
use super::native_presence_capture::{NativePresenceIdentity, NativePresenceResponse};
use super::stock;
use super::{
    CONSISTENCY, CacheState, CompleteGeneration, ErrorCode, PartitionMode, Projection, ReadError,
    SourceRegistration, Uuid,
};
use std::{collections::BTreeMap, sync::Arc};

impl NativePresenceIdentity {
    /// Pure immutable normalization and DATA matching for the original capture.
    /// This does not qualify history admission, configured origin, or current grants.
    pub fn validate_retained_generation(
        &self,
        registration: &SourceRegistration,
        generation: &CompleteGeneration,
    ) -> Result<(), ReadError> {
        // Check the actual original allocation before interpreting any bytes.
        if !generation
            .native_presence
            .as_ref()
            .is_some_and(|n| Arc::ptr_eq(&self.0, n))
        {
            return Err(ReadError(ErrorCode::WrongScope));
        }
        let native = &self.0;
        let original = &native.registration;
        registration.validate()?;
        native.limits.validate()?;
        if registration.workspace_id != original.workspace_id
            || registration.home_id != original.home_id
            || registration.source_instance_id != original.source_instance_id
            || registration.collection_id != original.collection_id
            || registration.owner != original.owner
            || registration.partition_mode != original.partition_mode
            || registration.allowed_external_ids != original.allowed_external_ids
            || registration.scope() != native.scope
            || generation.cache.scope() != native.scope
            || generation.cache.generation_id.as_ref() != Some(&native.generation_id)
        {
            return Err(ReadError(ErrorCode::WrongScope));
        }
        let cache = &generation.cache;
        let attempt = cache.last_attempt_at.as_ref().ok_or(invalid())?;
        let success = cache.last_successful_fetch_at.as_ref().ok_or(invalid())?;
        if cache.schema_version != 1
            || cache.consistency != CONSISTENCY
            || cache.status != CacheState::Fresh
            || cache.error.is_some()
            || success.instant() < attempt.instant()
        {
            return Err(invalid());
        }
        let authorized = |id: &Uuid| {
            registration.partition_mode == PartitionMode::ExclusiveHome
                || registration.allowed_external_ids.contains(id)
        };
        let limits = native.limits;
        let mut bytes = 0usize;
        for response in &native.responses {
            if response.scope != native.scope {
                return Err(ReadError(ErrorCode::WrongScope));
            }
            if !(200..300).contains(&response.status) {
                return Err(ReadError(ErrorCode::Upstream));
            }
            if response.body.len() > limits.max_response_bytes {
                return Err(ReadError(ErrorCode::SizeLimit));
            }
            bytes = bytes
                .checked_add(response.body.len())
                .ok_or(ReadError(ErrorCode::SizeLimit))?;
            if bytes > limits.max_generation_bytes {
                return Err(ReadError(ErrorCode::SizeLimit));
            }
        }
        if generation.stats.bytes != bytes || generation.stats.requests != native.responses.len() {
            return Err(invalid());
        }
        let mut responses = native.responses.iter();
        let mut rows: BTreeMap<Uuid, (WireEntity, serde_json::Value)> = BTreeMap::new();
        let mut pages = 0usize;
        for is_location in [true, false] {
            let mut total = None;
            let mut page = 1u64;
            let mut fetched = 0u64;
            loop {
                pages = pages
                    .checked_add(1)
                    .ok_or(ReadError(ErrorCode::Pagination))?;
                if pages > limits.max_pages {
                    return Err(ReadError(ErrorCode::Pagination));
                }
                let query = vec![
                    ("isLocation".into(), is_location.to_string()),
                    ("includeArchived".into(), "true".into()),
                    ("page".into(), page.to_string()),
                    ("pageSize".into(), limits.max_page_size.to_string()),
                ];
                let response = take(&mut responses, "/api/v1/entities", &query)?;
                let value = stock::page(&response.body, page, is_location, &[], limits)?;
                let data = decode::page(value)?;
                if data.page != page
                    || data.page_size != limits.max_page_size as u64
                    || total.is_some_and(|t| data.total != t)
                    || data.total > (limits.max_pages * limits.max_page_size) as u64
                {
                    return Err(ReadError(ErrorCode::Pagination));
                }
                total = Some(data.total);
                let expected = data.page_size.min(data.total.saturating_sub(fetched));
                if data.items.len() as u64 != expected {
                    return Err(ReadError(ErrorCode::Pagination));
                }
                for raw in data.items {
                    let (row, normalized) = decode::wire(raw)?;
                    if row
                        .entity_type
                        .as_ref()
                        .is_some_and(|t| t.is_location != is_location)
                    {
                        return Err(ReadError(ErrorCode::Pagination));
                    }
                    if let Some((_, existing)) = rows.get(&row.id) {
                        if existing != &normalized {
                            return Err(ReadError(ErrorCode::Pagination));
                        }
                    } else {
                        rows.insert(row.id.clone(), (row, normalized));
                    }
                }
                fetched += expected;
                if fetched == data.total {
                    break;
                }
                page += 1;
            }
        }
        let mut projections = Vec::new();
        for (id, (listed, _)) in rows {
            if !authorized(&id) {
                continue;
            }
            check_parent(&listed, &authorized)?;
            let detail_response = take(
                &mut responses,
                &format!("/api/v1/entities/{}", id.as_str()),
                &[],
            )?;
            let value = stock::detail(&detail_response.body, &id, limits)?;
            let (detail, raw) = decode::wire(value)?;
            if detail.id != id {
                return Err(ReadError(ErrorCode::WrongScope));
            }
            check_parent(&detail, &authorized)?;
            if detail != listed {
                return Err(ReadError(ErrorCode::Pagination));
            }
            let response = take(
                &mut responses,
                &format!("/api/v1/entities/{}/maintenance", id.as_str()),
                &[("status".into(), "both".into())],
            )?;
            let maintenance = stock::maintenance(&response.body, &id, limits)?;
            let navigation = native
                .stock_navigation
                .as_ref()
                .and_then(|n| n.for_entity(&detail));
            projections.push(decode::projection(
                raw,
                detail,
                maintenance,
                &native.scope,
                response.retrieved_at.clone(),
                navigation,
            )?);
        }
        if responses.next().is_some() || projections != generation.homebox_entities {
            return Err(invalid());
        }
        if generation.stats.pages != pages
            || projections
                .iter()
                .any(|p| p.retrieved_at.instant() > success.instant())
        {
            return Err(invalid());
        }
        validate_entities(&projections, &native.scope, &authorized)
    }
}

fn invalid() -> ReadError {
    ReadError(ErrorCode::InvalidSchema)
}
fn take<'a>(
    responses: &mut std::slice::Iter<'a, NativePresenceResponse>,
    path: &str,
    query: &[(String, String)],
) -> Result<&'a NativePresenceResponse, ReadError> {
    let response = responses.next().ok_or(invalid())?;
    if response.path != path || response.query != query {
        return Err(invalid());
    }
    Ok(response)
}
fn check_parent(row: &WireEntity, authorized: &impl Fn(&Uuid) -> bool) -> Result<(), ReadError> {
    if row.parent.as_ref().is_some_and(|p| !authorized(&p.id)) {
        return Err(ReadError(ErrorCode::WrongScope));
    }
    Ok(())
}
fn validate_entities(
    entities: &[Projection],
    scope: &super::SourceScope,
    authorized: &impl Fn(&Uuid) -> bool,
) -> Result<(), ReadError> {
    let mut records = BTreeMap::new();
    for (i, projection) in entities.iter().enumerate() {
        decode::validate_projection(projection, scope)?;
        if !authorized(&projection.entity.id)
            || projection
                .entity
                .parent
                .as_ref()
                .is_some_and(|p| !authorized(&p.id))
        {
            return Err(ReadError(ErrorCode::WrongScope));
        }
        if records.insert(&projection.entity.id, i).is_some() {
            return Err(invalid());
        }
    }
    let mut states = vec![0u8; entities.len()];
    for start in 0..entities.len() {
        let mut next = Some(start);
        let mut trail = Vec::new();
        while let Some(i) = next {
            if states[i] == 2 {
                break;
            }
            if states[i] == 1 {
                return Err(invalid());
            }
            states[i] = 1;
            trail.push(i);
            next = entities[i]
                .entity
                .parent
                .as_ref()
                .and_then(|p| records.get(&p.id).copied());
        }
        for i in trail {
            states[i] = 2;
        }
    }
    Ok(())
}
