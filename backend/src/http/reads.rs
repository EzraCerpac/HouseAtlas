//! Canonical frozen record/history/page reads over the actual storage peer.
use super::{
    CheckedHeaders, Host, HttpResult, authorized_read, domain_error, failure, json_response,
};
use crate::storage::Contract;
use crate::{
    access as a,
    app::{
        Core, HomeAuthority, NetworkSnapshotAuthority, ReadAuthority, Reads, RequestPrincipal,
        VerifiedNetworkSnapshotLink,
    },
    domain as d,
    http::contracts::NativeContracts,
    providers::network as n,
    storage as s,
};
use axum::{
    extract::{Extension, Path, State},
    http::{Method, StatusCode, Uri},
};
use serde_json::{Value, json};
use std::sync::Arc;

fn network_snapshot(
    core: &mut Core,
    host: &Host,
    p: &RequestPrincipal,
    scope: &s::Scope,
) -> Result<s::Snapshot, super::HttpFailure> {
    source_snapshot(core, host, p, scope, false)
}

/// Capture the genuine current read graph. The caller seals the original
/// request after qualifying the bounded retained facts during preparation.
/// Each event page seals its own current request; its cursor only correlates
/// the prior allocation and fixed query. Exact-intent reads keep their request.
pub(super) fn retained_read_snapshot(
    core: &mut Core,
    host: &Host,
    p: &RequestPrincipal,
    scope: &s::Scope,
) -> Result<s::Snapshot, super::HttpFailure> {
    source_snapshot(core, host, p, scope, true)
}

fn source_snapshot(
    core: &mut Core,
    host: &Host,
    p: &RequestPrincipal,
    scope: &s::Scope,
    capture_graph: bool,
) -> Result<s::Snapshot, super::HttpFailure> {
    let mut retained = Vec::new();
    let mut links = Vec::new();
    for binding in host.network_bindings.iter().filter(|binding| {
        let partition = binding.runtime().settings().configured_source().partition();
        partition.workspace_id.as_str() == scope.workspace_id
            && partition.home_id.as_str() == scope.home_id
    }) {
        if !Arc::ptr_eq(binding.access().shared().as_existing(), &core.access) {
            return Err(failure(StatusCode::SERVICE_UNAVAILABLE));
        }
        let source = binding.runtime().settings().configured_source();
        let access = core
            .access
            .try_lock()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        match p.capture_partition(&access, &source.partition()) {
            Ok(()) => {}
            Err(a::AccessError::NotFound | a::AccessError::Forbidden) => continue,
            Err(error) => return Err(super::access_error(error)),
        }
        let partition = p
            .captured_partition(&source.partition())
            .map_err(super::access_error)?;
        drop(access);
        let before = match binding.runtime().snapshot_link_bindings(
            &mut *core
                .store
                .lock()
                .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?,
            binding.access(),
            p.principal.principal(),
            &partition,
            &[],
        ) {
            Ok(before) => before,
            Err(n::NetworkPublicationError::Network(error))
                if matches!(
                    error.code,
                    n::ErrorCode::WrongScope | n::ErrorCode::InvalidSchema
                ) =>
            {
                continue;
            }
            Err(_) => return Err(failure(StatusCode::SERVICE_UNAVAILABLE)),
        };
        let access = core
            .access
            .try_lock()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        for (relation, reference) in &before.links {
            match p.capture_network_link(&access, reference) {
                Ok(()) => links.push(VerifiedNetworkSnapshotLink {
                    relation: relation.clone(),
                    reference: reference.clone(),
                }),
                Err(a::AccessError::NotFound | a::AccessError::Forbidden) => {}
                Err(error) => return Err(super::access_error(error)),
            }
        }
        drop(access);
        let entities = p.captured_network_members(partition.partition());
        retained.push((binding, partition, entities, before));
    }
    let base = ReadAuthority(core.access.clone());
    for (_, partition, entities, _) in &retained {
        let mut access = core
            .access
            .try_lock()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        p.revalidate_network_snapshot(&mut access, partition, entities)
            .map_err(super::access_error)?;
    }
    let mut store = core
        .store
        .lock()
        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
    if !Arc::ptr_eq(&base.0, &store.configured_authorization().0) {
        return Err(failure(StatusCode::SERVICE_UNAVAILABLE));
    }
    let snapshot = store
        .read_snapshot_with_authorization(
            &NetworkSnapshotAuthority {
                base: &base,
                links: &links,
            },
            p,
            scope,
        )
        .map_err(|error| domain_error(crate::app::storage_error(error)))?;
    for (binding, partition, entities, before) in retained {
        let after = binding
            .runtime()
            .snapshot_link_bindings(
                &mut store,
                binding.access(),
                p.principal.principal(),
                &partition,
                &entities,
            )
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        if after.baseline != before.baseline || after.links != before.links {
            return Err(failure(StatusCode::SERVICE_UNAVAILABLE));
        }
        let mut access = core
            .access
            .try_lock()
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        p.revalidate_network_snapshot(&mut access, &partition, &entities)
            .map_err(super::access_error)?;
    }
    if capture_graph {
        s::Contract::validate_snapshot(&NativeContracts, &snapshot)
            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
        super::stock_reads::capture_graph(&core.access, p, &snapshot)
            .map_err(super::stock_reads::http_error)?;
    }
    if !capture_graph {
        p.seal_source_capture();
    }
    Ok(snapshot)
}

