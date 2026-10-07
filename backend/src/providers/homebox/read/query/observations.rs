//! Concrete source observations bound to the original prepared read.
//! No grant, graph authorizer, GET, history or artifact factory is implemented.
use super::super::{SourceScope, Timestamp};
use super::*;
use crate::{
    contracts::stock::{HomeboxResourceKind, StockTarget},
    domain::stock::{self as st, StockContractPort},
    providers::homebox::wire,
};
use serde_json::Value;

/// An immutable projection of bounded native response bytes. The source owner
/// supplies its captured partition and retrieval metadata, never request scope
/// as a replacement for source registration. This is evidence, not authority.
/// Build the complete owner graph from these references and retained source
/// relationships before Domain preparation; Domain must authorize the graph
/// and exact output under the original principal/witness at dispatch.
#[derive(Debug)]
pub struct DecodedReadObservation {
    request: Value,
    decoded: wire::Decoded<HomeBoxReadResult>,
    references: Vec<StockTarget>,
    ordered_path: Option<Vec<StockTarget>>,
    parent_relations: Vec<(StockTarget, StockTarget)>,
}

impl DecodedReadObservation {
    pub fn from_detail<C: StockContractPort>(
        contracts: &C,
        request: &st::ValidatedRequest,
        captured_scope: &SourceScope,
        decoded: &wire::Decoded<wire::Detail>,
        retrieved_at: &Timestamp,
        status: SourceStatus,
    ) -> st::StockResult<Self> {
        let query = scoped(request, captured_scope)?;
        let result = if matches!(
            query.selection(),
            ReadSelection::Feature(FeatureQuery::Query {
                view: QueryView::AssetLookup,
                ..
            })
        ) {
            HomeBoxReadResult::Feature(native_features::asset_lookup(
                &query,
                request,
                decoded,
                retrieved_at,
            )?)
        } else {
            HomeBoxReadResult::Resources(detail::detail_resources(
                &query,
                decoded,
                retrieved_at,
                status,
            )?)
        };
        Self::finish(
            contracts,
            request,
            &query,
            result,
            &decoded.original,
            &decoded.source,
        )
    }

    pub fn from_maintenance<C: StockContractPort>(
        contracts: &C,
        request: &st::ValidatedRequest,
        captured_scope: &SourceScope,
        decoded: &wire::Decoded<wire::MaintenanceLog>,
        retrieved_at: &Timestamp,
        status: SourceStatus,
    ) -> st::StockResult<Self> {
        let query = scoped(request, captured_scope)?;
        let result = HomeBoxReadResult::Resources(detail::maintenance_resources(
            &query,
            decoded,
            retrieved_at,
            status,
        )?);
        Self::finish(
            contracts,
            request,
            &query,
            result,
            &decoded.original,
            &decoded.source,
        )
    }

    /// Decode already captured native bytes using the existing bounded,
    /// duplicate-key-aware parser. No source request or cursor is constructed.
    #[allow(clippy::too_many_arguments)]
    pub fn from_native<C: StockContractPort>(
        contracts: &C,
        request: &st::ValidatedRequest,
        captured_scope: &SourceScope,
        original: &[u8],
        retrieved_at: &Timestamp,
        status: SourceStatus,
        limits: wire::DecodeLimits,
    ) -> st::StockResult<Self> {
        let query = scoped(request, captured_scope)?;
        let source = wire::parse_observation(original, limits)
            .map_err(|_| st::StockError::InvalidContract)?;
        let result = match query.selection() {
            ReadSelection::Resources { .. } => HomeBoxReadResult::Resources(
                native_resources::native_resources(&query, &source, retrieved_at, status)?,
            ),
            ReadSelection::Feature(FeatureQuery::Query { .. }) => HomeBoxReadResult::Feature(
                native_features::native_feature(&query, request, &source, retrieved_at)?,
            ),
            _ => return Err(st::StockError::OwnerUnavailable),
        };
        Self::finish(contracts, request, &query, result, original, &source)
    }

