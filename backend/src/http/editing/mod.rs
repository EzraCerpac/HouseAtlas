//! Qualified place admission; writes retain the existing stock authority fence.
use super::{
    CheckedHeaders, Host, HttpFailure, HttpResult, authorized_read, domain_error, failure, intake,
    json_response, query_view,
};
use crate::{access, app::Reads, contracts, domain as d};
use axum::{
    extract::{Extension, Path, State},
    http::{Method, StatusCode, Uri},
};
use serde_json::{Value, json};
use std::collections::BTreeMap;

fn unavailable() -> HttpFailure {
    failure(StatusCode::SERVICE_UNAVAILABLE)
}
fn validate<T: contracts::Contract>(value: &Value) -> Result<T, HttpFailure> {
    contracts::decode(&serde_json::to_vec(value).map_err(|_| unavailable())?)
        .map_err(|_| unavailable())
}
fn active<'a>(
    snapshot: &'a d::Snapshot,
    scope: &d::Scope,
    kind: d::RecordType,
    id: &str,
) -> Option<&'a d::Record> {
    snapshot.records.iter().find(|record| {
        record.scope == *scope
            && record.lifecycle == d::Lifecycle::Active
            && record.target.record_type == kind
            && record.target.record_id == id
    })
}
fn admission(
    core: &mut crate::app::Core,
    p: &crate::app::RequestPrincipal,
    home: &d::HomeSummary,
    source: &d::SourceRef,
) -> Result<Value, HttpFailure> {
    // Resolve through the actual authorized projection. Caller labels and record
    // IDs or trusted registry membership cannot select a physical identity.
    let view = query_view(core, p, home)?;
    let Some(entry) = view
        .entries
        .iter()
        .find(|entry| entry.key == *source && entry.kind == d::EntryKind::Place)
    else {
        return Ok(Value::Null);
    };
    let (Some(identity_id), Some(binding_id)) = (&entry.atlas_id, &entry.binding_id) else {
        return Ok(Value::Null);
    };
    let snapshot = d::ReadPort::snapshot(
        &mut Reads(core.store.get_mut().map_err(|_| unavailable())?),
        p,
        &home.scope,
    )
    .map_err(domain_error)?;
    let Some(binding) = active(&snapshot, &home.scope, d::RecordType::Binding, binding_id) else {
        return Ok(Value::Null);
    };
    let payload: d::BindingPayload =
        serde_json::from_value(binding.payload.clone()).map_err(|_| unavailable())?;
    if payload.review_status != d::ReviewStatus::Accepted
        || payload.atlas_id != *identity_id
        || payload.source != source.key
        || payload.source_state == d::BindingSourceState::AccessRevoked
    {
        return Ok(Value::Null);
    }
    let Some(identity) = active(&snapshot, &home.scope, d::RecordType::Identity, identity_id)
    else {
        return Ok(Value::Null);
    };
    if identity.payload["kind"] != "location" {
        return Ok(Value::Null);
    }
    let mut matching = snapshot.records.iter().filter(|record| {
        record.scope == home.scope
            && record.lifecycle == d::Lifecycle::Active
            && record.target.record_type == d::RecordType::LocationSemantics
            && record.payload["atlasId"].as_str() == Some(identity_id.as_str())
            && record.payload["reviewStatus"] == "accepted"
    });
    let Some(record) = matching.next() else {
        return Ok(Value::Null);
    };
    if matching.next().is_some() {
        return Err(unavailable());
    }
    let value = serde_json::to_value(record).map_err(|_| unavailable())?;
    validate::<contracts::LocationSemanticsRecord>(&value)?;
    // Classification changes no references. Also pin the binding that resolved
    // this exact source so save retains source-to-identity continuity.
    let mut guards = BTreeMap::new();
    for (kind, target) in [("identity", identity), ("binding", binding)] {
        guards.insert(
            (kind, target.target.record_id.clone()),
            json!({"record":target.target,"expectedRevision":target.revision}),
        );
    }
    for target in [record, identity, binding] {
        for id in target.payload["evidenceIds"]
            .as_array()
            .ok_or_else(unavailable)?
        {
            let id = id.as_str().ok_or_else(unavailable)?;
            let evidence = active(&snapshot, &home.scope, d::RecordType::Evidence, id)
                .ok_or_else(unavailable)?;
            guards.insert(
                ("evidence", id.to_owned()),
                json!({"record":evidence.target,"expectedRevision":evidence.revision}),
            );
        }
    }
    let guards: Vec<_> = guards.into_values().collect();
    for guard in &guards {
        validate::<contracts::Guard>(guard)?;
    }
    Ok(
        json!({"record":value,"guards":guards,"canReplaceClassification":p.principal.role() == access::Role::Editor,"maximumReasonCodePoints":1024}),
    )
}
pub(super) async fn place(
    State(host): State<Host>,
    Path((workspace_id, home_id)): Path<(String, String)>,
    Extension(headers): Extension<CheckedHeaders>,
    uri: Uri,
    method: Method,
) -> HttpResult {
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
                let query = uri
                    .query()
                    .ok_or_else(|| failure(StatusCode::UNPROCESSABLE_ENTITY))?;
                if query.len() > 4096 {
                    return Err(failure(StatusCode::PAYLOAD_TOO_LARGE));
                }
                let mut fields = url::form_urlencoded::parse(query.as_bytes());
                let (name, bytes) = fields
                    .next()
                    .ok_or_else(|| failure(StatusCode::UNPROCESSABLE_ENTITY))?;
                if name != "source" || fields.next().is_some() || bytes.len() > 2048 {
                    return Err(failure(StatusCode::UNPROCESSABLE_ENTITY));
                }
                let raw = intake::json(bytes.as_bytes())?;
                validate::<contracts::SourceRef>(&raw)
                    .map_err(|_| failure(StatusCode::UNPROCESSABLE_ENTITY))?;
                let source: d::SourceRef = serde_json::from_value(raw)
                    .map_err(|_| failure(StatusCode::UNPROCESSABLE_ENTITY))?;
                if source.scope != home.scope {
                    return Err(failure(StatusCode::NOT_FOUND));
                }
                Ok(json_response(admission(core, p, home, &source)?))
            },
        )
    })
    .await
    .map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE))?
}
