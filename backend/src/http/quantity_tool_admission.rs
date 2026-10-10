//! Informational source selection for the optional quantity tool. This read
//! issues no native or physical admission and starts no provider operation.
use super::{CheckedHeaders, Host, HttpResult, authorized_read, failure, json_response};
use crate::{access as a, app::RequestPrincipal, domain as d};
use axum::{
    extract::{Extension, Path, State},
    http::{Method, StatusCode, Uri},
};
use serde_json::{Value, json};
use std::collections::BTreeSet;

fn unavailable() -> super::HttpFailure {
    failure(StatusCode::SERVICE_UNAVAILABLE)
}

fn selected_source(
    configured: &crate::config::providers::quantity_installation::OriginalQuantityConfigured,
    scope: &d::Scope,
    principal: &RequestPrincipal,
) -> Result<Option<a::SourceRef>, super::HttpFailure> {
    let descriptor = configured.descriptor();
    if descriptor.scope.workspace_id.to_string() != scope.workspace_id
        || descriptor.scope.home_id.to_string() != scope.home_id
        || descriptor.authority.actor_id.to_string() != principal.principal.actor_id().as_str()
    {
        return Ok(None);
    }
    let partition = configured.source().partition();
    if partition.workspace_id.as_str() != scope.workspace_id
        || partition.home_id.as_str() != scope.home_id
        || descriptor.target.source_instance_id.to_string() != partition.source_instance_id.as_str()
        || descriptor.target.collection_id.to_string() != partition.collection_id
    {
        return Ok(None);
    }
    let source = a::SourceRef {
        workspace_id: partition.workspace_id,
        home_id: partition.home_id,
        key: a::SourceKey {
            source_instance_id: partition.source_instance_id,
            collection_id: partition.collection_id,
            source_kind: a::SourceKind::HomeboxEntity,
            external_id: descriptor
                .target
                .id()
                .map_err(|_| unavailable())?
                .to_string(),
        },
    };
    Ok(configured.source().contains(&source).then_some(source))
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
                let mut installed: Vec<(String, a::SourceRef)> = Vec::new();
                let mut revision_entries = Vec::new();
                let mut unique = BTreeSet::new();
                if host.quantity_installations.len() > 64 {
                    return Err(unavailable());
                }
                if principal.principal.role() == a::Role::Editor {
                    for configured in host.quantity_installations.iter() {
                        if !configured.belongs_to_core(core) {
                            return Err(unavailable());
                        }
                        let Some(source) = selected_source(configured, &home.scope, principal)? else {
                            continue;
                        };
                        let key = serde_json::to_string(&source).map_err(|_| unavailable())?;
                        if !unique.insert(key.clone()) {
                            return Err(unavailable());
                        }
                        let mut access = core.access.lock().map_err(|_| unavailable())?;
                        // Failed current source selection is simply absent from
                        // this informational list. The later preview owns its
                        // independent mutation and physical checks.
                        if principal.capture_source(&access, &source).is_err()
                            || principal.capture_partition(&access, &source.partition()).is_err()
                        {
                            continue;
                        }
                        let source_grant = principal.captured_source(&source).map_err(|_| unavailable())?;
                        let partition_grant = principal
                            .captured_partition(&source.partition())
                            .map_err(|_| unavailable())?;
                        let mut current = false;
                        access.with_read_authorization(principal.principal.principal(), |guard| {
                            guard.revalidate_source(&source_grant)?;
                            let metadata = guard.persisted_source_metadata(&partition_grant)?;
                            current = metadata == *configured.metadata();
                            Ok::<(), a::AccessError>(())
                        }).map_err(super::access_error)?;
                        if !current {
                            continue;
                        }
                        let descriptor = configured.descriptor();
                        let policy = match descriptor.policy {
                            crate::providers::homebox::write::stock::QuantityPolicy::HumanRequired => {
                                json!({"kind":"human-required"})
                            }
                            crate::providers::homebox::write::stock::QuantityPolicy::NoHuman { maximum } => {
                                json!({"kind":"no-human","maximum":maximum})
                            }
                        };
                        // The revision records selected configuration and
                        // verified current metadata, but grants no authority.
                        revision_entries.push((key.clone(), json!({
                            "source":source,
                            "target":descriptor.target,
                            "sourceCommit":descriptor.source_commit,
                            "version":descriptor.version,
                            "buildDigest":descriptor.build_digest.as_str(),
                            "catalogDigest":descriptor.catalog_digest.as_str(),
                            "routeDigest":descriptor.route_digest.as_str(),
                            "groupId":descriptor.group_id,
                            "accountId":descriptor.account_id,
                            "authority":format!("{:?}", descriptor.authority),
                            "dispatcherEpoch":descriptor.dispatcher_epoch,
                            "policyDigest":descriptor.policy_digest.as_str(),
                            "policy":policy,
                            "freshness":format!("{:?}", descriptor.freshness),
                            "reviewedPolicy":configured.reviewed_policy(),
                            "sourceConfiguration":configured.source().access_registration(),
                            "queue":format!("{:?}", configured.queue()),
                            "physical":format!("{:?}", configured.physical()),
                            "metadata":{
                                "accessEpoch":configured.metadata().access_epoch(),
                                "sourceRegistrationVersion":configured.metadata().source_registration_version(),
                                "sourceRegistrationSha256":configured.metadata().source_registration_sha256(),
                                "registration":configured.metadata().registration(),
                            },
                        })));
                        installed.push((key, source));
                    }
                }
                revision_entries.sort_by(|left, right| left.0.cmp(&right.0));
                installed.sort_by(|left, right| left.0.cmp(&right.0));
                let revision = crate::contracts::semantics::canonical_digest(&json!({
                    "schemaVersion":1,
                    "scope":home.scope,
                    "selections":revision_entries.into_iter().map(|(_, value)| value).collect::<Vec<Value>>(),
                })).map_err(|_| unavailable())?;
                if revision.is_empty() || revision.len() > 128 || installed.len() > 64 {
                    return Err(unavailable());
                }
                let output = json!({
                    "schemaVersion":1,
                    "scope":home.scope,
                    "revision":revision,
                    "installedSources":installed.into_iter().map(|(_, source)| source).collect::<Vec<_>>(),
                });
                if serde_json::to_vec(&output).map_err(|_| unavailable())?.len() > 65_536 {
                    return Err(unavailable());
                }
                Ok(json_response(output))
            },
        )
    })
    .await
    .map_err(|_| unavailable())?
}