    fn finish<C: StockContractPort>(
        contracts: &C,
        request: &st::ValidatedRequest,
        query: &HomeBoxReadQuery,
        result: HomeBoxReadResult,
        original: &[u8],
        source: &Value,
    ) -> st::StockResult<Self> {
        let envelope = adapter::envelope(request, query, result.clone())?;
        contracts.validate(request.operation().output_schema, &envelope)?;
        let references = references(query, &result)?;
        let ordered_path = if request.id() == st::OperationId::HomeboxEntityPath {
            let HomeBoxReadResult::Resources(page) = &result else {
                return Err(st::StockError::InvalidContract);
            };
            Some(
                page.resources
                    .iter()
                    .map(|row| row.target.clone())
                    .collect(),
            )
        } else {
            None
        };
        let mut parent_relations = Vec::new();
        if let HomeBoxReadResult::Resources(page) = &result {
            for row in &page.resources {
                if let Some(parent) = row.data["parentId"].as_str() {
                    let StockTarget::Homebox {
                        resource_kind,
                        source_instance_id,
                        collection_id,
                        ..
                    } = &row.target
                    else {
                        return Err(st::StockError::InvalidContract);
                    };
                    parent_relations.push((
                        row.target.clone(),
                        StockTarget::Homebox {
                            source_instance_id: source_instance_id.clone(),
                            collection_id: collection_id.clone(),
                            resource_kind: resource_kind.clone(),
                            entity_id: None,
                            resource_id: Some(parent.into()),
                        },
                    ));
                }
            }
        }
        Ok(Self {
            request: request.raw().clone(),
            decoded: wire::Decoded {
                value: result,
                original: original.to_vec(),
                source: source.clone(),
            },
            references,
            ordered_path,
            parent_relations,
        })
    }

    /// Exact row/reference selectors for the actual owner graph resolver.
    /// These selectors carry no permission and do not prove completeness or
    /// ancestry. Inspect the original native relationships on the source owner.
    pub fn references(&self) -> &[StockTarget] {
        &self.references
    }
    pub fn original_request(&self) -> &Value {
        &self.request
    }
    /// Original native path order, with the requested resource once at the end.
    /// Order alone proves no ancestor relation: the actual graph owner must
    /// independently qualify route semantics and every disclosed ancestor.
    pub fn ordered_path(&self) -> Option<&[StockTarget]> {
        self.ordered_path.as_deref()
    }
    /// Direct source relations, including actual nested tree child edges.
    /// These are source parents, never physical placement or authorization.
    pub fn parent_relations(&self) -> &[(StockTarget, StockTarget)] {
        &self.parent_relations
    }
}

fn scoped(
    request: &st::ValidatedRequest,
    captured_scope: &SourceScope,
) -> st::StockResult<HomeBoxReadQuery> {
    let query = HomeBoxReadQuery::from_request(request)?;
    if query.scope() != captured_scope {
        return Err(st::StockError::CorrelationMismatch);
    }
    Ok(query)
}