type ScopedRecord = (String, String, String, String);
fn no_query(uri: &Uri) -> Result<(), super::HttpFailure> {
    if uri.query().is_some() {
        return Err(failure(StatusCode::FORBIDDEN));
    }
    Ok(())
}
fn target(kind: String, id: String) -> Result<d::RecordRef, super::HttpFailure> {
    let raw = json!({"recordType":kind,"recordId":id});
    NativeContracts
        .validate_shape("recordRef", &raw)
        .map_err(|_| failure(StatusCode::UNPROCESSABLE_ENTITY))?;
    serde_json::from_value(raw).map_err(|_| failure(StatusCode::UNPROCESSABLE_ENTITY))
}
pub(super) async fn record(
    State(host): State<Host>,
    Path((workspace_id, home_id, kind, id)): Path<ScopedRecord>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    no_query(&uri)?;
    tokio::task::spawn_blocking(move || {
        let _admitted = headers.admission_permit()?;
        authorized_read(
            &host,
            &headers,
            &uri,
            &method,
            Some(d::Scope {
                workspace_id,
                home_id,
            }),
            false,
            |core, p, home| {
                let target = target(kind, id)?;
                let mut store = core
                    .store
                    .lock()
                    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
                let mut query = d::Queries {
                    store: Reads(&mut store),
                    access: HomeAuthority {
                        access: Arc::clone(&core.access),
                        home: home.clone(),
                    },
                };
                let result = query
                    .record(p, &home.scope, &target)
                    .map_err(domain_error)?;
                let value = serde_json::to_value(result)
                    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
                NativeContracts
                    .validate_shape("record", &value)
                    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
                Ok(json_response(value))
            },
        )
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}
pub(super) async fn history(
    State(host): State<Host>,
    Path((workspace_id, home_id, kind, id)): Path<ScopedRecord>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    no_query(&uri)?;
    tokio::task::spawn_blocking(move || {
        let _admitted = headers.admission_permit()?;
        authorized_read(
            &host,
            &headers,
            &uri,
            &method,
            Some(d::Scope {
                workspace_id,
                home_id,
            }),
            false,
            |core, p, home| {
                let target = target(kind, id)?;
                let mut store = core
                    .store
                    .lock()
                    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
                let mut query = d::Queries {
                    store: Reads(&mut store),
                    access: HomeAuthority {
                        access: Arc::clone(&core.access),
                        home: home.clone(),
                    },
                };
                let audits = query
                    .history(p, &home.scope, &target)
                    .map_err(domain_error)?;
                let value = serde_json::to_value(audits)
                    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
                crate::contracts::decode::<crate::contracts::HttpHistory>(
                    &serde_json::to_vec(&value)
                        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?,
                )
                .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
                Ok(json_response(value))
            },
        )
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}
async fn list(
    host: Host,
    headers: CheckedHeaders,
    uri: Uri,
    method: Method,
    workspace_id: String,
    home_id: String,
    collection: &'static str,
) -> HttpResult {
    tokio::task::spawn_blocking(move || {
        let _admitted = headers.admission_permit()?;
        let (mut pages, prepared) = authorized_read(
            &host,
            &headers,
            &uri,
            &method,
            Some(d::Scope {
                workspace_id,
                home_id,
            }),
            false,
            |core, p, home| {
                let scope: s::Scope = serde_json::from_value(
                    serde_json::to_value(&home.scope)
                        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?,
                )
                .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
                let snapshot = if collection == "network/relations" {
                    network_snapshot(core, &host, p, &scope)?
                } else {
                    core.store
                        .lock()
                        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
                        .read_snapshot(p, &scope)
                        .map_err(|error| domain_error(crate::app::storage_error(error)))?
                };
                s::Contract::validate_snapshot(&NativeContracts, &snapshot)
                    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
                let (items, shape): (Vec<Value>, &str) = match collection {
                    "records" => (
                        snapshot
                            .records
                            .iter()
                            .map(serde_json::to_value)
                            .collect::<Result<_, _>>()
                            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?,
                        "record",
                    ),
                    "homebox/entities" => {
                        // Browser DTOs can replace unsafe external URLs with null;
                        // the frozen projection shape cannot. Retain exact safe URLs.
                        for projection in &snapshot.homebox_entities {
                            for attachment in projection["attachments"]
                                .as_array()
                                .ok_or_else(|| failure(StatusCode::SERVICE_UNAVAILABLE))?
                            {
                                if attachment["kind"] == "external-link"
                                    && !attachment["url"]
                                        .as_str()
                                        .is_some_and(|url| d::safe_web_url(url, false))
                                {
                                    return Err(domain_error(d::DomainError::UpstreamIncomplete));
                                }
                            }
                        }
                        (snapshot.homebox_entities, "homeboxProjection")
                    }
                    "network/relations" => (snapshot.network_relations, "networkRelation"),
                    _ => return Err(failure(StatusCode::SERVICE_UNAVAILABLE)),
                };
                for value in &items {
                    NativeContracts
                        .validate_shape(shape, value)
                        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
                }
                for status in &snapshot.caches {
                    NativeContracts
                        .validate_shape("cacheStatus", status)
                        .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
                }
                // Cache statuses do not carry an owner. Join their partitions
                // to exact configured Network registrations present in the
                // authorized Store snapshot, including the persisted owner.
                // This selects cache metadata, not new Source authority.
                let statuses = if collection == "network/relations" {
                    let registrations = host
                        .network_bindings
                        .iter()
                        .map(|binding| {
                            serde_json::to_value(
                                binding
                                    .runtime()
                                    .settings()
                                    .configured_source()
                                    .registration(),
                            )
                            .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))
                        })
                        .collect::<Result<Vec<_>, _>>()?;
                    snapshot
                        .caches
                        .into_iter()
                        .filter(|status| {
                            registrations.iter().any(|registration| {
                                snapshot.sources.contains(registration)
                                    && registration["owner"] == "network"
                                    && status["workspaceId"] == registration["workspaceId"]
                                    && status["homeId"] == registration["homeId"]
                                    && status["sourceInstanceId"]
                                        == registration["sourceInstanceId"]
                                    && status["collectionId"] == registration["collectionId"]
                            })
                        })
                        .collect()
                } else {
                    snapshot.caches
                };
                // Retain the exact exclusive registry guard through the
                // existing authorized_read final principal release. Pending
                // DATA dropping on release failure leaves live tokens intact.
                let mut pages = host
                    .pages
                    .lock()
                    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?;
                let prepared = pages.prepare(
                    &uri,
                    p,
                    headers.cookie.as_deref(),
                    collection,
                    items,
                    statuses,
                )?;
                Ok((pages, prepared))
            },
        )?;
        // Authority has actually released; commit cannot fail or reacquire
        // the registry, and normal response construction follows directly.
        let page = pages.commit(prepared);
        Ok(json_response(page))
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}
pub(super) async fn records(
    State(host): State<Host>,
    Path((workspace_id, home_id)): Path<(String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    list(host, headers, uri, method, workspace_id, home_id, "records").await
}
pub(super) async fn homebox(
    State(host): State<Host>,
    Path((workspace_id, home_id)): Path<(String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    list(
        host,
        headers,
        uri,
        method,
        workspace_id,
        home_id,
        "homebox/entities",
    )
    .await
}
pub(super) async fn network(
    State(host): State<Host>,
    Path((workspace_id, home_id)): Path<(String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    list(
        host,
        headers,
        uri,
        method,
        workspace_id,
        home_id,
        "network/relations",
    )
    .await
}
pub(super) async fn view(
    state: State<Host>,
    path: Path<(String, String)>,
    headers: Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    no_query(&uri)?;
    super::scoped(state, path, headers, uri, method).await
}
