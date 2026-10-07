//! Wire correlations plus explicit facts that the owning domain must discharge.
//!
//! A correlated response is not an authorization, provider result qualification,
//! durable receipt, or proof that any provider invocation occurred or ended.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::envelope::{array, string};
use super::{
    OperationId, StockContext, StockError, StockRequest, StockResult, StockTarget, StockValidation,
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ResponseKind {
    Error,
    Read,
    AtlasCommitted,
    ProviderOutcome {
        state: ProviderOutcomeState,
        activity: RemoteActivityState,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProviderOutcomeState {
    Prepared,
    Queued,
    Dispatching,
    ConfirmedObserved,
    RejectedBeforeDispatch,
    Partial,
    UnknownHeld,
    ResolvedObserved,
    ResolvedByHuman,
}

#[derive(Clone, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum RemoteActivityState {
    NotDispatched,
    Active,
    EndUnproven,
    EndedProven,
}

/// Relationship checks do not replace the owner's current output authority,
/// exact impact graph, provider-created identity or verified ancestor facts.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OutputObligationKind {
    CurrentResultAuthority,
    ExactTarget,
    ScopedPage,
    NewProviderIdentity,
    AncestorPath,
    RemapRecord,
    ImpactGraph,
    FeatureResource,
    NetworkSource,
    ArtifactHandle,
}

/// `value` is the original schema-checked output row or fact. Paths are stable
/// JSON pointers relative to this response; batch children retain their own
/// report so the owner can retain ordered per-child disclosure checks.
#[derive(Clone, Debug)]
pub struct OutputObligation {
    pub kind: OutputObligationKind,
    pub path: String,
    pub target: Option<StockTarget>,
    pub value: Value,
}

#[derive(Clone, Debug)]
pub struct StockResponse {
    raw: Value,
    command_id: Option<OperationId>,
    request_id: String,
    kind: ResponseKind,
    children: Vec<Self>,
    obligations: Vec<OutputObligation>,
}

impl StockResponse {
    /// Validate the request's exact output arm and all locally decidable wire
    /// correlations. Batch roots require their ordered durable child envelopes;
    /// non-batch responses require an empty child slice. This does no I/O.
    pub fn parse(
        validator: &StockValidation,
        request: &StockRequest,
        raw: Value,
        children: &[Value],
    ) -> StockResult<Self> {
        validator.validate(&request.operation()?.output_schema, &raw)?;
        require(
            raw["requestId"] == request.request_id(),
            "requestId differs",
        )?;
        let request_id = string(&raw, "requestId")?.to_owned();
        let mut obligations = vec![OutputObligation {
            kind: OutputObligationKind::CurrentResultAuthority,
            path: String::new(),
            target: None,
            value: raw.clone(),
        }];
        let is_error = raw.get("code").is_some() && raw.get("commandId").is_none();
        let mut child_responses = Vec::new();
        let (command_id, kind) = if is_error {
            require(children.is_empty(), "error response has child envelopes")?;
            (None, ResponseKind::Error)
        } else {
            require(
                raw["commandId"] == request.id().as_str(),
                "commandId differs",
            )?;
            let scope: StockContext = serde_json::from_value(raw["resolvedScope"].clone())?;
            require(&scope == request.context(), "resolvedScope differs")?;
            let kind = check_kind(request, &raw)?;
            check_requested_bounds(request, &raw)?;
            check_feature(request, &raw, &kind, &mut obligations)?;
            if request.is_batch() {
                require(
                    children.len() == request.children().len(),
                    "batch child response count differs",
                )?;
                let mut records = Vec::new();
                let mut audits = Vec::new();
                for (child, wire) in request.children().iter().zip(children) {
                    let response = Self::parse(validator, child, wire.clone(), &[])?;
                    require(
                        response.kind == ResponseKind::AtlasCommitted,
                        "batch child is not a committed Atlas response",
                    )?;
                    records.extend(array(&wire["data"], "records")?.iter().cloned());
                    audits.extend(array(&wire["data"], "auditIds")?.iter().cloned());
                    child_responses.push(response);
                }
                require(
                    raw["data"]["records"] == Value::Array(records),
                    "batch records are not ordered child flattening",
                )?;
                require(
                    raw["data"]["auditIds"] == Value::Array(audits),
                    "batch auditIds are not ordered child flattening",
                )?;
            } else {
                require(
                    children.is_empty(),
                    "non-batch response has child envelopes",
                )?;
                collect_output_obligations(request, &raw, &kind, &mut obligations)?;
            }
            (Some(request.id()), kind)
        };
        Ok(Self {
            raw,
            command_id,
            request_id,
            kind,
            children: child_responses,
            obligations,
        })
    }

    pub fn raw(&self) -> &Value {
        &self.raw
    }
    pub fn command_id(&self) -> Option<OperationId> {
        self.command_id
    }
    pub fn request_id(&self) -> &str {
        &self.request_id
    }
    pub fn kind(&self) -> &ResponseKind {
        &self.kind
    }
    pub fn children(&self) -> &[Self] {
        &self.children
    }
    pub fn obligations(&self) -> &[OutputObligation] {
        &self.obligations
    }
}

fn check_kind(request: &StockRequest, wire: &Value) -> StockResult<ResponseKind> {
    let target = request.target_value();
    if wire["status"] == "committed" {
        require(
            target["authority"] == "atlas",
            "committed response is not Atlas-owned",
        )?;
        require(
            wire["data"]["requestDigest"] == request.intent_digest(),
            "Atlas requestDigest differs",
        )?;
        return Ok(ResponseKind::AtlasCommitted);
    }
    if wire.get("state").is_some() {
        require(
            target["authority"] == "homebox" && request.is_provider_mutation(),
            "provider outcome belongs to a read request",
        )?;
        require(
            wire["requestDigest"] == request.intent_digest(),
            "provider requestDigest differs",
        )?;
        let state: ProviderOutcomeState = serde_json::from_value(wire["state"].clone())?;
        let activity: RemoteActivityState =
            serde_json::from_value(wire["remoteActivity"]["state"].clone())?;
        if activity == RemoteActivityState::NotDispatched {
            require(
                matches!(
                    state,
                    ProviderOutcomeState::Prepared
                        | ProviderOutcomeState::Queued
                        | ProviderOutcomeState::RejectedBeforeDispatch
                ),
                "not-dispatched activity has an invoked outcome state",
            )?;
            require(
                array(wire, "knownEffects")?.is_empty() && wire["responseSuccess"] == false,
                "never-invoked outcome claims effects or success",
            )?;
        } else {
            require(
                !matches!(
                    state,
                    ProviderOutcomeState::Prepared
                        | ProviderOutcomeState::Queued
                        | ProviderOutcomeState::RejectedBeforeDispatch
                ),
                "never-invoked state has dispatched activity",
            )?;
        }
        check_clock(&wire["observedAt"])?;
        return Ok(ResponseKind::ProviderOutcome { state, activity });
    }
    require(wire["status"] == "read", "unknown result kind")?;
    if let Some(value) = wire.get("retrievedAt") {
        check_clock(value)?;
    }
    Ok(ResponseKind::Read)
}

fn check_feature(
    request: &StockRequest,
    wire: &Value,
    kind: &ResponseKind,
    obligations: &mut Vec<OutputObligation>,
) -> StockResult<()> {
    let id = request.id().as_str();
    let is_feature = matches!(
        id,
        "homebox.export.create"
            | "homebox.query.read"
            | "homebox.label.output"
            | "homebox.qrcode.render"
    );
    if !is_feature || *kind != ResponseKind::Read {
        return Ok(());
    }
    require(
        !(id == "homebox.label.output" && request.payload()["delivery"] == "print"),
        "print request has a rendering response",
    )?;
    require(
        wire["sourceInstanceId"] == request.target_value()["sourceInstanceId"],
        "feature sourceInstanceId differs",
    )?;
    require(
        wire["collectionId"] == request.target_value()["collectionId"],
        "feature collectionId differs",
    )?;
    let expected = match id {
        "homebox.label.output" => "label-image",
        "homebox.qrcode.render" => "qrcode-image",
        "homebox.query.read" => string(request.payload(), "view")?,
        "homebox.export.create" => string(request.payload(), "format")?,
        _ => return Err(StockError::correlation("unknown feature command")),
    };
    require(
        wire["data"]["kind"] == expected,
        "feature data kind differs",
    )?;
    if let Some(artifact) = wire["data"].get("artifact") {
        if let Some(maximum) = request.payload().get("maxBytes") {
            require(
                nonnegative_integer(&artifact["byteSize"])? <= nonnegative_integer(maximum)?,
                "artifact exceeds selected maxBytes",
            )?;
        }
        check_clock(&artifact["expiresAt"])?;
        obligations.push(OutputObligation {
            kind: OutputObligationKind::ArtifactHandle,
            path: "/data/artifact".to_owned(),
            target: None,
            value: artifact.clone(),
        });
    }
    Ok(())
}

fn check_requested_bounds(request: &StockRequest, wire: &Value) -> StockResult<()> {
    let data = &wire["data"];
    if let Some(bound) = request.payload().get("pageSize") {
        let field = if data.get("records").is_some() {
            "records"
        } else if data.get("resources").is_some() {
            "resources"
        } else if data.get("entries").is_some() {
            "entries"
        } else {
            return Err(StockError::correlation(
                "page response lacks its selected array",
            ));
        };
        require(
            array(data, field)?.len() as u64 <= nonnegative_integer(bound)?,
            "page exceeds selected pageSize",
        )?;
    }
    if request.id().as_str() == "homebox.query.read" {
        let field = match request.payload()["view"].as_str() {
            Some(
                "asset-lookup"
                | "statistics-locations"
                | "statistics-tags"
                | "maintenance"
                | "barcode-product",
            ) => Some("rows"),
            Some("statistics-purchase-price") => Some("entries"),
            Some("currency" | "statistics") => None,
            _ => return Err(StockError::correlation("unknown feature view")),
        };
        if let Some(field) = field {
            require(
                array(data, field)?.len() as u64
                    <= nonnegative_integer(&request.payload()["limit"])?,
                "feature array exceeds selected limit",
            )?;
        }
    }
    Ok(())
}

fn collect_output_obligations(
    request: &StockRequest,
    wire: &Value,
    kind: &ResponseKind,
    obligations: &mut Vec<OutputObligation>,
) -> StockResult<()> {
    let data = &wire["data"];
    if let Some(target) = data.get("target") {
        output_target(request, target, data, "/data", obligations)?;
    }
    for field in ["records", "resources", "rows", "entries"] {
        if let Some(rows) = data.get(field).and_then(Value::as_array) {
            for (index, row) in rows.iter().enumerate() {
                let path = format!("/data/{field}/{index}");
                if let Some(target) = row.get("target") {
                    output_target(request, target, row, &path, obligations)?;
                } else if field == "rows"
                    && matches!(
                        data["kind"].as_str(),
                        Some("statistics-locations" | "statistics-tags")
                    )
                {
                    let target = json!({"authority":"homebox", "sourceInstanceId":request.target_value()["sourceInstanceId"],
                        "collectionId":request.target_value()["collectionId"], "resourceKind":if data["kind"] == "statistics-tags" { "tag" } else { "entity" }, "resourceId":row["id"]});
                    output_target(request, &target, row, &path, obligations)?;
                }
                if let Some(value) = row.get("retrievedAt") {
                    check_clock(value)?;
                }
            }
        }
    }
    if *kind == ResponseKind::AtlasCommitted {
        let records = array(data, "records")?;
        let expected = atlas_mutation_targets(request)?;
        require(
            records.len() == expected.len(),
            "Atlas receipt record count differs",
        )?;
        require(
            expected.iter().all(|target| {
                records
                    .iter()
                    .filter(|row| row["target"] == *target)
                    .count()
                    == 1
            }),
            "Atlas receipt identities differ",
        )?;
        require(
            array(data, "auditIds")?.len() == records.len(),
            "Atlas audit count differs",
        )?;
    }
    if let Some(effects) = wire.get("knownEffects").and_then(Value::as_array) {
        for (index, effect) in effects.iter().enumerate() {
            let target = &effect["target"];
            require(
                request.target_value()["authority"] == "homebox" && request.is_provider_mutation(),
                "effects belong to non-provider request",
            )?;
            same_provider_partition(request, target)?;
            obligations.push(OutputObligation {
                kind: OutputObligationKind::ImpactGraph,
                path: format!("/knownEffects/{index}"),
                target: Some(serde_json::from_value(target.clone())?),
                value: effect.clone(),
            });
        }
    }
    if request.target_value()["authority"] == "network" {
        collect_network(request, data, obligations)?;
    }
    Ok(())
}

fn output_target(
    request: &StockRequest,
    target: &Value,
    row: &Value,
    path: &str,
    obligations: &mut Vec<OutputObligation>,
) -> StockResult<()> {
    let selected = request.target_value();
    let id = request.id().as_str();
    require(
        target["authority"] == selected["authority"],
        "output authority differs",
    )?;
    let remap = id == "atlas.binding.remap";
    let mut expected_kind = request.operation()?.result_resource_kind.as_deref();
    if id == "homebox.query.read" {
        expected_kind = Some(match request.payload()["view"].as_str() {
            Some("maintenance") => "maintenance",
            Some("statistics-tags") => "tag",
            _ => "entity",
        });
    } else if id == "homebox.label.output" {
        expected_kind = Some("entity");
    }
    if remap {
        require(
            atlas_mutation_targets(request)?
                .iter()
                .any(|candidate| candidate == target),
            "remap output is not an exact affected record",
        )?;
    } else if selected["resourceKind"] != "collection" || !request.is_provider_mutation() {
        let field = if selected["authority"] == "atlas" {
            "recordType"
        } else {
            "resourceKind"
        };
        let expected = expected_kind
            .ok_or_else(|| StockError::correlation("catalog has no output resource kind"))?;
        require(target[field] == expected, "output resource kind differs")?;
    }
    if selected["authority"] == "homebox" {
        same_provider_partition(request, target)?;
        if let Some(owner) = selected.get("entityId") {
            require(
                target.get("entityId") == Some(owner),
                "output entity owner differs",
            )?;
        }
    }
    let purpose = if remap {
        OutputObligationKind::RemapRecord
    } else if selected == target {
        OutputObligationKind::ExactTarget
    } else if new_provider_identity(request) {
        OutputObligationKind::NewProviderIdentity
    } else if id == "homebox.entity.path" {
        OutputObligationKind::AncestorPath
    } else if selected["resourceKind"] == "collection" {
        if request.is_provider_mutation() {
            OutputObligationKind::ImpactGraph
        } else {
            OutputObligationKind::FeatureResource
        }
    } else if selected.get("recordId").is_none() && selected.get("resourceId").is_none() {
        OutputObligationKind::ScopedPage
    } else {
        return Err(StockError::correlation(
            "output existing identity differs from selected target",
        ));
    };
    obligations.push(OutputObligation {
        kind: purpose,
        path: path.to_owned(),
        target: Some(serde_json::from_value(target.clone())?),
        value: row.clone(),
    });
    Ok(())
}

fn same_provider_partition(request: &StockRequest, target: &Value) -> StockResult<()> {
    let selected = request.target_value();
    require(
        target["authority"] == "homebox"
            && target["sourceInstanceId"] == selected["sourceInstanceId"]
            && target["collectionId"] == selected["collectionId"],
        "output source partition differs",
    )?;
    // Effects can name other approved owners. The captured impact graph still
    // needs real owner facts; ordinary resources check entityId separately.
    Ok(())
}

fn new_provider_identity(request: &StockRequest) -> bool {
    matches!(
        request.id().as_str(),
        "homebox.entity.create"
            | "homebox.location.create"
            | "homebox.entity.duplicate"
            | "homebox.location.duplicate"
            | "homebox.tag.create"
            | "homebox.field.create"
            | "homebox.file.upload"
            | "homebox.document-link.create"
            | "homebox.maintenance.create"
            | "homebox.entity-type.create"
            | "homebox.template.create"
            | "homebox.template.create-item"
    )
}

fn atlas_mutation_targets(request: &StockRequest) -> StockResult<Vec<Value>> {
    if request.id().as_str() != "atlas.binding.remap" {
        return Ok(vec![request.target_value().clone()]);
    }
    let payload = request.payload();
    require(
        request.target_value()["recordId"] == payload["oldBindingId"],
        "remap selected record differs from oldBindingId",
    )?;
    Ok(vec![
        request.target_value().clone(),
        json!({"authority":"atlas","recordType":"binding","recordId":payload["newBindingId"]}),
        json!({"authority":"atlas","recordType":"reconciliation","recordId":payload["journalId"]}),
    ])
}

fn collect_network(
    request: &StockRequest,
    data: &Value,
    obligations: &mut Vec<OutputObligation>,
) -> StockResult<()> {
    let capability = request
        .id()
        .as_str()
        .split('.')
        .nth(1)
        .ok_or_else(|| StockError::correlation("invalid Network command"))?;
    require(
        data["capability"] == capability,
        "Network capability differs",
    )?;
    for (index, row) in array(data, "devices")?.iter().enumerate() {
        let source = &row["source"];
        require(
            matches!(
                source["sourceKind"].as_str(),
                Some("network-device" | "network-group" | "network-interface" | "network-segment")
            ) && source["sourceInstanceId"] == request.target_value()["sourceInstanceId"]
                && source["collectionId"] == request.target_value()["collectionId"],
            "Network device source partition differs",
        )?;
        obligations.push(OutputObligation {
            kind: OutputObligationKind::NetworkSource,
            path: format!("/data/devices/{index}"),
            target: None,
            value: row.clone(),
        });
    }
    for (index, relation) in array(data, "relations")?.iter().enumerate() {
        require(
            relation["workspaceId"] == request.context().workspace_id
                && relation["homeId"] == request.context().home_id
                && relation["sourceInstanceId"] == request.target_value()["sourceInstanceId"]
                && relation["collectionId"] == request.target_value()["collectionId"],
            "Network relation scope or partition differs",
        )?;
        check_clock(&relation["retrievedAt"])?;
        // from/to are frozen networkEndpoint values, not qualified source keys.
        // Their actual ownership/disclosure needs the owner's retained graph.
        obligations.push(OutputObligation {
            kind: OutputObligationKind::NetworkSource,
            path: format!("/data/relations/{index}"),
            target: None,
            value: relation.clone(),
        });
    }
    Ok(())
}

/// Finite millisecond clock using the published schema's date-time forms and
/// the accepted native Date.parse port. This preserves the wire string, reads
/// no real clock and decides no freshness, expiry, admission or provider end.
pub fn operational_time(value: &str) -> StockResult<i64> {
    if !super::super::semantics::published_date_time_format(value) {
        return Err(StockError::correlation(
            "invalid operational date-time shape",
        ));
    }
    super::super::semantics::finite_timestamp_millis(value)
        .ok_or_else(|| StockError::correlation("operational clock is not finite"))
}

fn check_clock(value: &Value) -> StockResult<()> {
    let value = value
        .as_str()
        .ok_or_else(|| StockError::correlation("operational clock is not a string"))?;
    operational_time(value).map(|_| ())
}

fn nonnegative_integer(value: &Value) -> StockResult<u64> {
    let number = value
        .as_f64()
        .filter(|number| {
            number.is_finite()
                && *number >= 0.0
                && *number <= 9_007_199_254_740_991.0
                && number.fract() == 0.0
        })
        .ok_or_else(|| {
            StockError::correlation("output correlation bound is not a safe nonnegative integer")
        })?;
    Ok(number as u64)
}

fn require(condition: bool, message: &str) -> StockResult<()> {
    if condition {
        Ok(())
    } else {
        Err(StockError::correlation(message))
    }
}
