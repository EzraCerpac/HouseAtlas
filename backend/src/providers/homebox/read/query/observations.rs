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
use std::collections::BTreeMap;

/// Already captured native template GET facts. Validated request shape is not
/// access or endpoint qualification; those remain the actual source owner's job.
pub struct TemplateDetailCapture<'a> {
    pub request: &'a st::ValidatedRequest,
    pub scope: &'a SourceScope,
    pub original: &'a [u8],
    pub retrieved_at: &'a Timestamp,
    pub status: SourceStatus,
}

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
    template_details: Vec<DecodedReadObservation>,
    template_list_retrieved_at: Option<Timestamp>,
}

type NativeListProjection = (
    ResourcePage,
    Vec<StockTarget>,
    Vec<(StockTarget, StockTarget)>,
);

impl DecodedReadObservation {
    /// Join a complete bounded native summary list with its actual captured
    /// per-ID details. No details are fetched, synthesized or borrowed from an
    /// unrelated list. Matching revision strings is correlation, not an atomic
    /// snapshot or freshness guarantee; the original graph owner still decides
    /// access, complete output disclosure and source qualification.
    #[allow(clippy::too_many_arguments)]
    pub fn from_template_list<C: StockContractPort>(
        contracts: &C,
        request: &st::ValidatedRequest,
        captured_scope: &SourceScope,
        original: &[u8],
        retrieved_at: &Timestamp,
        status: SourceStatus,
        details: &[TemplateDetailCapture<'_>],
        limits: wire::DecodeLimits,
    ) -> st::StockResult<Self> {
        let query = scoped(request, captured_scope)?;
        let ReadSelection::Resources {
            operation: st::OperationId::HomeboxTemplateList,
            page: Some(page),
        } = query.selection()
        else {
            return Err(st::StockError::OwnerUnavailable);
        };
        if page.cursor.is_some()
            || page.q.is_some()
            || !page.include_archived
            || details.len() > 100
        {
            return Err(st::StockError::OwnerUnavailable);
        }
        // The byte budget applies to the entire retained capture, in addition
        // to the existing per-document parser/depth/entry/text limits.
        let total_bytes = details.iter().try_fold(original.len(), |total, detail| {
            total.checked_add(detail.original.len())
        });
        if total_bytes.is_none_or(|total| total > limits.max_response_bytes) {
            return Err(st::StockError::OwnerUnavailable);
        }
        let source = wire::parse_observation(original, limits)
            .map_err(|_| st::StockError::InvalidContract)?;
        let summaries = source.as_array().ok_or(st::StockError::InvalidContract)?;
        if summaries.len() != details.len()
            || summaries.len() > page.page_size as usize
            || summaries.len() > 100
        {
            return Err(st::StockError::OwnerUnavailable);
        }
        let mut by_id = BTreeMap::new();
        for detail in details {
            let detail_query = scoped(detail.request, detail.scope)?;
            if detail.request.id() != st::OperationId::HomeboxTemplateGet
                || detail_query.scope() != query.scope()
                || detail.status != status
            {
                return Err(st::StockError::CorrelationMismatch);
            }
            let id = detail.request.target()["resourceId"]
                .as_str()
                .ok_or(st::StockError::InvalidContract)?;
            if by_id.insert(id, detail).is_some() {
                return Err(st::StockError::InvalidContract);
            }
        }
        let mut resources = Vec::with_capacity(summaries.len());
        let mut retained = Vec::with_capacity(summaries.len());
        for summary in summaries {
            let id = summary["id"]
                .as_str()
                .ok_or(st::StockError::InvalidContract)?;
            let detail = by_id.remove(id).ok_or(st::StockError::OwnerUnavailable)?;
            let observation = Self::from_native(
                contracts,
                detail.request,
                detail.scope,
                detail.original,
                detail.retrieved_at,
                detail.status,
                limits,
            )?;
            // These are the actual five EntityTemplateSummary properties in
            // the pinned native schema, also present in EntityTemplateOut.
            for key in ["id", "name", "description", "createdAt", "updatedAt"] {
                let value = summary
                    .get(key)
                    .and_then(Value::as_str)
                    .ok_or(st::StockError::OwnerUnavailable)?;
                if observation.decoded.source.get(key).and_then(Value::as_str) != Some(value) {
                    return Err(st::StockError::CorrelationMismatch);
                }
                if matches!(key, "createdAt" | "updatedAt") {
                    Timestamp::parse(value).map_err(|_| st::StockError::InvalidContract)?;
                }
            }
            let HomeBoxReadResult::Resources(detail_page) = &observation.decoded.value else {
                return Err(st::StockError::InvalidContract);
            };
            if detail_page.resources.len() != 1 {
                return Err(st::StockError::InvalidContract);
            }
            resources.push(detail_page.resources[0].clone());
            retained.push(observation);
        }
        if !by_id.is_empty() {
            return Err(st::StockError::CorrelationMismatch);
        }
        let result = HomeBoxReadResult::Resources(ResourcePage {
            scope: query.scope().clone(),
            resources,
            next_cursor: None,
            source_status: status,
        });
        let mut observation = Self::finish(contracts, request, &query, result, original, &source)?;
        // Retain every original detail byte document/request/status/retrieval;
        // the list's original bytes and source are separately retained above.
        observation.template_details = retained;
        observation.template_list_retrieved_at = Some(retrieved_at.clone());
        Ok(observation)
    }

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

    /// Complete projection is private to the actual native Source intake. It
    /// neither accepts a cursor as authority nor publishes an over-sized page.
    pub(in crate::providers::homebox::read) fn complete_native_list<C: StockContractPort>(
        contracts: &C,
        request: &st::ValidatedRequest,
        capture: &super::super::native_query::RetainedCapture,
    ) -> st::StockResult<NativeListProjection> {
        use super::super::native_query::RetainedCapture;
        let query = HomeBoxReadQuery::from_request(request)?;
        let (page, owner, parent) = match capture {
            RetainedCapture::Detail(c) => (
                detail::complete_fields(&query, c.wire_decoded(), c.retrieved_at())?,
                c.entity_id(),
                c.decoded().entity.parent.as_ref().map(|p| &p.id),
            ),
            RetainedCapture::Maintenance(c) => (
                detail::complete_maintenance(&query, c.wire_decoded(), c.retrieved_at())?,
                c.entity_id(),
                None,
            ),
            RetainedCapture::List(_) => return Err(st::StockError::OwnerUnavailable),
        };
        // Validate every projected member before the first continuation is
        // admitted, using bounded wire-sized batches, without changing input.
        let ReadSelection::Resources {
            page: Some(selection),
            ..
        } = query.selection()
        else {
            return Err(st::StockError::InvalidContract);
        };
        let page_size = usize::try_from(selection.page_size)
            .ok()
            .filter(|n| (1..=100).contains(n))
            .ok_or(st::StockError::InvalidContract)?;
        if page.resources.len().saturating_sub(1) / page_size
            > super::super::native_list_pages::TOKENS
        {
            return Err(st::StockError::OwnerUnavailable);
        }
        for chunk in page.resources.chunks(page_size) {
            let result = HomeBoxReadResult::Resources(ResourcePage {
                scope: page.scope.clone(),
                resources: chunk.to_vec(),
                next_cursor: None,
                source_status: SourceStatus::Unresolved,
            });
            let envelope = adapter::envelope(request, &query, result)?;
            contracts.validate(request.operation().output_schema, &envelope)?;
        }
        let entity = |id: &str| StockTarget::Homebox {
            source_instance_id: query.scope().source_instance_id.as_str().into(),
            collection_id: query.scope().collection_id.clone(),
            resource_kind: HomeboxResourceKind::Entity,
            entity_id: None,
            resource_id: Some(id.into()),
        };
        let owner = entity(owner.as_str());
        let mut refs = vec![owner.clone()];
        refs.extend(page.resources.iter().map(|r| r.target.clone()));
        let mut parents = Vec::new();
        if let Some(parent) = parent {
            let parent = entity(parent.as_str());
            if !refs.contains(&parent) {
                refs.push(parent.clone());
            }
            parents.push((owner, parent));
        }
        Ok((page, refs, parents))
    }

    /// Only the sealed configured producer can supply this retained snapshot.
    /// The exact current request is independently validated/bound to its owner.
    pub(in crate::providers::homebox::read) fn from_native_list_page<C: StockContractPort>(
        contracts: &C,
        request: &st::ValidatedRequest,
        snapshot: &super::super::native_list_pages::NativeListSnapshot,
        page: ResourcePage,
    ) -> st::StockResult<Self> {
        let query = scoped(request, snapshot.scope())?;
        Self::finish(
            contracts,
            request,
            &query,
            HomeBoxReadResult::Resources(page),
            snapshot.original_bytes(),
            snapshot.source_json(),
        )
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
            template_details: Vec::new(),
            template_list_retrieved_at: None,
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
    /// Original native capture bytes, including unknown source properties.
    pub fn original_bytes(&self) -> &[u8] {
        &self.decoded.original
    }
    /// Complete original detail captures, in native summary order. Their own
    /// requests and bytes are retained; they supply no independent authority.
    pub fn captured_template_details(&self) -> &[DecodedReadObservation] {
        &self.template_details
    }
    /// Original summary-list retrieval time, distinct from each detail's time.
    pub fn template_list_retrieved_at(&self) -> Option<&Timestamp> {
        self.template_list_retrieved_at.as_ref()
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
