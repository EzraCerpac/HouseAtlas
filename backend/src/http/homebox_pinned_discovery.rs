//! Informational discovery of explicitly selected local HomeBox file sources.
//! This read neither contacts HomeBox nor admits capture, delivery or installation.
use super::{CheckedHeaders, Host, HttpResult, authorized_read, failure, json_response};
use crate::{access as a, config::providers::registry::ProviderRegistry, domain as d};
use axum::{
    extract::{Extension, Path, State},
    http::{Method, StatusCode, Uri},
};
use serde_json::{Value, json};
use std::{collections::BTreeSet, sync::Arc};

fn unavailable() -> super::HttpFailure {
    failure(StatusCode::SERVICE_UNAVAILABLE)
}

pub(super) async fn admission(
    State(host): State<Host>,
    Path((workspace_id, home_id)): Path<(String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
    if uri.query().is_some() {
        return Err(failure(StatusCode::FORBIDDEN));
    }
    tokio::task::spawn_blocking(move || {
        let _admitted = headers.admission_permit()?;
        authorized_read(
            &host,
            &headers,
            &uri,
            &method,
            Some(d::Scope { workspace_id, home_id }),
            false,
            |core, principal, home| {
                if host.pinned_homebox_file_bindings.len() > 64
                    || !Arc::ptr_eq(&core.access, &host.mcp_access)
                {
                    return Err(unavailable());
                }
                // Validate the full original startup selection together, including
                // conflicting partitions across homes. No HTTP selector supplies it.
                let registry = ProviderRegistry::from_trusted_configuration(
                    host.pinned_homebox_file_bindings.iter().map(|binding| {
                        binding.source().registration().clone()
                    }).collect(),
                ).map_err(|_| unavailable())?;
                let mut access = core.access.lock().map_err(|_| unavailable())?;
                let mut candidates = Vec::new();
                for configured in registry.sources() {
                    let partition = configured.partition();
                    if partition.workspace_id.as_str() != home.scope.workspace_id
                        || partition.home_id.as_str() != home.scope.home_id
                    {
                        continue;
                    }
                    match principal.capture_partition(&access, &partition) {
                        Ok(()) => {},
                        Err(a::AccessError::NotFound | a::AccessError::Forbidden) => continue,
                        Err(error) => return Err(super::access_error(error)),
                    }
                    let partition_grant = principal.captured_partition(&partition)
                        .map_err(super::access_error)?;
                    let mut metadata = None;
                    access.with_read_authorization(
                        principal.principal.principal(),
                        |guard| {
                            metadata = Some(guard.persisted_source_metadata(&partition_grant)?);
                            Ok::<(), a::AccessError>(())
                        },
                    ).map_err(super::access_error)?;
                    if metadata.ok_or_else(unavailable)?.registration() != configured.access_registration() {
                        continue;
                    }
                    // Exclusive-home configuration contains no finite entity
                    // inventory. It cannot justify fabricating an entity selector.
                    for external_id in &configured.access_registration().allowed_external_ids {
                        let source = a::SourceRef {
                            workspace_id: partition.workspace_id.clone(),
                            home_id: partition.home_id.clone(),
                            key: a::SourceKey {
                                source_instance_id: partition.source_instance_id.clone(),
                                collection_id: partition.collection_id.clone(),
                                source_kind: a::SourceKind::HomeboxEntity,
                                external_id: external_id.clone(),
                            },
                        };
                        if !configured.contains(&source) {
                            return Err(unavailable());
                        }
                        match principal.capture_source(&access, &source)
                            .and_then(|()| principal.capture_partition(&access, &partition))
                        {
                            Ok(()) => {},
                            Err(a::AccessError::NotFound | a::AccessError::Forbidden) => continue,
                            Err(error) => return Err(super::access_error(error)),
                        }
                        candidates.push((Arc::clone(configured), source));
                        if candidates.len() > 64 {
                            return Err(unavailable());
                        }
                    }
                }
                principal.seal_source_capture();
                let mut response = None;
                access.with_read_authorization(principal.principal.principal(), |guard| {
                    let mut installed = Vec::new();
                    let mut revision_entries = Vec::new();
                    let mut unique = BTreeSet::new();
                    let mut partitions = BTreeSet::new();
                    let mut closure = crate::contracts::semantics::ReferenceClosure {
                        record_refs: Vec::new(),
                        missing_record_refs: Vec::new(),
                        source_refs: Vec::new(),
                        source_partitions: Vec::new(),
                    };
                    for (configured, source) in candidates {
                        let source_grant = principal.captured_source(&source)
                            .map_err(super::access_error)?;
                        let partition = source.partition();
                        let partition_grant = principal.captured_partition(&partition)
                            .map_err(super::access_error)?;
                        guard.revalidate_source(&source_grant).map_err(super::access_error)?;
                        let metadata = guard.persisted_source_metadata(&partition_grant)
                            .map_err(super::access_error)?;
                        if metadata.registration() != configured.access_registration() {
                            continue;
                        }
                        let key = serde_json::to_string(&source).map_err(|_| unavailable())?;
                        if !unique.insert(key.clone()) {
                            return Err(unavailable());
                        }
                        closure.source_refs.push(serde_json::from_value(
                            serde_json::to_value(&source).map_err(|_| unavailable())?,
                        ).map_err(|_| unavailable())?);
                        if partitions.insert(serde_json::to_string(&partition).map_err(|_| unavailable())?) {
                            closure.source_partitions.push(serde_json::from_value(
                                serde_json::to_value(&partition).map_err(|_| unavailable())?,
                            ).map_err(|_| unavailable())?);
                        }
                        revision_entries.push((key.clone(), json!({
                            "source": source,
                            "sourceConfiguration": configured.access_registration(),
                            "metadata": {
                                "accessEpoch": metadata.access_epoch(),
                                "sourceRegistrationVersion": metadata.source_registration_version(),
                                "sourceRegistrationSha256": metadata.source_registration_sha256(),
                                "registration": metadata.registration(),
                            },
                        })));
                        installed.push((key, source));
                    }
                    installed.sort_by(|left, right| left.0.cmp(&right.0));
                    revision_entries.sort_by(|left, right| left.0.cmp(&right.0));
                    let revision = crate::contracts::semantics::canonical_digest(&json!({
                        "schemaVersion": 1,
                        "scope": home.scope,
                        "selections": revision_entries.into_iter().map(|(_, entry)| entry).collect::<Vec<Value>>(),
                    })).map_err(|_| unavailable())?;
                    if revision.is_empty() || revision.len() > 128 || installed.len() > 64 {
                        return Err(unavailable());
                    }
                    let output = json!({
                        "schemaVersion": 1,
                        "scope": home.scope,
                        "revision": revision,
                        "installedSources": installed.into_iter().map(|(_, source)| source).collect::<Vec<_>>(),
                    });
                    if serde_json::to_vec(&output).map_err(|_| unavailable())?.len() > 65_536 {
                        return Err(unavailable());
                    }
                    principal.release_guard(guard, &closure).map_err(super::access_error)?;
                    response = Some(json_response(output));
                    Ok::<(), super::HttpFailure>(())
                })?;
                response.ok_or_else(unavailable)
            },
        )
    })
    .await
    .map_err(|_| unavailable())?
}