fn references(
    query: &HomeBoxReadQuery,
    result: &HomeBoxReadResult,
) -> st::StockResult<Vec<StockTarget>> {
    let mut targets = Vec::new();
    let mut add =
        |kind: HomeboxResourceKind, id: &str, owner: Option<&str>| -> st::StockResult<()> {
            super::super::Uuid::parse(id).map_err(|_| st::StockError::InvalidContract)?;
            let target = StockTarget::Homebox {
                source_instance_id: query.scope().source_instance_id.as_str().into(),
                collection_id: query.scope().collection_id.clone(),
                resource_kind: kind,
                entity_id: owner.map(str::to_owned),
                resource_id: Some(id.into()),
            };
            if !targets.contains(&target) {
                targets.push(target);
            }
            Ok(())
        };
    let mut views = Vec::new();
    match result {
        HomeBoxReadResult::Resources(page) => {
            views.extend(page.resources.iter().map(|r| (r.target.clone(), &r.data)))
        }
        HomeBoxReadResult::Feature(FeatureRead {
            data: FeatureData::Query(data),
            ..
        }) => {
            if let Some(rows) = data["rows"].as_array()
                && matches!(
                    data["kind"].as_str(),
                    Some("statistics-tags" | "statistics-locations")
                )
            {
                let kind = if data["kind"] == "statistics-tags" {
                    HomeboxResourceKind::Tag
                } else {
                    HomeboxResourceKind::Entity
                };
                for row in rows {
                    add(
                        kind.clone(),
                        row["id"].as_str().ok_or(st::StockError::InvalidContract)?,
                        None,
                    )?;
                }
            }
            if data["kind"] == "asset-lookup"
                && let Some(rows) = data["rows"].as_array()
            {
                for row in rows {
                    views.push((
                        serde_json::from_value(row["target"].clone())
                            .map_err(|_| st::StockError::InvalidContract)?,
                        &row["data"],
                    ));
                }
            }
        }
        _ => return Err(st::StockError::OwnerUnavailable),
    }
    for (target, data) in views {
        if let StockTarget::Homebox {
            resource_kind,
            resource_id: Some(id),
            entity_id,
            ..
        } = &target
        {
            add(resource_kind.clone(), id, entity_id.as_deref())?;
            if let Some(owner) = entity_id {
                add(HomeboxResourceKind::Entity, owner, None)?;
            }
            if let Some(parent) = data["parentId"].as_str() {
                let kind = if *resource_kind == HomeboxResourceKind::Tag {
                    HomeboxResourceKind::Tag
                } else {
                    HomeboxResourceKind::Entity
                };
                add(kind, parent, None)?;
            }
            if let Some(kind) = data["entityType"]["id"].as_str() {
                add(HomeboxResourceKind::EntityType, kind, None)?;
            }
            if let Some(template) = data["defaultTemplateId"].as_str() {
                add(HomeboxResourceKind::Template, template, None)?;
            }
            if let Some(location) = data["defaultLocation"]["resourceId"].as_str() {
                add(HomeboxResourceKind::Entity, location, None)?;
            }
            if let Some(tags) = data["defaultTags"].as_array() {
                for tag in tags {
                    add(
                        HomeboxResourceKind::Tag,
                        tag["resourceId"]
                            .as_str()
                            .ok_or(st::StockError::InvalidContract)?,
                        None,
                    )?;
                }
            }
            for (key, kind, owner) in [
                ("tagIds", HomeboxResourceKind::Tag, None),
                (
                    "attachmentIds",
                    HomeboxResourceKind::Attachment,
                    Some(id.as_str()),
                ),
                (
                    "maintenanceIds",
                    HomeboxResourceKind::Maintenance,
                    Some(id.as_str()),
                ),
            ] {
                if let Some(ids) = data[key].as_array() {
                    for id in ids {
                        add(
                            kind.clone(),
                            id.as_str().ok_or(st::StockError::InvalidContract)?,
                            owner,
                        )?;
                    }
                }
            }
        }
    }
    Ok(targets)
}

/// Borrows the exact original principal and PreparedRequest (including its
/// witness and graph). A clone/new preparation cannot substitute that binding.
/// Keep HomeBoxQueries and dispatch_prepared for full output disclosure checks.
pub struct DecodedReadOwner<'a, P, W, G> {
    principal: &'a P,
    prepared: &'a st::PreparedRequest<W, G>,
    observation: DecodedReadObservation,
}
impl<'a, P, W, G> DecodedReadOwner<'a, P, W, G> {
    pub fn bind(
        principal: &'a P,
        prepared: &'a st::PreparedRequest<W, G>,
        observation: DecodedReadObservation,
    ) -> st::StockResult<Self> {
        if prepared.request().raw() != observation.original_request() {
            return Err(st::StockError::CorrelationMismatch);
        }
        Ok(Self {
            principal,
            prepared,
            observation,
        })
    }
}
impl<P, W, G> HomeBoxReadOwner<P, W, G> for DecodedReadOwner<'_, P, W, G> {
    fn read(
        &mut self,
        principal: &P,
        prepared: &st::PreparedRequest<W, G>,
        query: &HomeBoxReadQuery,
    ) -> st::StockResult<HomeBoxReadResult> {
        if !std::ptr::eq(principal, self.principal)
            || !std::ptr::eq(prepared, self.prepared)
            || *query != HomeBoxReadQuery::from_request(prepared.request())?
        {
            return Err(st::StockError::AuthorityChanged);
        }
        Ok(self.observation.decoded.value.clone())
    }
}
